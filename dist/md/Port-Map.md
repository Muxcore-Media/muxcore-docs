# Port Map

**Canonical host-port assignments for the laptop MVP stack** used by [`muxcore-installer`](../muxcore-installer/) and the `_mvp` reference lab. Prefer these numbers over older README snippets that still mention historical defaults.

Sources of truth for what actually starts:

- Installer host: [`muxcore-installer/up.sh`](../muxcore-installer/up.sh)
- Lab host: [`_mvp/run-host.sh`](../_mvp/run-host.sh)
- Compose publish map: [`_mvp/docker-compose.yml`](../_mvp/docker-compose.yml)

Env override names match [Configuration Reference — sidecar listen addresses](Configuration-Reference#sidecar-listen--client-addresses-ports).

---

## How to read this map

| Column | Meaning |
|--------|---------|
| **Host port** | Port on `127.0.0.1` for the installer / `_mvp` host stack (and the default Compose *host* publish). |
| **Container / listen** | Address the process binds inside Compose (often the same as host; `api-rest` HTTP differs). |
| **Override env** | Primary env var that changes the listen address. |

Unless noted, gRPC and HTTP are separate listeners. Modules without a public HTTP UI still announce a gRPC listen addr to the mesh (`ModuleInfo.HttpAddr` historically names that gRPC endpoint).

---

## Core loom

| Service | Protocol | Host port | Listen (default) | Override |
|---------|----------|-----------|------------------|----------|
| `muxcored` | HTTP | **8080** | `:8080` | `MUXCORE_SERVER_ADDR` / `server.addr` |
| `muxcored` | gRPC mesh | **9090** | `:9090` | `grpc.addr` / `MUXCORE_MESH_ADDR` (clients) |

---

## MVP modules (installer + `_mvp`)

These are started by `muxcore-installer/up.sh` (fixture-only product path). `_mvp/run-host.sh` uses the same ports; Compose publishes the same host numbers unless an env override is set.

| Module | Protocol | Host port | Module binary default | Override env | Notes |
|--------|----------|-----------|----------------------|--------------|-------|
| `api-rest` | HTTP | **18080** | `:8080` | `API_REST_HTTP_ADDR` | **Remapped** so it does not collide with core `:8080`. Compose: host `18080` → container `8080`. |
| `api-rest` | gRPC | **9400** | `:9400` | `API_REST_GRPC_ADDR` | |
| `auth-local` | gRPC | **9403** | `:9403` | `AUTH_GRPC_ADDR` | Bootstrap / `authctl` |
| `auth-local` | HTTP | **9401** | `:9401` | `AUTH_HTTP_ADDR` | Login UI, WebAuthn |
| `database-sqlite` | gRPC | **9700** | `:9700` | `DATABASE_GRPC_ADDR` | Usually not published in Compose |
| `secrets-file` | gRPC | **9550** | `:9550` | `SECRETS_GRPC_ADDR` | |
| `encryption-aesgcm` | gRPC | **9601** | `:9601` | `ENCRYPTION_GRPC_ADDR` | |
| `call-policy-default` | gRPC | **9101** | `:9101` | `CALL_POLICY_GRPC_ADDR` | |
| `publish-policy-default` | gRPC | **9102** | `:9102` | — (binary default; no env override) | |
| `health-monitor` | gRPC | **9202** | `:9202` | `HEALTH_MONITOR_GRPC_ADDR` | |
| `health-monitor` | HTTP | **9203** | `:9203` | `HEALTH_MONITOR_HTTP_ADDR` | `/status` aggregate |
| `admin-ui` | HTTP | **8082** | `:8080` | `ADMIN_UI_ADDR` | **Remapped** off core/api-rest `:8080`. In auth-local redirect allowlist. |
| `metadata-tmdb` | gRPC | **9411** | `:9411` | `METADATA_GRPC_ADDR` | Was `:9410` historically (see remaps) |
| `media-movies` | gRPC | **9420** | `:9420` | `MOVIES_GRPC_ADDR` | |
| `media-movies` | HTTP | **9430** | `:9430` | `MOVIES_HTTP_ADDR` | Artwork / HTTP helpers |
| `media-tvshows` | gRPC | **9440** | `:9440` | `TVSHOWS_GRPC_ADDR` | |
| `media-tvshows` | HTTP | **9450** | `:9450` | `TVSHOWS_HTTP_ADDR` | |
| `notification-default` | gRPC | **9441** | `:9441` | `NOTIFY_GRPC_ADDR` | **Remapped** off tvshows `:9440` |
| `media-automation` | gRPC | **9460** | `:9460` | `AUTOMATION_GRPC_ADDR` | Owns `:9460` |
| `downloader-native-torrent` | gRPC | **9461** | `:9461` | `DOWNLOADER_GRPC_ADDR` | **Remapped** off automation `:9460` |
| `media-scanner` | gRPC | **9470** | `:9470` | `SCANNER_GRPC_ADDR` | |
| `jellyfin` | gRPC | **9475** | `:9475` | `JELLYFIN_GRPC_ADDR` | Soft-unconfigured OK |
| `jellyfin` | HTTP | **8475** | `:8475` | `JELLYFIN_HTTP_ADDR` | `/healthz` |
| `request-media` | gRPC | **9481** | `:9481` | `REQUEST_GRPC_ADDR` | |
| `request-media` | HTTP | **9380** | `:9380` | `REQUEST_HTTP_ADDR` | Consumer / BFF |
| `media-root-folders` | gRPC | **9540** | `:9540` | `ROOTS_GRPC_ADDR` | |

### Optional consumer UI

| Component | Protocol | Host port | Override | Notes |
|-----------|----------|-----------|----------|-------|
| `media-ui` / `mediauiprox` | HTTP | **5173** | `MEDIA_UI_LISTEN` / `MEDIA_UI_HTTP_PORT` | Installer off unless `MVP_ENABLE_MEDIA_UI≠0` + dist |

---

## Opt-in acquisition / analysis peers

Not started by the installer fixture path. `_mvp` starts `indexer-piratebay` only when `PIRATEBAY_API_BASE` is set. Listed here so multi-module hosts do not reuse their ports.

| Module | Protocol | Canonical port | Override | Collision note |
|--------|----------|----------------|----------|----------------|
| `indexer-piratebay` | gRPC | **9485** | `PIRATEBAY_GRPC_ADDR` | **Remapped** from `:9480` (ffprobe) |
| `indexer-torznab` | gRPC | **9486** | `TORZNAB_GRPC_ADDR` | Adjacent to piratebay |
| `media-ffprobe` | gRPC | **9480** | `FFPROBE_GRPC_ADDR` | Keeps `:9480`; do not put piratebay here |
| `media-custom-formats` | gRPC | **9490** | `FORMATS_GRPC_ADDR` | Scoring peer; adjacent to ffprobe/indexers |
| `media-rename` | gRPC | **9510** | `RENAME_GRPC_ADDR` | Binary default and host/`_mvp` map agree on **`:9510`** |
| `notification-apprise` | gRPC | **9445** | `NOTIFY_GRPC_ADDR` | Alternate notifier; not co-started with default on same addr |
| `auth-oidc` | gRPC | **9410** | `AUTH_OIDC_GRPC_ADDR` | Fills the slot freed when metadata moved to `:9411` |
| `auth-oidc` | HTTP | **9412** | `AUTH_OIDC_HTTP_ADDR` | Remapped off metadata gRPC `:9411` |

---

## Optional media, userdata, cache, and storage peers

Not started by the default installer fixture path. Listed so multi-module hosts do not reuse ports. Enable via `_mvp/run-host.sh` env flags or registry compose profiles. Canonical list: workspace `_mvp/PORTS.md`.

| Module | Protocol | Port(s) | Override env | Enable flag / notes |
|--------|----------|---------|--------------|---------------------|
| `userdata-local` | HTTP / gRPC | **9672** / **9673** | `USERDATA_LOCAL_HTTP_ADDR` / `USERDATA_LOCAL_GRPC_ADDR` | `MVP_ENABLE_USERDATA_LOCAL=1` |
| `media-subtitles` | gRPC / HTTP | **9520** / **9521** | `SUBTITLES_GRPC_ADDR` / `SUBTITLES_HTTP_ADDR` | optional subtitle manager |
| `media-transcoder` | gRPC / playback HTTP | **9525** / **9526** | `TRANSCODER_GRPC_ADDR` / `TRANSCODER_HTTP_ADDR` | mediauiprox transcode dial `:9526` |
| `plex` | gRPC / HTTP | **9476** / **8476** | `PLEX_GRPC_ADDR` / `PLEX_HTTP_ADDR` | optional playback bridge |
| `emby` | gRPC / HTTP | **9477** / **8477** | `EMBY_GRPC_ADDR` / `EMBY_HTTP_ADDR` | optional playback bridge |
| `media-music` | gRPC / health HTTP | **9640** / **9641** | `MUSIC_GRPC_ADDR` / `MUSIC_HTTP_ADDR` | optional Lidarr-class manager |
| `media-books` | gRPC / health HTTP | **9650** / **9651** | `BOOKS_GRPC_ADDR` / `BOOKS_HTTP_ADDR` | optional Readarr-class manager |
| `media-comics` | gRPC / health HTTP | **9660** / **9661** | `COMICS_GRPC_ADDR` / `COMICS_HTTP_ADDR` | optional manga/comic manager |
| `media-audiobooks` | gRPC / health HTTP | **9670** / **9671** | `AUDIOBOOKS_GRPC_ADDR` / `AUDIOBOOKS_HTTP_ADDR` | optional audiobook manager |
| `media-list-sync` | gRPC | **9530** | `LIST_SYNC_GRPC_ADDR` | `MVP_ENABLE_MEDIA_LIST_SYNC=1` |
| `media-dlna` | DLNA HTTP / gRPC / health | **9750** / **9751** / **8751** | `DLNA_HTTP_ADDR` / `DLNA_GRPC_ADDR` / `DLNA_HEALTH_ADDR` | `MVP_ENABLE_MEDIA_DLNA=1` |
| `cache-local` | gRPC | **9602** | `CACHE_LOCAL_GRPC_ADDR` | in-process cache module |
| `cache-redis` | gRPC | **9600** | `CACHE_REDIS_GRPC_ADDR` | `MVP_ENABLE_CACHE_REDIS=1` or `REDIS_ADDR` |
| `storage-s3` | gRPC / health HTTP | **9610** / **9611** | `STORAGE_S3_GRPC_ADDR` / `STORAGE_S3_HTTP_ADDR` | optional S3/MinIO provider |
| `storage-ceph` | gRPC / health HTTP | **9680** / **9681** | `STORAGE_CEPH_GRPC_ADDR` / `STORAGE_CEPH_HTTP_ADDR` | optional Ceph/RGW provider |

---

## Remapped host ports (collision fixes)

Historical module defaults overlapped when several sidecars ran on one host. **Current binary defaults and the host/installer scripts already use the remapped ports below.** Treat older docs that still say the “former” value as stale.

| Former default | Current canonical | Module that moved | Why |
|----------------|-------------------|-------------------|-----|
| `:8080` (HTTP) | **`:18080`** (host) | `api-rest` | Core loom owns host `:8080`. Module may still default to `:8080` *inside* its process; host/Compose always remap. |
| `:8080` (HTTP) | **`:8082`** | `admin-ui` | Same collision with core; host sets `ADMIN_UI_ADDR=:8082`. |
| `:9460` (gRPC) | **`:9461`** | `downloader-native-torrent` | `media-automation` keeps `:9460`. |
| `:9480` (gRPC) | **`:9485`** | `indexer-piratebay` | `media-ffprobe` keeps `:9480`; torznab uses `:9486`. |
| `:9440` (gRPC) | **`:9441`** | `notification-default` | `media-tvshows` gRPC keeps `:9440`. |
| `:9410` (gRPC) | **`:9411`** | `metadata-tmdb` | Frees `:9410` for `auth-oidc` gRPC. |
| `:9411` (HTTP) | **`:9412`** | `auth-oidc` HTTP | Avoids collision with metadata-tmdb gRPC on `:9411`. |
| `:9500` (gRPC) | **`:9510`** | `media-rename` | Binary default and host/`_mvp` both use `:9510`. |

If you run modules **without** the installer/`_mvp` env wrappers, set the override env vars explicitly — do not assume every published binary’s README matches this map until you verify `internal/module.go`.

### Still unique on the MVP set (no remap needed)

| Port | Owner |
|------|-------|
| 9090 | core gRPC mesh |
| 9101 / 9102 | call-policy / publish-policy |
| 9202 / 9203 | health-monitor |
| 9380 / 9481 | request-media |
| 9400 / 9401 / 9403 | api-rest gRPC / auth HTTP / auth gRPC |
| 9420 / 9430 | media-movies |
| 9440 / 9450 | media-tvshows |
| 9460 | media-automation |
| 9470 / 9475 / 8475 | scanner / jellyfin |
| 9540 / 9550 / 9601 / 9700 | roots / secrets-file / encryption / sqlite |

---

## Quick operator cheatsheet

Same numbers as installer `VIEW-ME.txt` / `_mvp` Endpoints:

| URL / dial | Default |
|------------|---------|
| Admin UI | `http://localhost:8082` |
| Core health | `http://127.0.0.1:8080/health` |
| REST API | `http://127.0.0.1:18080` |
| Auth HTTP | `http://127.0.0.1:9401` |
| Mesh gRPC | `127.0.0.1:9090` |
| Health `/status` | `http://127.0.0.1:9203/status` |
| Jellyfin bridge | `http://127.0.0.1:8475` |
| Consumer SPA | `http://127.0.0.1:5173` |
| Automation gRPC | `127.0.0.1:9460` |
| Downloader gRPC | `127.0.0.1:9461` |
| Scanner gRPC | `127.0.0.1:9470` |
| Indexer (opt-in) | `127.0.0.1:9485` |

---

## Related

- [Configuration Reference](Configuration-Reference) — full env list
- [Getting Started](Getting-Started) — laptop install paths
- [Deployment](Deployment) — production TLS (no insecure-disable)
