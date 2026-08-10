# Configuration Reference

**Every configuration option in MuxCore** — config file keys, environment variables, CLI flags, and their defaults. Includes the **laptop demo / installer** env knobs (`DOWNLOADER_ENGINE=fixture`, `TMDB_FIXTURE`, mesh dial local, ports) used by `_mvp` and `muxcore-installer`.

---

## Config File (`muxcore.json`)

Place `muxcore.json` in the working directory, or override the path with `MUXCORE_CONFIG`.

### Top-Level Keys

| Key | Type | Description |
|-----|------|-------------|
| `server` | `ServerConfig` | HTTP server settings |
| `grpc` | `GRPCConfig` | gRPC mesh settings |
| `log` | `LogConfig` | Structured logging |
| `database` | `DatabaseConfig` | Database connection (driver + URL) |
| `cache` | `CacheConfig` | Cache connection (driver + URL) |
| `audit` | `AuditConfig` | Audit logging |
| `modules` | `map[string]any` | Per-module arbitrary configuration |

### `server`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `addr` | string | `:8080` | HTTP listen address (validated with `net.ResolveTCPAddr`) |
| `read_timeout` | int | `15` | Read timeout in seconds |
| `write_timeout` | int | `15` | Write timeout in seconds |
| `cert_file` | string | `""` | Path to TLS certificate PEM file |
| `key_file` | string | `""` | Path to TLS private key PEM file |
| `trusted_proxies` | []string | loopback (`127.0.0.0/8`, `::1/128`) when empty | CIDRs whose `X-Forwarded-For` is trusted; no env override |

### `grpc`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `addr` | string | `:9090` | gRPC listen address (validated with `net.ResolveTCPAddr`) |
| `cert_file` | string | `""` | Path to TLS certificate PEM file |
| `key_file` | string | `""` | Path to TLS private key PEM file |
| `mtls_enabled` | bool | `false` | Require mutual TLS |
| `ca_cert_file` | string | `""` | Path to CA cert for mTLS client verification (manual setup) |
| `ca_cert_dir` | string | `""` | Directory for internal auto-generated CA (`ca.crt` + `ca.key`). Defaults to `<data-dir>/ca/` |
| `seed_nodes` | []string | `[]` | Cluster seed node addresses (`host:port`) |
| `join_token` | string | `""` | Pre-shared token required to join the cluster |
| `max_message_size_mb` | int | `32` | gRPC max message size in MB (affects storage streaming). Must be positive. |

### `log`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `level` | string | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `format` | string | `text` | Log format: `text`, `json` |

### `database`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `driver` | string | `""` | Database driver (provided by database module) |
| `url` | string | `""` | Database connection URL (credentials redacted in logs) |

### `cache`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `driver` | string | `""` | Cache driver (provided by cache module) |
| `url` | string | `""` | Cache connection URL (credentials redacted in logs) |

### `audit`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `path` | string | `""` | File path for JSONL audit log; empty = disabled |
| `max_size_mb` | int | `100` | Rotate audit log when file exceeds this size in MB |
| `max_rotated_files` | int | `5` | Number of rotated log files to keep (`.1`, `.2`, …) |

### `storage`

Per-operation timeout for storage provider calls. A hung provider cannot block callers beyond these deadlines.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `read_timeout_seconds` | int | `30` | Deadline for Get, Exists, Stat, List, Stream |
| `write_timeout_seconds` | int | `300` | Deadline for Put (5 minutes — large files need time) |
| `delete_timeout_seconds` | int | `30` | Deadline for Delete, Move |

### Example `muxcore.json`

```json
{
  "server": {
    "addr": ":8080",
    "read_timeout": 15,
    "write_timeout": 15,
    "cert_file": "/etc/ssl/server-cert.pem",
    "key_file": "/etc/ssl/server-key.pem"
  },
  "grpc": {
    "addr": ":9090",
    "cert_file": "/etc/ssl/grpc-cert.pem",
    "key_file": "/etc/ssl/grpc-key.pem",
    "mtls_enabled": true,
    "ca_cert_file": "/etc/ssl/ca.pem",
    "seed_nodes": ["node1:9090", "node2:9090"],
    "join_token": "my-secret-cluster-token"
  },
  "log": {
    "level": "info",
    "format": "json"
  },
  "database": {
    "driver": "postgres",
    "url": "postgres://user:pass@host:5432/muxcore"
  },
  "cache": {
    "driver": "redis",
    "url": "redis://host:6379"
  },
  "audit": {
    "path": "/var/log/muxcore/audit.jsonl"
  },
  "modules": {
    "downloader-native-torrent": {
      "listen_addr": "http://localhost:8080",
      "poll_interval_seconds": 30
    }
  }
}
```

