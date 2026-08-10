# Contracts Reference

**Every interface in MuxCore, documented.** Contracts are the patterns modules agree to follow. This page catalogs every fabric contract. For domain contracts (media-specific interfaces for downloading, playback, etc.), see [Module System](Module-System).

---

## How to Read This Page

Each contract lists:
- **What it does** — in plain language
- **How modules get it** — Fabric field, auto-detected, or runtime discovery
- **The interface** — Go code for module developers

> **Not a developer?** You don't need this page. It's a technical reference for people building modules. See [Module System](Module-System) for a friendlier overview.

---

## Core Services (Always Available)

These services are always available via gRPC on the mesh address. Sidecar modules access them through generated proto clients.

### Registry — Module Discovery

**What it does:** The phone book of the platform. Modules use it to find other modules.

**How to get it:** Via `DiscoveryService` gRPC

```go
type Registry interface {
    FindByRole(role string) []ModuleEntry
    FindByCapability(cap string) []ModuleEntry
    SupportsCapability(moduleID, cap string) bool
    Resolve(id string) (ModuleEntry, error)
    ListAll() []ModuleEntry
}
```

### EventBus — Publish and Subscribe

**What it does:** The central nervous system. Modules publish events; other modules subscribe.

**How to get it:** Via `EventService` gRPC

```go
type EventBus interface {
    Publish(ctx context.Context, event Event) error
    Subscribe(ctx context.Context, eventType string, handler EventHandler) error
    Unsubscribe(ctx context.Context, eventType string, handler EventHandler) error
    // Request publishes an event and waits for a reply.
    Request(ctx context.Context, event Event, timeout time.Duration) (Event, error)
    // SubscribeModule registers a handler tagged with a module identifier
    // for clean lifecycle management via UnsubscribeAll.
    // Returns a cancel func that unsubscribes this handler.
    SubscribeModule(ctx context.Context, moduleID, eventType string, handler EventHandler) (cancel func(), err error)
    // UnsubscribeAll removes all subscriptions for a given module ID.
    UnsubscribeAll(ctx context.Context, moduleID string) error
}
```

### StorageOrchestrator — File Storage

**What it does:** Store and retrieve files by ID. Modules never touch filesystem paths.

**How to get it:** Via `StorageService` gRPC

```go
type StorageOrchestrator interface {
    Get(ctx context.Context, key string) (io.ReadCloser, error)
    Put(ctx context.Context, key string, data io.Reader, size int64) error
    Delete(ctx context.Context, key string) error
    Move(ctx context.Context, src, dst string) error
    Exists(ctx context.Context, key string) (bool, error)
    Stat(ctx context.Context, key string) (ObjectInfo, error)
    List(ctx context.Context, prefix string) ([]ObjectInfo, error)
    Stream(ctx context.Context, key string, offset, length int64) (io.ReadCloser, error)
    CapabilityCheck(ctx context.Context, key string) ([]string, error)
    Promote(ctx context.Context, key string) error
    Relegate(ctx context.Context, key string) error
}
```

### Cluster — Multi-Machine Membership

**What it does:** Track which machines are in the cluster, who's the leader. Always started by core (including single-node deployments).

**How to get it:** Via `DiscoveryService` cluster RPCs

```go
type Cluster interface {
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
    Members() []NodeInfo
    Leader() *NodeInfo
    LocalNode() NodeInfo
    Events() <-chan ClusterEvent
    Health(ctx context.Context) error
    FindNodesByLabel(ctx context.Context, label, value string) []NodeInfo
    FindNodesByModule(ctx context.Context, moduleID string) []NodeInfo
}
```

### WorkerPool — Distributed Tasks

**What it does:** Schedule work across workers. Submit a task, it lands on an available worker.

**How to get it:** Core registers a built-in `core.workerpool`. The optional `worker-pool-memory` module also advertises the capability but is **deprecated** / superseded by the built-in.

