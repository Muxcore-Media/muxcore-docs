# Tasks

Living end-user product checklist for MuxCore (installer, fixture-first media path, self-hosted CI).

| Where | What |
|-------|------|
| **This wiki page** | Short pointer + constraints |
| **Workspace** | Canonical checklist: [`TASKS.md`](../TASKS.md) (sibling of `_mvp/` in the local MuxCore multi-repo workspace) |
| **Roadmap wiki page** | Also redirects here — no separate checkbox roadmap |

Previous per-module `ROADMAP.md` files and older wiki Roadmap checklists are **retired**. Do not add new “see ROADMAP” links; point at [`TASKS.md`](../TASKS.md) or this page.

### Constraints (same as workspace)

- Laptop + GitHub **free** account only
- Self-hosted CI runners (`runs-on: self-hosted`); local registry for images
- Fixture / mock / httptest acquisition for product gates — **no live pirate** indexers or swarms as requirements
- No paid Actions / Packages / cloud IdP / debrid as hard dependencies

### Doc entry points

- [Getting Started](Getting-Started) — installer / release binaries + fixture-first acquisition
- [Deployment](Deployment) — single laptop, self-hosted CI, local registry
- [Configuration Reference](Configuration-Reference) — loom config and env overrides
- [Port Map](Port-Map) — canonical gRPC/HTTP ports for installer / `_mvp` (collision remaps)
