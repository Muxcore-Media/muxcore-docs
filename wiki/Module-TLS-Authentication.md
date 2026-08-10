# Module TLS Authentication

**Core acts as an internal certificate authority (CA) for module identity.** Every module connecting to the gRPC mesh can be authenticated via TLS client certificates issued by core. This page documents the architecture, the two registration paths (auto-issued vs. bootstrap), and configuration.

---

## Architecture Overview

MuxCore runs a lightweight internal CA (`CertAuthority` in `internal/grpcmesh/certauth.go`) that is **not** a full PKI — there is no CRL or OCSP support. The CA:

- Auto-generates on first start (no user setup required)
- Stores files in the CA directory (`ca.crt` and `ca.key`, key at `0600`)
- Has a 10-year validity period
- Issues module certificates with 365-day validity
- Uses ECDSA P-256 keys

### File Layout

```
~/.muxcore/ca/          ← default (override with MUXCORE_GRPC_CA_CERT_DIR / grpc.ca_cert_dir)
├── ca.crt              ← CA certificate (PEM)
└── ca.key              ← CA private key (PEM, 0600, keep secret)
```

Default directory is `~/.muxcore/ca`. Override with `MUXCORE_GRPC_CA_CERT_DIR`.

---

## Two Registration Paths

### Path 1: Core-Spawned Modules (Auto-Issued)

When core spawns a module via the sidecar module manager (`--tag`), it **automatically issues a TLS client certificate** for that module and passes it via CLI flags:

```
--muxcore-tls-cert <path>/module.crt
--muxcore-tls-key  <path>/module.key
```

The module uses these certificates when connecting to the gRPC mesh. The certificate's Common Name (CN) is the module ID. The module never needs to handle bootstrap tokens.

### Path 2: External Modules (Bootstrap Tokens)

External modules (not spawned by core — running in separate containers or on different machines) use the `BootstrapRegister` RPC to obtain a signed certificate:

1. An operator generates a one-time token via core's admin API or config
2. The module starts without a certificate, connects insecurely (or with a pre-shared CA)
3. The module calls `BootstrapRegister` with the token
4. Core validates the token (format, expiry, single-use, module ID match) and returns a signed certificate + key + CA cert
5. The module reconnects with mTLS using the received credentials

**Token format:** `mct_<version>_<moduleID>_<hex>` (e.g., `mct_1_downloader-native-torrent_a1b2c3...`)

**Token properties:**
- Single-use (consumed after validation)
- 5-minute TTL (`tokenTTL`)
- Bound to a specific module ID (cannot be reused for a different module)
- Stored as SHA-256 hash (raw token never persisted)

---

## Configuration

### `muxcore.json`

```json
{
  "grpc": {
    "mtls_enabled": true,
    "ca_cert_dir": "/etc/muxcore/ca"
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `grpc.ca_cert_dir` | string | `~/.muxcore/ca/` | Directory for CA files (`ca.crt`, `ca.key`) |
| `grpc.mtls_enabled` | bool | `false` | Require mutual TLS for gRPC connections |

### Environment Variables

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `MUXCORE_GRPC_CA_CERT_DIR` | `grpc.ca_cert_dir` | CA file directory (overrides default) |
| `MUXCORE_GRPC_MTLS_ENABLED` | `grpc.mtls_enabled` | `true` or `false` |

---

## BootstrapRegister RPC

**Service:** `module.v1.ModuleRegistration`
**RPC:** `BootstrapRegister(BootstrapRegisterRequest) returns (BootstrapRegisterResponse)`

```protobuf
message BootstrapRegisterRequest {
  string token = 1;      // One-time bootstrap token
  string module_id = 2;  // The module's claimed identity
}

message BootstrapRegisterResponse {
  bool accepted = 1;      // Whether the certificate was issued
  string error = 2;       // Human-readable error if not accepted
  string signed_cert = 3; // PEM-encoded signed certificate
  string key_pem = 4;     // PEM-encoded private key
  string ca_cert = 5;     // PEM-encoded CA certificate
}
```

---

## Cryptographic Module Identity

When mTLS is enabled, every gRPC connection carries a TLS client certificate whose CN is the module ID. Core verifies this at the `Register` RPC:

- The `CommonName` in the TLS certificate **must match** the `module_id` in `RegisterRequest`
- This replaces the trust-on-first-use pattern (`x-caller-id` header)
- In dev mode (`MUXCORE_INSECURE_DISABLE_TLS=true`), peer address binding is used as a fallback

### Security Properties

| Property | Mechanism |
|----------|-----------|
| Module identity | TLS client certificate CN = module ID |
| Certificate issuance | Internal CA, signed with ECDSA P-256 |
| Token security | SHA-256 hashed, single-use, 5-min TTL |
| Key protection | PEM files at `0600` permissions |
| Cluster PKI | CA key distributed via join response, AES-256-GCM wrapped with join token |

---

## Cluster PKI Distribution

When a new node joins a cluster:

1. The seed node encrypts the CA private key with AES-256-GCM using a key derived from the join token (SHA-256)
2. The encrypted key + CA cert + signed node cert are returned in the `JoinResponse`
3. The joining node decrypts the CA key and installs it via `CertAuthority.LoadCA()`
4. All nodes in the cluster now trust the same CA
5. Each node can independently issue module certificates that every other node trusts

This means **modules can move between nodes** in a cluster — their certificates are accepted everywhere.

---

## Next Steps

- [Security Model](Security) — full security architecture
- [Writing Modules](Writing-Modules) — module registration with mTLS
- [Deployment](Deployment) — TLS configuration for production