```go
type WorkerPool interface {
    Submit(ctx context.Context, task WorkerTask) (string, error)
    Status(ctx context.Context, taskID string) (WorkerTask, error)
    Cancel(ctx context.Context, taskID string) error
    List(ctx context.Context, filter *WorkerTaskFilter) ([]WorkerTask, error)
}
```

### AuditLogger — Security Record

**What it does:** Record who did what, when, from where.

**How to get it:** Via audit module (auto-wired by core)

```go
type AuditLogger interface {
    Log(ctx context.Context, entry AuditEntry) error
    Query(ctx context.Context, filter AuditFilter) ([]AuditEntry, error)
    Export(ctx context.Context, format string) (io.ReadCloser, error)
}
```

### ModuleMeshClient — Direct Module Calls

**What it does:** Call another module directly for request/response patterns. All calls route through the gRPC mesh.

**How to get it:** Via `ModuleMesh` gRPC

```go
type ModuleMeshClient interface {
    Call(ctx context.Context, targetModule, method string, payload []byte) ([]byte, error)
    RegisterHandler(moduleID string, handler MeshHandler)
}
```

---

## Discoverable Infrastructure Services

These services are provided by optional infrastructure modules. Other modules discover them at runtime via `FindByCapability()`.

### AuthProvider — User Authentication

```go
type AuthProvider interface {
    Authenticate(ctx context.Context, credentials Credentials) (Session, error)
    Validate(ctx context.Context, token string) (Session, error)
    Revoke(ctx context.Context, token string) error
}
```

### Authorizer — Permission Checks

```go
type Authorizer interface {
    Can(ctx context.Context, session Session, action string, resource string) (bool, error)
}
```

### RateLimiterProvider — API Throttling

```go
type RateLimiterProvider interface {
    Allow(ctx context.Context, key string) bool
    Enabled() bool
}
```

### HealthMonitor — Health Checks

```go
type HealthMonitor interface {
    StartMonitoring(ctx context.Context, reg Registry, bus EventBus) error
    Stop(ctx context.Context) error
}
```

### CallPolicyProvider — Inter-Module Access Control

**What it does:** Determines whether module A is allowed to call module B. The mesh client enforces this before dispatching calls. If no provider is registered, all calls are **denied by default** (deny-by-default). Deployments that want open mode must register an explicit permissive call policy provider.

```go
type CallPolicyProvider interface {
    AllowCall(ctx context.Context, callerModuleID, targetModuleID, method string) (bool, error)
}
```

**Setting caller identity on outgoing calls:**

```go
ctx = contracts.WithCallerID(ctx, "my-module")
result, err := meshv1.NewModuleMeshClient(conn).Call(ctx, &meshv1.CallRequest{TargetModule:  "target-module", "Method", payload)
```

---

## Runtime Discovery Services

These services are discovered by modules at runtime via `FindByCapability()`. If none is registered, the service is simply unavailable — modules degrade gracefully.

### SecretsProvider — API Keys and Passwords

**Capability:** `"secrets"`

```go
type SecretsProvider interface {
    Get(ctx context.Context, key string) (string, error)
    Set(ctx context.Context, key, value string) error
    Delete(ctx context.Context, key string) error
    List(ctx context.Context) ([]string, error)
}
```

### DatabaseProvider — Persistent Storage

**Capability:** `"database"`

```go
type DatabaseProvider interface {
    Open(ctx context.Context, connString string) error
    Close(ctx context.Context) error
    Health(ctx context.Context) error
    Exec(ctx context.Context, query string, args ...any) (int64, error)
    Query(ctx context.Context, query string, args ...any) (Rows, error)
    Transaction(ctx context.Context, fn func(Tx) error) error
    Migrate(ctx context.Context, migrations []Migration) error
}
```

### CacheProvider — Ephemeral State

**Capability:** `"cache"`

