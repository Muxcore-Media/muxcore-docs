# Storage Abstraction

**Storage in MuxCore is not about files and folders.** It's about capabilities — what a storage backend can do — and the system adapts around them. Modules never touch filesystem paths. Everything goes through object IDs.

---

## The Problem with Filesystem Paths

Every existing media stack assumes local filesystem access:

```
Sonarr downloads to:    /downloads/movies/
Radarr expects media at: /media/movies/
Plex watches:           /media/
Transcoder reads from:  /transcodes/temp/
```

This causes problems when:
- You add a second machine — paths don't exist there
- You mount network storage (NFS/SMB) — atomic moves break
- You want to use cloud storage — the concept of a "path" doesn't apply
- Hardlinks fail across filesystem boundaries — double disk usage

MuxCore solves this by abstracting storage behind **object IDs**. A module asks for "object `abc123`" and the storage orchestrator figures out where it lives and how to get it.

---

## The Golden Rule

> **Modules must never touch filesystem paths.** Use `storagev1.NewStorageServiceClient(conn).Get(ctx, &storagev1.GetRequest{Key: "object-id"})`, never `os.Open("/media/movie.mkv")`.

If a module touches a path, the entire abstraction collapses.

---

## Three Layers

### Layer 1: Blob Storage

Raw object storage — put bytes in, get bytes out:

```go
type StorageProvider interface {
    Put(ctx, key string, data io.Reader, size int64) error
    Get(ctx, key string) (io.ReadCloser, error)
    Delete(ctx, key string) error
    Move(ctx, src, dst string) error
    Exists(ctx, key string) (bool, error)
    Stat(ctx, key string) (ObjectInfo, error)
    List(ctx, prefix string) ([]ObjectInfo, error)
}
```

Every storage backend implements this. Today core ships a **local filesystem** provider; additional backends (S3, Ceph, etc.) arrive as modules when available.

### Layer 2: The Orchestrator

The `StorageOrchestrator` sits between modules and storage providers. It:
- Routes objects to the right provider based on policies
- Negotiates capabilities at runtime
- Provides read-through caching when available
- Supports byte-range streaming
- Streams directly to providers when size is known (no intermediate buffer)
- Bounds concurrent audit goroutines to 100 to prevent burst overload

```go
type StorageOrchestrator interface {
    Get(ctx, key string) (io.ReadCloser, error)
    Put(ctx, key string, data io.Reader, size int64) error
    Delete(ctx, key string) error
    Move(ctx, src, dst string) error
    Stream(ctx, key string, offset, length int64) (io.ReadCloser, error)
    CapabilityCheck(ctx, key string) ([]string, error)
    Promote(ctx, key string) error
    Relegate(ctx, key string) error
    // ...
}
```

List operations accept an empty prefix to list all objects. `CapabilityCheck` accepts an empty key to check capabilities of the default provider.

### Layer 3: Media Library

The media library maps logical entities to physical storage:

```
movie://interstellar          → object "media/movies/interstellar/2160p.mkv"
show://breaking-bad/s01e01    → object "media/tv/breaking-bad/s01/e01.mkv"
music://daft-punk/ram         → object "media/music/daft-punk/ram/"
```

The metadata database knows which objects belong to which media items. Modules work with logical identifiers, not paths.

---

## Capability Interfaces

Not all storage supports the same operations. MuxCore uses small capability interfaces — a storage provider can implement any subset:

| Interface | What It Means | Who Supports It |
|-----------|--------------|----------------|
| `Streamable` | Can stream byte ranges | S3, local FS, most backends |
| `Seekable` | Can seek to arbitrary positions | Local FS, SMB/NFS |
| `Watchable` | Can notify on file changes | Local FS only |
| `AtomicMovable` | Atomic moves (instant, no copy) | Local FS, some NAS |
| `Hardlinkable` | Can create hardlinks | Local FS, ZFS datasets |
| `TieredProvider` | Hot/warm/cold storage tiers | Multi-backend setups |

### Capability Matrix

| Capability    | Local FS | SMB/NFS | S3/MinIO | Cloud (B2/R2) |
|---------------|----------|---------|----------|---------------|
| Atomic Move   | ✓        | ~Maybe   | ✗        | ✗             |
| Random Seek   | ✓        | ✓        | Partial  | Partial       |
| Streaming     | ✓        | ✓        | ✓        | ✓             |
| Hardlinks     | ✓        | ✗        | ✗        | ✗             |
| File Watching | ✓        | Weak     | ✗        | ✗             |

