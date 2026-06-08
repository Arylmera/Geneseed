# Spec — TUI polish-to-professional workplan

> Generated 2026-06-08 from a multi-agent workflow: 4 web-research agents
> (layout/density, color/theming, motion, iconography — drawing on lazygit/k9s/
> btop/Lipgloss/Textual) + 4 code-audit agents (structure, icon coverage, motion,
> color/fallback) reading the live TUI → 1 synthesis. 9 agents, ~605k tokens.
>
> **Hard constraints:** pure stdlib `curses` + `unicodedata`, NO pip deps ever
> (no rich/textual/blessed/windows-curses); the three display tiers
> (`default` emoji+motion / `GENESEED_TUI_PLAIN` / `GENESEED_TUI_ASCII`) must
> survive every change. Scope is `rituals/harness.py` (~L1452–3210). Tests are
> stdlib unittest (88; `python -m unittest discover -s tests`); doctor stays green.
>
> **Caveat:** curses is unavailable on Windows (this dev box), so changes are
> verified by unit tests + `--help` import + `doctor`; **visual QA requires a Unix
> terminal** (the work machine), as with both prior TUI specs.
>
> **Status (2026-06-08): FULLY EXECUTED, commits `2a019ed..HEAD`.** Every actionable
> task landed, including the two originally deferred: **2.5** (`_mcp_view` now framed,
> content reflowed inside the box) and **4.2** (`_run_logged` polls the pipe on an
> 80 ms `select` timeout so the spinner ticks during silent subprocess steps; main
> thread keeps sole ownership of curses; `os.read` gives a clean EOF; readline
> fallback for any non-`select` platform). Only **5.2** (smoothed interpolation) and
> **3.5** (dual-state focus borders) were dropped on judgement — see the end of each
> phase. 91 unittests pass; `doctor --all` clean; `--help` imports clean.
> **Visual QA still required** on a Unix terminal across all three tiers (default /
> `GENESEED_TUI_PLAIN` / `GENESEED_TUI_ASCII`) — especially the new `_mcp_view` frame
> (row reflow done blind) and the bootstrap spinner during a real `update`.

## Verdict

~80% of the way to professional. The 2026-06-08 refresh delivered the hard
architecture (three-tier `_icon`/`_mark`/`_spin`/`_dwidth`/`_fit`, accent palettes,
shared `_topbar`/`_botbar`/`_scrollbar`/`_vdiv`/`_draw_box`, atomic refresh). What
remains is **consistency leakage, not missing architecture**: a few screens
(`_mcp_view`, `_memory_view`, `_diff_view`, `_bootstrap_draw`) bypass the shared
primitives with hardcoded glyphs, byte-width `.ljust()[:]` slices, and bare
`erase()`; the palette has no WARN slot (warnings render as red FAIL); the
doctor/bootstrap spinners **freeze during the actual work** (worst artifact — a
"working" screen that visibly hangs); and PLAIN mode leaks braille motion it should
suppress. Surgical edits + two tiny primitives. Polish, not a rewrite.

---

## Phase 0 — New shared primitives (do first; later phases depend on these)

| # | Task | Function | Sev | Eff |
|---|------|----------|-----|-----|
| 0.1 | Add **pair 8** `init_pair(8, COLOR_YELLOW, -1)`, `pal["WARN"]=cp(8)\|A_BOLD` (mono fallback `A_BOLD`); add `pal["MUTED"]=A_DIM` as a named slot | `_tui_palette` L1743 | high | S |
| 0.2 | Add `_addch(stdscr,y,x,c,attr=0)` bounds-guarded wrapper; refactor the `ch()` closures in `_draw_box`/`_vdiv`/`_tui_loop` to it | new near `_put` L1611 | low | S |
| 0.3 | Add `_hline(stdscr,pal,y,x,w,attr=None)` rule helper; replace the inline `("-" if _TUI_ASCII else "─")*(w-4)` literals | new; `_menu` L1905, `_mcp_view` L2600 | low | S |
| 0.4 | Add `'pending':('·','·','-')` to `_MARKS`; add `edited/added/missing`, `mcp_on/off/absent`, `badge` triples to `_ICONS` | `_MARKS` L1569, `_ICONS` L1540 | med | M |
| 0.5 | `_spin` no-motion branch: `if not _TUI_ANIM: return '·' if not _TUI_ASCII else '-'` | `_spin` L1583 | high | S |

