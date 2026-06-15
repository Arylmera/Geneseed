"""Geneseed harness — TUI rendering primitives: glyph/icon/mark tables, the
braille spinner, the logo font, width-aware truncation, and the low-level
curses helpers (boxes, bars, palette, scrollbar, theme preview/flair).

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives


_TUI_ASCII = bool(os.environ.get("GENESEED_TUI_ASCII"))

# One glyph table for the whole TUI — every non-ASCII glyph swaps to a plain-ASCII
# stand-in when GENESEED_TUI_ASCII is set (for fonts that render them as tofu). This is
# the single source of truth: screens read from `_GLYPH` and never hardcode a glyph.
def _glyphs(ascii_mode):
    """The TUI glyph table for the given mode — unicode by default, plain-ASCII
    stand-ins when ascii_mode is set. Pure, so it is unit-tested."""
    return {
        "sel":   ">" if ascii_mode else "▸",
        "up":    "^" if ascii_mode else "▴",
        "down":  "v" if ascii_mode else "▾",
        "head":  "*" if ascii_mode else "◆",
        "skill": "*" if ascii_mode else "✦",
        "law":   "#" if ascii_mode else "§",
    }


_GLYPH = _glyphs(_TUI_ASCII)
_SEL_G = _GLYPH["sel"]       # back-compat aliases
_MORE_G = _GLYPH["down"]

# Two display tiers layered on top of GENESEED_TUI_ASCII:
#   GENESEED_TUI_PLAIN  — calm, deterministic look: keep unicode box/symbols but drop
#                         the colourful emoji and all motion (good for CI/screenshots).
#   (default)           — full emoji icons + the splash/spinner animation.
# GENESEED_TUI_ASCII still wins (pure ASCII, no emoji, no box-drawing, no motion).
_TUI_PLAIN = bool(os.environ.get("GENESEED_TUI_PLAIN"))
_TUI_EMOJI = not (_TUI_ASCII or _TUI_PLAIN)
_TUI_ANIM = _TUI_EMOJI


def _dwidth(s: str) -> int:
    """Display width of `s` in terminal columns. East-Asian wide/fullwidth and every
    emoji codepoint (the supplementary symbol planes) occupy two columns; combining
    marks occupy zero; a U+FE0F emoji-presentation selector promotes the preceding
    single-width base to two (so ⚠️/ℹ️ measure correctly). Pure — unit-tested. This is
    what lets emoji live in framed/padded screens without shearing the alignment."""
    import unicodedata
    w = 0
    prev = 0
    for ch in s:
        if ch == "️":            # emoji-presentation selector: base becomes wide
            if prev == 1:
                w += 1
                prev = 2
            continue
        if ch == "︎":            # text-presentation selector: leave the base as-is
            continue
        if unicodedata.combining(ch):
            prev = 0
            continue
        cw = 2 if (ord(ch) >= 0x1F000 or unicodedata.east_asian_width(ch) in ("W", "F")) else 1
        w += cw
        prev = cw
    return w


def _truncd(s: str, width: int) -> str:
    """Truncate `s` to at most `width` display columns (never splits a glyph)."""
    if width <= 0:
        return ""
    if _dwidth(s) <= width:
        return s
    out, w = "", 0
    for ch in s:
        cw = _dwidth(ch)
        if w + cw > width:
            break
        out += ch
        w += cw
    return out


def _fit(s: str, width: int) -> str:
    """Truncate to `width` display columns, then pad with spaces to exactly `width`.
    The display-width-aware replacement for `f"…".ljust(width)[:width]` so an emoji
    (two columns, one `str` char) can't drift a selection bar or a pane divider. Pure."""
    s = _truncd(s, width)
    return s + " " * max(0, width - _dwidth(s))


