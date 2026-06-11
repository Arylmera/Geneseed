"""A pure-stdlib, curses-compatible shim for VT-capable Windows consoles.

Python ships `curses` in the Unix stdlib but not on Windows, so the Geneseed
full-screen TUI (built on curses) was Unix-only. This module emulates the exact,
bounded subset of the `curses` API that `harness.py` uses, backed by ANSI/VT escape
sequences and `msvcrt` key input — both stdlib. It is swapped in by harness.py via
`sys.modules["curses"]` when the real module is missing, so the ~20 screen functions
keep speaking "curses" unchanged.

Scope is deliberate: only the calls harness.py actually makes (verified against the
source) are implemented. Rendering uses a "full repaint per refresh" model — valid
because the screens redraw only on a keypress/frame tick, so curses' optimized diff
refresh is unnecessary. Box glyphs travel as chtype-style ints (`ACS_* | attr`), the
same packing real curses uses, and are decoded back into a glyph + SGR style here.

On a non-Windows host the module still imports cleanly (so the test suite can run
everywhere); `msvcrt`/Win32 access is deferred to call time, and `wrapper` raises
`Unsupported` when no VT console is available so callers fall back to the line wizard.
"""

from __future__ import annotations

import os
import sys
import time

try:
    import msvcrt as _MSVCRT
except ImportError:               # non-Windows: imported for tests, never used at runtime
    _MSVCRT = None


# ── exceptions ───────────────────────────────────────────────────────────────
class error(Exception):
    """Mirror of curses.error — the bounds-guard `except curses.error` catches this."""


class Unsupported(RuntimeError):
    """Raised by `wrapper`/`enable_vt` when no VT-capable console is available, so the
    caller can fall back to the line-based wizard / headless status."""


# ── colour / attribute model ─────────────────────────────────────────────────
# chtype layout (bits): 0-7 glyph byte · 8 ALTCHARSET · 9-11 attrs · 12-19 colour pair.
# Ranges are disjoint so `ACS_HLINE | color_pair(1) | A_BOLD` round-trips losslessly.
_ALTCHARSET = 1 << 8
A_BOLD = 1 << 9
A_DIM = 1 << 10
A_REVERSE = 1 << 11
_PAIR_SHIFT = 12
_PAIR_MASK = 0xFF << _PAIR_SHIFT
_ATTR_MASK = A_BOLD | A_DIM | A_REVERSE | _PAIR_MASK

COLOR_BLACK, COLOR_RED, COLOR_GREEN, COLOR_YELLOW = 0, 1, 2, 3
COLOR_BLUE, COLOR_MAGENTA, COLOR_CYAN, COLOR_WHITE = 4, 5, 6, 7

# pair id -> (fg, bg); fg/bg of -1 means "terminal default" (no SGR code for that side).
_PAIRS: dict[int, tuple[int, int]] = {0: (-1, -1)}


def _reset_pairs() -> None:
    """Clear the colour-pair table (used by tests; harness re-inits via _tui_palette)."""
    _PAIRS.clear()
    _PAIRS[0] = (-1, -1)


def start_color() -> None:
    return None


def use_default_colors() -> None:
    return None


def has_colors() -> bool:
    return True


def init_pair(n: int, fg: int, bg: int) -> None:
    _PAIRS[n] = (fg, bg)


def color_pair(n: int) -> int:
    return (n & 0xFF) << _PAIR_SHIFT


def _sgr(attr: int) -> str:
    """Translate a chtype's attribute bits into an SGR escape, or "" for plain text."""
    codes: list[str] = []
    if attr & A_REVERSE:
        codes.append("7")
    if attr & A_BOLD:
        codes.append("1")
    if attr & A_DIM:
        codes.append("2")
    fg, bg = _PAIRS.get((attr & _PAIR_MASK) >> _PAIR_SHIFT, (-1, -1))
    if fg is not None and fg >= 0:
        codes.append(str(30 + fg))
    if bg is not None and bg >= 0:
        codes.append(str(40 + bg))
    return "\x1b[" + ";".join(codes) + "m" if codes else ""


# ── box / line glyphs (chtype ints with the ALTCHARSET bit) ──────────────────
ACS_ULCORNER = _ALTCHARSET | 1
ACS_URCORNER = _ALTCHARSET | 2
ACS_LLCORNER = _ALTCHARSET | 3
ACS_LRCORNER = _ALTCHARSET | 4
ACS_TTEE = _ALTCHARSET | 5
ACS_BTEE = _ALTCHARSET | 6
ACS_HLINE = _ALTCHARSET | 7
ACS_VLINE = _ALTCHARSET | 8
ACS_UARROW = _ALTCHARSET | 9
ACS_DARROW = _ALTCHARSET | 10
_ACS_CHARS = {1: "┌", 2: "┐", 3: "└", 4: "┘", 5: "┬", 6: "┴",
              7: "─", 8: "│", 9: "↑", 10: "↓"}


