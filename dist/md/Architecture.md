# Architecture

**How MuxCore is built under the hood.** This page covers the bootstrap sequence, gRPC services (module mesh + Health + admin), the sidecar binary pattern, and how the cluster heartbeat protocol works.

---

## Bootstrap Sequence

When `muxcored` starts, here's what happens in order:

```
1.  Parse CLI flags (--tag, --spool, --version)
2.  Load config (muxcore.json → env var overrides → validation)
3.  Set up structured logger (slog) — log level and format applied
4.  Run startup invariant checks (module cache, audit dir, cosign.pub, Go version)
5.  Create in-memory event bus (with optional WAL if MUXCORE_EVENT_JOURNAL_PATH set)
6.  Create gRPC mesh server + client
7.  Create gRPC connection pool (for heartbeat efficiency)
8.  Load TLS credentials (or disable with MUXCORE_INSECURE_DISABLE_TLS)
9.  Configure gRPC server: TLS, auth interceptor, keepalive enforcement
10. Register gRPC services: ModuleRegistration, Discovery, Events, Health, Storage, Mesh
11. Create module registry + built-in WorkerPool (`core.workerpool`)
12. Create HTTP API server (TLS + HSTS + security headers + trace middleware)
13. Create storage orchestrator → discover storage + cache modules
14. Configure audit logger (JSONL file with hash chain, or no-op); wire core built-ins (retry, idempotency, dead letter, event store)
15. Register admin gRPC services: SpoolService, ModuleLifecycleService, AuditService
16. Wire capability enforcement: call.policy → mesh/storage, publish.policy → event bus. Deny-by-default when no module provides a policy.
17. Load modules from spool tag: fetch tag → resolve → verify checksums → spawn sidecars
18. Init all modules (dependency-respecting order via Registry.StartupOrder)
19. Start all modules
20. Register core self-health probes (event bus, discovery, storage, audit)
21. Set health checker combining core probes + module state
22. Start HTTP server on :8080
23. Start gRPC server on :9090
24. Auto-join seed nodes (TLS required) — JoinResponse is membership only (no CA key distribution)
25. Start heartbeat loop (10s interval, carries module list + cluster term)
26. Start SIGHUP config-reload goroutine
27. Wait for shutdown signal

Shutdown sequence (graceful):
1.  srv.Drain(15s)      — HTTP: stop new connections, drain in-flight
2.  grpcSrv.GracefulStop() — gRPC: finish in-flight calls
3.  modMgr.StopAll()    — SIGTERM all sidecar module processes
4.  connPool.Close()    — Close all pooled gRPC connections
5.  srv.Shutdown()      — Release remaining HTTP resources
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      muxcored process                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │ HTTP API │  │  gRPC    │  │  Event    │  │  Module   │  │
│  │ :8080    │  │  :9090   │  │  Bus      │  │  Registry │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └─────┬─────┘  │
│       │             │              │               │        │
  │  ┌────┴─────────────┴──────────────┴───────────────┴────┐   │
│  │            Nine gRPC Services                           │   │
│  │  ModuleReg │ Discovery │ Storage │ Events │ Mesh      │   │
│  │  Health    │ SpoolSvc  │ Lifecycle │ Audit             │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────┐  ┌────────────┐  ┌───────────────┐            │
│  │  Storage │  │  Call      │  │  Publish      │            │
│  │  Orch.   │  │  Policy    │  │  Policy       │            │
│  └──────────┘  └────────────┘  └───────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │  Sidecar Module Manager                           │       │
│  │  Spool → Resolve (clone/build) → Verify → Spawn   │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## The Nine gRPC Services

Modules communicate with core entirely through gRPC. Six services serve module-to-core / mesh communication. Three administrative services support runtime management. All nine are served on the same port (default `:9090`):

### Module Services

| Service | Proto Package | Key RPCs |
|---------|--------------|----------|
| **ModuleRegistration** | `muxcore.module.v1` | `Register()`, `Unregister()`, `BootstrapRegister()` |
| **DiscoveryService** | `muxcore.discovery.v1` | `FindByCapability()`, `FindByRole()`, `Resolve()`, `ListAll()`, `Members()`, `Watch()`, `Join()` |
| **StorageService** | `muxcore.storage.v1` | `Put()` / `Get()` (streaming), `Delete()`, `Stat()`, `List()`, `Capabilities()` |
| **EventService** | `muxcore.events.v1` | `Publish()`, `Subscribe()` (streaming), `Request()`, `Replay()` (needs `MUXCORE_EVENT_JOURNAL_PATH`) |
| **ModuleMesh** | `muxcore.mesh.v1` | `Call()`, `StreamCall()` |
| **HealthService** | `muxcore.health.v1` | `Check()` (plus standard gRPC health probe) |

### Admin Services

| Service | Proto Package | Key RPCs |
|---------|--------------|----------|
| **SpoolService** | `muxcore.spool.v1` | `ListSpools()`, `ListTags()`, `FetchTag()`, `DeployTag()` |
| **ModuleLifecycleService** | `muxcore.lifecycle.v1` | `ListModules()`, `SpawnModule()`, `StopModule()`, `RestartModule()` |
| **AuditService** | `muxcore.audit.v1` | `Query()`, `Export()`, `VerifyChain()`, `Log()` |

These replace the old in-process `Fabric` struct for module access. Same philosophy, gRPC transport.

### Discovery notes (`core@v0.5.0+`)

- **Public allowlist:** Registration, Health `Check`, common Discovery RPCs (`FindByCapability`, `FindByRole`, `ListAll`, `Members`, `Watch`, `Resolve`, …), and selected Event RPCs are open without a bearer mesh identity so admin UIs and single-node peer fan-out work on a laptop. Other methods still require Authorizer + IdentityProvider.
- **`Members` module list:** On single-node deployments, `Members` refreshes the local node’s `Modules` / `ModuleHealth` from the live registry so Cluster SSE / dashboards are not stuck with an empty module list.

### Proto Files

```
proto/muxcore/
├── module/v1/registration.proto      ← ModuleRegistration + BootstrapRegister
├── discovery/v1/discovery.proto      ← Discovery + ListAll
├── storage/v1/storage.proto          ← StorageService
├── events/v1/events.proto            ← EventService
├── mesh/v1/module.proto              ← ModuleMesh
├── health/v1/health.proto            ← Health service
├── spool/v1/spool.proto              ← SpoolService (admin)
├── lifecycle/v1/lifecycle.proto      ← ModuleLifecycleService (admin)
├── audit/v1/audit.proto              ← AuditService (admin)
└── ...                               ← Infrastructure service protos (auth, secrets, etc.)
```

Generated Go code lives in `proto/gen/muxcore/<service>/v1/`.

## Service Discovery

Everything beyond the base loom is discovered at runtime via `FindByCapability()`:

| Service | Capability String | Interface |
|---------|------------------|-----------|
| Secrets | `"secrets"` | `SecretsProvider` |
| Database | `"database"` | `DatabaseProvider` |
| Cache | `"cache"` | `CacheProvider` |
| Cache Layer | `"cache.local"` | `CacheLayer` |
| Metrics | `"metrics"` | `MetricsProvider` |
| Tracing | `"tracing"` | `TracingProvider` |
| Circuit Breaker | `"circuitbreaker"` | `CircuitBreaker` |
| Config Watcher | `"config.watcher"` | `ConfigWatcher` |
| Dead Letter | `"deadletter"` | `DeadLetterProvider` |
| Call Policy | `"call.policy"` | `CallPolicyProvider` |
| Identity | `"identity"` | `IdentityProvider` |
| Logging | `"logging"` | `StructuredLogger` |
| Retry | `"retry"` | `RetryProvider` |
| Idempotency | `"idempotency"` | `IdempotencyProvider` |
| Feature Flags | `"feature.flags"` | `FeatureFlagProvider` |
| Serialization | `"serialization"` | `SerializationProvider` |
| Encryption | `"encryption"` | `EncryptionProvider` |
| Distributed Lock | `"distributed.lock"` | `DistributedLockProvider` |
| Data Redaction | `"data.redaction"` | `DataRedactionProvider` |
| Event Store | `"event.store"` | `EventStore` |
| Input Validation | `"input.validate"` | `InputValidator` |
| Workflow Engine | `"workflow.engine"` | `WorkflowEngine` |
| Publish Policy | `"publish.policy"` | `PublishPolicyProvider` |

If no module provides a capability, callers handle it gracefully — default behavior, degradation, or a warning. Every service is optional.

## Sidecar Module Pattern

Modules are standalone binaries, not compile-time imports. Core spawns them as child processes. Each binary must:

1. Accept `--muxcore-mesh-addr` (default: `localhost:9090`)
2. Accept `--muxcore-module-id` (its identifier)
3. Connect to the gRPC mesh
4. Call `ModuleRegistration.Register()` with a structured protobuf `ModuleInfo` (SDK fills fields from `contracts.ModuleInfo` — not a JSON blob)
5. Respond to SIGTERM/SIGINT for graceful shutdown
6. Call `ModuleRegistration.Unregister()` on exit

Reference implementation: [downloader-native-torrent](https://github.com/Muxcore-Media/downloader-native-torrent)

## Cluster Heartbeat Protocol

When multiple core instances form a cluster:

1. **Registration** — Modules register on their local core via `Register()` RPC
2. **Heartbeat** — Every 10s, each core sends a heartbeat to every peer carrying its module list (`NodeInfo.modules`) and the current cluster term
3. **Sync** — Peers update their copy of the remote node's module list and reconcile terms from incoming heartbeats
4. **Routing** — Mesh uses `NodeInfo.modules` to determine which node hosts a target module
5. **Eviction** — After 30s without a heartbeat, a node is evicted; its module list is removed and leader re-election runs

### Leader Election

MuxCore uses **deterministic rank-based election**. Every surviving node independently runs the same calculation and reaches the same result without coordination:

1. The surviving member with the **alphabetically lowest node ID** is always the leader
2. Each election increments the **term** — a monotonically increasing counter
3. Terms propagate via gRPC metadata on all Heartbeat and Join calls
4. When a node receives a heartbeat with a higher term, it updates its view and re-runs election
5. The leader's responsibilities: authoritative cluster ID, orphan module resurrection. (Eviction of dead peers runs independently on every node.)

Node IDs are set from `"muxcore-" + grpc.addr` at boot, which is deterministic per address.

### Node Failure

When a node dies:
1. Surviving nodes evict it after 30s heartbeat timeout
2. If the evicted node was the leader, re-election runs automatically
3. Mesh stops routing calls to the dead node's modules
4. Leader may resurrect orphaned tag modules on a surviving node; departed-node worker tasks are released to Pending via `FailNodeTasks` for redispatch (failed only after `MaxRetries` when set).

### Cluster Events

| Event | Proto Constant | When |
|-------|---------------|------|
| Node Joined | `TYPE_NODE_JOINED` | New core joins the cluster |
| Node Left | `TYPE_NODE_LEFT` | Core evicted (dead) or gracefully leaves |
| Leader Changed | `TYPE_LEADER_CHANGED` | Election produces a new leader |

`TYPE_NODE_DEGRADED` exists on the Go `Cluster.Events()` poll adapter (`pkg/contracts`) but is **not** emitted on `DiscoveryService.Watch()` today (Watch only JOINS / LEFT / LEADER_CHANGED).

### Connection Pooling

Heartbeats and cross-node mesh calls reuse a **gRPC connection pool** rather than dialing per-request. The pool evicts idle connections after 5 minutes and is closed cleanly on shutdown.

## Audit System

The built-in audit logger (`internal/audit/audit.go`) writes JSONL to a file:

- **Hash chain** — each entry carries `PrevEntryHash` (SHA-256 of previous entry), forming a tamper-evident chain
- **Optional HMAC** — entries can be cryptographically signed with a configured key
- **Chain verification** — `VerifyChainIntegrity()` validates the chain without exposing entry content
- **No-op when disabled** — empty `audit.path` means zero overhead; all Log/Query/Export return immediately

## Security Headers

- **HSTS** — emitted only when TLS is enabled (not unconditionally — CWE-523 fix)
- **CSP** — `default-src 'self'` on all HTML responses
- **CRLF blocking** — trace header strips `\r\n` before use (CWE-93 fix)
- **gRPC keepalive** — 5-minute idle timeout with 30s enforcement minimum (CWE-400 fix)

## Middleware Chain

The HTTP server applies middleware in this order (outermost → innermost):

1. `MaxBytesReader` — rejects oversized bodies (10 MB) before any handler runs
2. `SecurityHeaders` — HSTS, CSP, X-Frame-Options, etc.
3. `Recovery` — panic recovery → 500
4. `RateLimit` — per-IP rate limiting
5. `Auth` — session validation (sets session in request context)
6. `Authz` — authorization checks against route permissions
7. `Audit` — logs all authenticated requests (actor from session)
8. `Logging` — structured request logging
9. `Trace` — trace ID propagation

In Go HTTP middleware, the last wrapper applied executes first. The `rebuildChain()` function builds from innermost to outermost to achieve the correct execution order.

## Proxy Trust

`X-Forwarded-For` is trusted only from configured proxy CIDRs (loopback by default: `127.0.0.0/8`, `::1/128`). Untrusted peers: XFF ignored; client IP is `RemoteAddr`. `X-Real-IP` is not used. Configure via `server.trusted_proxies` / `MUXCORE_SERVER_TRUSTED_PROXIES` or `SetTrustedProxies(cidrs []string)`. Trusted CIDRs should name the immediate reverse-proxy hop(s).

## Configuration Loading

```
muxcore.json (file)
     ↓