---

## Environment Variables

All environment variables override their corresponding config file keys. Variables take **highest precedence**.

### Server

| Variable | Config Key | Default |
|----------|-----------|---------|
| `MUXCORE_CONFIG` | (config path) | `muxcore.json` |
| `MUXCORE_SERVER_ADDR` | `server.addr` | `:8080` |
| `MUXCORE_ADDR` | `server.addr` | deprecated alias for `MUXCORE_SERVER_ADDR` |
| `MUXCORE_SERVER_TLS_CERT` | `server.cert_file` | `""` |
| `MUXCORE_TLS_CERT` | `server.cert_file` | deprecated alias |
| `MUXCORE_SERVER_TLS_KEY` | `server.key_file` | `""` |
| `MUXCORE_TLS_KEY` | `server.key_file` | deprecated alias |
| `MUXCORE_SERVER_READ_TIMEOUT` | `server.read_timeout` | (seconds) |
| `MUXCORE_SERVER_WRITE_TIMEOUT` | `server.write_timeout` | (seconds) |

### gRPC

| Variable | Config Key | Default |
|----------|-----------|---------|
| `MUXCORE_GRPC_TLS_CERT` | `grpc.cert_file` | `""` |
| `MUXCORE_GRPC_TLS_KEY` | `grpc.key_file` | `""` |
| `MUXCORE_GRPC_MTLS_ENABLED` | `grpc.mtls_enabled` | `false` |
| `MUXCORE_GRPC_MTLS_CA` | `grpc.ca_cert_file` | `""` |
| `MUXCORE_GRPC_CA_CERT_DIR` | `grpc.ca_cert_dir` | `""` |
| `MUXCORE_GRPC_SEED_NODES` | `grpc.seed_nodes` | `""` (comma-separated) |
| `MUXCORE_GRPC_JOIN_TOKEN` | `grpc.join_token` | `""` |
| `MUXCORE_CLUSTER_JOIN_TOKEN` | `grpc.join_token` | fallback if `MUXCORE_GRPC_JOIN_TOKEN` unset |
| `MUXCORE_INSECURE_DISABLE_TLS` | (behavior flag) | unset |

### Logging

| Variable | Config Key | Default |
|----------|-----------|---------|
| `MUXCORE_LOG_LEVEL` | `log.level` | `info` |
| `MUXCORE_LOG_FORMAT` | `log.format` | `text` |

### Database & Cache

| Variable | Config Key | Default |
|----------|-----------|---------|
| `MUXCORE_DATABASE_DRIVER` | `database.driver` | `""` |
| `MUXCORE_DATABASE_URL` | `database.url` | `""` |
| `MUXCORE_CACHE_DRIVER` | `cache.driver` | `""` |
| `MUXCORE_CACHE_URL` | `cache.url` | `""` |

### Audit

| Variable | Config Key | Default |
|----------|-----------|---------|
| `MUXCORE_AUDIT_PATH` | `audit.path` | `""` (disabled) |

### Spool

| Variable | Config Key | Default |
|----------|-----------|---------|
| `MUXCORE_SPOOL_ALLOWED_HOSTS` | `spool.allowed_hosts` | `""` (comma-separated host allowlist for spool URLs) |

### Event Bus

| Variable | Purpose | Default |
|----------|---------|---------|
| `MUXCORE_EVENT_JOURNAL_PATH` | Directory for event WAL (write-ahead log). Enables persistence and `SubscribeFrom` replay. | `""` (disabled) |
| `MUXCORE_EVENT_REPLAY` | Replay WAL events to late subscribers on startup | `true` |

### Storage (built-in local FS)

| Variable | Purpose | Default |
|----------|---------|---------|
| `MUXCORE_STORAGE_DIR` | When set, core registers a built-in local filesystem storage provider rooted at this path (used by laptop demo / installer) | `""` (no built-in provider; wait for a storage module) |

### Debug & Observability

| Variable | Purpose | Default |
|----------|---------|---------|
| `MUXCORE_DEBUG_ENABLE` | Enable pprof endpoints at `/debug/pprof/` | `false` |
| `MUXCORE_METRICS_ENABLE` | Enable Prometheus metrics at `/metrics` | `false` |

### Security (Insecure Dev Mode)