# Action / section icons, three tiers picked by mode: emoji (default), unicode symbol
# (GENESEED_TUI_PLAIN), ASCII (GENESEED_TUI_ASCII). Every emoji is a single-codepoint,
# supplementary-plane glyph (display width 2, no FE0F variants) so _fit's math is exact.
_ICONS = {
    "browse":    ("📖", "▤", "#"),
    "diff":      ("🔍", "≈", "~"),
    "setup":     ("🧩", "⊞", "%"),
    "theme":     ("🎨", "◈", "*"),
    "update":    ("🔄", "↻", "@"),
    "bootstrap": ("🚀", "⇧", "^"),
    "build":     ("🔨", "⚒", "+"),
    "memory":    ("🧠", "❖", "&"),
    "status":    ("📊", "▦", "="),
    "settings":  ("🔧", "⚙", "%"),
    "quit":      ("🚪", "✕", "x"),
    "doctor":    ("🩺", "✚", "+"),
    "mcp":       ("🔌", "⊕", "&"),
    "link":      ("🔗", "∞", "&"),
    "unlink":    ("🔓", "∝", "-"),
    "uninstall": ("🗑", "⊗", "x"),
    "back":      ("🔙", "←", "<"),
    "agent":     ("🤖", "◆", "@"),
    "skill":     ("✨", "✦", "*"),
    "law":       ("📜", "§", "#"),
    "library":   ("📚", "❒", "L"),
    "notebook":  ("📓", "✎", "N"),
    "wiki":      ("📘", "▥", "W"),
    "config":    ("🧾", "⌗", "C"),
    "badge":     ("🧬", "⬡", "G"),
    "web":       ("🌐", "◍", "W"),
}


def _icon(name: str) -> str:
    """The icon for `name` in the active display tier (emoji / symbol / ASCII)."""
    emoji, sym, asc = _ICONS.get(name, ("•", "•", "*"))
    return asc if _TUI_ASCII else (emoji if _TUI_EMOJI else sym)


_MARKS = {"ok": ("✅", "✓", "+"), "fail": ("❌", "✗", "x"),
          "warn": ("⚠️", "!", "!"), "info": ("ℹ️", "·", "-"),
          # in-progress / not-yet-run step marker (the bootstrap/doctor step list)
          "pending": ("·", "·", "-"),
          # diff file-status — same semantics as git M/A/D, tier-aware so ASCII honours it
          "edited": ("📝", "~", "~"), "added": ("🆕", "+", "+"), "missing": ("🗑", "-", "-"),
          # MCP server state in _mcp_view (on / off / not-installed)
          "mcp_on": ("🟢", "●", "x"), "mcp_off": ("⚪", "○", "~"), "mcp_absent": ("⚫", "·", " ")}


def _mark(kind: str) -> str:
    """Status glyph for ok/fail/warn/info in the active tier. Used by the result panes
    so they honour GENESEED_TUI_ASCII (the old hardcoded ✓/✗ ignored it)."""
    emoji, sym, asc = _MARKS.get(kind, ("•", "·", "-"))
    return asc if _TUI_ASCII else (emoji if _TUI_EMOJI else sym)


_SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"          # braille spinner (single-width BMP), ASCII fallback below


def _spin(i: int) -> str:
    """One spinner frame for tick `i` — a braille whirl in the animated (emoji) tier,
    `|/-\\` under ASCII. In the calm tiers (PLAIN, or any non-animated mode) motion is
    suppressed: a static dot, so a per-keypress redraw never flickers a braille glyph
    where the tier contract promises no motion."""
    if not _TUI_ANIM:
        return "-" if _TUI_ASCII else "·"
    frames = "|/-\\" if _TUI_ASCII else _SPIN
    return frames[i % len(frames)]


# Block-letter masks for the GENESEED splash logo (5 rows, '#' = ink). Compact, hand
# tuned to ~7 cols/letter so the eight-letter word fits ~52 columns.
_LOGO_FONT = {
    "G": [" ### ", "#    ", "# ## ", "#  # ", " ### "],
    "E": ["#### ", "#    ", "###  ", "#    ", "#### "],
    "N": ["#   #", "##  #", "# # #", "#  ##", "#   #"],
    "S": [" ####", "#    ", " ### ", "    #", "#### "],
    "D": ["###  ", "#  # ", "#   #", "#  # ", "###  "],
}


