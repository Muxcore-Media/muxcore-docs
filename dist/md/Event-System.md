# Event System

**Events (signals) are how modules communicate without knowing about each other.** This page explains the event bus, event types, how to publish and subscribe, and module lifecycle event management.

---

## How Events Work

Modules publish events on the event bus. Other modules subscribe to event types they care about. The publisher never knows who's listening:

```
Downloader publishes: "download.completed"
    ↓
Media Manager receives it → imports the file
Transcoder receives it → starts optimizing
Notification module receives it → sends a Discord message
```

---

## Event Types

Event types use dotted naming: `domain.action`. Core defines infrastructure events. Domain contracts define domain events.

### Core Events

| Event Type | Payload | When |
|-----------|---------|------|
| `module.registered` | `ModuleRegisteredPayload` | Module registers successfully |
| `module.unregistered` | `ModuleUnregisteredPayload` | Module unregisters |
| `module.degraded` | `ModuleDegradedPayload` | Module health check fails |

### Cluster channel types (not bus publishes today)

`DiscoveryService.Watch` / cluster membership uses short `ClusterEventType` values (`node.joined`, `node.left`, `node.degraded`, `leader.changed`). Matching **bus** constants exist as `cluster.node.joined`, `cluster.node.left`, `cluster.node.degraded`, `cluster.leader.changed` (`pkg/contracts/cluster.go`) but core does **not** currently `Publish` those onto the event bus — subscribe to the discovery/cluster watch path for membership, not the bus, until that lands.

### Domain Events

Media/download event type constants live in core `pkg/contracts` (e.g. `media_events.go`). Examples:

- `download.started`, `download.completed`, `download.failed` — published by downloader modules (e.g. `downloader-native-torrent`); there is no `download.progress` bus event today
- `media.movie.added` / `.removed` / `.updated` / `.file_added` / `.file_removed`
- `media.tv.added` / `.removed` / `.updated` / `.episode_file_added` / `.episode_file_removed`
- `media.file.imported`, `media.download.dispatched`
- `tapestry.step.started`, `tapestry.step.completed`, `tapestry.step.failed` — workflow engine (`pkg/contracts/workflow.go`)
- `tapestry.started`, `tapestry.completed`, `tapestry.failed`, `tapestry.cancelled`, `tapestry.paused`, `tapestry.resumed`

---

## Publishing Events

```go
import "github.com/Muxcore-Media/core/pkg/contracts"

payload, _ := json.Marshal(contracts.DownloadEventPayload{
    ID:       id,
    Name:     "The Terminator",
    InfoHash: infoHash,
    SavePath: savePath,
})

bus.Publish(ctx, contracts.Event{
    Type:    contracts.EventDownloadCompleted,
    Source:  "downloader-native-torrent",
    Payload: payload,
})
```

Sidecar modules publish via gRPC:

```go
events := eventsv1.NewEventServiceClient(conn)
events.Publish(ctx, &eventsv1.PublishRequest{
    Event: &eventsv1.Event{
        Type:    "download.completed",
        Source:  moduleID,
        Payload: jsonPayload,
    },
})
```

### Publish Policy

Event publication is deny-by-default until a `PublishPolicyProvider` module is registered (capability `"publish.policy"`). The reference module `publish-policy-default` loads YAML rules from `policies.yaml` (override with `PUBLISH_POLICY_FILE`). Each rule matches a `caller` module ID (or `"*"`) against `event_types` globs (`"download.*"`, `"media.*"`, `"*"`). First matching rule wins.

```yaml
- caller: "downloader-native-torrent"
  event_types: ["download.*"]
- caller: "*"
  event_types: ["module.*", "cluster.*"]
```

---

## Subscribing to Events

```go
bus.Subscribe(ctx, contracts.EventDownloadCompleted, func(ctx context.Context, event contracts.Event) error {
    var payload contracts.DownloadEventPayload
    json.Unmarshal(event.Payload, &payload)
    // Process the download...
    return nil
})
```

Use `"*"` to subscribe to all events (useful for audit loggers and monitoring modules).

Sidecar modules subscribe via gRPC streaming:

```go
events := eventsv1.NewEventServiceClient(conn)
stream, _ := events.Subscribe(ctx, &eventsv1.SubscribeRequest{
    EventTypes: []string{"download.completed", "media.file.imported"},
})
for {
    event, err := stream.Recv()
    // Handle event...
}
```

---

## Per-Module Subscriptions (SubscribeModule / UnsubscribeAll)

Modules that subscribe to events during `Start()` and need clean teardown during `Stop()` should use `SubscribeModule` and `UnsubscribeAll`:

```go
// In Start():
bus.SubscribeModule(ctx, m.id, "download.completed", m.handleDownloadCompleted)

// In Stop():
bus.UnsubscribeAll(ctx, m.id)  // removes all subscriptions tagged with this module ID
```

This is cleaner than tracking individual handler references. `UnsubscribeAll` removes every subscription tagged with the given module ID in a single call — no need to store and individually unsubscribe each handler.

`UnsubscribeAll` with an empty module ID is a no-op. It only removes subscriptions that were registered with `SubscribeModule`.

---

## Request-Reply Pattern

For synchronous request-reply, use `Request()`:

```go
reply, err := bus.Request(ctx, contracts.Event{
    Type:    "metadata.lookup",
    Source:  "media-movies",
    Payload: payload,
}, 5*time.Second)
```

The event bus creates a temporary subscription for `<type>.reply`, publishes the request event, and waits for a reply. The first reply wins. Timeout or context cancellation returns an error.

---

## Replay (event journal)

gRPC `EventService.Replay` streams historical events from the WAL when `MUXCORE_EVENT_JOURNAL_PATH` is set (see [Configuration Reference](Configuration-Reference)). Without a journal path, replay is unavailable.

---

## Event Handler Guidelines

- **Handlers run concurrently** — the event bus dispatches each handler in its own goroutine. Don't rely on handler ordering.
- **30-second timeout** — each handler gets a 30-second context timeout. Long-running work should be enqueued, not done in the handler.
- **Return errors for logging** — returned errors are logged but don't affect other subscribers.
- **Don't block** — if your handler does heavy work, spawn a goroutine.
- **Trace propagation** — trace IDs are propagated from publisher to subscriber context automatically.

---

## Audit Events

When an audit logger is configured, the event bus records every `Publish`, `Subscribe`, and `Unsubscribe` call:

| Action | Audited Fields |
|--------|---------------|
| `event.publish` | source, event type, subscriber count, trace ID |
| `event.subscribe` | event type, handler pointer |
| `event.unsubscribe` | event type, handler pointer |

Read operations (`Get`, `List`, `Exists`) are intentionally not audited at the bus level — they're hot paths that would overwhelm the audit trail.

---

## Event Schema Versioning

The constant `EventSchemaVersion = "v1"` is defined in `pkg/contracts/eventschema.go` but is **reserved** — it is not currently consumed at runtime. It is defined for future typed-payload support. Current events use raw `[]byte` payloads that callers marshal/unmarshal themselves.

---

## Next Steps

- [Module System](Module-System) — how modules discover each other
- [Contracts Reference](Contracts) — EventBus and EventHandler interfaces
- [Writing Modules](Writing-Modules) — publish and subscribe from sidecar modules
