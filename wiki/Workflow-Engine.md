# Workflow Engine

**Workflows (tapestries) are MuxCore's killer feature.** They're multi-step automation pipelines that coordinate many modules to accomplish a goal — like acquiring a movie from request to notification — without hardcoding any step.

> **⚠️ Module-implemented, not built into core.** The `WorkflowEngine` interface lives in `pkg/contracts/workflow.go`. The **`workflow-tapestry`** module implements it (optional on the default spool tag). Cron-style scheduling is separate (`scheduler-cron` / Scheduler contract).

---

## What Is a Tapestry?

In the *arr world, workflows are implicit and hardcoded:

```
Sonarr: Search → Download → Move → Rename → Notify
```

You can't change the steps. You can't add steps. If you want subtitles fetched before import, that's a separate program (Bazarr) with its own scheduler.

In MuxCore, workflows are **explicit, configurable, and extensible**:

```
You define: Request → Metadata → Search → Download → Verify → Extract → Analyze → Transcode → Subtitles → Import → Notify
```

Each step is handled by a different module. The workflow engine orchestrates — it doesn't implement any step directly.

---

## A Real Example

Here's the seeded `movie-request` tapestry (JSON in `workflow-tapestry`; YAML below is equivalent):

```yaml
id: movie-request
name: "Movie Request Pipeline"
steps:
  - name: metadata-lookup
    handler:
      kind: module
      ref: metadata-tmdb
    retry: 3
    timeout_seconds: 30

  - name: indexer-search
    handler:
      kind: capability
      ref: indexer
    retry: 2
    timeout_seconds: 60
    depends_on: [metadata-lookup]

  - name: download
    handler:
      kind: capability
      ref: downloader
    retry: 1
    timeout_seconds: 0       # no timeout — downloads can take hours
    depends_on: [indexer-search]

  - name: library-import
    handler:
      kind: module
      ref: media-scanner
    retry: 1
    timeout_seconds: 60
    depends_on: [download]

  - name: notify
    handler:
      kind: capability
      ref: notification
    retry: 2
    timeout_seconds: 10
    depends_on: [library-import]
```

---

## How It Works

### Starting a Tapestry

```go
// Discover the workflow engine via gRPC
disc := discoveryv1.NewDiscoveryServiceClient(conn)
resp, _ := disc.FindByCapability(ctx, &discoveryv1.FindByCapabilityRequest{
    Capability: "workflow.engine",
})
// Use the discovered engine module
engine := workflowv1.NewWorkflowEngineClient(conn)
runID, err := engine.Run(ctx, &workflowv1.RunRequest{
    DefinitionName: "movie-request",
    Params: map[string]string{
        "title":   "The Terminator",
        "quality": "2160p",
    },
})
```

### The Engine Executes Each Step

```
Step 1: metadata-tmdb → looks up movie details
    ↓ success
Step 2: indexer-prowlarr → searches for releases
    ↓ success  
Step 3: downloader-native-torrent → starts download, waits for completion
    ↓ success
Step 4: verifier-builtin → checks file integrity
    ↓ success
Step 5: extractor-unpackerr → unpacks archives
    ↓ success
Step 6: analyzer-builtin → checks codec, resolution, bitrate
    ↓ success
Step 7: media-transcoder (FFmpeg) → creates optimized versions
    ↓ success
Step 8: content-subtitle → fetches subtitles
    ↓ success
Step 9: media-movies → imports into library
    ↓ success
Step 10: notifier-discord → sends completion message
```

### If a Step Fails

```
Step 4: verifier-builtin → FAILS (corrupt download)
    ↓
Retry 1: wait (exponential backoff) → FAILS
    ↓
Retry 2: wait (backoff × factor) → FAILS
    ↓
Retry 3: wait (capped) → FAILS
    ↓
Tapestry fails → notification sent → manual review
```

---

## Key Features

### Current (`workflow-tapestry`)

- **DAG waves** — `depends_on` gates readiness; all ready steps in a wave run in bounded parallel (fail-fast on hard failure)
- **Pause / Cancel gates** — checked at wave boundaries and before each dispatch; Pause waits until Resume; Cancel stops and leaves status `cancelled`
- **Retries with exponential backoff** — `step.retry` max re-attempts; delay `base × 2^n` + jitter (cap); prefers core `RetryProvider` mesh `Backoff` when discoverable, else local fallback. Tunable via step `meta` (`backoff_initial_ms`, `backoff_max_ms`, `backoff_factor`, `backoff_jitter`)
- **Idempotency** — key `runID:stepName` (override with `meta.idempotency_key`); calls core `IdempotencyProvider` over mesh (`Store` / `Exists` / `Result`); on hit skips the handler and returns cached output. Soft-fails if provider missing unless `meta.idempotency_required=true`
- **Timeouts** — per-step `timeout`; `0` means no timeout
- **Step I/O mapping** — `$params.*` / `$steps.<name>.output.*` via `input_mapping`
- **Control RPCs** — `Cancel` / `Pause` / `Resume` / `Status` / `ListRuns`
- **Seeded definitions** — ships under `internal/definitions/` (see below)

