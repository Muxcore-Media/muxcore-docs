# MuxCore Docs

Static HTML site rendered from the [MuxCore wiki](https://github.com/Muxcore-Media/core/wiki)
(`core.wiki` markdown). Laptop-friendly: no paid GitHub Pages required — ship `dist/` in
the repo or download the CI artifact / Release.

## Quick start

```bash
# From a MuxCore workspace that has sibling core.wiki:
make build
# or
./build.sh

# Serve
npx --yes serve dist -l 8080
# or: python3 -m http.server -d dist 8080
```

Build prefers `../core.wiki` when present and syncs into `./wiki/`; otherwise uses the
committed `./wiki/` snapshot so CI and clones work standalone.

## Layout

| Path | Role |
|------|------|
| `wiki/` | Markdown snapshot (GitHub wiki pages) |
| `site/style.css` | Shared stylesheet |
| `build.mjs` | Markdown → HTML |
| `dist/` | Generated site (`index.html` = Home) |
| `.github/workflows/ci.yml` | Self-hosted build + artifact upload |

## Update content

1. Edit the wiki (`core` wiki or local `../core.wiki`).
2. `make sync-wiki` (or just `make build` — it syncs automatically).
3. Commit updated `wiki/` and `dist/` if you want the repo to serve offline without a rebuild.
