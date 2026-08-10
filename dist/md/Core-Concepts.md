# Core Concepts

**This page explains how MuxCore works — from the big ideas down to the details.** If you're coming from Sonarr, Radarr, or Plex, start here. You don't need to be a programmer to understand this page. When we get into code examples, we'll mark them clearly.

---

## The Problem MuxCore Solves

### How Media Automation Works Today

Right now, most people run a stack of separate programs:

```
Sonarr (TV)  +  Radarr (Movies)  +  Lidarr (Music)  +  Bazarr (Subtitles)
     ↓               ↓                   ↓                  ↓
Prowlarr (search) → qBittorrent (download) → Plex/Jellyfin (playback)
```

Each program has its own:
- **Database** — the same movie exists in three places
- **Settings** — configure download paths six times
- **Scheduler** — six separate task timers running
- **Update cycle** — six things to keep current

This works fine for a single machine with a simple setup. It breaks down when you want to:
- Run transcoding on a separate GPU machine
- Store some media locally and some in cloud storage
- Have two downloaders active at the same time
- Add a new media type (books, audiobooks, comics)
- Survive a machine going down without manual intervention

### How MuxCore Does It

MuxCore replaces the separate programs with a **single platform** where everything is a pluggable module:

```
                         MuxCore (the platform)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   Downloaders           Media Managers         Playback
   (qBit, SABnzbd)    (Movies, TV, Music)   (Jellyfin, Plex)
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                    Everything else:
              Indexers, Transcoders, Notifications,
              Metadata, Subtitles, Storage backends...
```

Instead of six programs that barely know about each other, you have one platform where every module can see what every other module is doing. A download finishes → the media manager imports it → the transcoder optimizes it → notification goes out. All without hardcoded paths or fragile integrations.

> **⚠️ Beta software notice:** MuxCore is pre-1.0 beta software under active development. Core ships a built-in WorkerPool (`core.workerpool`). When a node dies, the **leader** can resurrect orphaned modules from the spool tag cache (`ResurrectOrphan`). **Task redistribution** returns departed-node worker tasks to Pending for redispatch (up to `MaxRetries`); exhausted retries are marked failed.

---

## The Fabric Metaphor

MuxCore uses a consistent metaphor to explain how it works. Once you understand this, everything else clicks into place.

**MuxCore is a fabric — a woven system of independent parts working together.**

| Concept | What it means | Real-world analogy |
|---------|--------------|-------------------|
| **The Loom** | Core platform — the fixed frame | The frame of a weaving loom that never changes shape |
| **Threads** | Modules — every feature is a thread | Individual threads woven into the fabric |
| **Patterns** | Contracts — the interfaces threads agree to | The weaving pattern that determines how threads cross |
| **Signals** | Events — how threads communicate | A pulse that travels through the fabric when something changes |
| **Tapestries** | Workflows — multi-step processes | A finished woven piece made from many threads |

### The Loom Never Changes

This is the most important rule in MuxCore:

> **If adding a new media type requires changing the core platform, the architecture is wrong.**

Core — the loom — knows nothing about movies, TV shows, music, books, or any specific media type. It provides the base infrastructure (event bus, module registry, HTTP server, gRPC mesh, storage orchestrator, audit pipeline) and nothing more. Everything specific to a media type lives in modules and their contracts.

This means:
- Adding support for VR180 video? Write a module, core doesn't change.
- Adding audiobook support? Write a module, core doesn't change.
- Adding a new streaming service? Write a module, core doesn't change.

---

## Five Design Patterns

These five patterns are how MuxCore stays flexible without becoming complicated. They're the engineering behind "the loom never changes."

### Pattern 1: `Meta` — The Universal Carry-All

Every task and filter in MuxCore carries a `Meta` field — a key-value bag that modules use for their own data. Core never looks inside it.

**Why this matters:** A download task can hold a torrent magnet link, an Apple Music track ID, a Spotify URI, or a YouTube video ID — all in the same `Meta` field. Core routes the task. The downloader module reads what it needs from `Meta`. Core never learns what Apple Music is.

```go
// Core never interprets these fields — the module does
req := &downloaderv1.AddTorrentRequest{
    TorrentUrl: magnetOrURL,
    Category:   "music",
    SavePath:   savePath,
}
// Extra provider-specific keys travel in Meta on related fabric types
// (worker tasks, filters) — not as a shared DownloadTask Go type.
```

