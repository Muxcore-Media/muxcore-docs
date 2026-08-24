# Module System

**Everything in MuxCore is a module.** Downloading, indexing, playback, transcoding, storage, notifications — every feature is a pluggable module behind a standard interface. This page explains how modules work, how they find each other, and every type of module you can add.

---

## What Is a Module?

A module is a **standalone binary** that:

1. Implements a standard lifecycle (Init, Start, Stop, Health)
2. Declares its role, capabilities, and which contracts it implements
3. Registers with the platform via gRPC at startup
4. Can be discovered by other modules at runtime

Think of a module like an app on your phone. Each one does something specific — a downloader, a media manager, a notification sender. But unlike phone apps, modules can see each other and work together automatically.

---

## Module Lifecycle

Every module goes through the same lifecycle:

```
Register → Init → Start → Running → Stopping → Stopped
                            ↓
                         Degraded
```

| State | What it means |
|-------|--------------|
| **Registered** | Module has called `ModuleRegistration.Register()` and been accepted by core |
| **Starting** | Module is being initialized |
| **Running** | Module is active and working |
| **Degraded** | Module is running but with reduced capability |
| **Stopping** | Module is shutting down |
| **Stopped** | Module has cleanly shut down |

A module becomes **Degraded** when it depends on an external service that isn't available. For example, if a metadata module cannot reach TMDB, it starts in degraded state.

---

## How Modules Register

Modules are standalone binaries that connect to core's gRPC mesh. The registration flow:

```
Module binary starts with:
  --muxcore-mesh-addr localhost:9090
  --muxcore-module-id downloader-native-torrent

1. Dial core's gRPC mesh
2. Call ModuleRegistration.Register() RPC
3. Receive RegisterResponse { mesh_addr, node_id }
4. Use mesh_addr for all subsequent service discovery
```

```go
// Sidecar entry point (cmd/module/main.go)
conn, _ := grpc.NewClient(*meshAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
regClient := modulev1.NewModuleRegistrationClient(conn)

info := mod.Info()

resp, _ := regClient.Register(context.Background(), &modulev1.RegisterRequest{
    ModuleId: *moduleID,
    ModuleInfo: &modulev1.ModuleInfo{
        Id:             info.ID,
        Name:           info.Name,
        Version:        info.Version,
        Roles:          info.Roles,
        Description:    info.Description,
        Author:         info.Author,
        Capabilities:   info.Capabilities,
        DependsOn:      info.DependsOn,
        MinCoreVersion: info.MinCoreVersion,
        HttpAddr:       info.HTTPAddr,
    },
    MeshAddr: *meshAddr,
})
// resp.MeshAddr  → use for all other gRPC services
// resp.NodeId    → core node identifier
```

All modules use this same registration pattern. Core spawns module binaries when started with `--tag`, and each module registers itself.

---

## Module Dependencies (DependsOn)

Modules can declare dependencies on other modules via the `DependsOn` field in `ModuleInfo`:

```go
func (m *Module) Info() contracts.ModuleInfo {
    return contracts.ModuleInfo{
        ID:        "media-transcoder",
        Name:      "FFmpeg Transcoder",
        DependsOn: []string{"cache-redis"},
    }
}
```

### Dependency Ordering

Core uses `Registry.StartupOrder()` to compute a dependency-respecting module initialization order. Modules listed in `DependsOn` are guaranteed to be initialized before the module that depends on them.

```go
order, err := reg.StartupOrder()
// Returns ["cache-redis", "media-transcoder", ...]
```

Cyclic dependencies are detected and return an error.

### Reverse Dependency Lookup

`Registry.DependencyGraph(id)` returns all modules that depend on a given module — useful for impact analysis before stopping or removing a module:

```go
dependents, err := reg.DependencyGraph("cache-redis")
// Returns ["media-transcoder", "media-movies", ...]
```

---

## The Sidecar Bridge — gRPC Services

Module binaries communicate with core entirely through gRPC. Module-facing services and admin services are served on the same gRPC port (default `:9090`):

### Module Services