---

## Phase 1 — Icon & glyph coverage ("fully iconned, no bare text, no hardcoded bypass")

| # | Task | Function | Sev | Eff |
|---|------|----------|-----|-----|
| 1.1 | Replace hardcoded `"🧬" if _TUI_EMOJI else _GLYPH["head"]` badge with `_icon('badge')` (`🧬/⬡/G`) | `_topbar` L1641 | med | S |
| 1.2 | Route `_diff_view` file-status `{edited:~,added:+,missing:-}` through `_mark('edited'/'added'/'missing')` | `_diff_view` L2299,L2337 | med | M |
| 1.3 | Route `_mcp_view` server-state `{enabled,disabled,absent}` through `_mark('mcp_on'/'mcp_off'/'mcp_absent')` | `_mcp_view` L2589 | low | M |
| 1.4 | `_bootstrap_draw.step_mark()` → `_mark`: running→`_spin(tick)`, else ok/fail/pending marks | `_bootstrap_draw` L2904 | low | S |
| 1.5 | Add `'info'` branch to `_doctor_view` result loop (`_mark('info')`+`pal["MUTED"]`) so tips match `_info_screen` | `_doctor_view` L2130 | low | S |
| 1.6 | Prefix `_memory_view` left-list rows with `_icon('memory')` / sel glyph | `_memory_view` L2469 | low | M |
| 1.7 | Remove dead `'agent'` key from `_glyphs()` (collides with `head` ◆; superseded by `_ICONS['agent']`); update its test | `_glyphs` L1467; tests L707 | low | S |

---

## Phase 2 — Width-safety & layout consistency (kills residual `.ljust()[:]` slices)

| # | Task | Function | Sev | Eff |
|---|------|----------|-----|-----|
| 2.1 | **Fix missing left-pane scroll in `_memory_view`** — add `list_top` state + clamp + `_scrollbar` (facts past the fold are unreachable today) | `_memory_view` L2465 | high | M |
| 2.2 | `_fit(...,dx)` for memory name row | `_memory_view` L2469 | low | S |
| 2.3 | `_fit(...,dx)` for diff row | `_diff_view` L2337 | low | S |
| 2.4 | `_fit(...,w-4)` for mcp row | `_mcp_view` L2595 | low | S |
| 2.5 | **Frame `_mcp_view`** (only interactive screen with no box) via `_draw_box` + `_hline` | `_mcp_view` L2584 | med | M |
| 2.6 | `_bootstrap_progress` footer → `_botbar` | `_bootstrap_progress` L2979 | low | S |
| 2.7 | `_too_small` takes `pal`, draws with `pal["TITLE"]` not bare `A_BOLD` | `_too_small` L1670 + callers | low | S |

---

## Phase 3 — Color hierarchy & focus treatment

| # | Task | Function | Sev | Eff |
|---|------|----------|-----|-----|
| 3.1 | Route `_info_screen` `warn` from `pal["FAIL"]` to `pal["WARN"]` (`_status_view` inherits free) | `_info_screen` L2185 | med | S |
| 3.2 | SEL → black-on-accent `init_pair(3,COLOR_BLACK,acc)` so green = OK only | `_tui_palette` L1757 | low | S |
| 3.3 | Detail-pane first line uses `pal["HEAD"]` (accent) not `pal["TITLE"]` (yellow) | `_tui_loop` L2773, `_memory_view` L2481 | low | S |
| 3.4 | Splash sigil drawn with `pal["HEAD"]` (accent) not `pal["OK"]` (green) | `_splash` L3117 | low | S |
| 3.5 | Dual-state border focus: focused pane divider/title `pal["HEAD"]`, unfocused `pal["FRAME"]` | `_tui_loop`/`_diff_view`/`_memory_view` | med | M |

---

## Phase 4 — Motion: progress that doesn't freeze, suppressed in calm tiers

