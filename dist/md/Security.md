# Security Model

**Security is woven into every layer of MuxCore.** Most self-hosted media software treats security as an afterthought — local-only access, no audit trail, hardcoded API keys. MuxCore builds authentication, authorization, encryption, and audit logging into the platform from day one.

---

## How Security Works (Plain Language)

Think of MuxCore security like a building with multiple layers:

1. **Front door (Authentication)** — Who are you? Prove it with a password, API token, or SSO.
2. **Room keys (Authorization)** — What are you allowed to do? Admins can do anything. Viewers can only browse.
3. **Security cameras (Audit Logging)** — Everything is recorded: who did what, when, from where.
4. **Locks on internal doors (Call Policy)** — Even modules need permission to talk to each other.
5. **Encrypted hallways (TLS)** — Data in transit is always encrypted between machines.

---

## Authentication

Authentication is **module-driven** — the core doesn't authenticate users directly. You install an auth module that connects to your existing identity system:

| Auth Module | How It Works |
|-------------|-------------|
| **Local Accounts** ([`auth-local`](https://github.com/Muxcore-Media/auth-local)) | Username + password + optional 2FA, stored locally |
| **API Tokens** | Scoped, revocable tokens for programmatic access (via auth modules) |
| **OAuth/OIDC** ([`auth-oidc`](https://github.com/Muxcore-Media/auth-oidc)) | Authentik, Authelia, Keycloak, Google, GitHub — **shipped** |
| **LDAP / Active Directory** | Planned (`auth-ldap` not bootstrapped yet) |

Multiple auth modules can be active simultaneously. Your family uses local accounts. Your scripts use API tokens. Your admin uses OIDC.

### API Tokens

```json
{
  "name": "readonly-monitor",
  "scopes": ["events:read", "status:read"],
  "expires": "2027-01-01T00:00:00Z"
}
```

Tokens are scoped and revocable. A monitoring dashboard gets read-only access. A download automation script gets download permissions only.

---

## Authorization (RBAC)

Once authenticated, every action is checked against role-based permissions:

| Role | What They Can Do |
|------|-----------------|
| **Admin** | Full system access — manage users, modules, settings |
| **Manager** | Manage media — approve requests, edit metadata, delete |
| **User** | Request media, view library, manage their own requests |
| **Viewer** | View library only — no requests, no changes |
| **Module** | Scoped to the module's declared needs |

### Policy Example

```yaml
policies:
  - role: user
    can: [media.request, media.view]
    on: [movies, tv, music]

  - role: manager
    can: [media.approve, media.delete, media.edit]
    on: [movies, tv, music, books]

  - role: admin
    can: ["*"]
    on: ["*"]
```

---

## Inter-Module Security

Modules need permission to talk to each other. A downloader shouldn't be able to call the user management module. The **Call Policy** system enforces this:

```go
// Module declares who it is
ctx = contracts.WithCallerID(ctx, "downloader-native-torrent")

// Mesh client checks: "can downloader-native-torrent call GetUsers on auth-local?"
result, err := meshv1.NewModuleMeshClient(conn).Call(ctx, &meshv1.CallRequest{
	TargetModule: "auth-local",
	Method:       "GetUsers",
	Payload:      payload,
})
// → Denied. Downloaders can't access user management.
```

When no call policy module is registered, inter-module calls are **denied by default** (secure-by-default). Deployments that want open mode must register an explicit permissive call policy provider.

### gRPC method allowlist (`core@v0.5.0+`)

Core’s auth interceptor deny-by-defaults **except** a fixed public allowlist: module registration, Health `Check`, Discovery fan-out RPCs (`FindByCapability`, `FindByRole`, `ListAll`, `Members`, `Watch`, `Resolve`, …), and selected Event subscribe/publish helpers. That keeps laptop admin UIs and single-node membership working without a bearer. Everything else still needs Authorizer + IdentityProvider. The old `MUXCORE_GRPC_REQUIRE_*_AUTH` env toggles are gone — do not rely on them.

---

## Audit Logging

Every significant action is recorded:

```
[2026-05-26 14:32:01] user:ender action:media.request resource:"The Terminator" trace:abc123
[2026-05-26 14:32:05] system action:workflow.started resource:movie-request trace:abc123
[2026-05-26 14:32:45] module:downloader-native-torrent action:download.started resource:torrent:xyz trace:abc123
[2026-05-26 15:45:12] module:media-movies action:library.item.added resource:"The Terminator" trace:abc123
```

Audit entries include:
- **Who** — user ID, system, or module ID
- **What** — the action performed
- **On what** — the resource affected
- **When** — timestamp
- **Trace ID** — links related actions across services
- **PrevEntryHash** — SHA-256 of the previous entry, forming a tamper-evident chain
- **Signature** — optional HMAC-SHA256 for cryptographic verification

### Default Audit Logger

Core ships with a built-in JSONL file logger. Set `audit.path` in `muxcore.json` or `MUXCORE_AUDIT_PATH` environment variable to enable it:

```json
{
  "audit": {
    "path": "/var/log/muxcore/audit.jsonl"
  }
}
```

When no path is configured, the audit logger is a no-op — all Log/Query/Export calls return immediately with zero overhead. This means audit logging is **safe to wire by default** and costs nothing until you turn it on.

For production, swap in a module-based audit logger (e.g., database-backed with search indexing) by implementing the `AuditLogger` contract.

---

## Network Security

### API Server (HTTP)

TLS is configured with certificate and key files. Production expects certs; laptop demos set `MUXCORE_INSECURE_DISABLE_TLS=true` so HTTP/gRPC run in plaintext (lab only — see [Configuration Reference](Configuration-Reference)).

```json
{
  "server": {
    "cert_file": "/etc/ssl/cert.pem",
    "key_file": "/etc/ssl/key.pem"
  }
}
```

Environment variables: `MUXCORE_SERVER_TLS_CERT` / `MUXCORE_SERVER_TLS_KEY` (aliases: `MUXCORE_TLS_CERT`, `MUXCORE_TLS_KEY`)

### Trusted Proxies

`X-Forwarded-For` is honored only when the TCP peer (`RemoteAddr`) is in a configured trusted proxy CIDR. By default only loopback (`127.0.0.0/8`, `::1/128`) is trusted. Untrusted peers: XFF is ignored and the client IP is `RemoteAddr`. `X-Real-IP` is not used.

```
Client → Internet → Reverse Proxy (10.0.0.1) → MuxCore
                                                ↑ trusts XFF only from 10.0.0.0/8
```

Configure via `server.trusted_proxies` in `muxcore.json` (CIDR strings) or `MUXCORE_SERVER_TRUSTED_PROXIES` (comma-separated). Empty keeps the loopback-only default. `muxcored` calls `SetTrustedProxies` at HTTP server init. Trusted CIDRs should be the immediate reverse-proxy hop(s).

### WAL and Audit Integrity

The audit logger fsyncs each entry by default. The event WAL exposes `Flush` / `Sync` / `FlushSync` APIs and syncs on segment rotation; it does not fsync on every individual event write unless callers flush.

### Health Endpoint Hardening

The `/health` endpoint no longer leaks module error messages verbatim. All errors are reported as the fixed string `"error"` to prevent information disclosure (file paths, internal hostnames, DB credentials in error messages).

### Audit Log fsync

Every audit entry is fsynced to disk immediately after writing. Combined with the SHA-256 hash chain and optional HMAC-SHA256 signing, this provides crash-safe, tamper-evident audit logging.

### gRPC SetHeader Error Handling

All gRPC metadata propagation errors (term headers on Join, Heartbeat, Members, Watch responses) are now logged at warn level. Previously they were silently discarded, which could cause stale cluster state in clients.

### gRPC Mesh (Inter-Machine)

gRPC communication between nodes uses TLS:

```json
{
  "grpc": {
    "cert_file": "/etc/ssl/grpc-cert.pem",
    "key_file": "/etc/ssl/grpc-key.pem",
    "mtls_enabled": true,
    "ca_cert_file": "/etc/ssl/ca.pem"
  }
}
```

**Plaintext mode** logs a warning — it works but is not recommended for production. **Mutual TLS (mTLS)** verifies both ends of the connection, preventing unauthorized nodes from joining the mesh.

Environment variables: `MUXCORE_GRPC_TLS_CERT`, `MUXCORE_GRPC_TLS_KEY`, `MUXCORE_GRPC_MTLS_ENABLED`, `MUXCORE_GRPC_MTLS_CA`

### Cluster Join Token

Nodes must present a pre-shared token to join the cluster:

```json
{
  "grpc": {
    "join_token": "my-secret-cluster-token"
  }
}
```

Or: `MUXCORE_CLUSTER_JOIN_TOKEN=my-sec...ken`

---

## Data Protection

### Encryption at Rest

Storage overlay / encryption modules can encrypt transparently **when an `EncryptionProvider` is registered and callers route through it**. Encryption is not a loom default for every Put:

```
Module writes data → Encryption overlay encrypts → Storage backend stores ciphertext
Module reads data ← Encryption overlay decrypts ← Storage backend returns ciphertext
```

The `EncryptionProvider` contract supports envelope encryption with key rotation. The `encryption-aesgcm` module implements this with a versioned on-disk keyring: new Encrypt calls use the active key; Decrypt selects the key from the ciphertext prefix (legacy unversioned blobs still decrypt with key id `0`).

```go
ep.Encrypt(ctx, plaintext)   // produces self-describing ciphertext
ep.Decrypt(ctx, ciphertext)  // reads key metadata, selects correct key
ep.RotateKey(ctx)            // new key for future encryptions, old key still works for existing data
```

### Secrets Management

Prefer a secrets module over putting API keys in config or env. Core still accepts some env overlays (e.g. `MUXCORE_DATABASE_URL`) for bootstrap; production credentials should live in a `SecretsProvider` module:

```go
secrets.Get(ctx, "jackett_api_key")    // not os.Getenv("JACKETT_API_KEY")
```

Supported module backends today:

- **`secrets-file`** — encrypted local file store (default / minimal spool tags).
- **`secrets-vault`** — client sidecar for HashiCorp Vault or OpenBao, Infisical, AWS Secrets Manager, GCP Secret Manager, or Azure Key Vault. Does not embed a secrets server; configure `SECRETS_BACKEND` and the provider’s env vars.

Run **only one** module advertising the `secrets` capability per mesh.

### Data Redaction

Sensitive data (emails, tokens, IP addresses) can be stripped from logs and audit trails **when a `DataRedactionProvider` module is registered** (e.g. `data-redaction-pattern`) and logging paths use it — not automatic for every slog/audit call out of the box:

```go
safe := redaction.Redact(ctx, data, []string{"email", "token", "ip_address"})
// {"user_id": "abc123", "email": "***REDACTED***", "action": "login"}
```

---

## Module Sandboxing (Planned)

External modules will run as separate processes with limited OS permissions:
- **Docker/container isolation** — recommended deployment pattern
- **gVisor/Firecracker** — optional microVM isolation for untrusted modules
- **Declared permissions** — modules declare what they need; core enforces

---

---

## Cryptographic Module Identity

When mTLS is enabled, every module connecting to the gRPC mesh presents a TLS client certificate whose Common Name (CN) is the module ID. Core verifies the CN matches the `module_id` in the `Register` RPC:

```
TLS handshake → extract CN from client cert → verify against RegisterRequest.ModuleId
```

**This replaces the trust-on-first-use `x-caller-id` header pattern.** Peer address binding is used only as a dev-mode fallback when `MUXCORE_INSECURE_DISABLE_TLS=true`.

### Certificate Issuance

| Path | How It Works |
|------|-------------|
| **Core-spawned** | Module manager issues cert automatically → passes via `--muxcore-tls-cert` / `--muxcore-tls-key` |
| **External** | Module calls `BootstrapRegister` with a one-time token → receives signed cert + key + CA (`BootstrapRegister` is on the mesh public allowlist; the token is the auth) |

See [Module TLS Authentication](Module-TLS-Authentication) for the full architecture.

### Benefits

- **Cryptographic binding** — module identity is tied to a TLS certificate, not a self-declared header
- **No shared secrets** — each module gets its own keypair, not a shared token
- **Cluster-wide trust** — every node must use the **same** CA material today (shared `ca_cert_dir` / files); join does **not** distribute the CA private key (see [Module TLS Authentication](Module-TLS-Authentication))
- **Revocation by expiration** — module certificates expire after 365 days and must be renewed

---

## Operator host notes (TLS + auth URLs)

On the MuxCore MVP host:

- **Do not** set `MUXCORE_INSECURE_DISABLE_TLS=true` on staging/production. Dev/unit tests may still use it locally.
- Staging cutover checklist: [`_mvp/tls/MTLS-STAGING.md`](../_mvp/tls/MTLS-STAGING.md) (`muxcore.staging.json` + `run-host-staging.sh`).
- **Auth URL split:** browsers use the public auth base (e.g. `https://auth.gringotts`); server-side code exchange uses the internal base (e.g. `http://127.0.0.1:9401`). Never point admin-ui auth vars at the admin UI port itself.

### Phase 2 / 3 identity & SIEM status

| Item | Status |
|------|--------|
| OIDC/SSO | Shipped — [`auth-oidc`](https://github.com/Muxcore-Media/auth-oidc) |
| LDAP / AD | Not started — track as future `auth-ldap` |
| SIEM hooks | Phase 3 — consume core audit JSONL (`MUXCORE_AUDIT_PATH`) or a future audit-export module/webhook |

## Security Roadmap

| Phase | Features |
|-------|----------|
| **MVP (Current)** | Local accounts auth, API tokens, RBAC, TLS encryption, mTLS enforcement, internal CA, audit logging, call policy |
| **Phase 2** | OIDC/SSO via [`auth-oidc`](https://github.com/Muxcore-Media/auth-oidc) (**shipped**); LDAP/AD provider (**planned**); richer module permission declarations |
| **Phase 3** | Sandbox policies, network segmentation, SIEM hooks (export audit JSONL / webhook to Splunk, Elastic, etc.) |

---

## Next Steps

- [Deployment](Deployment) — secure deployment patterns
- [Contracts Reference](Contracts) — AuthProvider, Authorizer, Encryption interfaces