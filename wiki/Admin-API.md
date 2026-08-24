# Admin API (gRPC Services)

**Runtime management services for admin tools.** Core exposes three gRPC services for querying and controlling modules, spools, and audit logs. These are used by `admin-ui` and the `muxcorectl` CLI MVP (plus any gRPC client). The MVP covers discovery/events/storage/audit query paths; lifecycle and spool admin RPCs are still deferred in the CLI.

All three services are registered on the same gRPC port (default `:9090`) alongside the existing module-facing services.

---

## SpoolService

**Proto:** `muxcore/spool/v1/spool.proto`
**Go package:** `proto/gen/muxcore/spool/v1`

Runtime management of spool configurations and tag-based module deployment. Use this to inspect available spools, list tags, and trigger deployments without restarting core.

| RPC | Request | Response | Purpose |
|-----|---------|----------|---------|
| `ListSpools` | `ListSpoolsRequest` | `ListSpoolsResponse` | Returns all configured spool URLs (active spool + any configured via API) |
| `ListTags` | `ListTagsRequest` | `ListTagsResponse` | Lists all tag names available on the given spool |
| `FetchTag` | `FetchTagRequest` | `FetchTagResponse` | Fetches a tag definition without deploying its modules |
| `DeployTag` | `DeployTagRequest` | `DeployTagResponse` | Fetches a tag, resolves modules, verifies checksums, spawns new ones. Idempotent — already-running modules are skipped |

### DeployTag Response

```json
{
  "tag_name": "media",
  "spool_url": "https://github.com/Muxcore-Media/spool",
  "results": [
    {"module_id": "downloader-native-torrent", "spawned": true, "already_running": false, "error": ""},
    {"module_id": "media-movies", "spawned": false, "already_running": true, "error": ""}
  ],
  "total": 2,
  "spawned": 1,
  "skipped": 1,
  "failed": 0
}
```

---

## ModuleLifecycleService

**Proto:** `muxcore/lifecycle/v1/lifecycle.proto`
**Go package:** `proto/gen/muxcore/lifecycle/v1`

Runtime control over individual module lifecycle — inspect, spawn, stop, and restart modules.

| RPC | Request | Response | Purpose |
|-----|---------|----------|---------|
| `ListModules` | `ListModulesRequest` | `ListModulesResponse` | All modules known to this node, including state, health, capabilities, uptime |
| `SpawnModule` | `SpawnModuleRequest` | `SpawnModuleResponse` | Resolve and spawn a module from a previously deployed tag |
| `StopModule` | `StopModuleRequest` | `StopModuleResponse` | Send SIGTERM to a running module and wait for stop |
| `RestartModule` | `RestartModuleRequest` | `RestartModuleResponse` | Kill and re-spawn a module from its existing binary |

### ListModules Response

```json
{
  "modules": [
    {
      "module_id": "downloader-native-torrent",
      "name": "Native Torrent Downloader",
      "version": "1.0.2",
      "state": "running",
      "health_error": "",
      "capabilities": ["downloader.torrent", "downloader.native.torrent"],
      "repo": "https://github.com/Muxcore-Media/downloader-native-torrent",
      "node_id": "muxcore-127.0.0.1:9090",
      "restart_policy": "on-failure",
      "uptime_seconds": 86400
    }
  ]
}
```

---

## AuditService

**Proto:** `muxcore/audit/v1/audit.proto`
**Go package:** `proto/gen/muxcore/audit/v1`

Query, export, and verify the core audit log. Provides programmatic access to the tamper-evident JSONL audit trail.

| RPC | Request | Response | Purpose |
|-----|---------|----------|---------|
| `Query` | `AuditQueryRequest` | `AuditQueryResponse` | Search audit entries by actor, action, resource, trace ID, and time range |
| `Export` | `AuditExportRequest` | `stream AuditExportChunk` | Stream all matching entries in JSON or CSV format (supports terabytes-scale logs) |
| `VerifyChain` | `AuditVerifyChainRequest` | `AuditVerifyChainResponse` | Standalone SHA-256 hash-chain integrity check over a time range — verifies without exposing entry content |
| `Log` | `LogRequest` | `LogResponse` | Write an entry to the audit log (used by admin tools and modules) |

### AuditQueryRequest

| Field | Type | Description |
|-------|------|-------------|
| `actor` | string | Filter by actor ID (user, system, module). Empty matches all |
| `action` | string | Filter by action string |
| `resource` | string | Filter by resource string |
| `trace_id` | string | Filter by trace ID |
| `from_time` | string | Start of time range (RFC3339) |
| `to_time` | string | End of time range (RFC3339) |
| `verify_chain` | bool | When true, validates hash chain of returned entries |
| `max_results` | int32 | Cap on returned entries (0 = no limit) |

---

## DiscoveryService Extensions

The existing `DiscoveryService` was extended with a `ListAll` RPC that returns health and state information for every registered module across the cluster:

| RPC | Purpose |
|-----|---------|
| `ListAll` | All registered modules on this node and all known peer nodes, including state, health status, and node ID |

### ModuleEntryProto

| Field | Type | Description |
|-------|------|-------------|
| `info` | `ModuleInfoProto` | Module identity and capabilities |
| `state` | string | Lifecycle state: `registered`, `starting`, `running`, `degraded`, `stopping`, `stopped` |
| `health_error` | string | Empty when healthy, last health check error otherwise |
| `node_id` | string | Cluster node running this module |

The `ModuleInfoProto` also carries `state` (field 11) and `health_error` (field 12). Repository/source URL for a running module is on lifecycle `ModuleStatusProto.repo`, not on discovery `ModuleInfoProto`.

---

## Next Steps

- [Architecture](Architecture) — full gRPC service overview and bootstrap sequence
- [Security](Security) — audit logging and authentication
- [Spool and Marketplace](Spool-and-Marketplace) — spool system details