Environment variables (overlay)
     ↓
Validation (timeouts, log levels, TLS cert validity)
     ↓
Config struct
```

Environment variables take highest precedence. See [Configuration Reference](Configuration-Reference) for the complete variable list.

### Hot-Reload (SIGHUP)

Send `SIGHUP` to a running `muxcored` process to reload the config file:

```bash
kill -HUP $(pidof muxcored)
```

**Safe changes** (applied immediately without restart):
- Log level and format

**Detected on reload but not applied** (restart required to take effect):
- Seed node list — change is logged; core does not re-join cluster peers until restart

**Unsafe changes** (logged as warnings; require restart):
- Audit log path
- Server or gRPC listen addresses
- TLS certificate/key files
- Database or cache URLs
- Join token

## Admin Tooling

Core does **not** ship a built-in admin UI. Admin functionality is delivered by optional tooling:

- **`admin-ui`** (shipped) — web dashboard (standalone client on the default spool tag). Uses core gRPC admin/discovery services and discovers `SettingsProvider`, `AuditLogger`, and `Authorizer` capabilities. CSRF protection lives in the UI, not core.
- **`muxcorectl` CLI** (MVP) — talks to core gRPC for `modules list`, `cluster status`, `events tail`, `storage ls`, `audit query`. Lifecycle and spool admin RPCs are deferred; use `admin-ui` or any gRPC client for those.

Core provides the data seams modules consume: `MembersSnapshot()`, `SubscriberStats()`, `ProviderInfo()`, `IsLeader()`, `Term()`, and the full gRPC service suite. The `SettingsProvider` contract in `pkg/contracts/settings.go` is the hook for modules to expose their configuration to admin tooling.

Observability endpoints that **do** stay in core:

| Endpoint | Gated by | Purpose |
|----------|----------|---------|
| `/health` | Always on | Liveness / readiness for load balancers |
| `/version` | Always on | Build / version string |
| `/api/v1/tasks*` | Worker pool present | List / get / cancel / reassign tasks |
| `/metrics` | `MUXCORE_METRICS_ENABLE=true` | Prometheus scraping |
| `/debug/pprof/*` | `MUXCORE_DEBUG_ENABLE=true` | Go runtime profiling |

## Core Self-Health

Core probes its own internals on every `/health` request. Probe results are cached for 5 seconds to avoid thundering-herd on poll-based monitoring.

| Probe | What it checks |
|-------|---------------|
| `core.event_bus` | Event bus is initialised and accepting subscriptions |
| `core.discovery` | Cluster discovery is reachable |
| `core.storage` | Storage orchestrator is alive |
| `core.audit` | Audit log directory is writable (when configured) |

Failed core probes appear in the `/health` response as `"core.<probe>": "<error>"`.

## Startup Invariant Checks

Before starting any subsystem, core verifies:

| Check | What it verifies |
|-------|-----------------|
| `module_cache_writable` | `~/.muxcore/modules/` exists and is writable |
| `audit_log_dir_writable` | Audit log parent directory is writable |
| `cosign_pub_readable` | `cosign.pub` exists and is readable for spool verification (**warning** if missing) |
| `go_version_match` | Go runtime version matches expected major.minor (**warning** on mismatch) |

Writable module-cache / audit-dir failures are fatal and abort startup. Cosign and Go-version mismatches warn and continue.

## Next Steps

- [Core Concepts](Core-Concepts) — architectural philosophy
- [Module System](Module-System) — module lifecycle and discovery
- [Writing Modules](Writing-Modules) — build a sidecar module
- [Configuration Reference](Configuration-Reference) — every config option
