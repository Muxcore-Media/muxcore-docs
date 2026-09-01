# Contributing to MuxCore

**Thank you for considering contributing to MuxCore.** Origin development runs on **Forgejo** (`git.zem.systems`); GitHub clone/PR/wiki-push is the optional public consumer path later.

---

## Development Setup

### Prerequisites

- **Go 1.26.x** (see `go.mod`; currently `go 1.26.4`)
- **protoc** + **protoc-gen-go** + **protoc-gen-go-grpc** (for proto changes)
- **git** + SSH access to Forgejo

### Clone and Build (origin)

```bash
git clone ssh://forgejo@git.zem.systems:2222/muxcore/core.git
cd core

export GOPRIVATE='github.com/Muxcore-Media/*'
export GONOSUMDB='github.com/Muxcore-Media/*'
git config --global url."ssh://forgejo@git.zem.systems:2222/muxcore/".insteadOf "https://github.com/Muxcore-Media/"

go build ./...
```

### Run Tests

```bash
make test
# or full gate:
make ci
```

Origin CI: `.forgejo/workflows/ci.yml` with `runs-on: native` on the vault Forgejo runner. Do **not** treat `.github/workflows/` as the merge gate.

### Lint

```bash
golangci-lint run
```

Configuration is in `.golangci.yml`.

### Run Core Locally

```bash
# Development mode (no TLS)
MUXCORE_INSECURE_DISABLE_TLS=true go run ./cmd/muxcored --tag default

# Bare loom (no modules)
MUXCORE_INSECURE_DISABLE_TLS=true go run ./cmd/muxcored
```

### Proto Regeneration

```bash
protoc --go_out=. --go_opt=module=github.com/Muxcore-Media/core \
       --go-grpc_out=. --go-grpc_opt=module=github.com/Muxcore-Media/core \
       -I proto proto/muxcore/**/v1/*.proto
```

---

## Architecture Rules

### The Iron Rule

> **If adding a new media type requires changing the core platform, the architecture is wrong.**

Core knows nothing about movies, TV, music, or books. All domain logic lives in modules.

### Contract Contributions

- **Core contracts** — interfaces in `pkg/contracts/` that define fabric infrastructure (event bus, registry, storage, mesh, security). These are reviewed for minimalism and fabric-agnosticism.
- **Domain contracts** — interfaces specific to a media domain (downloader, transcoder, metadata). These go in separate `github.com/Muxcore-Media/contracts-*` repos. Core never imports them.

### New Contracts Checklist

Before adding a new contract to `pkg/contracts/`:

1. Is it truly fabric infrastructure, not domain-specific?
2. Is it discoverable via `Registry.FindByCapability()`?
3. Is the interface minimal (only methods modules actually need)?
4. Are security considerations documented on the interface type?
5. Is the contract documented in the wiki [Contracts](Contracts) page?

### Module Contributions

Modules are standalone binaries, not compile-time imports. See [Writing Modules](Writing-Modules) for the sidecar pattern. Reference implementation: [downloader-native-torrent](https://github.com/Muxcore-Media/downloader-native-torrent).

Each module repo carries its own `.forgejo/workflows/ci.yml` (`runs-on: native`).

---

## PR Process

### Branching

- Branch from `master`
- Use descriptive branch names: `feat/description`, `fix/description`, `docs/description`
- Keep branches focused — one concern per PR

### Before Opening a PR

1. `go build ./...` passes
2. `make test` (or `make ci`) passes
3. `golangci-lint run` passes
4. New code has tests
5. New contracts are documented in the wiki
6. Commit messages are descriptive

### Commit Messages

```
area: short description (max 72 chars)

Longer explanation if needed. What changed and why.
```

Examples:
- `contracts: add EncryptionProvider interface`
- `grpcmesh: fix heartbeat TLS guard for nil creds`
- `docs: update roadmap to separate contracts from implementations`

### Review

All PRs require review. Forgejo CI must pass (build + test + lint). Doc-only PRs still require CI green.

### Merging

Squash-merge to `master`. Branch protection requires PRs, blocks force push, blocks branch deletion.

---

## Documentation

### Wiki (`muxcore-docs`)

Committed wiki markdown lives in **`muxcore-docs/wiki/`** in the umbrella workspace (or the `muxcore/muxcore-docs` Forgejo repo). When adding or changing a feature:

1. Update the relevant wiki page under `muxcore-docs/wiki/`
2. If it's a new contract, add it to the Contracts page
3. If it's a new config option, add it to the Configuration Reference
4. Point Roadmap/Tasks stubs at workspace [`MASTER-ROADMAP.md`](../MASTER-ROADMAP.md) — do not maintain parallel checkbox lists

Rebuild the static site: `cd muxcore-docs && npm ci && make build && npm test`.

**Public consumer path (later):** GitHub wiki (`core.wiki`) and GitHub Pages (`.github/workflows/pages.yml`) mirror the committed snapshot — they are not the origin documentation workflow.

### Code Documentation

- All exported types, functions, and interfaces must have GoDoc comments
- Security-sensitive interfaces must document what callers and implementers must not log
- Credential-bearing types must implement `slog.LogValuer` for safe logging

---

## Security

- **Vulnerability reporting:** See [SECURITY.md](https://github.com/Muxcore-Media/core/blob/master/SECURITY.md)
- **Secure coding:** Follow OWASP Go-SCP guidelines
- **Never log credentials** — use `slog.LogValuer` on config types with URLs
- **Constant-time comparison** for security-sensitive string checks (join tokens, API keys)
- **TLS is required** for production — gRPC refuses to start without it unless explicitly disabled

---

## License

GPL-3.0. See [LICENSE](https://github.com/Muxcore-Media/core/blob/master/LICENSE).