```go
type CacheProvider interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
    Delete(ctx context.Context, keys ...string) error
    Exists(ctx context.Context, key string) (bool, error)
    Incr(ctx context.Context, key string, delta int64) (int64, error)
    CompareAndSwap(ctx context.Context, key string, oldValue, newValue []byte) (bool, error)
    Lock(ctx context.Context, key string, ttl time.Duration) (LockHandle, error)
    Publish(ctx context.Context, channel string, msg []byte) error
    Subscribe(ctx context.Context, channel string) (<-chan []byte, error)
}
```

### CacheLayer — Storage Read-Through Cache

**Capability:** `"cache.local"`

```go
type CacheLayer interface {
    Get(ctx context.Context, key string) ([]byte, bool)
    Set(ctx context.Context, key string, data []byte) error
    Invalidate(ctx context.Context, prefix string) error
}
```

### MetricsProvider — Counters, Gauges, Histograms

**Capability:** `"metrics"`

```go
type MetricsProvider interface {
    Counter(name string, labels map[string]string) Counter
    Gauge(name string, labels map[string]string) Gauge
    Histogram(name string, labels map[string]string, buckets []float64) Histogram
}
```

### TracingProvider — Distributed Request Tracing

**Capability:** `"tracing"`

```go
type TracingProvider interface {
    StartSpan(ctx context.Context, name string) (context.Context, Span)
}

type Span interface {
    SetAttribute(key string, value string)
    SetStatus(code SpanStatusCode, description string)
    End()
}
```

### CircuitBreaker — Fail-Fast Protection

**Capability:** `"circuitbreaker"`

```go
type CircuitBreaker interface {
    Execute(ctx context.Context, key string, fn func(context.Context) error) error
    State(key string) CircuitState  // Closed, Open, HalfOpen
}
```

### ConfigWatcher — Runtime Change Notifications

**Capability:** `"config.watcher"`

```go
type ConfigWatcher interface {
    OnChange(ctx context.Context, capability string, handler func()) (cancel func())
}
```

### DeadLetterProvider — Failed Event Storage

**Capability:** `"deadletter"`

```go
type DeadLetterProvider interface {
    Store(ctx context.Context, event Event, handlerName string, err error) error
    Replay(ctx context.Context, handlerName string, since time.Time) ([]DeadLetterEntry, error)
    Discard(ctx context.Context, eventID string) error
}
```

### IdentityProvider — Caller Identity Extraction

**Capability:** `"identity"`

```go
type IdentityProvider interface {
    ExtractIdentity(ctx context.Context) (*Identity, error)
}

type Identity struct {
    ID     string
    Kind   string
    Roles  []string
    Claims map[string]any
    Extra  map[string]any
}
```

### StructuredLogger — Structured Logging

**Capability:** `"logging"`

```go
type StructuredLogger interface {
    Debug(ctx context.Context, msg string, fields map[string]any)
    Info(ctx context.Context, msg string, fields map[string]any)
    Warn(ctx context.Context, msg string, fields map[string]any)
    Error(ctx context.Context, msg string, fields map[string]any)
    Level() LogLevel
}
```

### RetryProvider — Retry with Backoff

**Capability:** `"retry"`

```go
type RetryProvider interface {
    Execute(ctx context.Context, policy RetryPolicy, fn func(context.Context) error) error
}

type RetryPolicy struct {
    MaxAttempts   int
    InitialDelay  time.Duration
    MaxDelay      time.Duration
    BackoffFactor float64
    Jitter        bool
    Extra         map[string]any
}
```

### IdempotencyProvider — Duplicate Prevention

**Capability:** `"idempotency"`

```go
type IdempotencyProvider interface {
    Store(ctx context.Context, key string, result []byte, ttl time.Duration) (bool, error)
    Exists(ctx context.Context, key string) (bool, error)
    Result(ctx context.Context, key string) ([]byte, error)
}
```

### FeatureFlagProvider — Gradual Rollouts

