# Contributing to MuxCore

**Thank you for considering contributing to MuxCore.** This guide covers development setup, contract contribution guidelines, and the PR process.

---

## Development Setup

### Prerequisites

- **Go 1.24+** (project targets Go 1.26)
- **protoc** + **protoc-gen-go** + **protoc-gen-go-grpc** (for proto changes)
- **git** + **GitHub account**

### Clone and Build

```bash
git clone https://github.com/Muxcore-Media/core.git
cd core
go build ./...
```

### Run Tests

```bash
scripts/run_tests.sh
```

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
5. Is the contract documented in the wiki Contracts page and this skill?

### Module Contributions

Modules are standalone binaries, not compile-time imports. See [Writing Modules](Writing-Modules) for the sidecar pattern. Reference implementation: [downloader-native-torrent](https://github.com/Muxcore-Media/downloader-native-torrent).

---

## PR Process

### Branching

- Branch from `master`
- Use descriptive branch names: `feat/description`, `fix/description`, `docs/description`
- Keep branches focused — one concern per PR

### Before Opening a PR

1. `go build ./...` passes
2. `scripts/run_tests.sh` passes
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

All PRs require review. CI must pass (build + test + lint). Doc-only PRs still require CI green.

### Merging

Squash-merge to `master`. Branch protection requires PRs, blocks force push, blocks branch deletion.

---

## Documentation

### Wiki

The wiki at `github.com/Muxcore-Media/core.wiki` is the primary user-facing documentation. When adding or changing a feature:

1. Update the relevant wiki page
2. If it's a new contract, add it to the Contracts page
3. If it's a new config option, add it to the Configuration Reference
4. Update the Roadmap if applicable

Wiki changes are pushed directly to the wiki repo's `master` branch.

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