| Service | Proto | Key RPCs |
|---------|-------|----------|
| `ModuleRegistration` | `module/v1/` | `Register()`, `Unregister()`, `BootstrapRegister()` |
| `DiscoveryService` | `discovery/v1/` | `FindByCapability()`, `FindByRole()`, `Resolve()`, `ListAll()` |
| `StorageService` | `storage/v1/` | `Put()` / `Get()` (streaming), `Delete()`, `Stat()`, `List()`, `Capabilities()` |
| `EventService` | `events/v1/` | `Publish()`, `Subscribe()`, `Request()` |
| `ModuleMesh` | `mesh/v1/` | `Call()`, `StreamCall()` |

### Admin Services

| Service | Proto | Key RPCs |
|---------|-------|----------|
| `SpoolService` | `spool/v1/` | `ListSpools()`, `ListTags()`, `FetchTag()`, `DeployTag()` |
| `ModuleLifecycleService` | `lifecycle/v1/` | `ListModules()`, `SpawnModule()`, `StopModule()`, `RestartModule()` |
| `AuditService` | `audit/v1/` | `Query()`, `Export()`, `VerifyChain()`, `Log()` |

These replace the old in-process `Fabric` struct. Same philosophy, gRPC transport.

---

## Service Discovery

Modules discover each other through the `DiscoveryService` gRPC — there are three ways to find a module:

### By Role (broad)

```go
disc := discoveryv1.NewDiscoveryServiceClient(conn)
resp, _ := disc.FindByRole(ctx, &discoveryv1.FindByRoleRequest{Role: "downloader"})
for _, mod := range resp.Modules {
    // mod.Id, mod.Capabilities, mod.Roles, mod.InfoJson
}
```

Roles are just strings — there's no fixed list. A module can declare any roles it wants.

### By Capability (specific)

```go
resp, _ := disc.FindByCapability(ctx, &discoveryv1.FindByCapabilityRequest{Capability: "secrets"})
```

Capabilities are fine-grained tags that describe what a module can do.

### By ID (direct)

```go
resp, _ := disc.Resolve(ctx, &discoveryv1.ResolveRequest{ModuleId: "downloader-native-torrent"})
```

### Storage Operations

```go
store := storagev1.NewStorageServiceClient(conn)
// Client-streaming upload
stream, _ := store.Put(ctx)
stream.Send(&storagev1.PutRequest{Key: "downloads/abc/file.mkv", TotalSize: size})
stream.Send(&storagev1.PutRequest{Chunk: data})
resp, _ := stream.CloseAndRecv()
```

### Event Publishing

```go
events := eventsv1.NewEventServiceClient(conn)
events.Publish(ctx, &eventsv1.PublishRequest{
    Event: &eventsv1.Event{
        Type:    "download.completed",
        Source:  "downloader-native-torrent",
        Payload: jsonPayload,
    },
})
```

### Cross-Module Calls

```go
mesh := meshv1.NewModuleMeshClient(conn)
resp, _ := mesh.Call(ctx, &meshv1.CallRequest{
    TargetModule: "media-transcoder",
    Method:       "Status",
    Payload:      jsonPayload,
})
```

---

## Contracts and Type Safety

Module binaries communicate via protobuf on the wire. Domain contracts ship as gRPC services in the canonical `contracts-*` repos. A downloader module that registers `DownloaderService` from `github.com/Muxcore-Media/contracts-downloader` exposes the same RPCs a media manager dials via `DownloaderServiceClient` (capability `"downloader"`; impl IDs like `downloader.native.torrent`).

For third-party modules using their own contract repos, the **contracts-reconciler** handles structural compatibility checking and `go.mod replace` directives at import time.

---

## Services Discovered at Runtime

Infrastructure services are discovered at runtime via `DiscoveryService.FindByCapability()`. Core exposes module mesh services (`Discovery`, `Storage`, `Event`, `ModuleMesh`, `ModuleRegistration`) plus `Health` and admin services (`Spool`, `ModuleLifecycle`, `Audit`). Everything else is optional and module-provided (except core built-ins such as WorkerPool, DeadLetter, Retry, Idempotency, and EventStore).

