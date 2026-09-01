# Getting Started

**Install MuxCore on one laptop from a Forgejo or LAN OCI registry (preferred), release binaries, or the installer.** You do not need a monorepo of sibling clones, Go, or live pirate indexers to try the media path.

Active product work is tracked in [Tasks](Tasks) → workspace [`MASTER-ROADMAP.md`](../MASTER-ROADMAP.md).

---

## What you are installing

MuxCore is a **loom** (`muxcored`) plus **sidecar modules** (auth, libraries, automation, downloader, UIs). On a laptop, the supported first-run is:

1. Pull prebuilt images from **`MUXCORE_REGISTRY`** (Forgejo `git.zem.systems/muxcore` or a LAN registry) using `_mvp/docker-compose.registry.yml`.
2. Start the stack with fixture-friendly defaults (`DOWNLOADER_ENGINE=fixture`).
3. Log into admin + consumer UI, import or request a fixture title, confirm it appears in the library.

That path is the product gate. Live torrents, Apibay, Real-Debrid, paid TMDB, and paid Usenet are **operator opt-in later** — never required for install or smoke.

GitHub Releases and GHCR are a **deferred public mirror** — not the required download path for household installs (see [Deployment](Deployment#self-hosted-ci-and-local-registry-no-billing-narrative)).

---

## Prerequisites

| Required | Optional |
|----------|----------|
| Linux or macOS laptop (amd64 or arm64) | Docker Compose v2 or Podman Compose |
| Docker / Podman for registry install (Path A) | Go toolchain (only if you build from source) |
| Network to your Forgejo or LAN registry once | Local Jellyfin for bridge demos |

You do **not** need: sixty sibling git clones, GitHub-hosted Actions minutes, GHCR `write:packages`, VPN, or any pirate site account.

---

## Path A — Registry install (preferred household)

The supported non-developer path pulls OCI images from **Forgejo or a LAN registry** — no sibling Go clones and no GHCR push scope.

### Publish images (operator / lab)

From the workspace `_mvp/` tree (or equivalent checkout with `scripts/`):

```bash
cd _mvp

# LAN registry (no Forgejo yet)
./scripts/local-registry.sh start
export MUXCORE_REGISTRY=localhost:5000/muxcore
./scripts/publish-muxcored-local.sh v0.5.8

# Forgejo package registry (default MUXCORE_REGISTRY when unset in publish script)
./scripts/publish-muxcored-local.sh v0.5.8
# default: git.zem.systems/muxcore
```

`MUXCORE_REGISTRY` must match on **publish and install** hosts. Tag module images (`api-rest`, `auth-local`, …) under the same prefix with `scripts/publish-module-images.sh`.

Forgejo login (when pushing to origin):

```bash
echo "$FORGEJO_TOKEN" | podman login git.zem.systems -u <user> --password-stdin
```

### Install (primary)

```bash
cd _mvp
export MUXCORE_REGISTRY=localhost:5000/muxcore   # or git.zem.systems/muxcore
export MUXCORE_IMAGE_TAG=v0.5.8
export DOWNLOADER_ENGINE=fixture
docker compose -f docker-compose.registry.yml pull
docker compose -f docker-compose.registry.yml up -d
./smoke.sh
```

Default operator URLs (see [Port Map](Port-Map)):

| Surface | URL |
|---------|-----|
| Admin UI | `http://127.0.0.1:9080` (registry compose) |
| REST API | `http://127.0.0.1:18080` |
| Core health | `http://127.0.0.1:8080/health` |

Full operator doc: [`_mvp/docs/PUBLIC-INSTALL.md`](../_mvp/docs/PUBLIC-INSTALL.md).

**Deferred:** public `ghcr.io/muxcore-media/*` mirror via `_mvp/docker-compose.ghcr.yml` — requires GitHub `write:packages`; use Forgejo/LAN until that scope exists.

---

## Path B — Installer or manual release binaries

The **`muxcore-installer`** TUI (see [Tasks](Tasks)) can fetch pinned release tarballs when registry images are unavailable. **GitHub Releases** remain an optional public mirror for binaries — not the origin gate for household compose.

When available the installer:

1. Downloads pinned `muxcored` + module release assets (Forgejo origin preferred; GitHub mirror when published).
2. Creates a local data dir, `.env`, and TLS-off-dev defaults for laptop use.
3. Bootstraps an `auth-local` admin user and prints the password once.
4. Starts the stack via Compose **or** host binaries.
5. Writes a `VIEW-ME.txt`-style URL sheet (admin, consumer, health).
6. Runs an offline smoke: fixture acquisition → library → `/api/movies`.

Typical shape (exact flags land with the installer release):

```bash
./install.sh --dir ~/muxcore --tag media
# Follow printed VIEW-ME.txt for admin / consumer URLs
```

### Manual release binaries (mirror path)

```bash
mkdir -p ~/muxcore/{bin,data,run}
cd ~/muxcore
# Download muxcored + module tarballs from GitHub Releases or Forgejo release assets
chmod +x bin/muxcored
./bin/muxcored --help
```

Prefer **Path A** (registry compose) for homelab household installs. Use **Path B** when you already manage release tarballs yourself. The developer lab in `_mvp/` (sibling builds) is not the end-user path.

---

## Path C — Manual spool / tag (advanced)

### Spool tags instead of inventing a module list

```bash
# Official spool — curated presets
export MUXCORE_SPOOL=https://github.com/Muxcore-Media/spool
./bin/muxcored --tag minimal   # platform + auth-ish baseline
# or
./bin/muxcored --tag media     # libraries + automation + acquisition chain
```

Tags are JSON lists of `{repo, version, required}`. Core resolves them from the spool and launches sidecars. Third-party spools are untrusted — see [Spool Security](Spool-Security).

### Laptop-friendly env defaults

For a first laptop run, prefer insecure-dev TLS off and fixture acquisition (see [Fixture-first acquisition](#fixture-first-acquisition) below):

```bash
export MUXCORE_INSECURE_DISABLE_TLS=true   # laptop / lab only
export DOWNLOADER_ENGINE=fixture
export TMDB_FIXTURE=1
# Leave PIRATEBAY_API_BASE unset — indexer soft-empty is fine
```

Generate a local admin via your bootstrap script (installer prints this; `_mvp/bootstrap-auth.sh` is the lab equivalent). Open the printed admin and consumer URLs.

### Verify

```bash
curl -sS http://127.0.0.1:8080/health
# Expect status ok and module health entries once sidecars register

curl -sS http://127.0.0.1:18080/api/v1/health   # api-rest, if loaded
```

Then log into **admin-ui** and **media-ui-app**, confirm modules list healthy, and run a fixture Dispatch or library import (next section).

---

## Path D — Developer lab (`_mvp`) — not end-user

[`_mvp/`](../_mvp/) is the **reference lab**: sibling clones, `run-host.sh`, Compose builds from workspace trees. It proves the media path and hosts `./smoke.sh`. Product docs and the installer must not require that layout.

If you are developing MuxCore itself:

```bash
cd _mvp
cp .env.example .env
# Prefer fixture defaults for day-to-day:
#   DOWNLOADER_ENGINE=fixture
#   TMDB_FIXTURE=1
#   SMOKE_LIVE_ACQUISITION unset / off
./run-host.sh up
./bootstrap-auth.sh
./smoke.sh
```

Operator URLs after host up: `_mvp/run/VIEW-ME.txt`. Treat `_mvp` as upstream for installer behavior, not as the install story you hand to non-developers.

---

## Fixture-first acquisition

**No live pirate required.** The supported laptop demo closes the acquire → library → UI loop entirely offline (or with only GitHub Releases for install).

### Why fixtures

| Concern | Fixture path | Live path (opt-in) |
|---------|--------------|--------------------|
| Product / smoke gate | Yes | No |
| BitTorrent swarm / DHT | No | Yes (`DOWNLOADER_ENGINE=anacrolix`) |
| Pirate / Apibay HTTP | No | Yes (`PIRATEBAY_API_BASE`) |
| TMDB network / API key | No (`TMDB_FIXTURE=1`) | Optional real key |
| VPN | No | Recommended if you opt in |

Live acquisition remains available for operators who explicitly enable it. It is **never** a CI gate, install prerequisite, or “Getting Started” requirement. See [Tasks](Tasks) and workspace [`MASTER-ROADMAP.md`](../MASTER-ROADMAP.md) for constraints.

### Default knobs

| Variable | Laptop default | Meaning |
|----------|----------------|---------|
| `DOWNLOADER_ENGINE` | `fixture` | Writes a parseable `.mkv` under the download dir and completes immediately — no swarm |
| `TMDB_FIXTURE` | `1` | Offline Fight Club / Breaking Bad metadata for search & details |
| `PIRATEBAY_API_BASE` | *unset* | Indexer stays soft-empty; Search returns nothing; demo still works |
| `SMOKE_LIVE_ACQUISITION` | *off* | Smoke must not append live pirate sections |

Optional later (not for first-run docs):

```bash
# Operator opt-in only — not supported as a product gate
# export PIRATEBAY_API_BASE=https://apibay.org
# export DOWNLOADER_ENGINE=anacrolix
# export SMOKE_LIVE_ACQUISITION=1
```

### What the offline loop does

1. **Request / catalog** — `request-media` + `metadata-tmdb` in fixture mode resolve titles without a TMDB key.
2. **Dispatch** — `media-automation` Dispatches to `downloader-native-torrent` with `DOWNLOADER_ENGINE=fixture`.
3. **Complete** — fixture engine emits `download.completed` with a local file under the downloads directory.
4. **Import** — `media-scanner` `ImportPath` / watch dir organizes into the library root (e.g. `Movies/Fight Club (1999)/…`).
5. **Browse / play** — admin-ui and media-ui-app list the title; stream/download uses the local library file.

You can also drop a fixture file into the downloads/watch directory and import without Dispatch. Indexers may be omitted entirely.

### Soft-empty indexers

Unconfigured `indexer-piratebay` / Torznab is normal on a laptop demo. Automation Search may be empty; Dispatch fixture magnets still complete. Do not treat “no indexer results” as a failed install.

---

## Configuration pointers

- Full loom keys, `MUXCORE_*` overrides, and **laptop demo / installer env knobs**: [Configuration Reference](Configuration-Reference#laptop-demo--installer-env-_mvp--muxcore-installer).
- **gRPC/HTTP host ports** for installer + `_mvp` modules (including remapped collision fixes): [Port Map](Port-Map).
- Spool presets: [Spool & Marketplace](Spool-and-Marketplace).
- Security / mTLS (production): [Security](Security), [Module TLS Authentication](Module-TLS-Authentication).

Minimal loom config example:

```json
{
  "server": { "addr": ":8080" },
  "grpc": { "addr": ":9090" },
  "log": { "level": "info", "format": "text" }
}
```

Module-specific knobs (`DOWNLOADER_ENGINE`, `TMDB_FIXTURE`, library roots, auth bootstrap) live in the installer’s `.env` (or `_mvp/.env` in the lab). Prefer env for laptop demos; keep secrets out of git.

---

## Spool security (short)

Official spool: `https://github.com/Muxcore-Media/spool`. Modules there are maintained by the MuxCore org.

Third-party `--spool` URLs are untrusted: audit module repos and pins, prefer commit/tag pins, and run untrusted sets in a sandbox. Modules inherit the loom’s OS privileges. Details: [Spool Security](Spool-Security).

---

## Staging TLS and public auth URLs

For a real host (not unit tests):

1. Prefer mTLS (`MUXCORE_GRPC_MTLS_ENABLED=true` / `grpc.mtls_enabled` in config). See [Module TLS Authentication](Module-TLS-Authentication) and [Deployment](Deployment#mtls-and-certificate-management).
2. Never leave `MUXCORE_INSECURE_DISABLE_TLS=true` on staging or production processes.
3. When using auth-local / auth-oidc behind a reverse proxy, split URLs:
   - **Public (browser):** e.g. `https://auth.zem.systems` (`AUTH_HTTP_URL` / `ADMIN_UI_AUTH_ADDR`)
   - **Internal (code exchange):** e.g. `http://127.0.0.1:9401` (`AUTH_HTTP_INTERNAL_URL` / `ADMIN_UI_AUTH_INTERNAL_ADDR`)

Full operator checklist: [`_mvp/tls/MTLS-STAGING.md`](../_mvp/tls/MTLS-STAGING.md).

## Next steps

- [Fixture-first acquisition](#fixture-first-acquisition) — already above; share with anyone tempted to “just hit Apibay for the demo”
- [Core Concepts](Core-Concepts) — loom, threads, signals
- [Deployment](Deployment) — single laptop → cluster; self-hosted CI + local registry
- [Tasks](Tasks) — stub to [`MASTER-ROADMAP.md`](../MASTER-ROADMAP.md)
- [Module System](Module-System) — what each sidecar does