def _glyph_of(ch) -> str:
    """A char/ACS-int/ord-int → the single display character it denotes."""
    if isinstance(ch, str):
        return ch
    if ch & _ALTCHARSET:
        return _ACS_CHARS.get(ch & 0xFF, "?")
    return chr(ch & 0xFF)


# ── key constants & translation ──────────────────────────────────────────────
# Real ncurses values; all > 255 so they never collide with a byte ordinal.
KEY_DOWN, KEY_UP, KEY_LEFT, KEY_RIGHT = 258, 259, 260, 261
KEY_HOME, KEY_BACKSPACE = 262, 263
KEY_NPAGE, KEY_PPAGE, KEY_ENTER, KEY_END = 338, 339, 343, 360

# msvcrt sends extended keys as a \x00 / \xe0 prefix followed by this second char.
_EXT = {"H": KEY_UP, "P": KEY_DOWN, "K": KEY_LEFT, "M": KEY_RIGHT,
        "G": KEY_HOME, "O": KEY_END, "I": KEY_PPAGE, "Q": KEY_NPAGE}


def _translate_key(ch: str, second):
    """Map a getwch() result to a curses-style code. Plain keys → their ordinal
    (so ESC=27, Enter=13, Backspace=8 match harness' comparisons); extended keys →
    a KEY_* sentinel; an unknown extended code → -1 (ignored)."""
    if ch in ("\x00", "\xe0"):
        return _EXT.get(second, -1)
    return ord(ch)


# ── VT enable (Windows console) ──────────────────────────────────────────────
_ENABLE_VT = 0x0004  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
_STD_OUTPUT = -11


def enable_vt(stream):
    """Enable ANSI/VT processing on the console behind `stream` and return a `restore()`
    callable. Raises `Unsupported` when there is no real console (output redirected, or
    a non-Windows host) so callers degrade to the line wizard. Shared with theme_anim
    so the animated intro renders on Windows too."""
    if not (sys.platform.startswith("win") and getattr(stream, "isatty", lambda: False)()):
        raise Unsupported("no VT-capable console")
    import ctypes

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.GetStdHandle(_STD_OUTPUT)
    prev = ctypes.c_uint32()
    if not kernel32.GetConsoleMode(handle, ctypes.byref(prev)):
        raise Unsupported("GetConsoleMode failed")
    if not kernel32.SetConsoleMode(handle, prev.value | _ENABLE_VT):
        raise Unsupported("SetConsoleMode failed")
    try:                          # box-drawing / emoji need a UTF-8 stream
        stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    def restore():
        kernel32.SetConsoleMode(handle, prev.value)

    return restore


# ── the window (stdscr) ───────────────────────────────────────────────────────
_ENTER_ALT, _EXIT_ALT = "\x1b[?1049h", "\x1b[?1049l"
_HIDE_CURSOR, _SHOW_CURSOR = "\x1b[?25l", "\x1b[?25h"


def _pos(y: int, x: int) -> str:
    """Cursor-position escape; curses' 0-based (y, x) → VT's 1-based (row, col)."""
    return f"\x1b[{y + 1};{x + 1}H"


