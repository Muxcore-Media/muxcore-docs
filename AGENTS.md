# AGENTS.md — muxcore-docs

Static HTML site built from committed wiki markdown in `./wiki/`. CI is GitHub Actions (`.github/workflows/ci.yml`, `ubuntu-latest`). `.github/workflows/pages.yml` (GitHub Pages) is `workflow_dispatch`-only because Pages on private repos needs a paid plan.

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

- **Roadmap / Tasks wiki pages** are stubs pointing at [`MASTER-ROADMAP.md`](https://github.com/Muxcore-Media/umbrella/blob/main/MASTER-ROADMAP.md). Do not maintain parallel checkbox lists in the wiki.
- After material platform milestones, update Getting Started, Deployment, Security, Port Map, and Configuration Reference here; then rebuild `dist/`.
- Workspace path links (`../TASKS.md`, `../_mvp/…`) become non-navigable `workspace-file-ref` spans in the static site — prefer wiki page links or plain prose for operator docs.

## GitHub Actions CI

Workflow: `.github/workflows/ci.yml` — `runs-on: ubuntu-latest`, `actions/checkout@v5`, Node 22, `npm ci`, `make build`, `npm test`, uploads `dist/` artifact.