```
metadata-lookup ─┬─→ indexer-search-1 (torrent)
                 └─→ indexer-search-2 (usenet)
                          │
                    first one wins → download
```

```yaml
- name: transcode
  handler: media-transcoder
  input_mapping:
    source_file: "$steps.download.output.filepath"
    target_quality: "$params.quality"
```

### Planned

Compensation/saga, conditional steps, and fallback handler chains (see Advanced Features below).

---

## Built-In Tapestries

Default definitions ship with `workflow-tapestry` under `internal/definitions/`. Customize handlers for your module IDs. Music/book managers are not shipped yet — those runs fail until managers exist:

| Tapestry | Purpose |
|----------|---------|
| `movie-request` | Full movie acquisition — search through import |
| `tv-request` | TV episode acquisition |
| `music-request` | Music album acquisition |
| `book-request` | Book acquisition |
| `media-transcode` | Re-encode existing media |
| `media-migrate` | Move media between storage providers |
| `media-backup` | Backup to cold storage |
| `library-scan` | Scan and import existing media files |

---

## Advanced Features (Planned)

### Compensation — Undo on Failure

If step 7 fails after step 3 succeeded, the engine runs compensation handlers:

```
Step 3: download → started        [compensation: cancel download]
Step 7: import → started          [compensation: remove partial import]
Step 8: notify → not reached
```

### Conditional Steps

Skip steps based on results:

```yaml
- name: transcode
  handler: media-transcoder
  condition: "media.codec != 'h264'"   # only transcode if not already h264
```

### Fallback Chains

Try handlers in order until one succeeds:

```yaml
- name: metadata-lookup
  handlers: [metadata-tmdb, metadata-tvdb, metadata-imdb]
```

---

## Power Use Cases

### Intelligent Orchestration

- **Move workload to idle GPU** — transcoding scheduler picks the least-loaded worker
- **Auto-balance storage** — move media to the provider with the most free space
- **Prioritize by popularity** — recently watched media stays on fast storage
- **Predictive pre-transcoding** — transcode the next episode while you're watching the current one

### Cross-Media Awareness

A tapestry can coordinate across media types — something impossible in siloed *arr stacks:

```
User adds an anime series
  → Checks for manga adaptation
  → Checks for light novel source
  → Offers to track and download all related media
```

---

## Workflow Engine Interface

```go
// Defined in pkg/contracts/workflow.go
type WorkflowEngine interface {
    RegisterDefinition(ctx context.Context, definition TapestryDefinition) error
    RemoveDefinition(ctx context.Context, definitionID string) error
    GetDefinition(ctx context.Context, definitionID string) (*TapestryDefinition, error)
    ListDefinitions(ctx context.Context) ([]TapestryDefinition, error)
    Run(ctx context.Context, definitionID string, input map[string]any) (string, error)
    Status(ctx context.Context, runID string) (*TapestryRun, error)
    Cancel(ctx context.Context, runID string) error
    Pause(ctx context.Context, runID string) error
    Resume(ctx context.Context, runID string) error
    ListRuns(ctx context.Context, filter *TapestryRunFilter) ([]TapestryRun, error)
}
```

Key types:
- **TapestryDefinition** — the workflow template (ID, steps, metadata)
- **TapestryStep** — a single step with `StepHandler{Kind,Ref}`, retry, timeout, depends_on, input_mapping
- **TapestryRun** — a running instance with status, step results, start/end times
- **StepResult** — output of a completed step, passed to dependent steps
- **TapestryRunFilter** — filter by status and/or definition ID

Discovered via `FindByCapability("workflow.engine")`. The `workflow-tapestry` module implements this. If no engine module is registered, the Scheduler contract still handles cron-style tasks independently.

---

## Next Steps

- [Module System](Module-System) — modules that handle workflow steps
- [Event System](Event-System) — how step transitions are communicated
- [Writing Modules](Writing-Modules) — build a module that participates in workflows