def _logo_lines() -> list[str]:
    """The 'GENESEED' wordmark as 5 text rows (filled with the full-block glyph), or an
    ASCII '#'-rendered version under GENESEED_TUI_ASCII. Letters joined by a space gap."""
    ink = "#" if _TUI_ASCII else "█"
    rows = []
    for r in range(5):
        cells = [_LOGO_FONT[c][r].replace("#", ink) for c in "GENESEED"]
        rows.append(" ".join(cells))
    return rows


def _put(stdscr, y, x, s, attr=0):
    """The one bounds-guarded draw primitive for every TUI screen. Clips to the window
    and swallows the edge-cell curses.error so a write to the last column never crashes."""
    import curses
    h, w = stdscr.getmaxyx()
    if 0 <= y < h and 0 <= x < w:
        try:
            stdscr.addnstr(y, x, s, max(0, w - x - 1), attr)
        except curses.error:
            pass


def _addch(stdscr, y, x, c, attr=0):
    """Bounds-guarded single-cell draw — the `addch` sibling of `_put`. Clips to the
    window and swallows the edge-cell curses.error, so the box/divider primitives never
    crash on the last row/column. One source for the try/except every screen duplicated."""
    import curses
    h, w = stdscr.getmaxyx()
    if 0 <= y < h and 0 <= x < w:
        try:
            stdscr.addch(y, x, c, attr)
        except curses.error:
            pass


def _hline(stdscr, pal, y, x, w, attr=None):
    """A horizontal rule of `w` display columns at (y, x): ACS ─, or ASCII `-` under
    GENESEED_TUI_ASCII. One source for the inline `("-" if _TUI_ASCII else "─")*n` rules."""
    ch = "-" if _TUI_ASCII else "─"
    _put(stdscr, y, x, ch * max(0, w), pal["FRAME"] if attr is None else attr)


def _clear_frame(stdscr):
    """Erase the frame *and* force a full physical repaint on the next refresh.

    A plain `erase()` does a diff-based update: ncurses repaints only the cells it
    thinks changed. That leaves ghosts behind in two common cases — content from a
    different prior screen, and the trailing half of a double-width glyph (the themed
    sigils/emoji, the `·`/box-drawing characters) that a single-width blank doesn't
    cover. These screens redraw only on a keypress (`getch` blocks between frames), so
    a guaranteed full repaint per frame costs nothing and is flicker-free — unlike a
    continuously animating loop. `clearok(True)` is reset by the refresh it triggers,
    so it is set each frame."""
    stdscr.erase()
    stdscr.clearok(True)


def _topbar(stdscr, pal, text):
    """Top title bar (row 0), with the consistent badge glyph (🧬 in emoji mode)."""
    _, w = stdscr.getmaxyx()
    badge = _icon("badge")
    _put(stdscr, 0, 0, _fit(f"  {badge} {text}  ", w - 1), pal["BAR"])


def _botbar(stdscr, pal, hints):
    """Bottom hint bar (row h-1). `hints` is a ready string, or a list of (key, label)
    pairs joined uniformly so every screen's footer reads the same way."""
    h, w = stdscr.getmaxyx()
    text = hints if isinstance(hints, str) else " · ".join(f"{k} {lbl}" for k, lbl in hints)
    _put(stdscr, h - 1, 0, _fit(f"  {text}  ", w - 1), pal["BAR"])


def _clamp(top, total, view_h):
    """Clamp a scroll offset so the [top, top+view_h) window stays inside `total` rows."""
    return max(0, min(top, max(0, total - view_h)))


def _wrap_lines(lines, width):
    """Flatten raw lines into width-wrapped display lines (blank lines preserved)."""
    import textwrap
    out = []
    for ln in lines:
        if ln:
            out.extend(textwrap.wrap(ln, max(1, width)) or [""])
        else:
            out.append("")
    return out


def _too_small(stdscr, min_h, min_w):
    """Draw the 'enlarge the window' guard and return True when the terminal is below
    the minimum; the caller then refreshes, reads a key, and continues/returns."""
    import curses
    h, w = stdscr.getmaxyx()
    if h < min_h or w < min_w:
        _put(stdscr, 0, 0, "Terminal too small — enlarge the window, or press q.", curses.A_BOLD)
        return True
    return False