Every task states frame timing + CPU/tier discipline.

| # | Task | Function | Sev | Eff |
|---|------|----------|-----|-----|
| 4.1 | **Clock-driven doctor spinner** — run `_doctor_collect` on a `threading.Thread`; main loops `stdscr.timeout(80);getch()` redrawing `_spin(tick)` at 80 ms until an `Event` is set, then join. `_TUI_ANIM`-gated (static, no loop, when off). Fixes the worst freeze | `_doctor_view` L2085 | high | L |
| 4.2 | **Clock-driven bootstrap spinner** — same background-ticker so a silent subprocess step still animates; reset `tick=0` in `_run_steps`. 80 ms, gated | `_run_logged` L2944, `_run_steps` L2951 | med | L |
| 4.3 | `_bootstrap_draw` → `_clear_frame` instead of bare `erase()` (kills double-width ghost cells) | `_bootstrap_draw` L2892 | med | S |
| 4.4 | Width-stable splash timing: cap strand sweep ≈700 ms any width; cap post-sigil hold ~250–300 ms | `_splash` L3109 | low | S |
| 4.5 | **Diff loading placeholder** — one-shot `_spin(0)+"computing diff…"` before `_diff_collect()` (no loop) | `_diff_view` L2287 | med | S |
| 4.6 | Route TUI **build/update** keys through `_run_steps`/`_bootstrap_progress` instead of `endwin()+run()+input()` (stay inside curses) | `_tui_loop` L2831, `_main_menu` L3175 | med | M |

---

## Phase 5 — Determinate progress polish (nice-to-have; only after 0–4)

| # | Task | Function | Sev | Eff |
|---|------|----------|-----|-----|
| 5.1 | 8-step sub-character block fill `▏▎▍▌▋▊▉█` in `_progress_bar` (emoji/plain tiers; `#/-` ASCII) | `_progress_bar` L1778 | low | M |
| 5.2 | Smoothed progress interpolation (`_displayed_frac += (target-_displayed_frac)*0.25`/frame; instant in calm tiers) | `_doctor_view`/`_bootstrap_draw` | low | M |

---

## Phase 6 — Tests & doctor gate

| # | Task | Sev | Eff |
|---|------|-----|-----|
| 6.1 | Pure tests: `_spin` static under `_TUI_ANIM` false; new `_ICONS`/`_MARKS` keys single-codepoint width-2 emoji + ASCII-pure tier 3 (extend `test_icon_and_mark_honour_display_tier` L741) | med | S |
| 6.2 | `_tui_palette` test: `WARN`/`MUTED` keys exist + degrade in mono; update `_glyphs` key-set test (1.7) | low | S |
| 6.3 | Full suite + `doctor --all` green; manual 3-tier smoke on a Unix terminal for each touched screen | high | M |

---

## DECISION FLAGGED — Windows / no-curses fallback

Curses is Unix-only; Windows falls to the line-based wizard. **Recommendation: keep
it line-based, do NOT invest in parity** — `windows-curses` is a forbidden pip dep,
and the line wizard already covers the real Windows entry path with tier-aware ASCII
marks. The only near-zero-cost touch: **(optional, S)** turn `cmd_menu`'s Windows
branch (L3193) into a clear CTA (`"Geneseed — no interactive menu on Windows. Run:
python harness.py setup"` + subcommand list).

---

## Explicitly NOT doing (rejected as gimmickry / CPU waste / constraint violation)

- No pip TUI lib (rich/textual/blessed/urwid/windows-curses) — hard constraint.
- No per-keystroke selection-pulse (a forced `napms` on every j/k makes nav feel
  laggy — opposite of professional; the full-width SEL bar already gives feedback).
- No Nerd-Font/PUA tier baked into a default (tofu on unpatched fonts); document the
  intended order (ascii < plain < emoji < nerd) as a comment only.
- No new VS-16 emoji (keep new glyphs single-codepoint width-2 so `_fit` stays exact).
- No proportional scroll thumb, marquee/indeterminate bar, `?` help overlay,
  portrait reflow, or truecolor gradients — net-new features beyond polish; defer.
