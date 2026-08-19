---
group: plugins
order: 1
title: "geneseed-context"
kind: "concept"
---
Enforces the project-context load by injection, not instruction: on `session.created` it auto-discovers the repo's docs by convention and injects the `eager` ones before your first turn, so the harness needs **zero per-repo files**.

- **Eager** (injected in full, budget-capped): root `AGENTS.md` / `AGENT.md` / `CLAUDE.md` / `.cursorrules`, `README.md`, `CONTRIBUTING.md`.
- **Lazy** (path + first heading, read on demand): `docs/`, `doc/`, `architecture/`, `adr/`, monorepo `packages/*/README.md`, other root `*.md`. `node_modules`, `.git`, `dist`, `build` are never scanned.
- It re-pushes eager docs on `session.compacting` so context survives a summarised long session, and carries your machine wiki (`wiki.jsonc`) on the same budgets.

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup).

### Configure

- `GENESEED_CONTEXT` — path to an explicit `context.json` manifest (or drop `.harness/context.json` in the repo) to take control: same schema, plus glob `path`s, `load: exclude`, and `"extend": true` to layer on top of discovery.
- `GENESEED_EAGER_FILE_KB` (default 16) / `GENESEED_EAGER_TOTAL_KB` (default 48) — budget caps; an oversized eager file is demoted to a lazy listing, never silently truncated.
- `GENESEED_CONTEXT_VISIBLE=1` — force the visible `PROJECT CONTEXT` block instead of the invisible per-request transform.
- `GENESEED_CONTEXT_INJECT=off` — disable injection entirely (falls back to the soft AGENT.md Law).

### Verify

Start a session with `GENESEED_DEBUG=1` set — the plugin logs what it discovered and injected to stderr. Silence means it didn't load: re-check the filename and that the path is exactly the plugins dir above.
