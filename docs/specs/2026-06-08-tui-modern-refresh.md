# Spec — TUI modern refresh (emoji, splash, motion)

> Make the curses control panel feel modern and refined: width-safe emoji icons, an
> animated ASCII-art splash, and spinners on the progress screens — all stdlib-only,
> with a calm opt-out and the existing ASCII fallback intact.

**Date:** 2026-06-08
**Status:** implementing
**Scope:** Additive polish on top of the 2026-06-07 refactor. No new screens, no
keybinding changes, no screen-geometry changes. Pure-stdlib `curses` only (Decision:
"no third-party dependencies, ever" — so no `rich`/`textual`).

## Problem

The TUI worked but read flat: a plain text top bar, no branding, `◆ ✦ §` the only
icons, and static progress bars. The themes already ship rich `BANNER`/`LOADED_SIGIL`
art the panel never surfaced. Emoji were deliberately avoided because they render
double-width and shear `ljust`/slice-based alignment — a real curses problem, but a
solvable one.

## New primitives

- `_dwidth(s)` — display width in terminal columns. Emoji (the supplementary symbol
  planes) and East-Asian wide/fullwidth count as 2; combining marks as 0; a trailing
  `U+FE0F` promotes its single-width base to 2 (so `⚠️`/`ℹ️` measure right). Stdlib
  `unicodedata` only. **Pure, unit-tested.**
- `_truncd(s, w)` / `_fit(s, w)` — display-width-aware truncate / truncate-then-pad,
  the replacements for `f"…".ljust(w)[:w]`. This is what lets a two-column emoji live
  in a one-`str`-char cell without drifting a selection bar or a pane divider.
  **Pure, unit-tested.**
- `_ICONS` + `_icon(name)` — three display tiers per action/section icon: emoji
  (default), unicode symbol (`GENESEED_TUI_PLAIN`), ASCII (`GENESEED_TUI_ASCII`).
  Every emoji is a single-codepoint, supplementary-plane glyph (width 2, no FE0F) so
  `_fit`'s math is exact. **Tier purity unit-tested.**
- `_MARKS` + `_mark(kind)` — ok/fail/warn/info status glyph in the active tier
  (`✅/❌/⚠️/ℹ️` → `✓/✗/!/·` → `+/x/!/-`). Fixes a latent bug: the doctor view
  hardcoded `✓/✗`, ignoring `GENESEED_TUI_ASCII`.
- `_spin(i)` — one braille spinner frame (`|/-\` under ASCII).
- `_logo_lines()` + `_LOGO_FONT` — the `GENESEED` wordmark as 5 block-letter rows
  (`█`, or `#` under ASCII). **Rectangularity unit-tested.**
- `_splash` / `_maybe_splash` — a brief, skippable intro: the wordmark reveals row by
  row in the accent colour, a strand sweeps beneath, the theme sigil settles, then it
  clears to the menu. Shown at most once per process; any key skips.

## Display tiers (env)

- `GENESEED_TUI_ASCII=1` — pure ASCII; no emoji, no box-drawing, no motion (unchanged
  behaviour, now also covers the icons/marks). Wins over everything.
- `GENESEED_TUI_PLAIN=1` — calm, deterministic look: unicode box/symbols kept, emoji
  and all animation dropped. Good for CI / screenshots.
- (default) — full emoji icons + splash + spinners.

## Applied to

- `_topbar`/`_botbar` — width-aware fill; `🧬` badge in emoji mode.
- `_menu` (incl. theme picker) — `_fit`/`_truncd` for every padded/sliced row.
- `_tui_loop` (browse) — emoji section + row icons; width-aware list rows.
- `_doctor_view` — spinner on the progress line; `_mark` for the result list.
- `_info_screen` / `_status_view` — `_mark` icons.
- `_bootstrap_draw` — per-frame spinner on the running step and footer.
- `_MENU_ACTIONS` / `_SETTINGS_ACTIONS` — a leading icon per action (key unchanged).
- `_main_menu` / `_tui_loop` — show `_maybe_splash` once.

## Out of scope

Per-screen layout/row-math changes, new screens, Windows curses support, theming the
splash wordmark per-theme (it uses the theme accent colour + sigil, not a custom logo).

## Verification

1. New unit tests: `_dwidth`, `_fit`/`_truncd`, icon/mark tier purity, `_logo_lines`.
2. `python -m unittest discover -s tests` — full suite green (81).
3. `python rituals/harness.py --help` — imports clean.
4. Visual (tmux capture, 100×32): splash reveal, emoji main menu, browse panel
   alignment, health-check `✅`, theme picker — all render and align; `GENESEED_TUI_PLAIN`
   drops emoji/motion; `GENESEED_TUI_ASCII` stays ASCII-clean.

## Worklog

- [x] width primitives (`_dwidth`/`_truncd`/`_fit`) + unit tests
- [x] icon/mark tiers (`_ICONS`/`_icon`/`_MARKS`/`_mark`) + tier-purity tests
- [x] splash (`_logo_lines`/`_splash`/`_maybe_splash`) + spinner (`_spin`)
- [x] wire into topbar/botbar, `_menu`, `_tui_loop`, doctor/info/status/bootstrap, menus
- [x] `GENESEED_TUI_PLAIN` toggle + help-overlay note
- [x] unittest (81) + --help + tmux visual pass
- [ ] commit + push