Modules check capabilities at runtime and adapt:

```go
caps, _ := storagev1.NewStorageServiceClient(conn).Capabilities(ctx, &storagev1.CapabilitiesRequest{}); // check returned caps for  objectKey)
for _, cap := range caps {
    switch cap {
    case "hardlinkable":
        // Use hardlinks — fast and space-efficient
    case "atomicmovable":
        // Use atomic moves — instant and safe
    default:
        // Fall back to copy + delete
    }
}
```

---

## Storage Providers

### Shipped
- **Local filesystem** — direct disk access via core's storage orchestrator

### Planned (module-backed)
- **SMB / NFS / WebDAV** — network mounts
- **S3** — AWS S3, MinIO, Cloudflare R2, Backblaze B2, Wasabi
- **GCS / Azure Blob**
- **Ceph / SeaweedFS / Longhorn**

---

## Storage Overlays (Planned)

Middleware backends that wrap other backends, adding capabilities transparently:

```
Encryption Layer     ← encrypts before writing
    ↓
Compression Layer    ← compresses data
    ↓
Cache Layer          ← caches hot objects in RAM/NVMe
    ↓
Replication Layer    ← writes to multiple backends
    ↓
S3 Provider          ← actual storage
```

Planned overlays:
- **Encryption** — encrypt data at rest
- **Compression** — transparent compression
- **Deduplication** — block-level dedup
- **Replication** — write to multiple destinations
- **Snapshot** — point-in-time recovery
- **Cache** — SSD/RAM read-through cache

---

## Storage Policies

Programmatic routing is live: the orchestrator evaluates ordered `RoutingPolicy` rules (first match wins) via `AddPolicy` / `SetPolicies`. Put placement matches on object **prefix** and/or **label** metadata; **age_days** rules apply only to background migration (relegate), not Put. Core loads `storage.policies` from config at startup (`PoliciesFromConfig`).

```go
orch.AddPolicy(storage.RoutingPolicy{
    Name:     "hot",
    Prefix:   "hot/",
    Provider: "fast-nvme",
})
orch.AddPolicy(storage.RoutingPolicy{
    Name:     "archive",
    AgeDays:  365,
    Tier:     contracts.StorageTierCold,
})
```

Config shape (`storage.policies` in core config JSON):

```json
{
  "storage": {
    "policies": [
      {
        "name": "temp",
        "match": { "label": "transcoding-temp" },
        "provider": "local-ssd"
      },
      {
        "name": "hot-prefix",
        "match": { "prefix": "hot/" },
        "provider": "fast-nvme"
      },
      {
        "name": "cold-age",
        "match": { "age_days": 365 },
        "tier": "cold"
      }
    ]
  }
}
```

**Still in progress:** declarative `media_type` / quality-based YAML rules (the aspirational media-aware policy language). Until that lands, route by prefix/label/age as above.

---

## Storage Scenarios (Target Architecture)

### Hot/Cold Tiering

```
Recently watched → NVMe (hot)
This year's media → HDD array (warm)
Archive → S3 Glacier (cold)
```

Media automatically moves between tiers based on access patterns (planned).

### Distributed Transcoding

```
1. Remote S3 media → worker pulls segment
2. Worker caches to local SSD
3. GPU transcodes the segment
4. Result pushed to target storage
```

Workers don't need access to the same filesystem — they pull, cache, process, and push.

### Multi-Region Replication

```
Primary: local ZFS pool
Replica: remote S3 bucket
Backup: cold archive (monthly)
```

---

## Important Distinction

**Media presence ≠ media availability.**

A movie can exist logically (in your library, with metadata) but its files may be:
- Still downloading
- Archived (needs retrieval)
- On an offline node
- Partially replicated

The library tracks what exists logically. The storage layer handles physical availability. These are separate concerns.

---

## Terminology

| Term | Meaning |
|------|---------|
| **Asset** | A raw stored file or blob |
| **Media Object** | A logical media entity (movie, episode, song) |
| **Storage Provider** | A physical storage backend |
| **Storage Policy** | Rules for where objects get stored |
| **Capability** | What a storage backend can do (stream, seek, hardlink) |

---

## Next Steps

- [Event System](Event-System) — how modules communicate
- [Workflow Engine](Workflow-Engine) — multi-step automation
- [Contracts Reference](Contracts) — storage interfaces in detail