### Common service discovery capabilities

| Service | Capability String | Interface | What It Provides |
|---------|------------------|-----------|-----------------|
| Secrets | `"secrets"` | `SecretsProvider` | API keys, passwords, tokens |
| Database | `"database"` | `DatabaseProvider` | Persistent storage (SQLite, Postgres) |
| Cache | `"cache"` | `CacheProvider` | Ephemeral state, locks, pub/sub |
| Cache Layer | `"cache.local"` | `CacheLayer` | Read-through storage caching |
| Storage | `"storage"` | `StorageProvider` | Blob / object storage backends |
| Metrics | `"metrics"` | `MetricsProvider` | Counters, gauges, histograms |
| Tracing | `"tracing"` | `TracingProvider` | Distributed request tracing |
| Circuit Breaker | `"circuitbreaker"` | `CircuitBreaker` | Fail-fast protection |
| Config Watcher | `"config.watcher"` | `ConfigWatcher` | Runtime service change notifications |
| Dead Letter | `"deadletter"` | `DeadLetterProvider` | Store and replay failed events |
| Call Policy | `"call.policy"` | `CallPolicyProvider` | Inter-module access control |
| Publish Policy | `"publish.policy"` | `PublishPolicyProvider` | Event publication access control |
| Identity | `"identity"` | `IdentityProvider` | Extract caller identity from context |
| Auth | `"auth"` | `AuthProvider` | Authenticate users / tokens |
| Authorizer | `"authorizer"` | `Authorizer` | Permission checks |
| Rate Limit | `"ratelimit"` | `RateLimiterProvider` | Throttle API requests |
| Logging | `"logging"` | `StructuredLogger` | Structured, leveled logging |
| Retry | `"retry"` | `RetryProvider` | Retry with backoff and jitter |
| Idempotency | `"idempotency"` | `IdempotencyProvider` | Prevent duplicate processing |
| Feature Flags | `"feature.flags"` | `FeatureFlagProvider` | Gradual rollouts, kill switches |
| Serialization | `"serialization"` | `SerializationProvider` | Content-type negotiation |
| Encryption | `"encryption"` | `EncryptionProvider` | Envelope encryption for data at rest |
| Distributed Lock | `"distributed.lock"` | `DistributedLockProvider` | Coordination across machines |
| Data Redaction | `"data.redaction"` | `DataRedactionProvider` | Strip PII before logging |
| Event Store | `"event.store"` | `EventStore` | Durable append-only event log |
| Input Validation | `"input.validate"` | `InputValidator` | Schema-based input validation |
| Workflow Engine | `"workflow.engine"` | `WorkflowEngine` | Multi-step tapestry orchestration |
| Worker Pool | `"worker.pool"` | `WorkerPool` | Distributed task execution |
| Scheduler | `"scheduler"` | `Scheduler` | Cron-style scheduling |
| Health Monitor | `"health.monitor"` | `HealthMonitor` | Periodic module health checks |
| Backup | `"backup"` | `BackupProvider` | Backup / restore hooks |
| Spool Resolver | `"spool.resolver"` | `SpoolResolver` | Resolve / fetch spool module sources |

Canonical constants: `pkg/contracts/capabilities.go`. Executor capabilities use the `"executor."` prefix. If no module provides a capability, callers handle it gracefully — using a default, falling back to a simpler mode, or logging a warning. Every service is optional.

---

## Types of Modules

### Core Infrastructure

These modules provide platform-level services that other modules depend on.

| Module Type | Role | Contract |
|-------------|------|----------|
| **Auth Provider** | `"auth"` | `AuthProvider` — authenticate users, validate tokens |
| **Authorizer** | — | `Authorizer` — check permissions |
| **Rate Limiter** | — | `RateLimiterProvider` — throttle API requests |
| **Health Monitor** | — | `HealthMonitor` — periodic module health checks |
| **Cluster** | — | `Cluster` — node membership, leader election |
| **Worker Pool** | — | `WorkerPool` — distributed task scheduling |
| **Audit Logger** | — | `AuditLogger` — record security-relevant actions |
| **Call Policy** | — | `CallPolicyProvider` — inter-module access control |