**Capability:** `"feature.flags"`

```go
type FeatureFlagProvider interface {
    IsEnabled(ctx context.Context, flag string, defaultValue bool) bool
    GetVariant(ctx context.Context, flag string, defaultValue string) string
}
```

### SerializationProvider — Content-Type Negotiation

**Capability:** `"serialization"`

```go
type SerializationProvider interface {
    Marshal(contentType string, v any) ([]byte, error)
    Unmarshal(contentType string, data []byte, v any) error
    SupportedTypes() []string
}
```

### EncryptionProvider — Envelope Encryption

**Capability:** `"encryption"`

```go
type EncryptionProvider interface {
    Encrypt(ctx context.Context, plaintext []byte) ([]byte, error)
    Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error)
    RotateKey(ctx context.Context) error
}
```

### DistributedLockProvider — Coordination

**Capability:** `"distributed.lock"`

```go
type DistributedLockProvider interface {
    Acquire(ctx context.Context, key string, ttl time.Duration) (DistributedLockHandle, error)
}

type DistributedLockHandle interface {
    Unlock(ctx context.Context) error
    Renew(ctx context.Context, ttl time.Duration) error
}
```

### DataRedactionProvider — PII Stripping

**Capability:** `"data.redaction"`

```go
type DataRedactionProvider interface {
    Redact(ctx context.Context, data map[string]any, rules []string) (map[string]any, error)
}
```

### EventStore — Append-Only Event Log

**Capability:** `"event.store"`

```go
type EventStore interface {
    Append(ctx context.Context, stream string, events []Event) (firstSequence int64, err error)
    Read(ctx context.Context, stream string, fromSequence int64, limit int) ([]EventStoreEntry, error)
    Subscribe(ctx context.Context, stream string, fromSequence int64) (<-chan EventStoreEntry, error)
    Streams(ctx context.Context) ([]string, error)
}
```

---



## gRPC Services (Sidecar Module Access)

These gRPC services are exposed on the mesh address. Sidecar modules use them to access core services. Compiled-in modules use the Fabric equivalents directly.

### StorageService

| RPC | Purpose |
|-----|---------|
| `Put(stream PutRequest) returns PutResponse` | Client-streams an object into storage |
| `Get(GetRequest) returns stream GetResponse` | Server-streams an object from storage (supports byte ranges) |
| `Delete(DeleteRequest) returns DeleteResponse` | Removes an object |
| `Stat(StatRequest) returns StatResponse` | Object metadata (size, type, modification time) |
| `List(ListRequest) returns ListResponse` | Objects matching a key prefix |
| `Capabilities(CapabilitiesRequest) returns CapabilitiesResponse` | Which optional interfaces the backend supports (hardlinkable, streamable, etc.) |

**Proto:** `muxcore/storage/v1/storage.proto`

### DiscoveryService (Registry Queries)

Extended with module discovery RPCs for sidecar modules:

| RPC | Purpose |
|-----|---------|
| `FindByCapability(FindByCapabilityRequest) returns FindByCapabilityResponse` | Find modules by capability string |
| `FindByRole(FindByRoleRequest) returns FindByRoleResponse` | Find modules by role string |
| `Resolve(ResolveRequest) returns ResolveResponse` | Get a single module's info by ID |
| `ListAll(ListAllRequest) returns ListAllResponse` | All registered modules (local + peer), with state and health |

Plus cluster membership RPCs: `Join`, `Leave`, `Heartbeat`, `Members`, `Watch`.

**Proto:** `muxcore/discovery/v1/discovery.proto`

### EventService

| RPC | Purpose |
|-----|---------|
| `Publish(PublishRequest) returns PublishResponse` | Send an event to all subscribers |
| `Subscribe(SubscribeRequest) returns stream Event` | Receive events matching types |
| `Request(RequestEvent) returns Event` | Request/reply event pattern |

**Proto:** `muxcore/events/v1/events.proto`

