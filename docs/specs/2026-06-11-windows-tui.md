# Spec — Native Windows TUI (stdlib VT backend)

> Bring the full-screen curses TUI to native Windows at full parity — every screen
> and animation — using only the Python stdlib (no `pip install`), and degrading
> gracefully to the existing line wizard when a VT console isn't available. A small
> `rituals/_winterm.py` shim emulates the bounded `curses` subset the screens use and
> is swapped in via `sys.modules["curses"]`, so the ~20 screen functions and the Unix
> path stay untouched.

**Date:** 2026-06-11
**Status:** implemented (verified 2026-06-15)
**Scope:** Additive — a new stdlib-only backend module plus relaxed platform gates.
No new screens, no keybinding changes, no screen-geometry changes. Pure-stdlib only
(Decision: "no third-party dependencies, ever" — so **no** `windows-curses`,
`rich`, or `textual`). Closes the "Windows curses support" item left out of scope by
[2026-06-08-tui-modern-refresh](2026-06-08-tui-modern-refresh.md).

## Problem

The full-screen TUI (main menu, browse/control panel, doctor, setup form, bootstrap
progress) is built on Python's `curses`, which ships in the Unix stdlib but **not** on
Windows. So the code gates it off and Windows users fall back to a line wizard:

```python
# rituals/harness.py:1474
if not sys.platform.startswith("win") and sys.stdin.isatty():
    ... curses.wrapper(_setup_tui) ...   # else → line wizard
```

Windows 10+ consoles *can* render the same UI: they support ANSI/VT escape sequences
once `ENABLE_VIRTUAL_TERMINAL_PROCESSING` is enabled, and `msvcrt` provides key input —
both stdlib. The blocker is purely the missing `curses` module, not the terminal.

## Constraints (decided during brainstorming)

- **Strict zero-install.** Windows TUI must run on stdlib alone. No `pip install`,
  ever — `windows-curses` is rejected even as an optional accelerator.
- **Full parity.** All screens *and* animations (spinners, validation animation, the
  `theme_anim` intro), with the same colors and box-drawing as Unix.
- **Modern consoles + graceful fallback.** Target Windows Terminal and Win10 1809+
  conhost. If VT can't be enabled or output is redirected, fall back to the existing
  line wizard / headless `status` — never crash, never regress.

## Approach

**Chosen — A: curses-compatible shim.** A new pure-stdlib `rituals/_winterm.py`
implements the exact, *verified* subset of the `curses` API the screens use, backed by
VT escapes and `msvcrt`. The screens keep speaking "curses" unchanged.

**Alternative — B: backend abstraction.** Define a `Terminal` protocol
(put/box/getkey/color/refresh/size), refactor all ~20 screens onto it, implement it
twice (curses adapter + VT adapter). Architecturally tidier long-term, but it rewrites
the *working* Unix TUI — a wide diff with real regression risk — and the screens use
curses idioms directly (`color_pair`, `ACS_*`), making the abstraction surface broad.
Not worth destabilizing the proven path for a second backend that may never be added.

A is chosen because the curses surface is small and bounded (verified below), the risk
concentrates in one isolated, unit-testable module, the Unix path is byte-for-byte
untouched, and full parity falls out for free since the same screen code runs
everywhere.

## Integration seam

`harness.py` is run as a script (`py rituals\harness.py <cmd>`), so `rituals/` is
`sys.path[0]`, and `import curses` happens *locally inside ~12 functions*, not at module
top. One insertion near the top of `harness.py` therefore covers every call site with
**no screen-function edits**:

```python
try:
    import curses  # noqa: F401  (stdlib on Unix)
except ImportError:                       # Windows: no stdlib curses
    import _winterm
    sys.modules["curses"] = _winterm      # every later `import curses` resolves here
```

The explicit `not sys.platform.startswith("win")` guards (e.g. harness.py:1474) relax
to "attempt the TUI on Windows too; fall back on failure".

## Verified curses surface (what the shim must provide)

Enumerated directly from `harness.py` — the shim implements only this, nothing more.

