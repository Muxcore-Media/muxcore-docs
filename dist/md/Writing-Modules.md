# Writing Modules

**Build your own module — a thread to weave into the MuxCore fabric.** This guide walks through creating a sidecar module from nothing: declaring its role, connecting to the gRPC mesh, discovering other modules, and communicating through events.

---

## Before You Start

You need:
- Go 1.26 or later (matches current core `go.mod`)
- A GitHub account (to publish the module)
- Understanding of [Core Concepts](Core-Concepts) and the [Module System](Module-System)
- A running MuxCore instance (`muxcored`) for testing

---

## Fast path: `muxcore-module-starter`

Prefer the official starter over hand-rolling `go mod init`:

```bash
git clone https://github.com/Muxcore-Media/muxcore-module-starter.git
cd muxcore-module-starter
make new-module NAME=my-module
# optional: OUT=/path/to/my-module
cd ../my-module
make build && make test
```

That generates a sidecar layout, `muxcore.json`, Makefile, and **self-hosted CI** that pins published `core@v0.5.0` (private fetch via `MUXCORE_CI_TOKEN` — no sibling `core` checkout). Details: [muxcore-module-starter](https://github.com/Muxcore-Media/muxcore-module-starter).

You can still scaffold manually with the steps below if you need a custom layout.

---

## Module Architecture

Every module is a **standalone binary** — not compiled into core. Core spawns it as a child process; the module connects to the gRPC mesh and registers at runtime.

```
my-module/
├── cmd/
│   └── module/
│       └── main.go        ← sidecar entry point (gRPC registration, signal handling)
├── internal/
│   ├── module.go          ← contracts.Module implementation
│   └── ...                ← module-specific logic
├── go.mod                 ← depends on core + contract repos
├── go.sum
└── muxcore.json           ← marketplace metadata
```

Reference implementation: [downloader-native-torrent](https://github.com/Muxcore-Media/downloader-native-torrent).

---

## Step 1: Create the Go Module

```bash
mkdir my-module && cd my-module
go mod init github.com/yourname/my-module
go get github.com/Muxcore-Media/core@v0.5.0
go get github.com/Muxcore-Media/contracts-downloader  # if building a downloader
```

---

## Step 2: Implement the Module Interface

Every module implements the `contracts.Module` lifecycle interface:

```go
package internal

import (
    "context"
    "github.com/Muxcore-Media/core/pkg/contracts"
    dl "github.com/Muxcore-Media/contracts-downloader"
)

type Module struct {
    id       string
    meshAddr string
    conn     *grpc.ClientConn
    // ... module-specific fields
}

func NewModule(moduleID, meshAddr string, conn *grpc.ClientConn) *Module {
    return &Module{id: moduleID, meshAddr: meshAddr, conn: conn}
}

func (m *Module) Info() contracts.ModuleInfo {
    return contracts.ModuleInfo{
        ID:           "downloader-native-torrent",
        Name:         "Native Torrent Downloader",
        Version:      "1.0.0",
        Roles:        []string{"downloader"},
        Description:  "Native BitTorrent engine for MuxCore",
        Author:       "MuxCore",
        Capabilities: []string{"downloader.torrent", "downloader.native.torrent"},
        Contracts: []contracts.ContractDeclaration{
            {
                Repo:      "github.com/Muxcore-Media/contracts-downloader",
                Version:   "v1.0.0",
                Interface: "DownloaderService",
            },
        },
        DependsOn: []string{},
    }
}

func (m *Module) Init(ctx context.Context) error {
    // Discover services via DiscoveryService gRPC
    discClient := discoveryv1.NewDiscoveryServiceClient(m.conn)
    resp, _ := discClient.FindByCapability(ctx, &discoveryv1.FindByCapabilityRequest{
        Capability: "storage",
    })
    if len(resp.Modules) > 0 {
        // Storage backend found — set up storage client
    }
    return nil
}

func (m *Module) Start(ctx context.Context) error {
    // Begin operations: start pollers, connect to external services
    return nil
}

func (m *Module) Stop(ctx context.Context) error {
    // Graceful shutdown: stop pollers, close connections
    return nil
}

func (m *Module) Health(ctx context.Context) error {
    // Check connectivity to external dependencies
    return nil
}
```

---

## Step 3: Write the Sidecar Entry Point

Create `cmd/module/main.go` — this is the binary that core spawns:

```go
package main

import (
    "context"
    "flag"
    "log/slog"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/yourname/my-module/internal"
    modulev1 "github.com/Muxcore-Media/core/proto/gen/muxcore/module/v1"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
)

func main() {
    meshAddr := flag.String("muxcore-mesh-addr", "localhost:9090", "gRPC address of the MuxCore mesh")
    moduleID := flag.String("muxcore-module-id", "my-module", "Module identifier")
    tlsCert := flag.String("muxcore-tls-cert", "", "Path to TLS client certificate (auto-provided by core)")
    tlsKey := flag.String("muxcore-tls-key", "", "Path to TLS client private key (auto-provided by core)")
    tlsCA := flag.String("muxcore-tls-ca", "", "Path to CA certificate (MUXCORE_TLS_CA)")
    flag.Parse()

    // Connect to core mesh with retry
    var conn *grpc.ClientConn
    var err error
    for attempt := 0; attempt < 5; attempt++ {
        conn, err = grpc.NewClient(*meshAddr,
            grpc.WithTransportCredentials(insecure.NewCredentials()),
        )
        if err == nil {
            break
        }
        if attempt < 4 {
            slog.Warn("mesh connection failed, retrying", "attempt", attempt+1, "error", err)
            time.Sleep(time.Duration(attempt+1) * time.Second)
        }
    }
    if err != nil {
        slog.Error("failed to connect to mesh", "error", err)
        os.Exit(1)
    }
    defer conn.Close()

    // Register with core
    regClient := modulev1.NewModuleRegistrationClient(conn)
    mod := internal.NewModule(*moduleID, *meshAddr, conn)
    info := mod.Info()

    resp, err := regClient.Register(context.Background(), &modulev1.RegisterRequest{
        ModuleId:   *moduleID,
        ModuleInfo: &modulev1.ModuleInfo{
            Id:             info.ID,
            Name:           info.Name,
            Version:        info.Version,
            Roles:          info.Roles,
            Description:    info.Description,
            Author:         info.Author,
            Capabilities:   info.Capabilities,
            DependsOn:      info.DependsOn,
            MinCoreVersion: info.MinCoreVersion,
            HttpAddr:       info.HTTPAddr,
        },
        MeshAddr: *meshAddr,
    })
    if err != nil || !resp.Accepted {
        slog.Error("registration failed", "error", err, "reason", resp.Error)
        os.Exit(1)
    }

    // Start the module
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()

    mod.Init(ctx)
    mod.Start(ctx)

    <-ctx.Done() // Wait for shutdown signal

    mod.Stop(context.Background())
    regClient.Unregister(context.Background(), &modulev1.UnregisterRequest{ModuleId: *moduleID})
}
```

Every sidecar binary must:
- Accept `--muxcore-mesh-addr` (default: `localhost:9090`)
- Accept `--muxcore-module-id` (its identifier)
- Accept `--muxcore-tls-cert`, `--muxcore-tls-key`, and `--muxcore-tls-ca` (auto-provided by core when spawned via `--tag`; prefer `modulesdk.Run`)
- Connect to the gRPC mesh
- Call `ModuleRegistration.Register()` with structured `ModuleInfo`
- Respond to SIGTERM/SIGINT for graceful shutdown
- Call `ModuleRegistration.Unregister()` on exit

---

## External Modules (Bootstrap Tokens)

If your module runs **outside** core's sidecar manager (separate container, different machine), you cannot rely on auto-issued TLS certificates. The designed path is `BootstrapRegister` with a one-time token:

1. Generate a bootstrap token for your module on the core node
2. Pass the token to your module (via env var, config file, or CLI flag)
3. Your module calls `BootstrapRegister` to receive a signed certificate
4. Your module reconnects with mTLS using the received credentials

> **Note:** `BootstrapRegister` is on the mesh public allowlist; the one-time bootstrap token is the authentication. Prefer core-spawned sidecars when possible. Details: [Module TLS Authentication](Module-TLS-Authentication).

```go
regClient := modulev1.NewModuleRegistrationClient(conn)

// Exchange bootstrap token for a signed certificate
bootstrapResp, err := regClient.BootstrapRegister(ctx, &modulev1.BootstrapRegisterRequest{
    Token:    *bootstrapToken,
    ModuleId: *moduleID,
})
if err != nil || !bootstrapResp.Accepted {
    slog.Error("bootstrap registration failed", "error", err)
    os.Exit(1)
}

// Use the returned credentials for subsequent connections
certPEM := bootstrapResp.SignedCert
keyPEM := bootstrapResp.KeyPem
caPEM := bootstrapResp.CaCert
```

The token is single-use, expires after 5 minutes, and is bound to a specific module ID. See [Module TLS Authentication](Module-TLS-Authentication) for the full architecture.

---

Create `muxcore.json` in the repo root:

```json
{
  "name": "My Module",
  "description": "Does something useful",
  "version": "1.0.0",
  "author": "Your Name",
  "roles": ["example"],
  "capabilities": ["example.basic"],
  "contracts": [
    {"repo": "github.com/Muxcore-Media/contracts-downloader", "version": "v1.0.0", "interface": "DownloaderService"}
  ]
}
```

---

## Discovering Other Modules

Find modules via the `DiscoveryService` gRPC:

```go
disc := discoveryv1.NewDiscoveryServiceClient(conn)

// By role
resp, _ := disc.FindByRole(ctx, &discoveryv1.FindByRoleRequest{Role: "downloader"})
for _, mod := range resp.Modules {
    // mod.Id, mod.Roles, mod.Capabilities
}

// By capability
resp, _ := disc.FindByCapability(ctx, &discoveryv1.FindByCapabilityRequest{Capability: "secrets"})

// Direct resolve
resp, _ := disc.Resolve(ctx, &discoveryv1.ResolveRequest{ModuleId: "downloader-native-torrent"})
```

---

## Communicating Through Events

### Publishing Events

```go
import dl "github.com/Muxcore-Media/contracts-downloader"

payload, _ := json.Marshal(dl.DownloadCompletedPayload{
    DownloadID: id,
    Title:      "Movie Title",
})

events := eventsv1.NewEventServiceClient(conn)
events.Publish(ctx, &eventsv1.PublishRequest{
    Event: &eventsv1.Event{
        Type:    dl.EventDownloadCompleted,
        Source:  "my-module",
        Payload: payload,
    },
})
```

Event types and payloads are defined in the domain contract repos. See [Event System](Event-System) for the full event model.

---

## Using Storage

```go
store := storagev1.NewStorageServiceClient(conn)

// Upload (client-streaming)
stream, _ := store.Put(ctx)
stream.Send(&storagev1.PutRequest{Key: "path/to/object", TotalSize: size})
for _, chunk := range chunks {
    stream.Send(&storagev1.PutRequest{Chunk: chunk})
}
resp, _ := stream.CloseAndRecv()

// Download (server-streaming)
getStream, _ := store.Get(ctx, &storagev1.GetRequest{Key: "path/to/object"})
for {
    resp, err := getStream.Recv()
    if err == io.EOF { break }
    // process resp.Chunk
}

// Metadata
stat, _ := store.Stat(ctx, &storagev1.StatRequest{Key: "path/to/object"})
caps, _ := store.Capabilities(ctx, &storagev1.CapabilitiesRequest{})
```

---

## Calling Other Modules Directly

For request/response patterns, use the `ModuleMesh`:

```go
mesh := meshv1.NewModuleMeshClient(conn)
resp, _ := mesh.Call(ctx, &meshv1.CallRequest{
    TargetModule: "media-transcoder",
    Method:       "Status",
    Payload:      jsonPayload,
})
```

---

## Building Real Modules

### Downloader Module

Implement and register the shared gRPC service from `contracts-downloader`:

```go
import (
    cdlv1 "github.com/Muxcore-Media/contracts-downloader/muxcore/downloader/v1"
)

// Register on the module gRPC server:
cdlv1.RegisterDownloaderServiceServer(grpcSrv, &contractsServer{m: m})

func (s *contractsServer) AddTorrent(ctx context.Context, req *cdlv1.AddTorrentRequest) (*cdlv1.AddTorrentResponse, error) {
    // req.TorrentUrl, req.SavePath, req.Category, req.Paused
    return &cdlv1.AddTorrentResponse{TorrentId: id, Name: name, InfoHash: hash}, nil
}
```

Callers discover capability `"downloader"` (impl IDs like `downloader.native.torrent`) and dial `DownloaderServiceClient`.

See [downloader-native-torrent](https://github.com/Muxcore-Media/downloader-native-torrent) for a complete reference implementation — native torrent engine, `DownloaderService` adapter, and event emission.

### Storage Provider Module

```go
func (m *Module) Put(ctx context.Context, key string, data io.Reader, size int64) (int64, error) { ... }
func (m *Module) Get(ctx context.Context, key string) (io.ReadCloser, error) { ... }
func (m *Module) Stat(ctx context.Context, key string) (contracts.ObjectInfo, error) { ... }

// Optional capability interfaces
func (m *Module) Hardlink(ctx context.Context, src, dst string) error { ... }
```

A storage module registers with role `"storage"` and announces capabilities like `"hardlinkable"` and `"streamable"`. Other modules discover it via `FindByCapability("storage")` and use the `StorageService` gRPC.

---

## Media Library Module (Admin UI Integration)

Media modules (movies, TV, books) can expose browsing, search, metadata editing, and artwork management to the admin UI by implementing the `MediaAdminService` gRPC service.

### 1. Import the contract

```go
import (
    mediaadminv1 "github.com/Muxcore-Media/contracts-media-admin/gen/muxcore/media/admin/v1"
)
```

### 2. Implement the gRPC server

```go
type mediaAdminServer struct {
    mediaadminv1.UnimplementedMediaAdminServiceServer
    // Your media module state
}

func (s *mediaAdminServer) GetMediaTypeInfo(ctx context.Context, req *mediaadminv1.GetMediaTypeInfoRequest) (*mediaadminv1.GetMediaTypeInfoResponse, error) {
    return &mediaadminv1.GetMediaTypeInfoResponse{
        DisplayName: "Movies",    // Shows as nav tab label
        FilterFields: []*mediaadminv1.FilterField{
            {Key: "year", Label: "Year", Type: "number"},
            {Key: "genre", Label: "Genre", Type: "select", Options: []string{"Action", "Comedy", "Drama"}},
        },
    }, nil
}

func (s *mediaAdminServer) ListItems(ctx context.Context, req *mediaadminv1.ListItemsRequest) (*mediaadminv1.ListItemsResponse, error) {
    // Query your database (via DatabaseProvider) and return items
    items := []*mediaadminv1.MediaItem{
        {
            Id: "123", Title: "The Terminator", Year: 1984,
            Genres: []string{"Action", "Sci-Fi"},
            Metadata: map[string]string{"director": "James Cameron", "runtime": "108"},
        },
    }
    return &mediaadminv1.ListItemsResponse{Items: items, Total: 1, Page: 1}, nil
}

func (s *mediaAdminServer) GetItem(ctx context.Context, req *mediaadminv1.GetItemRequest) (*mediaadminv1.GetItemResponse, error) {
    // Return single item with full detail
}

func (s *mediaAdminServer) UpdateMetadata(ctx context.Context, req *mediaadminv1.UpdateMetadataRequest) (*mediaadminv1.UpdateMetadataResponse, error) {
    // Update item metadata in your database
}

func (s *mediaAdminServer) ListArtwork(ctx context.Context, req *mediaadminv1.ListArtworkRequest) (*mediaadminv1.ListArtworkResponse, error) {
    // Return artwork URLs for the item
}

func (s *mediaAdminServer) ReplaceArtwork(stream mediaadminv1.MediaAdminService_ReplaceArtworkServer) error {
    // Receive artwork image chunks and store
}
```

### 3. Register the gRPC server alongside your module's other services

```go
grpcSrv := grpc.NewServer()
mediaadminv1.RegisterMediaAdminServiceServer(grpcSrv, &mediaAdminServer{})
// Also register any other services your module provides
```

### 4. Register with the `"media.library"` capability

```go
info := contracts.ModuleInfo{
    ID:           "media-movies",
    Name:         "Movies",
    Description:  "Movie library management",
    Roles:        []string{"media_manager"},
    Capabilities: []string{"media.library"},
    HttpAddr:     ":9430",    // media-movies HTTP helper port (gRPC is :9420 — see Port-Map)
}
```

### 5. Data model

Use the central `DatabaseProvider` for persistence. Each media module runs its own migrations (`Migrate()`) to create its tables within the shared database. The `metadata map<string,string>` field on `MediaItem` carries type-specific fields (runtime for movies, episode count for TV, page count for books) — this is the Meta pattern. The admin UI renders them generically.

---

## Testing Your Module

Unit tests mock the external services (HTTP servers, gRPC backends). Integration tests need a running `muxcored` instance.

### Unit Tests (Mock HTTP Server)

```go
func TestMyClient(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Return expected API responses
    }))
    defer srv.Close()

    client := NewClient(srv.URL, "user", "pass", 5*time.Second)
    ctx := context.Background()
    client.Login(ctx)
    // ... assertions
}
```

### Integration Tests (Real Core)

```bash
# Start core in insecure dev mode
MUXCORE_INSECURE_DISABLE_TLS=true muxcored &

# Build and run module
go build -o my-module ./cmd/module
./my-module --muxcore-mesh-addr localhost:9090 --muxcore-module-id my-module
```

### Docker Integration Testing

```yaml
# docker-compose.test.yml
services:
  muxcored:
    image: muxcore-media/core:latest
    environment:
      - MUXCORE_INSECURE_DISABLE_TLS=true
    ports: ["8080:8080", "9090:9090"]
```

---

## Module Checklist

Before publishing:

- [ ] `go.mod` depends on `github.com/Muxcore-Media/core` plus domain contract repos
- [ ] Sidecar entry point at `cmd/module/main.go`
- [ ] Accepts `--muxcore-mesh-addr`, `--muxcore-module-id`, `--muxcore-tls-cert`, `--muxcore-tls-key`, and `--muxcore-tls-ca` flags
- [ ] Calls `ModuleRegistration.Register()` at startup with structured `ModuleInfo`
- [ ] Calls `ModuleRegistration.Unregister()` at shutdown
- [ ] Handles SIGTERM/SIGINT for graceful shutdown
- [ ] Implements `contracts.Module` (Info, Init, Start, Stop, Health)
- [ ] Implements domain contracts from appropriate `contracts-*` repos
- [ ] `Contracts` declared in `Info().Contracts`
- [ ] `muxcore.json` at repo root with `contracts` and `capabilities`
- [ ] All external services discovered via `DiscoveryService.FindByCapability()`, never assumed
- [ ] Works gracefully when services are unavailable (degraded state)
- [ ] `Meta` used for module-specific data instead of assuming core changes

---

## Next Steps

- [Contracts Reference](Contracts) — every interface in detail
- [Module System](Module-System) — all module types and discovery
- [Event System](Event-System) — how modules communicate through events
- [downloader-native-torrent](https://github.com/Muxcore-Media/downloader-native-torrent) — complete reference implementation
