# Headless status command

**Date:** 2026-06-07
**Status:** implemented

## Problem

The install dashboard (theme, install mode, component counts, memory store, AGENT.md
location) lived only in the curses TUI (`_status_view`) — invisible on Windows, CI,
and any no-TTY host, exactly where `doctor`/`diff`/`version` already work headless.

## Fix

- `_status_data()` (`harness.py`) — one source of truth for the dashboard facts:
  installed theme/emit (`_installed_defaults`), agent/skill/law counts
  (`_tui_inventory`), memory dir + fact count, and the version fingerprint
  comparison (installed vs `build.source_fingerprint()`), plus AGENT.md location for
  a global install. Returns a plain dict.
- `harness status` (`cmd_status`) prints it as a **framed, aligned panel** via the
  pure `_status_lines(d, color)` — Unicode box with an accent-colored border + bold
  title and a green/amber/dim verdict glyph. Color is auto-disabled when piped/CI
  (`_color_enabled`: TTY + `NO_COLOR`/`TERM=dumb` honored); `GENESEED_TUI_ASCII`
  swaps every non-ASCII glyph (box-drawing, ◆ · ✓ —) for a plain equivalent. No
  curses, any OS.
- `_status_view` (TUI) is refactored to render from `_status_data()`, so the panel
  and the headless command can never drift (the TUI also gains the version line).
- Launcher (`geneseed`) routes `status`; CLI/help/docstrings updated.

## Tests
- `StatusDataTests`: counts match the rendered inventory (6/17/18), the source
  fingerprint is 12-hex, the verdict is a non-empty string, and every structural key
  the command/TUI consume is present.
- `StatusRenderTests`: the plain panel is a uniform-width framed box with all key
  fields present; `color=True` adds ANSI without changing the line count.

## Verified
`doctor --all` clean; 53 tests pass; `status` prints correctly with no install and
against a fresh global install.