### Pattern 2: Discovery, Not Pre-Wiring

Core provides base infrastructure to every module (event bus, registry, storage, gRPC mesh). Everything else — secrets, databases, caches, metrics, tracing — modules discover at runtime by asking "who can do X?"

```
Module asks: "Who provides secrets?"
Registry answers: "vault-secrets can do that"
Module gets: a SecretsProvider it can use
```

If someone writes a new type of service tomorrow, modules discover it the same way. Core's service list never needs to grow.

### Pattern 3: Role Strings, Not Enums

In most systems, the platform defines every possible module type as a fixed list. In MuxCore, modules define their own roles as simple strings:

```go
// A module can declare any roles it wants
Roles: []string{"downloader", "streaming_source", "cache_writer"}
```

Core has no catalog of roles. A module can declare `"vr180_processor"` and other modules find it with `FindByRole("vr180_processor")`. The loom doesn't need to know what a VR180 processor is.

### Pattern 4: Domain Contracts in Separate Repos

Everything specific to a media type lives in a **contract repository** — an independent, versioned package that defines interfaces:

```
github.com/Muxcore-Media/contracts-downloader    → DownloaderService (gRPC)
github.com/Muxcore-Media/contracts-indexer       → Indexer / search types
github.com/Muxcore-Media/contracts-media-admin   → MediaAdminService (admin UI seam)
github.com/Muxcore-Media/contracts-reconciler    → Structural contract reconciliation
```

Core also defines fabric contracts (including `WorkflowEngine`) in `pkg/contracts/`. Core imports **none** of the domain `contracts-*` repos. Modules import the ones they need. When a domain needs a new interface, that contract repo is updated — core stays untouched.

### Pattern 5: Contract Declarations

Modules openly declare which contracts they implement:

```go
func (m *Module) Info() ModuleInfo {
    return ModuleInfo{
        ID:   "apple-music",
        Name: "Apple Music Provider",
        Roles: []string{"playback", "media_manager"},
        Contracts: []ContractDeclaration{
            {Repo: "contracts-downloader", Version: "v1.0.0", Interface: "DownloaderService"},
            {Repo: "contracts-media-admin", Version: "v1.0.0", Interface: "MediaAdminService"},
        },
    }
}
```

The marketplace checks these before showing install buttons. Consumer modules check them before connecting. Core stores and returns them — nothing more.

---

## The Media Object Pattern

One of the most powerful design decisions in MuxCore: **a single media item can own multiple files.**

In Sonarr, if you want 1080p and 4K versions of a movie, you need two separate instances. In MuxCore, one movie object owns files at every quality:

```
MediaObject "The Terminator"
├── Assets:
│   ├── 2160p remux (72 GB, MKV)
│   ├── 1080p web   (8 GB, AV1)
│   ├── 720p web    (3 GB, H.264)
│   └── 360p web    (1 GB, H.264)
```

The playback module asks "give me the best file this device can play," and the media library returns the matching asset. The loom just stores blobs and routes events — it never counts files or checks codecs.

### How It Works in Practice

1. Downloader fetches the 2160p remux → adds an asset to the media object
2. Transcoder creates 1080p, 720p, and 360p versions → adds three more assets
3. Client requests playback → media library picks the right asset for that device
4. Core never knows any of this happened — it just stored blobs and routed events

---

## How Modules Communicate

Modules in MuxCore never call each other directly. All communication goes through two channels:

### Signals (Events)

When something changes — a download finishes, a transcode completes, a new node joins the cluster — the module publishes a **signal** on the event bus. Any module that cares about that signal subscribes to it:

```
Downloader publishes: "download.completed"
    ↓
Media Manager receives it → imports the file
Transcoder receives it → starts optimizing
Notification module receives it → sends a Discord message
```

The downloader doesn't know (or care) who's listening. It just sends the signal.

### Direct Calls (gRPC)

For request/response patterns — "what's the status of task X?" or "give me the metadata for movie Y" — modules make direct calls through the gRPC mesh. The mesh routes calls locally when the target module is on the same machine, or over the network when it's on another node.

Module-to-module calls are protected by policy — modules declare who they are, and the mesh enforces access rules.

---

## Cross-Node Module Tracking

