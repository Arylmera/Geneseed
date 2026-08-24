---
group: concepts
order: 9
title: "Sovereign repos (exclusions)"
kind: "concept"
link: {"hash": "#/harness", "label": "Manage in Harness →"}
---
A **sovereign repo** is a folder where every GLOBAL harness install goes fully dormant: hooks stay silent and the global preamble (`AGENT.md`/`CLAUDE.md`) is never loaded there. A repo that ships its own agent config you don't want a global harness layered onto is the usual case.

### Total dormancy, not a filter

Exclusion is all-or-nothing per folder — it doesn't trim which Rules apply or which Skills load, the global harness simply never engages inside that tree. A per-repo Geneseed install in the same folder is unaffected; exclusions only ever suppress GLOBAL installs.

### How it's wired, per host

- **Claude Code** — native suppression via `claudeMdExcludes` in the repo's `.claude/settings.local.json`.
- **Bob** — a shadow `rules/geneseed.md` stub that shadows the global one (never overwrites a hand-written stub already there).
- **OpenCode** — the hook entry's sovereign-bypass guard and its twin in the plugins short-circuit at session start.
- **Copilot — documented limitation.** GitHub Copilot has no native per-repo suppression hook: the global `copilot-instructions.md` still loads even inside an excluded folder.

### Manage it

- **CLI** — `harness exclude add <path>` / `remove <path>` / `list`.
- **This console** — the **Excluded folders** card on the **Harnesses** page (shown once a global install exists).

Exclusions live in each global install's own `excludes.json`, so add/remove re-wires every global install in one call — nothing to repeat per host.
