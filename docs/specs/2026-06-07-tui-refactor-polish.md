# Spec — TUI refactor + conservative polish

> Kill the duplication across the curses TUI screens and apply a consistent,
> behavior-preserving polish (fix the ASCII-glyph bug, unify header/footer/scrollbar).
> No new screens, no keybinding or feature changes, no screen-geometry changes.

**Date:** 2026-06-07
**Status:** implemented (verified 2026-06-15)
**Scope:** Refactor + conservative polish (user-selected). Park G5 (worktrees) and the
Windows-TUI gap.

## Problem

`rituals/harness.py` TUI (~1355–2560) works but duplicates:
- the bounds-guarded `put()` closure in ~9 functions,
- scroll-clamp + textwrap blocks across every scrollable pane,
- title/footer bar rendering,
and has a real defect: `GENESEED_TUI_ASCII` is ignored by `_tui_loop` (line 2303)
and `_menu`'s detail branch (1520), which hardcode `▸ ◆ ✦ §`.

## New shared primitives (added near the existing curses helpers)

- `_put(stdscr, y, x, s, attr=0)` — the one bounds-guarded draw. Each screen keeps a
  thin 2-line `put = lambda`/shim delegating to it, so call sites are untouched (lower
  risk) while the duplicated try/except/bounds logic lives in one place.
- `_GLYPH` — single glyph map honouring `GENESEED_TUI_ASCII` for
  `sel/up/down/head/agent/skill/law`. `_SEL_G`/`_MORE_G` become aliases. Fixes the bug.
- `_topbar(stdscr, pal, text)` / `_botbar(stdscr, pal, hints)` — top/bottom BAR rows;
  `_botbar` accepts a string or `(key,label)` pairs joined uniformly (` · `). No
  per-key colour tricks (kept simple/safe on the reverse-video bar).
- `_clamp(top, total, view_h)` — scroll-offset clamp. **Pure, unit-tested.**
- `_wrap_lines(lines, width)` — flatten raw lines to width-wrapped display lines,
  blank-safe. **Pure, unit-tested.**
- `_too_small(stdscr, min_h, min_w)` — shared guard; returns True if too small.
- `_scrollbar(stdscr, pal, x, y0, view_h, top, total)` — consistent `▴`/`▾` markers,
  replacing today's mix of arrows (browse) and "more" text (doctor/diff/memory).
- `_vdiv(stdscr, pal, dx, y0, y1)` — the vertical divider used by the two-pane screens.

## Applied to
`_menu`, `_text_input`, `_info_screen`, `_doctor_view`, `_diff_view`, `_memory_view`,
`_status_view`, `_tui_loop`, `_bootstrap_draw` — each refactored to call the primitives,
keeping its own loop, keys, features, and **geometry**.

## Out of scope
Merging the three two-pane screens into one engine; changing any screen's row math /
layout; new screens; Windows support; G5.

## Verification (runnable on Windows)
1. New unit tests: `_clamp`, `_wrap_lines`, and glyph selection (ASCII vs unicode).
2. `python -m unittest discover -s tests` — full suite green (pure TUI helpers +
   existing inventory/status tests unchanged).
3. `python rituals/harness.py --help` — module imports clean (no syntax error).
4. `python rituals/harness.py doctor --all` — still green.
5. Visual: user runs `python rituals/harness.py tui` on the Unix/work machine.

## Worklog
- [x] add helpers (_put, _glyphs/_GLYPH, _topbar, _botbar, _clamp, _wrap_lines, _too_small, _scrollbar, _vdiv)
- [x] unit tests for pure helpers (TuiHelperTests: _clamp, _wrap_lines, _glyphs ASCII)
- [x] refactor _menu + _text_input
- [x] refactor _info_screen + _doctor_view
- [x] refactor _diff_view + _memory_view (shared _vdiv, dropped unused `g`)
- [x] refactor _tui_loop (fixed ASCII glyphs via _GLYPH; _scrollbar for detail)
- [x] refactor _bootstrap_draw title/footer
- [x] unittest (59) + --help + doctor --all green
- [ ] commit + push

## Outcome
8 inline `put()` closures collapsed to thin shims over one `_put`; title/footer/
scrollbar/glyph logic centralised. ASCII-glyph bug fixed (was hardcoded in `_tui_loop`
+ `_menu`). Behaviour, keys, and screen geometry unchanged. Visual confirmation pending
on a Unix terminal (`python rituals/harness.py tui`).
