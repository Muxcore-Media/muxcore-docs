# Spool and Marketplace

**Spools are how MuxCore discovers modules. The marketplace is how it imports them.** This page explains how modules are discovered, imported, and how contract reconciliation enables third-party modules to use their own contract repos.

---

## How Spools Work (Plain Language)

Think of a spool like an app store catalog. It's a list of available modules and curated tag presets. When you run:

```bash
muxcored --tag default
```

Core fetches the `default` tag from the official spool (`github.com/Muxcore-Media/spool`) and discovers which modules to load.

### Official vs Third-Party Spools

| Type | Example | Trust Level |
|------|---------|------------|
| **Official** | `github.com/Muxcore-Media/spool` | Maintained by the MuxCore team |
| **Third-party** | `github.com/some-user/custom-spool` | Untrusted — audit before use |

Anyone can create a spool. See [Spool Security](Spool-Security) for the trust model.

### Tag Format

Tags are JSON files in `tags/<name>.json`. They list modules with version pins:

```json
{
  "name": "default",
  "description": "The official MuxCore starter setup",
  "version": "1.0.0",
  "modules": [
    {
      "repo": "https://github.com/Muxcore-Media/admin-ui",
      "version": "v1.0.0",
      "required": true
    }
  ]
}
```

---

## Module Import and Contracts

Every module implements one or more contract interfaces. For official modules, these contracts come from `github.com/Muxcore-Media/contracts-*` repos. But third-party module authors may define their contracts in their own repos.

### The Problem: Go's Nominal Type System

In Go, two interfaces with identical method sets but different package paths are **different types**. The same applies when third-party modules vendored a private copy of a domain contract:

```go
// Module A imports the canonical gRPC stubs
import cdlv1 "github.com/Muxcore-Media/contracts-downloader/muxcore/downloader/v1"
var client cdlv1.DownloaderServiceClient

// Module B generated stubs from a forked proto package path
import other "github.com/some-dev/contracts-downloader/muxcore/downloader/v1"
// other.DownloaderServiceClient is a DIFFERENT type than Module A's
// Dial/assert paths diverge even if the wire RPCs match
```

This is Go's nominal type system — type identity is `package_path + name`, not structure.

### The Solution: Contract Reconciliation

When core imports a module (via `--tag`), the module manager runs the **contract reconciliation** engine (`github.com/Muxcore-Media/contracts-reconciler`) after cloning the repo and before building:

1. **Extract.** Parses the declared Go interface / service surface from the third-party contract repo using AST
2. **Compare.** Checks structural compatibility against the canonical Muxcore-Media equivalent (method names, parameter types, return types)
3. **Normalize.** If structurally identical, generates a `go.mod replace` directive
4. **Reject.** If methods differ, the import fails with a detailed mismatch report

```
Third-party: github.com/some-dev/contracts-downloader v1.2.0
Canonical:   github.com/Muxcore-Media/contracts-downloader v1.0.0

Service "DownloaderService":
  - RPC / method signatures match structurally ✓

→ go mod edit -replace github.com/some-dev/contracts-downloader=github.com/Muxcore-Media/contracts-downloader@v1.0.0
```

After reconciliation, `go.mod replace` directives normalize all contract imports to canonical paths.

### Declaring Contracts in muxcore.json

Third-party modules declare their contracts in `muxcore.json`:

```json
{
  "name": "My Custom Downloader",
  "kind": "downloader",
  "capabilities": ["downloader", "downloader.custom"],
  "contracts": [
    {
      "repo": "github.com/my-org/contracts-downloader",
      "version": "v2.0.0",
      "interface": "DownloaderService"
    }
  ]
}
```

Official modules don't need this — they already use canonical contract repos.

### The Simplest Approach: Shared Proto Package

Prefer importing the canonical `contracts-downloader` proto package and registering `DownloaderService` directly. If you must publish a thin wrapper package, re-export the generated types from the canonical module path so callers share one stub identity.

---

## Canonical Contract Registry

The reconciler maintains a registry mapping interface names to canonical repos (`contracts-reconciler/reconciler/canonical.go`).

**Published today:**

| Interface | Canonical Repo |
|-----------|----------------|
| `DownloaderService` | `github.com/Muxcore-Media/contracts-downloader` |
| `Indexer` | `github.com/Muxcore-Media/contracts-indexer` |
| Media admin seam | `github.com/Muxcore-Media/contracts-media-admin` |

Other entries in the reconciler registry (e.g. historical `contracts-media`, `contracts-playback`) are reserved names — those repos are not published yet. Prefer published packages or in-module interfaces until they exist.

---

## Runtime Spool Management via gRPC

Core exposes the `SpoolService` gRPC service for runtime management of spools and tag deployments. Admin tools use this to inspect available spools, list tags, and trigger deployments without restarting:

### SpoolService RPCs

| RPC | Purpose |
|-----|---------|
| `ListSpools` | Returns all configured spool URLs (active spool from `--spool`, plus any configured runtime spools) |
| `ListTags` | Lists all tag names available on a given spool, with descriptions and module counts |
| `FetchTag` | Fetches a tag definition without deploying — inspect what modules would be loaded |
| `DeployTag` | Fetches a tag, resolves modules, verifies checksums, and spawns new ones. Idempotent — already-running modules are skipped |

### Example: Deploy a Tag at Runtime

```bash
# Using admin-ui, grpcurl, or any gRPC client (muxcorectl spool admin deferred):
# Call DeployTag to load the "media-stack" tag without restarting core
```

```go
spoolClient := spoolv1.NewSpoolServiceClient(conn)

resp, err := spoolClient.DeployTag(ctx, &spoolv1.DeployTagRequest{
    SpoolUrl: "https://github.com/Muxcore-Media/spool",
    TagName:  "media-stack",
})
// resp.Spawned   → number of modules newly spawned
// resp.Skipped   → modules already running
// resp.Failed    → modules that failed to start
```

The `DeployTag` response reports per-module results:

```json
{
  "tag_name": "media-stack",
  "results": [
    {"module_id": "downloader-native-torrent", "spawned": true, "already_running": false},
    {"module_id": "media-movies", "spawned": false, "already_running": true}
  ],
  "spawned": 1,
  "skipped": 1,
  "failed": 0
}
```

See [Admin API](Admin-API) for the full gRPC reference.

---

## Philosophy

MuxCore contracts are **patterns**, not org-bound dependencies. Two modules implementing the same interface pattern should be interchangeable regardless of which GitHub org published the `.go` file.

The reconciler is the weaver — it aligns patterns across independent contract repos. Core never enters the conversation. The loom doesn't care which thread made the pattern.

---

## Next Steps

- [Module System](Module-System) — how modules discover each other
- [Contracts Reference](Contracts) — every interface in detail
- [Spool Security](Spool-Security) — trust model for third-party spools