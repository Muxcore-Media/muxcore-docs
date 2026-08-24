# Getting Started

**Install MuxCore on one laptop from release binaries (or the installer).** You do not need a monorepo of sibling clones, Go, or live pirate indexers to try the media path.

Active product work is tracked in [Tasks](Tasks) (workspace [`TASKS.md`](../TASKS.md)).

---

## What you are installing

MuxCore is a **loom** (`muxcored`) plus **sidecar modules** (auth, libraries, automation, downloader, UIs). On a laptop, the supported first-run is:

1. Download published release assets (or run the installer that does this for you).
2. Start a local stack with fixture-friendly defaults.
3. Log into admin + consumer UI, import or request a fixture title, confirm it appears in the library.

That path is the product gate. Live torrents, Apibay, Real-Debrid, paid TMDB, and paid Usenet are **operator opt-in later** — never required for install or smoke.

---

## Prerequisites

| Required | Optional |
|----------|----------|
| Linux or macOS laptop (amd64 or arm64) | Docker / Podman Compose (compose profile) |
| Network to fetch GitHub Releases once | Go toolchain (only if you build from source) |
| A writable data directory | Local Jellyfin for bridge demos |

You do **not** need: sixty sibling git clones, GitHub-hosted Actions minutes, a paid registry, VPN, or any pirate site account.

---

## Path A — Installer (preferred)

The end-user surface is the **`muxcore-installer`** repo (see [Tasks](Tasks) §1). When available it:

1. Downloads pinned `muxcored` + module release assets from GitHub Releases.
2. Creates a local data dir, `.env`, and TLS-off-dev defaults for laptop use.
3. Bootstraps an `auth-local` admin user and prints the password once.
4. Starts the stack via Compose **or** host binaries.
5. Writes a `VIEW-ME.txt`-style URL sheet (admin, consumer, health).
6. Runs an offline smoke: fixture acquisition → library → `/api/movies`.

Typical shape (exact flags land with the installer release):

```bash
# After cloning or downloading muxcore-installer
./install.sh --dir ~/muxcore --tag media
# Follow printed VIEW-ME.txt for admin / consumer URLs
```

Prefer **Path A** (`muxcore-installer`) for a laptop demo. Use **Path B** (manual release binaries) when you already manage binaries yourself. The developer lab in `_mvp/` (sibling builds) is not the end-user path.

---

## Path B — Manual release binaries

### 1. Pick a data directory

```bash
mkdir -p ~/muxcore/{bin,data,run}
cd ~/muxcore
```

### 2. Fetch core

Download the `muxcored` asset for your OS/arch from the [core releases](https://github.com/Muxcore-Media/core/releases) page (current product line: **v0.5.0+**), verify checksums if published, and place the binary in `bin/`:

```bash
chmod +x bin/muxcored
./bin/muxcored --help
```

### 3. Fetch modules from Releases (not clones)

Pull the modules your spool tag pins — typically from the `media` / `minimal` presets in [`Muxcore-Media/spool`](https://github.com/Muxcore-Media/spool). Each module publishes its own GitHub Release; the installer (Path A) automates the pin matrix. Manual operators should mirror the same tags the spool lists (no floating `latest` for end-user demos).

Place module binaries next to `muxcored` or wherever your start script expects them. You still do **not** need source trees.

### 4. Spool tags instead of inventing a module list

```bash
# Official spool — curated presets
export MUXCORE_SPOOL=https://github.com/Muxcore-Media/spool
./bin/muxcored --tag minimal   # platform + auth-ish baseline
# or
./bin/muxcored --tag media     # libraries + automation + acquisition chain
```

Tags are JSON lists of `{repo, version, required}`. Core resolves them from the spool and launches sidecars. Third-party spools are untrusted — see [Spool Security](Spool-Security).

### 5. Laptop-friendly env defaults

For a first laptop run, prefer insecure-dev TLS off and fixture acquisition (see [Fixture-first acquisition](#fixture-first-acquisition) below):

```bash
export MUXCORE_INSECURE_DISABLE_TLS=true   # laptop / lab only
export DOWNLOADER_ENGINE=fixture
export TMDB_FIXTURE=1
# Leave PIRATEBAY_API_BASE unset — indexer soft-empty is fine
```

Generate a local admin via your bootstrap script (installer prints this; `_mvp/bootstrap-auth.sh` is the lab equivalent). Open the printed admin and consumer URLs.

### 6. Verify

```bash
curl -sS http://127.0.0.1:8080/health
# Expect status ok and module health entries once sidecars register

curl -sS http://127.0.0.1:18080/api/v1/health   # api-rest, if loaded
```

Then log into **admin-ui** and **media-ui-app**, confirm modules list healthy, and run a fixture Dispatch or library import (next section).

---

## Path C — Developer lab (`_mvp`) — not end-user

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

Live acquisition remains available for operators who explicitly enable it. It is **never** a CI gate, install prerequisite, or “Getting Started” requirement. See workspace [`TASKS.md`](../TASKS.md) constraints and §12 non-goals.

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
   - **Public (browser):** e.g. `https://auth.gringotts` (`AUTH_HTTP_URL` / `ADMIN_UI_AUTH_ADDR`)
   - **Internal (code exchange):** e.g. `http://127.0.0.1:9401` (`AUTH_HTTP_INTERNAL_URL` / `ADMIN_UI_AUTH_INTERNAL_ADDR`)

Full operator checklist: [`_mvp/tls/MTLS-STAGING.md`](../_mvp/tls/MTLS-STAGING.md).

## Next steps

- [Fixture-first acquisition](#fixture-first-acquisition) — already above; share with anyone tempted to “just hit Apibay for the demo”
- [Core Concepts](Core-Concepts) — loom, threads, signals
- [Deployment](Deployment) — single laptop → cluster; self-hosted CI + local registry
- [Tasks](Tasks) / [`TASKS.md`](../TASKS.md) — installer, gates G1–G10, packaging checklist
- [Module System](Module-System) — what each sidecar does
