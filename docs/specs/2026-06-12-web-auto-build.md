# Web auto-build — offer npm install + build when web/dist is missing

**Date:** 2026-06-12
**Status:** implemented (verified 2026-06-15)

## Problem

`geneseed web` serves the committed React bundle from `web/dist`. When the
bundle is absent — a fresh clone before the first build, or a deployed install
upgraded by an updater that predates `web` in the SYNC list (fixed 00695aa) —
`serve()` prints the manual recipe (`cd web && npm install && npm run build`)
and exits. The user asked for the web UI and got homework instead: the harness
knows exactly what to run, where, and in what order.

## Fix

One decision helper plus a thin runner in `rituals/web.py`, wired into
`serve()` where the missing-dist bail lives today. The TUI's `w` key and the
menu entry both spawn `harness.py web` as a terminal subprocess, so one console
prompt covers every entry point.

### Decision — `_build_plan(dist, web_dir, npm, interactive) -> str`

**Pure** (unit-tested). Returns one of:

- `"serve"` — `dist/index.html` exists; no build needed.
- `"no-source"` — `web_dir/package.json` missing: the web sources never
  arrived. Caller prints a `geneseed upgrade` hint (twice on installs whose
  running updater predates the SYNC fix) and exits 1.
- `"no-npm"` — sources present but `npm` is `None`: caller prints the manual
  recipe plus an "install Node.js" pointer and exits 1.
- `"no-tty"` — buildable, but stdin is not interactive (scripts, CI): caller
  prints the manual recipe and exits 1 — never hang on a prompt.
- `"ask"` — buildable and interactive: caller prompts.

### Prompt and build — in `serve()`

On `"ask"`: `[web] UI not built — run npm install && npm run build now? [Y/n]`
(empty answer = yes). Decline prints the manual recipe and exits 0 — the user
made a choice, not an error. Accept runs `npm install` then `npm run build`
with `cwd=web/`, output inherited so a slow or proxied install stays visible.
The npm executable is `shutil.which("npm")` — on Windows that resolves
`npm.cmd`, so no `shell=True`. A non-zero exit reports which step failed and
returns that code. On success `serve()` falls through to the existing flow
(server start, browser open) with no second prompt — running `geneseed web`
*was* the request to start it.

### Scope

Missing dist only. A stale dist (web sources newer than the build) still
serves: staleness detection means mtime heuristics and surprise rebuilds, and
the committed `web/dist` is the normal delivery path. Revisit only if stale
bundles bite in practice.

## Tests

`WebAutoBuildTests` (stdlib unittest, beside the existing web tests):
`_build_plan` returns `"serve"` when dist is populated, `"no-source"` without
`package.json`, `"no-npm"` without npm, `"no-tty"` when non-interactive, and
`"ask"` when buildable + interactive. The subprocess runner stays thin and
untested by design.

## Docs

README → *Web UI* (SETUP.md has no web section): note that `geneseed web`
offers to build the UI when `web/dist` is missing; the manual recipe stays as
the non-interactive path.