| Variable | Purpose | Default |
|----------|---------|---------|
| `MUXCORE_INSECURE_DISABLE_TLS` | Bypass TLS requirement for HTTP and gRPC (`true` / `1`) | unset (TLS required) |
| `MUXCORE_DEV_TLS_SKIP` | Dev alias accepted alongside insecure-disable for local lab skips | unset |

> **Removed (do not use):** `MUXCORE_GRPC_REQUIRE_DISCOVERY_AUTH` and `MUXCORE_GRPC_REQUIRE_EVENTS_AUTH`. As of `core@v0.5.0`, discovery/event auth is not toggled by those env vars. A fixed public allowlist opens registration, common Discovery RPCs (`FindByCapability`, `FindByRole`, `ListAll`, `Members`, `Watch`, `Resolve`, …), Health `Check`, and selected Event RPCs so operator UIs and peer fan-out work without a bearer mesh identity. Everything else still requires Authorizer + IdentityProvider.

---

## Laptop demo / installer env (`_mvp` + `muxcore-installer`)

These knobs are **not** loom `muxcore.json` keys. They come from the installer `.env`, `_mvp/.env.example`, and host start scripts. The supported laptop path is **fixture-only**: no live pirate indexers, no BitTorrent swarm, no Apibay.

Canonical sources: [`_mvp/.env.example`](../_mvp/.env.example), [`muxcore-installer/.env.example`](../muxcore-installer/.env.example), and [Getting Started](Getting-Started) (fixture-first chapter).

### Fixture path (supported defaults)

Copy these for a first laptop run. Leave live-acquisition variables unset.

| Variable | Demo default | Where it applies | Meaning |
|----------|--------------|------------------|---------|
| `MUXCORE_INSECURE_DISABLE_TLS` | `true` | `muxcored` + every sidecar | Plaintext HTTP/gRPC for local lab only. Required for host MVP / installer laptop defaults. Never use on a shared or internet-facing host. |
| `DOWNLOADER_ENGINE` | `fixture` | `downloader-native-torrent` | Offline engine: writes a parseable `.mkv` under the downloads dir and completes immediately — no DHT/swarm. |
| `TMDB_FIXTURE` | `1` | `metadata-tmdb` | Serves offline Fight Club / Breaking Bad metadata for Search & details. No TMDB network or API key. |
| `SMOKE_LIVE_ACQUISITION` | unset / `0` | `_mvp/smoke.sh`, installer smoke | Must stay off for the product gate. Only exact `1` enables the live section, and only when `PIRATEBAY_API_BASE` is also set. |
| `PIRATEBAY_API_BASE` | **unset** | Host/compose + `indexer-piratebay` | **Opt-in only.** Leave unset so the indexer is not started (host) / soft-empty. Demo Dispatch still works via fixture magnets. |
| `MUXCORE_MESH_DIAL_LOCAL` | `true` (installer / host) | Modules that dial peers from discovery (`media-automation`, `health-monitor`, `request-media`, admin paths, …) | Rewrites empty / wildcard discovery hosts (`:port`, `0.0.0.0`) to `127.0.0.1:port` so host-process sidecars can reach each other. Compose/Docker DNS usually leaves this unset. |
| `MUXCORE_STORAGE_DIR` | `./data/storage` | `muxcored` | Enables built-in local FS storage for the demo data dir. |
| `MUXCORE_LOG_LEVEL` | `info` | `muxcored` | Same as loom `log.level`. |
| `MUXCORE_CONFIG` | `./muxcore.json` (installer) | `muxcored` | Config file path. |

Also leave `TMDB_API_KEY` unset when `TMDB_FIXTURE=1`. Optional live TMDB is operator choice later, not part of the demo gate.

### Mesh address & client dial targets

| Variable | Demo default | Purpose |
|----------|--------------|---------|
| `MUXCORE_MESH_ADDR` | `127.0.0.1:9090` | Core gRPC mesh as seen by smoke / listmodules / host scripts (not a loom config key; scripts and modules also accept `MUXCORE_GRPC_ADDR`). |
| `MUXCORE_GRPC_ADDR` | same mesh host:port | Sidecar SDK: address of core’s gRPC mesh to register against. |

### Smoke URLs & timeouts

| Variable | Demo default | Purpose |
|----------|--------------|---------|
| `SMOKE_CORE_URL` | `http://127.0.0.1:8080` | Core HTTP `/health` probe |
| `SMOKE_API_URL` | `http://127.0.0.1:18080` | `api-rest` base (`/api/v1/...`) |
| `SMOKE_ADMIN_URL` | `http://localhost:8082` | Admin UI URL for smoke / VIEW-ME |
| `SMOKE_JELLYFIN_URL` | `http://127.0.0.1:8475` | Soft Jellyfin bridge probe |
| `SMOKE_TIMEOUT_SEC` | `180` (`_mvp`) / `120` (installer) | Overall smoke wait budget |