**Module:** `wrapper`, `error`, `napms`, `curs_set`, `def_prog_mode`,
`reset_prog_mode`, `endwin`; color: `start_color`, `use_default_colors`, `has_colors`,
`init_pair`, `color_pair`, `COLOR_BLACK/RED/GREEN/YELLOW/BLUE/MAGENTA/CYAN/WHITE`;
attrs: `A_BOLD`, `A_DIM`, `A_REVERSE`; glyphs: `ACS_HLINE/VLINE/ULCORNER/URCORNER/`
`LLCORNER/LRCORNER/TTEE/BTEE/UARROW/DARROW`; keys: `KEY_UP/DOWN/HOME/END/NPAGE/PPAGE/`
`ENTER/BACKSPACE`.

**Window (`stdscr`):** `getmaxyx`, `addnstr`, `addch`, `hline`, `vline`, `move`,
`erase`, `clearok`, `refresh`, `curs_set`, `keypad`, `nodelay`, `timeout`, `getch`.

No `get_wch`, pads, or subwindows are used.

## Component design — `rituals/_winterm.py`

- **`enable_vt()`** — `ctypes` → `kernel32.GetConsoleMode` / `SetConsoleMode` with
  `ENABLE_VIRTUAL_TERMINAL_PROCESSING` on the stdout handle. Reconfigure stdout to
  UTF-8. Returns a `restore()` closure; raises `Unsupported` if the handle isn't a
  console or the mode can't be set.
  **Note (verified during implementation):** `theme_anim._anim_ok()` *already* enables
  VT on Windows via the `os.system("")` trick, so the animated theme intro needs **no
  change** — the spec's plan to route it through `enable_vt()` was unnecessary.
- **`wrapper(fn)`** — `enable_vt()`; enter alt-screen (`\x1b[?1049h`); hide cursor;
  build the `stdscr` window; `try: fn(stdscr)` `finally:` restore (show cursor,
  `\x1b[?1049l`, restore console mode). Mirrors `curses.wrapper`'s cleanup guarantee.
- **`_Window`** — the `stdscr` object. Buffers per-frame writes; `refresh()` flushes
  one batched `stdout.write` + flush (minimizes flicker). **Full repaint each
  `refresh()`** — valid because the screens repaint only on a keypress/frame tick
  (`harness.py:1773-1777`), so curses' optimized diff refresh is unnecessary. Methods:
  - `getmaxyx()` → `os.get_terminal_size()` (rows, cols).
  - `addnstr`/`addch` → cursor-position escape `\x1b[{y+1};{x+1}H` + SGR-wrapped text;
    coordinates clamped (the existing `_put` also bounds-guards and swallows
    `curses.error`).
  - `hline`/`vline` → repeat the glyph; `move` → record cursor; `erase`/`clearok` →
    `\x1b[2J\x1b[H`.
  - `keypad`, `nodelay(flag)` (= `timeout(0)`), `timeout(ms)`, `curs_set`.
- **Color / attrs** — `init_pair(id, fg, bg)` records a table; `color_pair(id)` and
  `A_BOLD/A_DIM/A_REVERSE` return OR-able integer tokens (curses semantics: attrs
  combine with `|`). At draw time a token → SGR: `30-37` fg / `40-47` bg + `1` bold /
  `2` dim / `7` reverse. `COLOR_*` = `0-7`.
- **ACS glyphs** — mapped to unicode box characters, honoring the existing
  `GENESEED_TUI_ASCII` path (under ASCII mode `_bx` already returns plain `+ - |`, so
  the ACS constants are largely bypassed; the shim still defines them as safe
  fallbacks).
- **`getch()`** — honors `timeout`/`nodelay`: poll `msvcrt.kbhit()` until the deadline;
  return `-1` on timeout. On a key, read `msvcrt.getwch()`; if it's the `0x00`/`0xe0`
  prefix, read the second char and map to `KEY_UP/DOWN/HOME/END/NPAGE/PPAGE`; map
  `\r`→`KEY_ENTER`, `\b`→`KEY_BACKSPACE`; otherwise return `ord(ch)`.
