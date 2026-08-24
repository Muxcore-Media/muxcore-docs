# Spool Security

**Spools are the source of truth for which modules run on your system.** This page explains the security model and what you need to know before using a spool.

---

## The Official Spool

```
https://github.com/Muxcore-Media/spool
```

The official MuxCore spool is maintained by the MuxCore team. All modules it lists are under the `Muxcore-Media` GitHub organization. When you run:

```bash
muxcored --tag media
```

you are loading the `default` tag from the official spool. Core fetches the tag definition, resolves the listed modules, and launches them.

---

## Third-Party Spools

You can point MuxCore at any spool:

```bash
muxcored --tag my-setup --spool https://github.com/some-user/custom-spool
```

**This is a trust decision.** A third-party spool can:

- List modules that contain malicious code
- Point to forks with backdoors or data exfiltration
- Omit security-critical modules (e.g., auth, rate limiting) and replace them with stubs
- Specify outdated versions with known vulnerabilities
- Change its module list at any time — the tag you fetched yesterday might be different today

**Modules run with the same OS privileges as the core process.** A malicious module can access your filesystem, network, environment variables, and any data MuxCore manages.

---

## Before Using a Third-Party Spool

1. **Audit the module list.** Open the spool repo and read every `tags/<name>.json` file. Know exactly which modules will run.
2. **Verify each module repo.** Check that the repo URLs point to legitimate sources, not lookalike forks.
3. **Check for security modules.** Make sure the spool includes auth, rate limiting, and other security infrastructure — and that they point to real implementations, not stubs.
4. **Pin to a specific version.** Tags in the spool specify module versions. Use a tag that pins explicit versions, not one that floats on `latest`.
5. **Test in isolation first.** Run MuxCore in a container or VM with restricted access before deploying on production hardware.

---

## How Core Protects You

When you use the `--tag` flag, MuxCore prints a security disclaimer to stderr before loading any modules. If you use a non-default spool (`--spool`), the disclaimer is displayed regardless.

Core's built-in protections:

- **SSRF protection** — the spool fetcher validates URL schemes (https only), blocks private/reserved IPs, enforces a 10-second timeout, and limits response body size to 1 MB.
- **Checksum verification** — SHA-256 checksums specified in the spool tag are verified after module build. Required modules with mismatched checksums block startup. Optional modules are skipped with a warning.
- **Strict call policy** — modules can only call other modules whose declared capabilities match the call target (enforced by a `CallPolicyProvider` module such as `call-policy-default`; core denies calls until a `call.policy` module is wired).
- **Strict publish policy** — event publication is deny-by-default until a `PublishPolicyProvider` is registered (capability `"publish.policy"`). The reference module `publish-policy-default` loads YAML rules from `policies.yaml` (override with `PUBLISH_POLICY_FILE`); each rule matches a `caller` module ID against `event_types` globs.

Core does not currently:

- **Cryptographically sign** module binaries (e.g., Sigstore/cosign)
- **Sandbox** module processes (they run with full user privileges)
- **Validate** that spool module lists haven't changed since you last checked

These are on the roadmap. For now, the security boundary is **your diligence**.

---

## Creating Your Own Spool

Anyone can host a spool. See the [official spool repo](https://github.com/Muxcore-Media/spool) for the format:

```
your-spool/
├── catalog.json          # Module catalog
├── tags/
│   ├── default.json      # Tag definitions
│   └── custom.json
└── README.md
```

A spool can be any git repo with a `tags/` directory. GitHub repos work out of the box. Non-GitHub repos need to serve the `tags/` directory over HTTP.

---

## Threat Model

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Malicious module in third-party spool | High | Audit spools before use |
| Spool tag changed after review | Medium | Pin to a specific commit |
| Module repo compromised | High | Checksum verification catches mismatches; binary signing planned |
| Module escapes to host | High | Sandboxing (planned) |
| Official spool compromised | Low | GitHub org security, 2FA required |
