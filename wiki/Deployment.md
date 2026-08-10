# Deployment

**Day one is one laptop.** Prefer the [installer / release-binary path](Getting-Started) over cloning the workspace or standing up Kubernetes. Scale out only when a single node is not enough.

Active checklist: [Tasks](Tasks) (workspace [`TASKS.md`](../TASKS.md)).

---

## Day-1 preference

| Prefer | Defer |
|--------|-------|
| Installer or published release binaries | Sibling monorepo builds |
| Compose **or** host binaries on one machine | `muxcore-operator` / Helm as the first install |
| Fixture acquisition (`DOWNLOADER_ENGINE=fixture`) | Live pirate / swarm as a smoke gate |
| Self-hosted CI + **local** image registry | GitHub-hosted runners, paid Actions minutes, paid Packages billing |

`_mvp/` remains the developer reference lab. End users should never be told to clone sixty repos.

---

## Phase 1: Single machine (supported first-run)

One host, one `muxcored`, modules as sidecars (spawned by core or started by the installer/compose file).

```
┌──────────────────────────┐
│      Laptop / NAS         │
│                           │
│  ┌──────────────────────┐ │
│  │  MuxCore (the loom)  │ │
│  │  HTTP  → :8080       │ │
│  │  gRPC  → :9090       │ │
│  └──────────────────────┘ │
│                           │
│  Sidecars: auth, api-rest,│
│  libraries, automation,   │
│  fixture downloader, UIs  │
└──────────────────────────┘
```

### What you get