> **⚠️ Beta status:** Heartbeat-based module tracking is implemented. On node loss, the **leader** may resurrect orphaned tag modules on a surviving node. Modules do not self-reconnect by querying `Members()`. Departed-node worker tasks are released for redispatch (retry-capped).

When MuxCore runs as a cluster (multiple core instances across machines), every node tracks which modules are running where. This is what makes the mesh routing work.

### How It Works

1. **Modules register locally.** A module connects to its local core instance via gRPC and calls `Register()`. The core adds it to its local registry.

2. **Heartbeats advertise module lists.** Every 10 seconds, each core sends a heartbeat to every other core in the cluster. The heartbeat carries the node's current module list — every module ID registered on that node.

3. **Peers sync module lists.** When core-2 receives a heartbeat from core-1, it updates its copy of core-1's `NodeInfo.modules`. Core-2 now knows that `media-transcoder` (FFmpeg backend) is running on core-1.

4. **Mesh routing uses the module map.** When a module on core-3 calls `media-transcoder`, the mesh checks which node hosts it. If core-1 has it, the call gets routed through the core-to-core gRPC connection to core-1, then delivered locally.

### What Happens When a Node Dies

1. Core-1 stops sending heartbeats (process killed, machine down, network partition).
2. After 30 seconds without a heartbeat, core-2 and core-3 independently evict core-1 from their member lists.
3. Core-1's module list is removed alongside its node entry. The mesh stops routing calls to it.
4. A `TYPE_NODE_LEFT` cluster event fires, notifying any watchers.

### Module Failover (Leader Resurrection)

When a node leaves the cluster:

1. Surviving nodes evict it after the heartbeat timeout; a `TYPE_NODE_LEFT` event fires.
2. The **leader** looks up orphaned modules that were deployed from a spool tag and still have a cached binary.
3. The leader calls `ResurrectOrphan` to spawn those modules on the surviving node.
4. The surviving node's next heartbeat advertises the resurrected module IDs.
5. Mesh callers keep using the same module ID — they do not need to know a resurrection occurred.

Limits: only tag-deployed modules with a usable binary in the tag cache are resurrected. In-flight worker tasks on the departed node are released back to Pending for redispatch (failed only after `MaxRetries` is exceeded).

### Cluster Events

Any module can subscribe to cluster membership changes via `DiscoveryService.Watch()`:

| Event | When |
|-------|------|
| `TYPE_NODE_JOINED` | A new core instance joins the cluster |
| `TYPE_NODE_LEFT` | A core instance is evicted (dead) or gracefully leaves |
| `TYPE_NODE_DEGRADED` | A node reports reduced capability |
| `TYPE_LEADER_CHANGED` | Cluster leader election produces a new leader |

---

## The Fabric at a Glance

```
                     ┌───────────────────────────┐
                     │      gRPC Services         │
                     │  ModuleReg │ Discovery     │
                     │  Storage │ Events │ Mesh   │
                     │  Spool │ Lifecycle │ Audit │
                     └────────────┬──────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
   ┌──────▼──────┐       ┌───────▼───────┐       ┌───────▼──────┐
   │  Event Bus  │       │   Registry    │       │   Storage    │
   │ (signals)   │       │(module dir)   │       │  Orchestrator│
   └──────┬──────┘       └───────┬───────┘       └───────┬──────┘
          │                      │                       │
          └──────────────────────┼───────────────────────┘
                                 │
                     ┌───────────▼───────────────┐
                     │   Sidecar Module Manager   │
                     │  Spawn → Verify → Monitor  │
                     │                            │
                     │  ┌──────────────────────┐  │
                     │  │  Modules (threads)   │  │
                     │  │  Downloaders         │  │
                     │  │  Media Managers      │  │
                     │  │  Playback Providers  │  │
                     │  │  Transcoders         │  │
                     │  │  Storage Backends    │  │
                     │  │  Notification Senders│  │
                     │  │  ... and more        │  │
                     │  └──────────────────────┘  │
                     └────────────────────────────┘
```

---

## Next Steps

- **Just want to try it?** → [Getting Started](Getting-Started)
- **Want to understand modules?** → [Module System](Module-System)
- **Want to build a module?** → [Writing Modules](Writing-Modules)
- **Want to see every interface?** → [Contracts Reference](Contracts)
- **Want to understand the internals?** → [Architecture](Architecture)