def _vdiv(stdscr, pal, dx, y0, y1):
    """Vertical divider at column dx over rows [y0, y1) — the two-pane split."""
    import curses
    g = _bx(curses)
    for r in range(y0, y1):
        _addch(stdscr, r, dx, g["v"], pal["FRAME"])


def _scrollbar(stdscr, pal, x, y0, view_h, top, total):
    """Consistent ▴/▾ scroll markers at column x: ▴ at the top row when scrolled down,
    ▾ at the last visible row when more remains below. No-op when everything fits."""
    if total <= view_h:
        return
    if top > 0:
        _put(stdscr, y0, x, _GLYPH["up"], pal["FRAME"])
    if top + view_h < total:
        _put(stdscr, y0 + view_h - 1, x, _GLYPH["down"], pal["FRAME"])


def _bx(curses) -> dict:
    """Line/box glyphs — ASCII (+ - |) when GENESEED_TUI_ASCII is set (for fonts that
    render ACS box-drawing as tofu), else ACS line glyphs."""
    if _TUI_ASCII:
        return {"ul": "+", "ur": "+", "ll": "+", "lr": "+", "ttee": "+", "btee": "+",
                "h": ord("-"), "v": ord("|"), "up": "^", "down": "v"}
    return {"ul": curses.ACS_ULCORNER, "ur": curses.ACS_URCORNER, "ll": curses.ACS_LLCORNER,
            "lr": curses.ACS_LRCORNER, "ttee": curses.ACS_TTEE, "btee": curses.ACS_BTEE,
            "h": curses.ACS_HLINE, "v": curses.ACS_VLINE, "up": curses.ACS_UARROW,
            "down": curses.ACS_DARROW}


def _accent_for(theme: str) -> str:
    """The ACCENT colour name a theme declares (default cyan)."""
    try:
        return json.loads((build.THEMES / f"{theme}.json").read_text(encoding="utf-8")).get("ACCENT", "cyan")
    except (OSError, json.JSONDecodeError):
        return "cyan"


def _draw_box(stdscr, curses, y, x, hh, ww, attr=0) -> None:
    """Single-line box; ASCII when GENESEED_TUI_ASCII, else ACS glyphs. Bounds-guarded."""
    g = _bx(curses)

    def ch(yy, xx, c):
        _addch(stdscr, yy, xx, c, attr)
    x2, y2 = x + ww - 1, y + hh - 1
    ch(y, x, g["ul"]); ch(y, x2, g["ur"]); ch(y2, x, g["ll"]); ch(y2, x2, g["lr"])
    try:
        stdscr.hline(y, x + 1, g["h"] | attr, ww - 2)
        stdscr.hline(y2, x + 1, g["h"] | attr, ww - 2)
        stdscr.vline(y + 1, x, g["v"] | attr, hh - 2)
        stdscr.vline(y + 1, x2, g["v"] | attr, hh - 2)
    except curses.error:
        pass


