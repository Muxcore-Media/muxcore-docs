# AGENTS.md — muxcore-docs

Static HTML site built from committed wiki markdown in `./wiki/`. Origin CI is Forgejo (`.forgejo/workflows/ci.yml`); `.github/workflows/pages.yml` is an optional public GitHub Pages consumer only — not the merge gate.

## Wiki source

- **Default:** `./wiki/` in this repo is the documentation snapshot agents and CI build from.
- **Override:** set `MUXCORE_DOCS_WIKI` to another directory (absolute or relative to repo root) when syncing from a sibling checkout.
- **Skip copy-back:** `MUXCORE_DOCS_SKIP_WIKI_SYNC=1` prevents `build.mjs` from copying a non-local wiki source into `./wiki/` (tests use this).

Do not treat `../core.wiki` as the default build input in the umbrella workspace — it can overwrite committed pages and hide orphans like `Installer-Pin-Matrix.md`.

## Build & test

```bash
cd muxcore-docs
npm ci
make build          # node build.mjs → dist/
npm test            # build + a11y (axe) + build unit tests
```

Use `nix-shell -p nodejs --run 'cd muxcore-docs && npm ci && npm test'` when Node is not on PATH.

## Content policy

- Do **not** keep Roadmap or Tasks wiki pages. Canonical open work is workspace [`MASTER-ROADMAP.md`](../MASTER-ROADMAP.md) and umbrella GitHub Issues.
- After material platform milestones, update Getting Started, Deployment, Security, Port Map, and Configuration Reference here; then rebuild `dist/`.
- Workspace path links (`../MASTER-ROADMAP.md`, `../_mvp/…`) become non-navigable `workspace-file-ref` spans in the static site — prefer wiki page links or plain prose for operator docs.

## Forgejo CI

Workflow: `.forgejo/workflows/ci.yml` — `runs-on: native`, Node 22, `npm ci`, `make build`, `npm test`, uploads `dist/` artifact.