### Library / auth bootstrap (lab + installer)

| Variable | Demo default | Purpose |
|----------|--------------|---------|
| `MVP_LIBRARY_ROOT` | `./data/library` | Movie library root for scanner / movies module |
| `MVP_TV_LIBRARY_ROOT` | `./data/library/tv` | TV library root |
| `MVP_DOWNLOADS_DIR` | `./data/downloads` | Download / watch directory (fixture engine writes here) |
| `MVP_TOKEN_FILE` | `./run/admin.token` | Bearer token written by bootstrap-auth |
| `MVP_ADMIN_USER` / `MVP_ADMIN_PASSWORD` | `admin` / `admin-dev-only` | Dev-only local auth bootstrap — **not for production** |
| `MVP_ENABLE_MEDIA_UI` | `1` (`_mvp`) / `0` (installer default) | Whether host stack expects consumer SPA bring-up |
| `AUTH_GRPC_ADDR` | `127.0.0.1:9403` | `auth-local` gRPC for bootstrap / clients |
| `AUTH_HTTP_URL` | `http://127.0.0.1:9401` | `auth-local` HTTP |

### Sidecar listen / client addresses (ports)

Used so host-mode processes and smoke clients agree on ports. Compose maps the same numbers into the container network.

**Canonical table (all MVP modules, remapped collision ports, opt-in indexer/ffprobe):** [Port Map](Port-Map).

| Variable | Demo default | Service |
|----------|--------------|---------|
| `API_REST_HTTP_ADDR` / `API_REST_GRPC_ADDR` | `:18080` / `:9400` | `api-rest` (HTTP remapped off core `:8080`) |
| `MOVIES_GRPC_ADDR` | `127.0.0.1:9420` | `media-movies` |
| `TVSHOWS_GRPC_ADDR` | `127.0.0.1:9440` | `media-tvshows` |
| `AUTOMATION_GRPC_CLIENT_ADDR` | `127.0.0.1:9460` | `media-automation` |
| `DOWNLOADER_GRPC_CLIENT_ADDR` | `127.0.0.1:9461` | `downloader-native-torrent` (remapped off `:9460`) |
| `SCANNER_GRPC_CLIENT_ADDR` | `127.0.0.1:9470` | `media-scanner` |
| `JELLYFIN_GRPC_CLIENT_ADDR` | `127.0.0.1:9475` | `jellyfin` bridge |
| `ROOTS_GRPC_ADDR` | `127.0.0.1:9540` | `media-root-folders` (`_mvp`) |
| `HEALTH_MONITOR_GRPC_CLIENT_ADDR` | `127.0.0.1:9202` | `health-monitor` (installer) |

Core loom ports (not env overrides in the demo `.env`, but expected defaults): HTTP **`:8080`**, gRPC mesh **`:9090`**. Admin UI listens on **`:8082`** (remapped off `:8080`). Consumer SPA (when enabled) is typically **`:5173`**. Indexer gRPC **`:9485`** only when live acquisition is opted in (remapped off ffprobe `:9480`).

Optional soft Jellyfin server (not required for demo): `JELLYFIN_BASE_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_WEBHOOK_SECRET` — leave empty for unconfigured-bridge smoke.

### Live acquisition (operator opt-in only — not a product gate)

Do **not** set these for install, CI, or the supported laptop demo. They exist for operators who already accept VPN / swarm risk and explicitly want live torrents.

| Variable | When set | Effect |
|----------|----------|--------|
| `PIRATEBAY_API_BASE` | e.g. Apibay URL | Host `run-host.sh` starts `indexer-piratebay`; Search can return live results |
| `DOWNLOADER_ENGINE` | `anacrolix` | Real BitTorrent client instead of fixture |
| `SMOKE_LIVE_ACQUISITION` | `1` | Smoke appends live acquisition checks **only if** `PIRATEBAY_API_BASE` is also set |
| `SMOKE_LIVE_TIMEOUT` | e.g. `3m` | Live section timeout (`_mvp`) |
| `SMOKE_LIVE_MIN_SEEDERS` | e.g. `1` | Minimum seeders gate for live smoke |
| `SMOKE_LIVE_MIN_BYTES` | e.g. `131072` | Minimum downloaded bytes for live smoke |

