# Welcome to MuxCore

**MuxCore is a media automation platform that grows with you.** It starts as simple as a single app. When you're ready, scale to multiple machines, cloud storage, and custom workflows — without rebuilding or switching platforms.

---

## If You Use Sonarr, Radarr, or Plex...

You already know the *arr stack: Sonarr for TV, Radarr for movies, Lidarr for music, Bazarr for subtitles, Prowlarr for indexers, qBittorrent for downloads, Plex for playback. Each one is a separate program with its own settings, its own database, and its own way of doing things.

**MuxCore replaces all of them with one system.** But it doesn't lock you into one way of working. Every feature — downloading, indexing, playback, transcoding, notifications — is a pluggable module. Want two downloaders? Add them. Want GPU transcoding on a separate machine? Add a worker there. The system adapts to your setup.

## What Makes It Different

| What you're used to | How MuxCore does it |
|---|---|
| One program per media type | One platform, any media type |
| Hardcoded workflows (search → download → import) | Configurable workflows you define |
| One machine, one ceiling | Add machines, split the load |
| 1080p and 4K need two Sonarr instances | One library, any number of qualities |
| If a node goes down, nothing takes over | Leader can resurrect orphaned tag modules; worker tasks on the departed node are released for redispatch (retry-capped via `FailNodeTasks`) |
| Storage must be local or NFS-mounted | Storage is provider-routed (local today; S3/cloud via modules when available) |

## How It Works (In Plain English)

Think of MuxCore as a **loom** — the frame that holds everything together. Every feature you add is a **thread** woven into that frame:

- Want to download torrents? Add a downloader thread.
- Want to play media through Jellyfin? Add a playback thread.
- Want Discord notifications? Add a notification thread.

Threads never talk to each other directly. They send **signals** through the loom — download finished, import complete, playback started. Other threads hear those signals and react. This means you can add, remove, or replace threads without breaking anything.

The loom itself never changes when you add a new kind of media. Movies, TV, music, books, audiobooks — they're all just threads woven into the same fabric.

## Quick Start

Prefer **release binaries or the installer** on one laptop — not a monorepo of sibling clones, and not live pirate indexers.

```bash
# After installer or manual release download (see Getting Started)
export DOWNLOADER_ENGINE=fixture
export TMDB_FIXTURE=1
muxcored --tag media --spool https://github.com/Muxcore-Media/spool
```

[Getting Started](Getting-Started) covers installer / release layout, fixture-first acquisition (no live pirate required), and verification. Active work: [Tasks](Tasks) / workspace [`TASKS.md`](../TASKS.md).

## Quick Navigation

| New to MuxCore? | Building something? | Running it? |
|---|---|---|
| [Core Concepts](Core-Concepts) — how it all fits together | [Module System](Module-System) — every type of module explained | [Getting Started](Getting-Started) — install and configure; [Port Map](Port-Map) — gRPC/HTTP ports |
| [Events & Storage](Event-System) — how communication works | [Writing Modules](Writing-Modules) — build your own module | [Deployment](Deployment) — single node to cluster |
| | [Contracts Reference](Contracts) — every interface in detail | [Security](Security) — auth, TLS, permissions |
| | [Workflow Engine](Workflow-Engine) — multi-step pipelines | [Tasks](Tasks) — checklist / [`TASKS.md`](../TASKS.md) |
| | | [Architecture](Architecture) — bootstrap, gRPC services, cluster |

---

**MuxCore is the distributed fabric for media orchestration. The loom never changes. The threads are yours to define.**
