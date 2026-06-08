# Spec — Optional Textual front-end for the control panel

> Add a modern, Textual-powered control panel that the `menu`/`tui` commands use when
> Textual is installed, falling back to the dependency-free stdlib `curses` panel
> otherwise. The critical path (setup/bootstrap/build/doctor/…) stays bare-`python3`.

**Date:** 2026-06-08
**Status:** implementing
**Scope:** A pure-optional *view* layer. No change to the generator, the install path,
or the curses panel's behaviour. New module `rituals/tui_textual.py`, imported lazily.

## Why this is allowed under "no deps, ever"

DESIGN Decision (Generator contract) keeps the critical path stdlib-only so the bundle
is hermetic and installs on a bare `python3`, any OS. The Textual layer does **not**
touch that path: it is imported lazily (never at module top), it is never required, and
mutating actions shell out to the same dependency-free code. If Textual is absent, the
classic curses panel runs exactly as before. Documented as the single sanctioned
exception in DESIGN.md.

## Architecture

- `harness._textual_available()` — true when `import textual` succeeds and the opt-out
  `GENESEED_TUI_CURSES` is unset.
- `harness._launch_textual(theme, start)` — puts `rituals/` on `sys.path`, imports
  `tui_textual`, and calls `run(harness_module, theme, start)`. Returns the exit code,
  or `None` to signal the caller to fall back. Any import failure is non-fatal.
- `cmd_menu` / `cmd_tui` — try Textual first (any OS), then curses (Unix), then a plain
  one-line hint. `tui` opens straight on the browse screen; `menu` opens the hub.
- `tui_textual.py` reuses harness's **pure data** functions — `_tui_inventory`,
  `_detail_lines`, `_status_data`, `_diff_collect`, `_doctor_collect`, `_memory_facts`
  (+ `_memory_drop_index`), the `_mcp_*` helpers, `_logo_lines`, `_accent_for`. It
  renders; it never re-implements.

## Screens

- **MenuScreen** — branded hero (the `GENESEED` wordmark + theme sigil) + an
  `OptionList` of actions, with a live help line.
- **BrowseScreen** — a `Tree` catalog (Agents/Skills/Laws) with a live filter `Input`;
  the selected spec renders in a `Markdown` widget (specs *are* markdown).
- **StatusScreen** — the dashboard as a Rich table.
- **MemoryScreen** — facts list + Markdown body; `d`/`x` delete via a confirm modal.
- **DiffScreen** — changed files + a colored unified diff.
- **DoctorScreen** — runs `_doctor_collect` in a thread worker with a live
  `ProgressBar`, then lists ✅/❌ results; `r` re-runs.
- **McpScreen** — toggle/enable MCP presets into an OpenCode config.
- Mutating actions (`setup`/`build`/`update`) `suspend()` the app and run the launcher's
  dependency-free command; `update` exits afterward so the user relaunches fresh code.

The app maps each Geneseed ACCENT to a cohesive built-in Textual theme and styles
borders/titles with the live `$accent` token.

## Out of scope

Replacing the curses panel (it remains the fallback and the dependency-free default),
porting `link`/`unlink`/`uninstall` into Textual (they stay launcher commands), and a
custom per-theme Textual theme file.

## Verification

1. `python rituals/harness.py --help` and `import harness` work with **no textual
   installed** (textual is never imported at module top — asserted by a unit test).
2. `python -m unittest discover -s tests` — full suite green; the Textual pilot test
   `skipUnless(textual)` so CI (dependency-free) skips it, runs it locally.
3. `_textual_available()` returns False under `GENESEED_TUI_CURSES=1` (unit-tested).
4. Local pilot (`App.run_test`): every screen mounts; browse populates 3 sections and
   the filter narrows them; the doctor worker reports a verdict; Enter/Esc route
   between menu and screens; quit returns 0.
5. Visual (tmux): the real `tui` panel renders the branded header, searchable tree, and
   a Markdown-rendered, theme-aware detail pane.

## Worklog

- [x] `rituals/tui_textual.py` — app + 7 screens + confirm modal, reusing harness data
- [x] `_textual_available` / `_launch_textual`; wire `cmd_menu` + `cmd_tui` with fallback
- [x] `--theme` on the `menu` parser; help text updated
- [x] tests: no-top-level-import guard, opt-out toggle, skipUnless pilot (84 green)
- [x] docs: SETUP.md (optional extra + toggles), DESIGN.md carve-out, this spec
- [ ] commit + push