### ModuleMesh

| RPC | Purpose |
|-----|---------|
| `Call(CallRequest) returns CallResponse` | Unary call to a specific module |
| `StreamCall(stream CallRequest) returns stream CallResponse` | Bidirectional streaming calls |

**Proto:** `muxcore/mesh/v1/module.proto`

### ModuleRegistration

| RPC | Purpose |
|-----|---------|
| `Register(RegisterRequest) returns RegisterResponse` | Register a sidecar module (returns `mesh_addr`, `node_id`) |
| `Unregister(UnregisterRequest) returns UnregisterResponse` | Unregister at shutdown |
| `BootstrapRegister(BootstrapRegisterRequest) returns BootstrapRegisterResponse` | External modules obtain a signed TLS certificate using a one-time token |

**Proto:** `muxcore/module/v1/registration.proto`

### SpoolService (Admin)

| RPC | Purpose |
|-----|---------|
| `ListSpools(ListSpoolsRequest) returns ListSpoolsResponse` | Returns all configured spool URLs |
| `ListTags(ListTagsRequest) returns ListTagsResponse` | Lists all tag names on a spool |
| `FetchTag(FetchTagRequest) returns FetchTagResponse` | Fetches a tag definition without deploying |
| `DeployTag(DeployTagRequest) returns DeployTagResponse` | Fetches, resolves, and spawns modules from a tag. Idempotent |

**Proto:** `muxcore/spool/v1/spool.proto`

### ModuleLifecycleService (Admin)

| RPC | Purpose |
|-----|---------|
| `ListModules(ListModulesRequest) returns ListModulesResponse` | All modules known to this node with state and health |
| `SpawnModule(SpawnModuleRequest) returns SpawnModuleResponse` | Resolve and spawn a module from a tag entry |
| `StopModule(StopModuleRequest) returns StopModuleResponse` | Send SIGTERM and wait for stop |
| `RestartModule(RestartModuleRequest) returns RestartModuleResponse` | Kill and re-spawn from existing binary |

**Proto:** `muxcore/lifecycle/v1/lifecycle.proto`

### AuditService (Admin)

| RPC | Purpose |
|-----|---------|
| `Query(AuditQueryRequest) returns AuditQueryResponse` | Search audit entries by actor, action, resource, time range |
| `Export(AuditExportRequest) returns stream AuditExportChunk` | Stream matching entries in JSON or CSV |
| `VerifyChain(AuditVerifyChainRequest) returns AuditVerifyChainResponse` | Hash-chain integrity check without exposing entry content |
| `Log(LogRequest) returns LogResponse` | Write an entry to the audit log |

**Proto:** `muxcore/audit/v1/audit.proto`

### Service Discovery Flow

```
Sidecar Module                      Core gRPC (mesh_addr)
     │                                       │
     │── Register(ModuleInfo) ──────────────►│  ModuleRegistration
     │◄─ RegisterResponse{mesh_addr} ────────│
     │                                       │
     │── FindByCapability("storage") ───────►│  DiscoveryService
     │◄─ [{id, capabilities, roles}...] ─────│
     │                                       │
     │── Put(key, chunks) ──────────────────►│  StorageService
     │◄─ PutResponse{key, size} ────────────│
     │                                       │
     │── Publish(event) ────────────────────►│  EventService
     │◄─ PublishResponse{} ─────────────────│
```

## Storage Capability Interfaces

Storage providers can optionally implement these to advertise features:

```go
type Streamable interface {
    Stream(ctx context.Context, key string, offset, length int64) (io.ReadCloser, error)
}

type Seekable interface {
    Seek(ctx context.Context, key string, offset int64) (int64, error)
}

type Watchable interface {
    Watch(ctx context.Context, prefix string) (<-chan StorageEvent, error)
}

type AtomicMovable interface {
    AtomicMove(ctx context.Context, src, dst string) error
}

type Hardlinkable interface {
    Hardlink(ctx context.Context, src, dst string) error
}

type TieredProvider interface {
    // Tier management for hot/warm/cold storage
}
```