If `SMOKE_LIVE_ACQUISITION=1` but `PIRATEBAY_API_BASE` is empty, smoke skips the live section and stays on the fixture path.

### Minimal demo `.env` sketch

```bash
# Loom / TLS (laptop only)
MUXCORE_INSECURE_DISABLE_TLS=true
MUXCORE_LOG_LEVEL=info
MUXCORE_STORAGE_DIR=./data/storage
MUXCORE_MESH_ADDR=127.0.0.1:9090
MUXCORE_MESH_DIAL_LOCAL=true

# Fixture acquisition (supported gate)
DOWNLOADER_ENGINE=fixture
TMDB_FIXTURE=1
# PIRATEBAY_API_BASE=          # leave unset
# SMOKE_LIVE_ACQUISITION=      # leave unset / 0

# Smoke probes
SMOKE_CORE_URL=http://127.0.0.1:8080
SMOKE_API_URL=http://127.0.0.1:18080
SMOKE_ADMIN_URL=http://localhost:8082
SMOKE_TIMEOUT_SEC=180

# Paths + bootstrap
MVP_LIBRARY_ROOT=./data/library
MVP_TV_LIBRARY_ROOT=./data/library/tv
MVP_DOWNLOADS_DIR=./data/downloads
MVP_TOKEN_FILE=./run/admin.token
MVP_ADMIN_USER=admin
MVP_ADMIN_PASSWORD=admin-dev-only
```

See [Getting Started](Getting-Started) for install paths and [Deployment](Deployment) for production TLS (no insecure-disable).

---

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--tag` | (none) | Tag name to load from spool (e.g., `default`) |
| `--spool` | `https://github.com/Muxcore-Media/spool` | Spool URL to fetch tags from |
| `--version` | — | Print version and exit |

Without `--tag`, core starts as a bare loom — HTTP server + gRPC mesh, zero modules.

---

## Config Hot-Reload (SIGHUP)

Send `SIGHUP` to apply config file changes at runtime:

```bash
kill -HUP $(pidof muxcored)
```

**Applied live (no restart needed):**
- `log.level`, `log.format`
- `grpc.seed_nodes`

**Requires restart (warning logged, change NOT applied):**
- `audit.path` — the file handle stays open to the original file until restart
- `server.addr`, `grpc.addr`
- Any TLS cert/key files
- `database`, `cache` settings
- `grpc.join_token`

---

## TLS Configuration

### Development Mode (No TLS)

Set `MUXCORE_INSECURE_DISABLE_TLS=true` to bypass TLS requirement for both HTTP and gRPC. The server logs a warning. Only use for local development.

```bash
MUXCORE_INSECURE_DISABLE_TLS=true muxcored --tag default
```

### Production TLS (Server)

```bash
export MUXCORE_TLS_CERT=/etc/ssl/server-cert.pem
export MUXCORE_TLS_KEY=/etc/ssl/server-key.pem
```

### Production TLS (gRPC)

```bash
export MUXCORE_GRPC_TLS_CERT=/etc/ssl/grpc-cert.pem
export MUXCORE_GRPC_TLS_KEY=/etc/ssl/grpc-key.pem
```

### Mutual TLS (mTLS) — External CA

```bash
export MUXCORE_GRPC_TLS_CERT=/etc/ssl/grpc-cert.pem
export MUXCORE_GRPC_TLS_KEY=/etc/ssl/grpc-key.pem
export MUXCORE_GRPC_MTLS_ENABLED=true
export MUXCORE_GRPC_MTLS_CA=/etc/ssl/ca.pem
```

### Mutual TLS (mTLS) — Internal CA

Core can auto-generate its own CA. No external CA setup needed:

```bash
export MUXCORE_GRPC_MTLS_ENABLED=true
export MUXCORE_GRPC_CA_CERT_DIR=/etc/muxcore/ca
```

The internal CA creates `ca.crt` and `ca.key` in the specified directory on first start. Core-spawned modules get auto-issued certificates. See [Module TLS Authentication](Module-TLS-Authentication) for full details.

---

## Per-Module Configuration

The `modules` map in `muxcore.json` passes arbitrary configuration to individual modules by their module ID:

```json
{
  "modules": {
    "downloader-native-torrent": {
      "listen_addr": "http://192.168.1.50:8080",
      "username": "admin",
      "poll_interval_seconds": 30
    },
    "media-transcoder": {
      "gpu": "nvidia",
      "max_concurrent": 2
    }
  }
}
```

Modules read their config by looking up their own module ID in the `Modules` map. There is no environment variable equivalent — per-module config is file-only.