- **`napms(ms)`** → `time.sleep(ms/1000)`. **`error`** → an exception class matching the
  `except curses.error` guards. **`def_prog_mode`/`reset_prog_mode`/`endwin`** →
  save/restore console state around shelling out (e.g. the doctor screen running an
  external command).

## Data / control flow

Unchanged from Unix. A screen function receives `stdscr`, draws via
`addnstr`/`addch`/`hline` + attrs, calls `refresh()`, then blocks on `getch()` (or
polls with a `timeout` for animation frames). The only difference is which object backs
`stdscr` — real curses on Unix, `_winterm._Window` on Windows.

## Error handling / fallback

`enable_vt()` is the gate. If it fails or `not sys.stdout.isatty()`, `wrapper` raises
`_winterm.Unsupported`. The call sites already catch curses failures and check
`isatty()` to drop to the line wizard / `_ask_choice` / headless `status`
(harness.py:1474, 1483-1484, 1550-1564); those guards are extended so a Windows
`Unsupported`/any failure routes to the same existing fallback. Net: capable consoles
get the TUI, everyone else gets today's behavior, nothing regresses.

## Testing

1. **Unit tests for `_winterm`** (run on any OS by mocking `msvcrt`/`ctypes`):
   - SGR generation for each attr/color-pair combination.
   - `KEY_*` translation from `msvcrt` byte/prefix sequences.
   - coordinate → escape-sequence math (incl. clamping).
   - `getch`/`timeout`/`nodelay` state machine (timeout returns `-1`).
   - `wrapper` enable/restore ordering, including the exception path.
2. **Integration smoke (replaces the drift guard):** during implementation the
   "render via real curses and compare" idea proved not cleanly implementable — real
   curses draws to the terminal, not to an inspectable string buffer, so there is no
   apples-to-apples comparison. Instead, drive a real harness screen (`_menu`) through
   the shim with scripted input and an in-memory stream, asserting it renders the
   expected content and returns/cancels correctly. The shim is installed as `curses`
   for the test, so harness' internal `import curses` resolves to it — runs on any OS
   and exercises the seam + shim + real screen code end-to-end.
3. **Existing suite stays green** (`python -m unittest discover -s tests`), including
   the headless `status` / line-wizard fallback tests.
4. **Manual smoke matrix:** Windows Terminal + conhost on Win10/11 × {main menu, browse
   panel, doctor, setup form, bootstrap} × {resize, narrow "too small" guard at
   harness.py:1823, `GENESEED_TUI_ASCII`, `GENESEED_TUI_PLAIN`, `NO_COLOR`}.

## Out of scope

- Legacy / no-VT conhost rendering via the Win32 console API (`SetConsoleCursorPosition`,
  attribute words). Constraint is modern + graceful fallback.
- Mouse input; resize-event handling beyond re-reading size each frame.
- Any new screens or layout/geometry changes — parity only.
- The shim implements only the verified surface; a missing call is added during
  implementation if planning/coding uncovers one.

## Docs to update on completion

- `README.md` — the "Windows: … The full-screen TUI menu is Unix-only; on Windows use
  the guided `setup` wizard" note becomes "works natively on a VT-capable console".
- `SETUP.md` — same correction where it states the curses form is Unix-only.

## Worklog

- [x] `_winterm.py`: `enable_vt`, `_Window`, color/attr/ACS/KEY tables, `getch` state machine, `wrapper`
- [x] `sys.modules["curses"]` seam in `harness.py`; relax `win` platform gates (5 TUI gates + cmd_tui/cmd_menu + CLI help)
- [x] ~~route `theme_anim.play_line` through `enable_vt()`~~ — not needed; it already enables VT via `os.system("")`
- [x] unit tests (`_winterm`, 26) + integration smoke (`_menu` via shim, 2) — replaces the drift guard
- [x] full unittest suite green (141) + `--help` import check (seam loads shim on Windows)
- [x] real-platform smoke: graceful fallback verified (`tui`/`menu` off a non-VT console, `enable_vt` raises `Unsupported`)
- [ ] manual visual pass on a live Windows Terminal (interactive; outstanding — needs a human console)
- [x] update README.md / SETUP.md Windows notes
- [ ] commit + push