---

## Other Fabric Contracts

### Scheduler — Task Scheduling

**Module-only** — core has no built-in Scheduler. Discover via capability `"scheduler"` (reference impl: `scheduler-cron`).

```go
type Scheduler interface {
    Schedule(ctx context.Context, task SchedulerTask) (string, error)
    Cancel(ctx context.Context, taskID string) error
    Status(ctx context.Context, taskID string) (SchedulerTaskStatus, error)
}
```

### BackupProvider — Backup and Restore

```go
type BackupProvider interface {
    CreateBackup(ctx context.Context) (BackupInfo, error)
    Restore(ctx context.Context, backupID string) error
    ListBackups(ctx context.Context) ([]BackupInfo, error)
    DeleteBackup(ctx context.Context, backupID string) error
}

type Backupable interface {
    ExportState(ctx context.Context) ([]byte, error)
    ImportState(ctx context.Context, data []byte) error
}
```

### SettingsProvider — Module Configuration UI

```go
type SettingsProvider interface {
    Settings() []SettingDef
}
```

### Executor — Worker Task Handler

```go
type Executor interface {
    CanHandle(taskType string) bool
    Execute(ctx context.Context, task WorkerTask) (result []byte, err error)
}
```

---


### WorkflowEngine

**Capability:** `"workflow.engine"`

Multi-step tapestry orchestration. Discovered via `FindByCapability("workflow.engine")`.

| Method | Description |
|--------|-------------|
| `RegisterDefinition` | Store a tapestry template |
| `RemoveDefinition` | Remove a tapestry template |
| `GetDefinition` | Retrieve a tapestry template |
| `ListDefinitions` | List all registered tapestries |
| `Run` | Start a tapestry execution |
| `Status` | Check tapestry progress |
| `Cancel` | Stop a running tapestry |
| `Pause` | Suspend at next step boundary |
| `Resume` | Continue a paused tapestry |
| `ListRuns` | Query tapestry history |

**Types:** `TapestryDefinition`, `TapestryStep`, `TapestryRun`, `StepResult`, `TapestryRunFilter`

**Event types:** `workflow.step.started`, `workflow.step.completed`, `workflow.step.failed`

**Step-to-step data passing:** `StepResult.Output` + `TapestryStep.InputMapping`

**DAG support:** `depends_on` enables parallel converging steps.

## Media Admin Service Contract

**Repo:** `github.com/Muxcore-Media/contracts-media-admin`
**Capability:** `"media.library"`

Media library modules (movies, TV, books, etc.) implement the `MediaAdminService` gRPC service to provide browsing, search, metadata editing, and artwork management to the admin UI. Core never imports this proto — it is a domain contract between media modules and the admin UI.

### Proto: `muxcore.media.admin.v1.MediaAdminService`

**RPCs:**

| RPC | Request | Response | Purpose |
|-----|---------|----------|---------|
| `GetMediaTypeInfo` | `GetMediaTypeInfoRequest` | `GetMediaTypeInfoResponse` | Returns display name ("Movies"), icon, and available filter fields for the admin UI nav tab |
| `ListItems` | `ListItemsRequest` | `ListItemsResponse` | Paginated, filterable, searchable list of media items |
| `GetItem` | `GetItemRequest` | `GetItemResponse` | Single media item with full detail |
| `UpdateMetadata` | `UpdateMetadataRequest` | `UpdateMetadataResponse` | Edit title, description, and type-specific metadata fields |
| `ListArtwork` | `ListArtworkRequest` | `ListArtworkResponse` | Artwork variants for a media item |
| `ReplaceArtwork` | stream `ReplaceArtworkRequest` | `ReplaceArtworkResponse` | Upload or replace artwork image |

### Key Design: The Meta Pattern