def _tui_palette(curses, accent="cyan") -> dict:
    """Shared colour attributes (frame, bars, selection, headings, icons). The frame /
    bar / header colour follows the theme ACCENT. Degrades to monochrome attributes
    when the terminal has no colour."""
    cols = {"cyan": curses.COLOR_CYAN, "yellow": curses.COLOR_YELLOW, "red": curses.COLOR_RED,
            "green": curses.COLOR_GREEN, "magenta": curses.COLOR_MAGENTA,
            "blue": curses.COLOR_BLUE, "white": curses.COLOR_WHITE}
    acc = cols.get(accent, curses.COLOR_CYAN)
    color = False
    try:
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, acc, -1)
        curses.init_pair(2, curses.COLOR_BLACK, acc)
        curses.init_pair(3, curses.COLOR_BLACK, curses.COLOR_GREEN)
        curses.init_pair(4, curses.COLOR_YELLOW, -1)
        curses.init_pair(5, curses.COLOR_MAGENTA, -1)
        curses.init_pair(6, curses.COLOR_GREEN, -1)
        curses.init_pair(7, curses.COLOR_RED, -1)
        curses.init_pair(8, curses.COLOR_YELLOW, -1)
        color = curses.has_colors()
    except curses.error:
        color = False
    cp = curses.color_pair
    return {
        "FRAME": cp(1) if color else curses.A_DIM,
        "BAR": (cp(2) | curses.A_BOLD) if color else curses.A_REVERSE,
        "SEL": (cp(3) | curses.A_BOLD) if color else curses.A_REVERSE,
        "TITLE": (cp(4) | curses.A_BOLD) if color else curses.A_BOLD,
        "ICON": cp(5) if color else 0,
        "HEAD": (cp(1) | curses.A_BOLD) if color else curses.A_BOLD,
        "OK": (cp(6) | curses.A_BOLD) if color else curses.A_BOLD,
        "FAIL": (cp(7) | curses.A_BOLD) if color else curses.A_BOLD,
        # WARN is yellow (distinct from red FAIL) so a warning never reads as a failure;
        # MUTED is the dim attribute, formalised as a named slot for hints/secondary text.
        "WARN": (cp(8) | curses.A_BOLD) if color else curses.A_BOLD,
        "MUTED": curses.A_DIM,
    }


_BAR_EIGHTHS = " ▏▎▍▌▋▊▉█"   # 0..8 eighths of a cell — sub-character resolution


def _progress_bar(frac: float, width: int = 24) -> str:
    """A determinate bar exactly `width` display columns wide. In the emoji/plain tiers
    it fills at 8-eighths sub-cell resolution (one partial block at the frontier) so the
    bar advances smoothly instead of jumping a whole cell at a time; ASCII falls back to
    a #/- bar (set GENESEED_TUI_ASCII=1 if a font garbles the block glyphs)."""
    frac = max(0.0, min(1.0, frac))
    if _TUI_ASCII:
        filled = int(round(frac * width))
        return "#" * filled + "-" * (width - filled)
    eighths = int(round(frac * width * 8))
    full, rem = divmod(eighths, 8)
    if full >= width:
        return "█" * width
    return "█" * full + _BAR_EIGHTHS[rem] + " " * (width - full - 1)


def _theme_preview(key):
    """Right-panel preview lines for a theme, read live from its JSON: tagline, sigil,
    voice, and a sample law title. Returns (kind, text) rows."""
    try:
        data = json.loads((build.THEMES / f"{key}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [("dim", "(no preview available)")]
    lines = [("title", key), ("", "")]
    if data.get("TAGLINE"):
        lines += [("dim", data["TAGLINE"]), ("", "")]
    if data.get("LOADED_SIGIL"):
        lines += [("ok", data["LOADED_SIGIL"]), ("", "")]
    if data.get("VOICE"):
        lines += [("", "Voice — " + data["VOICE"]), ("", "")]
    if data.get("LEX_I"):
        lines.append(("", "e.g.  Rule I — " + data["LEX_I"]))
    if data.get("BENEDICTION"):
        lines += [("", ""), ("dim", data["BENEDICTION"])]
    return lines


def _theme_flair(theme: str) -> dict:
    """The voice elements the setup chrome speaks in once a theme is chosen, read live
    from its JSON (pure — unit-tested): accent colour, tagline, loaded-sigil, banner
    rows, and benediction. Every field degrades to an empty string / list when the
    theme omits it, so the caller falls back to plain text instead of crashing. This is
    what carries the theme rework's 'voice, vocabulary, and a banner' into the wizard's
    confirm and success screens — the same flavour the rendered bundle now wears."""
    try:
        data = json.loads((build.THEMES / f"{theme}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    return {
        "accent": data.get("ACCENT", "cyan"),
        "tagline": data.get("TAGLINE", ""),
        "sigil": data.get("LOADED_SIGIL", ""),
        "banner": data.get("BANNER", "").splitlines(),
        "benediction": data.get("BENEDICTION", ""),
    }