class _Window:
    """The stdscr stand-in. Buffers per-frame writes; `refresh()` flushes them in one
    write. `rows`/`cols` may be pinned (tests); otherwise size is read live."""

    def __init__(self, stream, rows: int | None = None, cols: int | None = None):
        self._stream = stream
        self._rows, self._cols = rows, cols
        self._buf: list[str] = []
        self._timeout = -1          # -1 blocking · 0 nodelay · >0 milliseconds
        self._msvcrt = _MSVCRT

    # -- geometry -------------------------------------------------------------
    def getmaxyx(self) -> tuple[int, int]:
        if self._rows is not None and self._cols is not None:
            return self._rows, self._cols
        try:
            size = os.get_terminal_size()
            return size.lines, size.columns
        except OSError:
            return 24, 80

    # -- drawing --------------------------------------------------------------
    def addnstr(self, y: int, x: int, s: str, n=None, attr: int = 0) -> None:
        if n is not None:
            s = s[:max(0, n)]
        style = _sgr(attr)
        self._buf.append(_pos(y, x) + (style + s + "\x1b[0m" if style else s))

    def addstr(self, y: int, x: int, s: str, attr: int = 0) -> None:
        self.addnstr(y, x, s, None, attr)

    def addch(self, y: int, x: int, ch, attr: int = 0) -> None:
        style = _sgr(attr)
        g = _glyph_of(ch)
        self._buf.append(_pos(y, x) + (style + g + "\x1b[0m" if style else g))

    def hline(self, y: int, x: int, ch, n: int) -> None:
        style = _sgr(ch & _ATTR_MASK if isinstance(ch, int) else 0)
        g = _glyph_of(ch)
        run = g * max(0, n)
        self._buf.append(_pos(y, x) + (style + run + "\x1b[0m" if style else run))

    def vline(self, y: int, x: int, ch, n: int) -> None:
        style = _sgr(ch & _ATTR_MASK if isinstance(ch, int) else 0)
        g = _glyph_of(ch)
        for i in range(max(0, n)):
            self._buf.append(_pos(y + i, x) + (style + g + "\x1b[0m" if style else g))

    def move(self, y: int, x: int) -> None:
        self._buf.append(_pos(y, x))

    # -- screen state ---------------------------------------------------------
    def erase(self) -> None:
        self._buf.append("\x1b[2J\x1b[H")

    def clearok(self, flag: bool = True) -> None:
        # erase() already issues a full clear; the diff-refresh ghosting clearok guards
        # against on real curses can't occur with our full-repaint model, so this is a
        # no-op kept for API parity.
        return None

    def keypad(self, flag: bool = True) -> None:
        return None

    def nodelay(self, flag: bool) -> None:
        self._timeout = 0 if flag else -1

    def timeout(self, ms: int) -> None:
        self._timeout = ms

    def refresh(self) -> None:
        if self._buf:
            self._stream.write("".join(self._buf))
            self._buf.clear()
        try:
            self._stream.flush()
        except (ValueError, OSError):
            pass

    # -- input ----------------------------------------------------------------
    def _read_key(self):
        ch = self._msvcrt.getwch()
        if ch in ("\x00", "\xe0"):
            return _translate_key(ch, self._msvcrt.getwch())
        return _translate_key(ch, None)

    def getch(self):
        mv = self._msvcrt
        if mv is None:
            return -1
        t = self._timeout
        if t == 0:                                  # nodelay
            return self._read_key() if mv.kbhit() else -1
        if t is None or t < 0:                      # blocking
            while not mv.kbhit():
                time.sleep(0.005)
            return self._read_key()
        deadline = time.monotonic() + t / 1000.0    # timed
        while time.monotonic() < deadline:
            if mv.kbhit():
                return self._read_key()
            time.sleep(0.005)
        return -1


# ── module-level lifecycle (curses API parity) ───────────────────────────────
_ACTIVE: _Window | None = None


def wrapper(func, *args, **kwargs):
    """Enable VT, enter the alt-screen with the cursor hidden, run `func(stdscr, ...)`,
    and always restore the screen + console mode — mirroring curses.wrapper's guarantee.
    Raises `Unsupported` (before touching the screen) when no VT console is available."""
    global _ACTIVE
    stream = sys.stdout
    restore = enable_vt(stream)
    win = _Window(stream)
    _ACTIVE = win
    stream.write(_ENTER_ALT + _HIDE_CURSOR)
    stream.flush()
    try:
        return func(win, *args, **kwargs)
    finally:
        try:
            stream.write(_SHOW_CURSOR + _EXIT_ALT)
            stream.flush()
        finally:
            _ACTIVE = None
            restore()


def _emit_active(seq: str) -> None:
    """Write a control sequence to the active session's stream. A no-op when there is no
    active wrapper() session, so these never leak escapes to a plain/headless stdout."""
    if _ACTIVE is None:
        return
    try:
        _ACTIVE._stream.write(seq)
        _ACTIVE._stream.flush()
    except (ValueError, OSError):
        pass


def curs_set(visibility: int) -> int:
    _emit_active(_SHOW_CURSOR if visibility else _HIDE_CURSOR)
    return 1


def napms(ms: int) -> None:
    time.sleep(max(0, ms) / 1000.0)


def def_prog_mode() -> None:
    return None


def endwin() -> None:
    """Leave the TUI screen so a shelled-out command draws on the normal buffer."""
    _emit_active(_SHOW_CURSOR + _EXIT_ALT)


def reset_prog_mode() -> None:
    """Re-enter the TUI screen after a shelled-out command returns."""
    _emit_active(_ENTER_ALT + _HIDE_CURSOR)
