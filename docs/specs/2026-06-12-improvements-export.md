# Improvements export — preserve deployed self-improvements as a back-port file

**Date:** 2026-06-12
**Status:** approved

## Problem

Every agent and skill spec ends with a **self-improvement loop** (spec
2026-06-XX, commit 5106a33): when a run reveals a flaw in the spec itself, the
agent edits its own file — in the **deployed** harness, in place. Those edits
are exactly the knowledge the harness is supposed to accumulate, and they are
also exactly what `setup`, re-theme, and `upgrade` silently overwrite when they
re-render the global install from `src/`.

`diff` (the back-port aid, spec 2026-06-07) already *surfaces* the drift, but
only to stdout / an interactive TUI pane. There was no artifact: nothing a user
could keep, nothing to hand to an agent in this repo with "fold these into
`src/`", and nothing produced automatically at the moment it matters most — the
instant before a rebuild destroys the edits.

## Fix

One report renderer, one writer, and an auto-export hooked into every flow that
overwrites a deployed global harness.

### New helpers (`rituals/harness.py`, beside `_diff_collect`)

- `_improvements_md(target, theme, files, when) -> str` — **pure** (unit-tested).
  Renders the collected drift as a self-contained markdown report: header
  (capture time, deployed dir, theme, edited/added/missing counts), a standing
  instruction ("hand this file to an agent in the Geneseed source repo…"), then
  one `## file (status)` section per file with the unified diff in a
  ` ```diff ` fence. Diffs read source → deployed; the expected copy is rendered
  in the **deployed** theme (2026-06-07), so only genuine edits appear.
- `_write_improvements(target, theme, files, out_path=None) -> Path` — writes
  the report for an already-collected diff. Default destination:
  `improvements/improvements-YYYYMMDD-HHMMSS.md` **inside the deployed harness
  dir** (`target`, e.g. `~/.config/opencode`) — the report lives beside the
  install it describes, where every consumer of that harness finds it. Safe by
  the manifest contract: the dir is never listed as owned, so `diff` never
  reports it as drift, re-emits never clobber it, and uninstall leaves it in
  place (same contract as memory). *(Amended same day: the first cut wrote to
  `improvements/` under the source root; moved into the deployment per review —
  the artifact belongs with the harness generation location.)*
- `export_improvements(target=None, theme=None, out_path=None) -> (path, files)`
  — collect + write **only when there is drift**. `path` is `None` when there is
  no deployed install (`files is None`) or no differences (`files == []`).

### CLI — `diff --out FILE`

`geneseed diff --out FILE` writes the report (and still prints the summary);
with no drift it prints "no differences — nothing written." The closing hint now
offers `--out` alongside `--full`.

### Auto-export — wired into every overwrite path

| Flow | Hook | Surface |
| --- | --- | --- |
| `upgrade` (also reached by `update`, `bootstrap`, Settings → Update) | `cmd_upgrade`, **before** `_update.upgrade()` — the factory refresh replaces `src/`, so the export must compare against the *pre-refresh* source the deployment was built from | two stdout lines: saved path + back-port hint |
| line-mode setup wizard | `_setup_lines`, after confirm, before the build, only when `emit == "opencode-global"` | info lines before the build output |
| curses setup **and** re-theme (`_grow_flow` is their shared back half) | before `_run_steps`, only for the global emit; a one-shot "checking the deployed harness for local edits…" frame covers the multi-second collect (same pattern as `_diff_view`) | `extra` rows appended to the post-build summary via a new optional `extra` param on `_setup_done_lines` |
| TUI *Review local edits* | new `e` key in `_diff_view` (reuses the already-collected files — no recompute) | info screen with the written path |

Failures of the export itself never block an install or upgrade — they warn and
continue (the upgrade warning names the manual `diff --out` escape hatch).

### Post-TUI flush — the notice must outlive the alternate screen

The in-TUI notices proved easy to miss in practice (the summary rows sit below
the theme banner; in bootstrap the upgrade step's lines scroll past inside the
progress screen). `_flush_export_notes()` re-prints, on the restored terminal,
every improvements file written **since process start** (`_T0`): it *scans* the
global install's `improvements/` dir by mtime instead of tracking calls, so
exports made by subprocess steps (the upgrade inside bootstrap / update) are
caught too. Called after each curses session ends (`cmd_setup`, `cmd_menu`,
`cmd_tui`) and **before each `_reexec`** (bootstrap → setup, Settings → Update)
— a re-exec replaces the process, so anything not flushed first is lost.

Not hooked: Settings → *Rebuild bundle* and `geneseed build` (plain `build.py`
defaults to `--emit files` — they never touch a deployed global install).

## Tests

`ImprovementsExportTests` (stdlib unittest): the pure renderer carries header,
counts, per-status labels, and intact ` ```diff ` fences; `_write_improvements`
honours an explicit out-path and creates parent dirs; `export_improvements`
against a dir with no manifest returns `(None, None)` and writes nothing.

## Docs

README → *Keeping it current* ("Local edits survive"); SETUP.md → *Reviewing
local edits* (export + auto-export behaviour); `.gitignore` ignores
`improvements/`.