- In-memory event bus (no external broker required)
- Local filesystem library + downloads dirs
- SQLite (or equivalent) via `database-sqlite` for the default installer profile
- Admin UI + consumer UI URLs on localhost
- Offline demo via [fixture-first acquisition](Getting-Started#fixture-first-acquisition)

### Start options

**Installer / release binaries** — see [Getting Started](Getting-Started).

**Compose** (images from a **local** registry or pre-loaded tarballs):

```bash
docker compose up -d
# bootstrap admin → open VIEW-ME.txt URLs
```

**Bare loom + tag** (modules already on disk or resolved from spool):

```bash
muxcored --tag media --spool https://github.com/Muxcore-Media/spool
```

Configuration: `muxcore.json` and env — [Configuration Reference](Configuration-Reference), [Getting Started](Getting-Started).

---

## Self-hosted CI and local registry (no billing narrative)

MuxCore packaging assumes a **laptop or home lab** plus a **GitHub free** org/account. Product and contributor docs must not depend on paid GitHub Actions minutes or paid package tiers.

### CI

- Module workflows use `runs-on: self-hosted` (org runners on your hardware).
- Merge gates: `go test ./...` (or language equivalent) on those runners.
- Do **not** treat GitHub-hosted runners as the default path for new repos.
- Offline / fixture / httptest tests only for acquisition — no live pirate APIs in CI.

### Images and artifacts

- Build images on the self-hosted runner: `docker build` (or Podman).
- Push to a **local registry** you run yourself, for example:

```bash
# Example local registry on the lab machine
docker run -d -p 5000:5000 --name registry registry:2

docker build -t localhost:5000/muxcore/core:v0.5.0 .
docker push localhost:5000/muxcore/core:v0.5.0
```

- Compose and installer pin matrices should reference those local tags (or Release binary tarballs), not “whatever latest is on a paid remote.”
- GitHub Releases (free) remain the distribution channel for `muxcored` and module binaries; image hosting for day-1 can stay entirely on-LAN.
- Avoid documenting paid GHCR package scopes or hosted-runner billing as requirements.

### Release factory (summary)

Tracked in [`TASKS.md`](../TASKS.md) §10: GoReleaser (or `make release`) on self-hosted runners for linux amd64/arm64, installer pin matrix, spool tags updated with the same pins. Until that factory is complete, `_mvp` host builds prove the path; installer consumes published assets.

---

## Phase 2: Multiple machines

Add workers when you need distributed transcoding, extra storage, or failover. Still no requirement for cloud billing.

```
┌─────────────────────┐
│   MuxCore Node 1    │  (primary — API, UI, event bus)
│   - Core services   │
│   - Database module │
│   - Cache module    │
└─────────┬───────────┘
          │
    ┌─────┴─────────────┐
    │                   │
┌───▼─────────┐  ┌──────▼────────┐
│ Worker 1    │  │ Worker 2      │
│ - Transcoder│  │ - Transcoder  │
│ - Local SSD │  │ - Local SSD   │
└─────────────┘  └───────────────┘
```

### Capabilities

- Distributed transcoding to least-loaded workers
- Worker / module failover after heartbeat loss
- Shared task queue via cache module (local Redis/Valkey optional)
- Shared metadata via database module (Postgres optional profile)

PostgreSQL and Redis are **modules**, not built into core. Laptop default remains SQLite + local cache; multi-node picks Postgres/Redis when you need them.

```yaml
# Illustrative — pull images from your local registry
services:
  muxcore:
    image: localhost:5000/muxcore/core:v0.5.0
    environment:
      - MUXCORE_DATABASE_DRIVER=postgres
      - MUXCORE_DATABASE_URL=postgres://...
      - MUXCORE_CACHE_DRIVER=redis
      - MUXCORE_CACHE_URL=redis://...

  postgres:
    image: postgres:16

  redis:
    image: redis:7
```

---

## Phase 3: Kubernetes (later)

Full orchestration (HA cores, GPU pools, Rook/Ceph or MinIO) is optional and **not** day-1. Prefer installer/compose until you need it. Operator/Helm work is tracked under [Tasks](Tasks); samples should use **local** images only (kind/k3d + `localhost:5000`), not paid cloud registries as a hard dependency.

---

## Clustering: auto-join

### On the new node

```json
{
  "grpc": {
    "addr": ":9090",
    "seed_nodes": ["primary-node:9090"],
    "join_token": "my-secret-cluster-token"
  }
}
```

Or:

```bash
export MUXCORE_GRPC_SEED_NODES="primary-node:9090,backup-node:9090"
export MUXCORE_CLUSTER_JOIN_TOKEN="my-secret-cluster-token"
```

### What happens

1. New node contacts seed nodes and presents the join token.
2. Receives member list + leader ID and registers.
3. Heartbeats every ~10s advertise that node’s module list.
4. Eviction after ~30s without heartbeats; modules rediscover via `DiscoveryService.Members()` and re-register.

---

## mTLS and certificates

In production, enable mutual TLS; core can act as an internal CA under `~/.muxcore/ca/` (or `MUXCORE_GRPC_CA_CERT_DIR`). Laptop first-run may use `MUXCORE_INSECURE_DISABLE_TLS=true` — never carry that into a shared or internet-facing deploy.

```bash
export MUXCORE_GRPC_MTLS_ENABLED=true
export MUXCORE_GRPC_CA_CERT_DIR=/etc/muxcore/ca
```

See [Module TLS Authentication](Module-TLS-Authentication) and [Security](Security).

---

## Module deployment (multi-machine)

Sidecars connect to the nearest mesh:

```yaml
services:
  muxcore:
    image: localhost:5000/muxcore/core:v0.5.0

  downloader-native-torrent:
    image: localhost:5000/muxcore/downloader-native-torrent:v0.2.1
    environment:
      - DOWNLOADER_ENGINE=fixture   # keep fixture until you intentionally opt into live
    command:
      - --muxcore-mesh-addr=muxcore:9090
      - --muxcore-module-id=downloader-native-torrent
```

---

## Environments (guidance)

| Environment | Start here | Grow to |
|-------------|------------|---------|
| Laptop / home lab | Phase 1 installer or compose | Phase 2 workers; optional local k3s |
| Seedbox | Phase 1 host binaries + modules | Phase 2 if multi-box |
| Enterprise / provider | Phase 2+ with mTLS | Phase 3 when ops requires it |

---

## Observability

| Phase | Baseline |
|-------|----------|
| **Phase 1** | Structured logs, `/health`, health-monitor, admin events |
| **Phase 2** | Optional Prometheus / Grafana (compose profile), audit JSONL |
| **Phase 3** | Distributed tracing (local Jaeger/OTLP collector) |

---

## Next steps

- [Getting Started](Getting-Started) — installer / release binaries + fixture-first acquisition
- [Security](Security) — TLS, mTLS, join tokens
- [Core Concepts](Core-Concepts) — cross-node tracking and failover
- [Tasks](Tasks) — packaging, gates, and what is explicitly out of scope