Each `MediaItem` carries a `map<string, string> metadata` field for type-specific data. Movie modules store `{"runtime": "148", "director": "James Cameron"}`, TV modules store `{"season_count": "5", "episode_count": "62"}`, book modules store `{"author": "Frank Herbert", "page_count": "412"}`. The admin UI renders these fields generically based on `FilterField` definitions from `GetMediaTypeInfo`.

### Communication Pattern

The admin UI discovers media modules by `FindByCapability("media.library")`, gets each module's `HTTPAddr`, dials the module's gRPC `MediaAdminService` endpoint directly, and calls the appropriate RPC. This is the same direct-gRPC pattern used for the auth provider.

### Module Registration

Media modules must register with core declaring the `"media.library"` capability:

```go
regClient.Register(ctx, &modulev1.RegisterRequest{
    ModuleId: "media-movies",
    ModuleInfo: &modulev1.ModuleInfo{
        Name:         "Movies",
        Capabilities: []string{"media.library"},
        HttpAddr:     ":9420",  // media-movies gRPC (see Port-Map; not :9410)
    },
})
```

## Domain Contracts

Domain contracts live in separate versioned repos under `github.com/Muxcore-Media/contracts-*`. Core imports none of them (workflow types for tapestries live in core `pkg/contracts/workflow.go`).

| Repo | What it defines |
|------|-----------------|
| `contracts-downloader` | gRPC `DownloaderService` (`AddTorrent`, `GetTorrent`, `ListTorrents`, …) |
| `contracts-indexer` | Indexer / search types |
| `contracts-media-admin` | Media admin gRPC / admin UI seam |
| `contracts-reconciler` | Structural contract reconciliation |

Additional domain packages may appear as media modules land; do not assume a repo exists until it is published.

---

## Third-Party Contracts

Domain contract interfaces are patterns, not org-bound dependencies. A module that defines its own `MediaLibrary` interface in `github.com/some-dev/contracts-media` is weaving the same pattern — but Go's nominal type system treats it as a different type.

### Structural Compatibility

Two interfaces are structurally compatible if they have:

- The same exported method names
- The same parameter types in the same order
- The same return types in the same order

Package paths, comments, and embedded interfaces are **not** compared. Only the method signatures matter.

### Contract Reconciliation

When the spool marketplace imports a module that uses non-canonical contract repos, it runs the `contracts-reconciler` engine:

1. Parses both the third-party and canonical contract repos' Go source via AST
2. Extracts the named interface and compares method signatures structurally
3. If they match, generates a `go.mod replace` directive normalizing the import to the canonical path
4. If they differ, rejects the import with a detailed mismatch report

This preserves interface compatibility while honoring the MuxCore philosophy that contracts are patterns, not org-bound dependencies.

### Type Aliases (Recommended)

The simplest approach for third-party contract repos is to use Go type aliases:

```go
package media

import "github.com/Muxcore-Media/contracts-media"

// Type alias — this IS the canonical type. No reconciliation needed.
type MediaLibrary = media.MediaLibrary
type MediaObject   = media.MediaObject
type MediaFilter   = media.MediaFilter
type MediaType     = media.MediaType
```

Modules importing from this repo get the canonical types directly. The Go compiler treats them as identical. No reconciliation step is needed.

### Declaring Contracts

Third-party modules declare their contract usage in `muxcore.json`:

```json
{
  "contracts": [
    {
      "repo": "github.com/my-org/contracts-downloader",
      "version": "v2.0.0",
      "interface": "DownloaderService"
    }
  ]
}
```

This tells the spool marketplace which interfaces to reconcile. Modules that use type aliases or import canonical repos directly don't need this declaration.

See [Spool and Marketplace](Spool-and-Marketplace) for the full import and reconciliation flow.

## Next Steps

- [Writing Modules](Writing-Modules) — how to use these contracts in practice
- [Module System](Module-System) — discovery and lifecycle patterns