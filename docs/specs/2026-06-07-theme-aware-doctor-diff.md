# Theme-aware doctor & diff

**Date:** 2026-06-07
**Status:** approved

## Problem

A user who installs **one** theme is buried in noise from two tools that ignore
which theme they actually installed:

1. **`doctor`** with no `--theme` *sweeps all 8 themes* (a maintainer-grade check).
   One real concern is therefore echoed up to 8×. The post-install health check
   (`setup`) calls doctor this way, so a fresh install looks broken.
2. **`diff`** renders the "expected" copy in the **config/neutral** theme rather
   than the **deployed** theme. Every themed word then shows as a fake diff,
   drowning the genuine local edits the tool exists to surface.

Both are the same root mistake: the tools never read the `.geneseed-theme` marker
that `setup` already wrote. The source is correct — confirmed clean across all 8
themes. There is **no** need for per-theme source: structure is theme-independent
by design; a theme only swaps voice tokens.

## Fix

A single shared helper detects a directory's theme; doctor and diff both use it.

### `_theme_of_dir(dir) -> str | None`
Reads `dir/.geneseed-theme`; falls back to matching a theme's unique
`LOADED_SIGIL` in `dir/AGENT.md` (the existing `_theme_from_agent`). Replaces the
inlined detection in `_installed_defaults` (dedup / refactor).

### Doctor — default to the installed theme
- New pure helper `_themes_to_check(theme, all_themes, detected, available)`:
  explicit `--theme` wins; else, unless `--all` is given, scope to the detected
  installed theme; fall back to the full sweep when nothing is installed (fresh
  clone) or the detected theme is unknown.
- `_doctor_collect` gains `all_themes=False`; computes `detected` from
  `_installed_defaults()` only when no theme / not `--all`.
- `cmd_doctor` gains `--all`; prints a one-line note when scoped
  ("checked installed theme 'X'; run --all to sweep every theme").
- **The cross-theme parity check stays unconditional** — it is the cheap check
  that motivated the sweep (a voice token defined in one theme, missing in
  another). Scoping loses zero safety.
- All call sites inherit the new default: `setup` passes the just-installed
  theme; the TUI health check and the wizard fallback auto-scope.
- **CI uses `--all`** to keep the maintainer guarantee.

### Diff — render "expected" in the deployed theme
- `_diff_collect`: when `--theme` is absent, detect the deployed theme with
  `_theme_of_dir(target)`; keep config/neutral only as a last-resort fallback.

## Out of scope
- Publish/sync completeness (cause A) — not the issue here; source is clean.
- Collapsing/deduping multi-theme output — rejected; scoping fits the mental
  model better and is the recommended path.

## Tests
- `_theme_of_dir`: detects from marker; detects from sigil when marker absent.
- `_themes_to_check`: explicit theme; scoped to detected; `--all` sweeps;
  fallback to sweep when detected is unknown / absent.