### Media Capabilities

| Module Type | Role / Capability | Domain Contract |
|-------------|-------------------|-----------------|
| **Downloader** | `"downloader"` | `contracts-downloader` |
| **Indexer** | `"indexer"` | `contracts-indexer` — many modules may advertise this; callers (e.g. `media-automation`) fan out `Search` across all of them. A single module may still aggregate many sites via `ListIndexers`. |
| **Media Library (admin)** | `"media.library"` | `contracts-media-admin` |
| **Other media roles** | (module-defined) | May use local interfaces or future `contracts-*` packages |

Media managers (`media-movies`, `media-tvshows`), playback, transcoder, metadata, and related modules exist in the workspace; not every type has a published standalone contract repo yet.

### Storage

| Module Type | Role | Contract |
|-------------|------|----------|
| **Storage Provider** | `"storage"` | `StorageProvider` — basic blob storage |
| **Streamable** | (capability) | `Streamable` — range-request streaming |
| **Seekable** | (capability) | `Seekable` — random access within files |
| **Watchable** | (capability) | `Watchable` — filesystem event notifications |
| **Atomic Movable** | (capability) | `AtomicMovable` — atomic file moves |
| **Hardlinkable** | (capability) | `Hardlinkable` — hardlink support |
| **Tiered** | (capability) | `TieredProvider` — hot/warm/cold storage tiering |

### Infrastructure Services (Discovered)

| Service | Capability | Contract |
|---------|-----------|----------|
| **Secrets** | `"secrets"` | `SecretsProvider` |
| **Database** | `"database"` | `DatabaseProvider` |
| **Cache** | `"cache"` | `CacheProvider` |
| **Cache Layer** | `"cache.local"` | `CacheLayer` |
| **Metrics** | `"metrics"` | `MetricsProvider` |
| **Tracing** | `"tracing"` | `TracingProvider` |
| **Circuit Breaker** | `"circuitbreaker"` | `CircuitBreaker` |
| **Config Watcher** | `"config.watcher"` | `ConfigWatcher` |
| **Dead Letter** | `"deadletter"` | `DeadLetterProvider` |
| **Identity** | `"identity"` | `IdentityProvider` |
| **Logging** | `"logging"` | `StructuredLogger` |
| **Retry** | `"retry"` | `RetryProvider` |
| **Idempotency** | `"idempotency"` | `IdempotencyProvider` |
| **Feature Flags** | `"feature.flags"` | `FeatureFlagProvider` |
| **Serialization** | `"serialization"` | `SerializationProvider` |
| **Encryption** | `"encryption"` | `EncryptionProvider` |
| **Distributed Lock** | `"distributed.lock"` | `DistributedLockProvider` |
| **Data Redaction** | `"data.redaction"` | `DataRedactionProvider` |
| **Event Store** | `"event.store"` | `EventStore` |
| **Input Validation** | `"input.validate"` | `InputValidator` |
| **Workflow Engine** | `"workflow.engine"` | `WorkflowEngine` |
| **Publish Policy** | `"publish.policy"` | `PublishPolicyProvider` |

### UI & API / Media Admin

| Module Type | Capability | What It Does | Contract Repo |
|-------------|-----------|-------------|---------------|
| **UI Module** | `"ui"` | Register HTTP handlers for a user interface | (custom) |
| **API Module** | `"api"` | Register HTTP handlers for a REST API | (custom) |
| **Media Library** | `"media.library"` | Provides media browsing, search, metadata editing, and artwork management to the admin UI via a standard gRPC service | `contracts-media-admin` |

---

## Next Steps

- [Contracts Reference](Contracts) — every interface in detail
- [Writing Modules](Writing-Modules) — build your own sidecar module
- [Event System](Event-System) — how modules communicate
- [Architecture](Architecture) — bootstrap, gRPC services, cluster
