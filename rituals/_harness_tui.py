"""Geneseed harness — Full-screen curses control panel: widgets, views and the event loop.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



# ---- shared curses helpers (used by the setup form and the control panel) -------

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


def _menu(stdscr, curses, prompt, options, default=None, detail_fn=None, accent="cyan"):
    """Framed, colored single-choice menu. Returns the chosen key or None (cancel).
    options: list of (key, label, description). With detail_fn, render two panes — the
    list on the left and detail_fn(key)'s lines on the right; else the focused row's
    description shows beneath the list. `accent` tints the frame/bars/headings — pass a
    theme's ACCENT to make a post-selection screen speak in that theme's colour."""
    import textwrap
    pal = _tui_palette(curses, accent)
    curses.curs_set(0)
    idx = 0
    if default is not None:
        idx = next((i for i, (k, _l, _d) in enumerate(options) if k == default), 0)
    while True:
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()

        def put(y, x, s, a=0):
            _put(stdscr, y, x, s, a)

        if _too_small(stdscr, 9, 44):
            stdscr.refresh()
            if stdscr.getch() in (ord("q"), 27):
                return None
            continue
        _topbar(stdscr, pal, prompt)
        _draw_box(stdscr, curses, 1, 0, h - 2, w, pal["FRAME"])

        if detail_fn:
            dx = max(18, min(36, w // 2))
            g = _bx(curses)
            try:
                for r in range(2, h - 2):
                    stdscr.addch(r, dx, g["v"], pal["FRAME"])
                stdscr.addch(1, dx, g["ttee"], pal["FRAME"])
                stdscr.addch(h - 2, dx, g["btee"], pal["FRAME"])
            except curses.error:
                pass
            put(1, 2, " Themes ", pal["HEAD"])
            put(1, dx + 2, " Preview ", pal["HEAD"])
            avail = max(1, h - 4)
            liw = dx - 2
            ltop = idx - avail + 1 if idx >= avail else 0
            for vi in range(avail):
                oi = ltop + vi
                if oi >= len(options):
                    break
                label = options[oi][1]
                if oi == idx:
                    put(2 + vi, 1, _fit(f" {_GLYPH['sel']} {label} ", liw), pal["SEL"])
                else:
                    put(2 + vi, 2, _truncd(f" {label}", liw - 1), 0)
            rx, rw = dx + 2, max(4, w - dx - 3)
            wrapped = []
            for kind, text in (detail_fn(options[idx][0]) or []):
                if not text:
                    wrapped.append(("", ""))
                else:
                    for j, seg in enumerate(textwrap.wrap(text, rw) or [""]):
                        wrapped.append((kind, seg if j == 0 else "  " + seg))
            for r, (kind, seg) in enumerate(wrapped):
                if 2 + r >= h - 2:
                    break
                a = (pal["TITLE"] if kind == "title" else pal["OK"] if kind == "ok"
                     else curses.A_DIM if kind == "dim" else 0)
                put(2 + r, rx, seg[:rw], a)
        else:
            for i, (_k, label, _desc) in enumerate(options):
                y = 2 + i
                if y >= h - 5:
                    break
                if i == idx:
                    put(y, 2, _fit(f" {_SEL_G} {label} ", w - 4), pal["SEL"])
                else:
                    put(y, 3, _truncd(f"  {label}", w - 4), 0)
            dy = 2 + len(options) + 1
            if dy < h - 2:
                _hline(stdscr, pal, dy - 1, 2, w - 4)
                for j, seg in enumerate(textwrap.wrap(options[idx][2], w - 6)[:3]):
                    put(dy + j, 3, seg, curses.A_DIM)

        _botbar(stdscr, pal, "↑↓ move · Enter select · q cancel")
        stdscr.refresh()
        c = stdscr.getch()
        if c in (ord("q"), 27):
            return None
        elif c in (curses.KEY_UP, ord("k")):
            idx = (idx - 1) % len(options)
        elif c in (curses.KEY_DOWN, ord("j")):
            idx = (idx + 1) % len(options)
        elif c in (curses.KEY_ENTER, 10, 13, ord(" ")):
            return options[idx][0]


def _text_input(stdscr, curses, prompt, default=""):
    """Framed single-line text input. Returns the entered string (default if empty),
    or None on Esc."""
    pal = _tui_palette(curses)
    curses.curs_set(1)
    buf = list(default)
    try:
        while True:
            _clear_frame(stdscr)
            h, w = stdscr.getmaxyx()

            def put(y, x, s, a=0):
                _put(stdscr, y, x, s, a)

            if _too_small(stdscr, 7, 30):
                stdscr.refresh()
                if stdscr.getch() == 27:
                    return None
                continue
            _topbar(stdscr, pal, "Geneseed setup")
            _draw_box(stdscr, curses, 1, 0, h - 2, w, pal["FRAME"])
            put(2, 3, prompt, pal["TITLE"])
            s = "".join(buf)
            put(4, 3, "› " + s, 0)
            _botbar(stdscr, pal, "type a value · Enter accept · Esc cancel")
            try:
                stdscr.move(4, min(w - 2, 5 + len(s)))
            except curses.error:
                pass
            stdscr.refresh()
            c = stdscr.getch()
            if c == 27:
                return None
            elif c in (curses.KEY_ENTER, 10, 13):
                return "".join(buf).strip() or default
            elif c in (curses.KEY_BACKSPACE, 127, 8):
                if buf:
                    buf.pop()
            elif 32 <= c < 127:
                buf.append(chr(c))
    finally:
        curses.curs_set(0)


def _setup_tui(stdscr):
    """Curses install form: theme → mode → (target) → confirm. Returns the selection
    dict, or None if cancelled at any step."""
    import curses
    inst = _installed_defaults()
    theme_prompt = "Choose a theme" + (f"   (installed: {inst['theme']})" if inst["theme"] else "")
    theme = _menu(stdscr, curses, theme_prompt,
                  [(k, k, blurb or "voice theme") for k, blurb in _theme_options()],
                  default=inst["theme"] or _default_theme(), detail_fn=_theme_preview)
    if theme is None:
        return None
    emit_prompt = "Choose an install mode" + (f"   (installed: {inst['emit']})" if inst["emit"] else "")
    emit = _menu(stdscr, curses, emit_prompt,
                 [(k, k, d) for k, d in EMIT_OPTIONS], default=inst["emit"] or "opencode-global")
    if emit is None:
        return None
    out = root = None
    if emit == "opencode":
        root = _text_input(stdscr, curses, "Repo root to install into", ".")
        if root is None:
            return None
        out = root
    elif emit == "files":
        out = _text_input(stdscr, curses, "Output directory for the bundle", "Harness")
        if out is None:
            return None
    target = out or root
    flair = _theme_flair(theme)
    summary = f"theme = {theme}     mode = {emit}" + (f"     target = {target}" if target else "")
    # Once a theme is chosen the confirm step speaks in its voice: the tagline is the
    # prompt and the accent tints the frame, so you feel the flavour you're about to
    # implant before committing to the build.
    prompt = flair["tagline"] or "Ready to build the harness?"
    choice = _menu(stdscr, curses, prompt,
                   [("go", "Build now", summary),
                    ("cancel", "Cancel", "Make no changes and exit.")],
                   default="go", accent=flair["accent"])
    return {"theme": theme, "emit": emit, "out": out, "root": root} if choice == "go" else None


def _retheme_tui(stdscr):
    """Curses re-theme form: theme → confirm. The install mode and target stay as
    deployed — only the voice changes. Returns the selection dict, or None if
    cancelled at either step."""
    import curses
    inst = _installed_defaults()
    theme_prompt = "Choose a theme" + (f"   (installed: {inst['theme']})" if inst["theme"] else "")
    theme = _menu(stdscr, curses, theme_prompt,
                  [(k, k, blurb or "voice theme") for k, blurb in _theme_options()],
                  default=inst["theme"] or _default_theme(), detail_fn=_theme_preview)
    if theme is None:
        return None
    emit = inst["emit"] or "opencode-global"
    flair = _theme_flair(theme)
    summary = f"theme = {theme}     mode = {emit} (unchanged)"
    prompt = flair["tagline"] or "Ready to rebuild the harness?"
    choice = _menu(stdscr, curses, prompt,
                   [("go", "Build now", summary),
                    ("cancel", "Cancel", "Make no changes and exit.")],
                   default="go", accent=flair["accent"])
    return {"theme": theme, "emit": emit, "out": None, "root": None} if choice == "go" else None


# Law heading in the rendered laws file, e.g. "### Rule XVIII — Load the Project Context".
LAW_HEADING_RE = re.compile(r"^###\s+\S+\s+([IVXLCDM]+)\s+[—-]\s+(.+?)\s*$")


def _parse_laws(text: str) -> list[dict]:
    """Split the rendered laws file into {num, title, body} entries."""
    laws: list[dict] = []
    cur: dict | None = None
    for line in text.splitlines():
        m = LAW_HEADING_RE.match(line)
        if m:
            if cur:
                laws.append(cur)
            cur = {"num": m.group(1), "title": m.group(2), "body": ""}
        elif cur is not None:
            cur["body"] += line + "\n"
    if cur:
        laws.append(cur)
    for law in laws:
        law["body"] = law["body"].strip()
    return laws


def _tui_inventory(theme_name: str) -> dict:
    """Render-accurate inventory for the TUI (pure — unit-tested): each agent and
    skill with its one-line purpose AND full rendered spec, plus the laws with their
    titles and bodies. Powers the two-pane browser (list + detail)."""
    _t, items = build.render_all(theme_name)
    agents: list[dict] = []
    skills: list[dict] = []
    laws: list[dict] = []
    for _out_rel, text, src in items:
        if text is None:
            continue
        parts = src.relative_to(build.SRC).as_posix().split("/")
        if len(parts) == 2 and parts[1].endswith(".md") and not parts[1].startswith("_"):
            entry = {"name": parts[1][:-3], "desc": build._first_blockquote(text), "body": text}
            if parts[0] == "agents":
                agents.append(entry)
            elif parts[0] == "skills":
                skills.append(entry)
        if parts[-1] == "universal.md":
            laws = _parse_laws(text)
    agents.sort(key=lambda e: e["name"])
    skills.sort(key=lambda e: e["name"])
    return {"agents": agents, "skills": skills, "laws": laws, "theme": theme_name}


def _tui_entries(inv: dict) -> list[tuple[str, str, object]]:
    """Ordered (kind, label, data) rows for the left list. kind 'head' is a section
    divider (not selectable); 'agent' | 'skill' | 'law' carry their data dict."""
    rows: list[tuple[str, str, object]] = [("head", f"AGENTS ({len(inv['agents'])})", None)]
    rows += [("agent", e["name"], e) for e in inv["agents"]]
    rows.append(("head", f"SKILLS ({len(inv['skills'])})", None))
    rows += [("skill", e["name"], e) for e in inv["skills"]]
    rows.append(("head", f"LAWS ({len(inv['laws'])})", None))
    rows += [("law", f"Rule {e['num']} — {e['title']}", e) for e in inv["laws"]]
    return rows


def _detail_lines(kind: str, label: str, data) -> list[str]:
    """Right-pane content for the selected entry."""
    if kind == "law":
        return [label, ""] + (data["body"].splitlines() if data else [])
    if kind in ("agent", "skill") and data:
        return data["body"].splitlines()
    return [label]


def _doctor_view(stdscr, curses, pal) -> None:
    """Run the health check with a progress bar, then show a colored ✓/✗ result list
    (scrollable; 'r' re-runs, 'q' returns)."""
    import textwrap

    def put(y, x, s, a=0):
        _put(stdscr, y, x, s, a)

    import threading
    state = {"i": 0, "total": 1, "label": "starting"}

    def draw_progress(tick):
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()
        _topbar(stdscr, pal, "Geneseed — health check")
        frac = state["i"] / state["total"] if state["total"] else 0.0
        put(2, 3, f"{_spin(tick)} Validating:  {state['label']}", pal["TITLE"])
        put(4, 3, f"[{_progress_bar(frac, max(10, min(40, w - 22)))}] {int(frac * 100):3d}%", pal["HEAD"])
        _botbar(stdscr, pal, "please wait…")
        stdscr.refresh()

    def on_progress(i, total, label):
        # Data only in the animated tier (the clock loop below owns drawing). In the
        # calm tiers there is no ticker thread, so draw per-check right here.
        state.update(i=i, total=total, label=label)
        if not _TUI_ANIM:
            draw_progress(0)

    result = {}
    if _TUI_ANIM:
        # Run the collect on a worker thread and redraw the spinner on an 80 ms clock
        # (~12.5 fps, the canonical braille rate) so a slow check (e.g. the bundle-drift
        # render) animates instead of appearing hung. Only the MAIN thread touches
        # curses; the worker only renders/compares and updates the plain `state` dict
        # (GIL-atomic, no lock needed).
        done = threading.Event()

        def _work():
            try:
                result["v"] = _doctor_collect(on_progress=on_progress)
            except Exception as e:               # never leave the UI hung on a crash
                result["v"] = ([], [f"health check crashed: {e}"])
            finally:
                done.set()

        worker = threading.Thread(target=_work, daemon=True)
        worker.start()
        stdscr.timeout(80)
        tick = 0
        while not done.is_set():
            draw_progress(tick)
            stdscr.getch()          # blocks up to 80 ms, then returns -1 → next frame
            tick += 1
        worker.join()
        stdscr.timeout(-1)          # restore blocking getch for the result list below
    else:
        draw_progress(0)
        result["v"] = _doctor_collect(on_progress=on_progress)
    themes, problems = result["v"]
    if problems:
        lines = [("fail", f"{len(problems)} problem(s) across {len(themes)} theme(s):"), ("", "")]
        lines += [("fail", p) for p in problems]
        if any("dead link" in p for p in problems):
            lines += [("", ""), ("info", "Tip: dead links to skills mean the source is "
                                          "incomplete — run Update (./geneseed update) or re-sync "
                                          "src/, then re-check.")]
    else:
        lines = [("ok", f"All checks passed — {len(themes)} themes clean."), ("", ""),
                 ("ok", "no unresolved tokens, dead links, or non-hermetic escapes"),
                 ("ok", "every theme defines the same voice tokens (parity)"),
                 ("ok", "every spec has a purpose line; plugins parse; prompt extractable"),
                 ("ok", "rendered bundle matches a fresh render of src")]

    top = 0
    while True:
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()
        _topbar(stdscr, pal, "Geneseed — health check")
        flat = []
        for kind, text in lines:
            if not text:
                flat.append(("", ""))
                continue
            for j, seg in enumerate(textwrap.wrap(text, max(10, w - 8)) or [""]):
                flat.append((kind, seg if j == 0 else "  " + seg))
        body_h = max(1, h - 2)
        top = _clamp(top, len(flat), body_h)
        for r in range(body_h):
            di = top + r
            if di >= len(flat):
                break
            kind, seg = flat[di]
            if kind == "ok":
                put(1 + r, 2, f"{_mark('ok')} {seg}", pal["OK"])
            elif kind == "fail":
                put(1 + r, 2, f"{_mark('fail')} {seg}", pal["FAIL"])
            elif kind == "warn":
                put(1 + r, 2, f"{_mark('warn')} {seg}", pal["WARN"])
            elif kind == "info":
                put(1 + r, 2, f"{_mark('info')} {seg}", pal["MUTED"])
            else:
                put(1 + r, 2, seg, 0)
        _scrollbar(stdscr, pal, w - 1, 1, body_h, top, len(flat))
        _botbar(stdscr, pal, "↑↓/PgUp/PgDn scroll · r re-run · Enter/q close")
        stdscr.refresh()
        c = stdscr.getch()
        if c in (ord("q"), 27, curses.KEY_ENTER, 10, 13):
            return
        elif c in (curses.KEY_DOWN, ord("j")):
            top += 1
        elif c in (curses.KEY_UP, ord("k")):
            top = max(0, top - 1)
        elif c == curses.KEY_NPAGE:
            top += body_h
        elif c == curses.KEY_PPAGE:
            top = max(0, top - body_h)
        elif c == ord("r"):
            return _doctor_view(stdscr, curses, pal)


def _doctor_screen(stdscr) -> None:
    import curses
    _doctor_view(stdscr, curses, _tui_palette(curses))


def _doctor_run_ui() -> int:
    """Show the health check in the curses view where supported, else run the classic
    text doctor. Used by the setup wizard's 'Run a health check now?' prompt."""
    if sys.stdin.isatty():
        try:
            import curses
            import locale
            try:
                locale.setlocale(locale.LC_ALL, "")
            except locale.Error:
                pass
            curses.wrapper(_doctor_screen)
            return 0
        except Exception:
            pass
    return cmd_doctor(argparse.Namespace(theme=None, all=False, bundle=None, no_bundle=False))


def _info_screen(stdscr, curses, pal, title, lines, footer) -> None:
    """Scrollable info panel: (kind, text) rows with ok/warn/info coloring. Returns
    on Enter/q."""
    import textwrap
    icon = {"ok": _mark("ok"), "warn": _mark("warn"), "info": _mark("info")}
    # 'art' / 'dim' are flavour rows (banner, sigil, benediction): no status icon, no
    # wrap — pre-formatted lines drawn raw (clipped, not reflowed) so a theme banner
    # keeps its shape, in the accent ('art') or dimmed ('dim').
    attr = {"ok": pal["OK"], "warn": pal["WARN"], "info": pal["MUTED"],
            "art": pal["HEAD"], "dim": curses.A_DIM}
    top = 0
    while True:
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()

        def put(y, x, s, a=0):
            _put(stdscr, y, x, s, a)

        _topbar(stdscr, pal, f"Geneseed — {title}")
        flat = []
        for kind, text in lines:
            if kind in ("art", "dim"):
                flat.append((kind, text))                      # raw, no icon, no wrap
                continue
            for j, seg in enumerate(textwrap.wrap(text, max(10, w - 8)) or [""]):
                flat.append((kind, f"{icon.get(kind, '·')} {seg}" if j == 0 else f"   {seg}"))
        body_h = max(1, h - 2)
        top = _clamp(top, len(flat), body_h)
        for r in range(body_h):
            di = top + r
            if di >= len(flat):
                break
            kind, seg = flat[di]
            put(1 + r, 2, seg, attr.get(kind, 0))
        _scrollbar(stdscr, pal, w - 1, 1, body_h, top, len(flat))
        _botbar(stdscr, pal, footer)
        stdscr.refresh()
        c = stdscr.getch()
        if c in (curses.KEY_ENTER, 10, 13, ord("q"), 27):
            return
        elif c in (curses.KEY_DOWN, ord("j")):
            top += 1
        elif c in (curses.KEY_UP, ord("k")):
            top = max(0, top - 1)


def _themed_reveal(stdscr, curses, pal, theme) -> None:
    """Curses install flourish: scroll the theme's ASCII sprite across the screen once
    (pose-cycled, over its ground line), then hand off to the done screen. Skippable
    with any key. Never raises — a render hiccup just ends the animation early."""
    try:
        import theme_anim
    except Exception:
        return
    art = theme_anim.art_for(theme)
    poses, ground, title = art["sprite"], art.get("ground", ""), art["title"]
    h = max((len(p) for p in poses), default=0)
    spw = max((len(r) for p in poses for r in p), default=0)
    stdscr.nodelay(True)
    try:
        _h, w = stdscr.getmaxyx()
        for i in range(w + spw + 1):
            _clear_frame(stdscr)
            _topbar(stdscr, pal, "Geneseed")
            _put(stdscr, 1, max(1, (w - len(title)) // 2), title[: w - 2], pal["HEAD"])
            base = 3
            pose = poses[(i // 3) % len(poses)]
            x = w - i                                # enter from the right, travel left
            for r in range(h):
                row = pose[r] if r < len(pose) else ""
                if x >= 0:
                    seg = row[: max(0, w - 1 - x)]
                    if seg:
                        _put(stdscr, base + r, x, seg)
                else:
                    seg = row[-x:][: w - 1]
                    if seg:
                        _put(stdscr, base + r, 0, seg)
            if ground:
                g = ground * ((w // max(1, len(ground))) + 2)
                off = i % len(ground)
                _put(stdscr, base + h, 0, g[off:off + w - 1], curses.A_DIM)
            _botbar(stdscr, pal, "any key to continue")
            stdscr.refresh()
            curses.napms(22)
            if stdscr.getch() != -1:
                break
    except Exception:
        pass
    finally:
        try:
            stdscr.nodelay(False)
        except Exception:
            pass


def _setup_flow(stdscr) -> int:
    """One seamless curses setup: form → build → reveal → summary → health check."""
    sel = _setup_tui(stdscr)
    if not sel:
        return 0
    return _grow_flow(stdscr, sel)


def _retheme_flow(stdscr) -> int:
    """Change theme only: the theme picker, then the same build → reveal → summary →
    health check as setup. The install mode and target stay as deployed."""
    sel = _retheme_tui(stdscr)
    if not sel:
        return 0
    return _grow_flow(stdscr, sel)


def _grow_flow(stdscr, sel: dict) -> int:
    """Build → themed reveal → summary → health check for a confirmed selection —
    the shared back half of the setup and re-theme flows."""
    import curses
    theme, emit = sel["theme"], sel["emit"]
    out, root = sel.get("out"), sel.get("root")
    # The theme is locked in now: repaint the rest of the flow (build → summary →
    # health check) in its accent so the chrome matches the harness being grown.
    flair = _theme_flair(theme)
    pal = _tui_palette(curses, accent=flair["accent"])
    extra = []
    if emit == "opencode-global":
        # The build overwrites the deployed global harness; the self-improvement loops
        # may have edited it in place. Preserve that drift first — one-shot "saving"
        # frame (the export renders the whole harness to a temp dir, like the diff).
        _clear_frame(stdscr)
        _topbar(stdscr, pal, "setup")
        h, w = stdscr.getmaxyx()
        msg = f"{_spin(0)} checking the deployed harness for local edits" + ("..." if _TUI_ASCII else "…")
        _put(stdscr, max(2, h // 2), max(2, (w - _dwidth(msg)) // 2), msg, pal["MUTED"])
        _botbar(stdscr, pal, "")
        stdscr.refresh()
        try:
            ipath, _ifiles = export_improvements()
        except Exception:
            ipath = None
        if ipath:
            extra.append(("info", f"local edits preserved -> {ipath}"))
            extra.append(("info", "hand that file to your agent to back-port them into src"))
    argv = _setup_build_args(theme, emit, out, root)
    status = _run_steps(stdscr, curses, pal,
                        [("Build the harness", [sys.executable, str(BUILD), *argv])],
                        heading="building")
    ok = bool(status) and status[0] == "done"
    if ok:
        _themed_reveal(stdscr, curses, pal, theme)   # themed install flourish before the summary
    _info_screen(stdscr, curses, pal, _setup_done_title(flair, ok),
                 _setup_done_lines(flair, theme, emit, out, root, ok, extra),
                 "Enter: run health check" if ok else "Enter: close")
    if not ok:
        return 1
    _doctor_view(stdscr, curses, pal)
    return 0


def _setup_done_title(flair: dict, ok: bool) -> str:
    """Title for the post-build screen — the sigil's own opening words on success
    (e.g. 'Gene-seed implanted'), else a plain fallback."""
    if not ok:
        return "setup"
    sig = flair["sigil"]
    if sig:
        head = re.split(r"\s+[—–-]\s+", sig, maxsplit=1)[0]
        # Drop any leading emoji/symbol run (and its spacing) so the title bar's own
        # badge isn't doubled — every theme's sigil opens with a different glyph.
        head = re.sub(r"^[\W_]+", "", head, flags=re.UNICODE).strip()
        if head:
            return head[:48].lower()
    return "setup complete"


def _setup_done_lines(flair: dict, theme, emit, out, root, ok, extra=None) -> list:
    """Post-build rows. On success the theme's banner crowns the screen and its
    benediction closes it, with the factual install summary between — the same
    voice/banner treatment the rendered bundle wears. On failure: just the facts.
    `extra` rows (e.g. the preserved-local-edits pointer) join the facts."""
    facts = _setup_summary_lines(theme, emit, out, root, ok) + list(extra or [])
    if not ok:
        return facts
    rows: list = []
    if flair["banner"]:
        rows += [("art", ln) for ln in flair["banner"]] + [("art", "")]
    if flair["sigil"]:
        rows += [("art", flair["sigil"]), ("art", "")]
    rows += facts
    if flair["benediction"]:
        rows += [("art", ""), ("dim", flair["benediction"])]
    return rows


def _diff_view(stdscr, curses, pal) -> None:
    """Two-pane review of local edits: changed files on the left, the selected file's
    colored unified diff on the right (j/k file, PgUp/PgDn scroll, q close)."""
    # One-shot "computing…" frame so the multi-second _diff_collect() (renders the whole
    # harness into a temp dir to compare) never shows a blank screen. No loop — the
    # results overwrite it on the first real frame; the spinner glyph is tier-gated.
    _clear_frame(stdscr)
    _topbar(stdscr, pal, "Review local edits")
    h, w = stdscr.getmaxyx()
    msg = f"{_spin(0)} computing diff" + ("..." if _TUI_ASCII else "…")
    _put(stdscr, max(2, h // 2), max(2, (w - _dwidth(msg)) // 2), msg, pal["MUTED"])
    _botbar(stdscr, pal, "")
    stdscr.refresh()
    target, theme, files = _diff_collect()
    if files is None:
        _info_screen(stdscr, curses, pal, "review local edits",
                     [("warn", f"No deployed global install at {target}."),
                      ("info", "Diff compares a deployed global harness against a fresh render of src.")],
                     "Enter: close")
        return
    if not files:
        _info_screen(stdscr, curses, pal, "review local edits",
                     [("ok", "No differences — the deployed harness matches source.")],
                     "Enter: close")
        return
    sel = 0
    dtop = 0
    list_top = 0
    while True:
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()

        def put(y, x, s, a=0):
            _put(stdscr, y, x, s, a)

        if _too_small(stdscr, 6, 40):
            stdscr.refresh()
            if stdscr.getch() in (ord("q"), 27):
                return
            continue
        _topbar(stdscr, pal, f"Review local edits  ·  {len(files)} changed")
        dx = max(16, min(40, w // 3))
        body_h = h - 2
        if sel < list_top:
            list_top = sel
        elif sel >= list_top + body_h:
            list_top = sel - body_h + 1
        list_top = _clamp(list_top, len(files), body_h)
        for i in range(body_h):
            fi = list_top + i
            if fi >= len(files):
                break
            f = files[fi]
            st = f["status"]
            if fi == sel:
                attr = pal["SEL"]
            elif st == "added":
                attr = pal["OK"]
            elif st == "missing":
                attr = pal["FAIL"]
            else:
                attr = pal["TITLE"]
            put(1 + i, 0, _fit(f" {_mark(st)} {f['rel']}", dx), attr)
        _vdiv(stdscr, pal, dx, 1, h - 1)
        diff = files[sel]["diff"]
        rx, rw = dx + 2, max(4, w - dx - 3)
        dtop = _clamp(dtop, len(diff), body_h)
        for i in range(body_h):
            di = dtop + i
            if di >= len(diff):
                break
            ln = diff[di]
            if ln[:3] in ("+++", "---") or ln.startswith("@@"):
                a = pal["TITLE"]
            elif ln.startswith("+"):
                a = pal["OK"]
            elif ln.startswith("-"):
                a = pal["FAIL"]
            else:
                a = 0
            put(1 + i, rx, ln[:rw], a)
        _scrollbar(stdscr, pal, w - 1, 1, body_h, dtop, len(diff))
        _botbar(stdscr, pal, "j/k file · PgUp/PgDn scroll · e export to file · q close")
        stdscr.refresh()
        c = stdscr.getch()
        if c in (ord("q"), 27, curses.KEY_ENTER, 10, 13):
            return
        elif c == ord("e"):
            try:
                path = _write_improvements(target, theme, files)
                rows = [("ok", f"improvements file written: {path}"),
                        ("info", "hand it to your agent to back-port the edits into src.")]
            except OSError as e:
                rows = [("warn", f"could not write the file ({e})")]
            _info_screen(stdscr, curses, pal, "export local edits", rows, "Enter: back")
        elif c in (curses.KEY_DOWN, ord("j")):
            sel = min(sel + 1, len(files) - 1)
            dtop = 0
        elif c in (curses.KEY_UP, ord("k")):
            sel = max(sel - 1, 0)
            dtop = 0
        elif c == curses.KEY_NPAGE:
            dtop += body_h
        elif c == curses.KEY_PPAGE:
            dtop = max(0, dtop - body_h)


def _help_overlay(stdscr, curses, pal) -> None:
    """Keybindings help for the browse panel."""
    _info_screen(stdscr, curses, pal, "keys", [
        ("info", "Up/Down or j/k    move the selection"),
        ("info", "PgUp/PgDn         scroll the detail pane"),
        ("info", "Home/End          jump to first / last"),
        ("info", "/                 search (Esc clears it)"),
        ("info", "d                 health check"),
        ("info", "x                 review local edits (diff)"),
        ("info", "b                 rebuild the bundle"),
        ("info", "u                 update everything"),
        ("info", "w                 open the local web UI"),
        ("info", "?                 this help"),
        ("info", "q                 quit the panel"),
        ("info", ""),
        ("info", "Appearance:  GENESEED_TUI_PLAIN=1 drops emoji + animation (calm look);"),
        ("info", "             GENESEED_TUI_ASCII=1 forces pure ASCII (tofu-font fallback)."),
    ], "Enter: close")


def _memory_facts(mdir):
    """List memory facts as {name, desc, body, path} (skips MEMORY.md / README)."""
    facts = []
    try:
        paths = sorted(mdir.glob("*.md"))
    except OSError:
        return facts
    for p in paths:
        if p.stem.lower() in ("memory", "readme"):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm, _body = _frontmatter(text)
        facts.append({"name": fm.get("name", p.stem), "desc": fm.get("description", ""),
                      "body": text, "path": p})
    return facts


def _memory_drop_index(mdir, name) -> None:
    """Remove the index line(s) referencing `name.md` from MEMORY.md."""
    idx = mdir / "MEMORY.md"
    try:
        lines = idx.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    keep = [ln for ln in lines if f"({name}.md)" not in ln]
    if keep != lines:
        try:
            idx.write_text("\n".join(keep) + "\n", encoding="utf-8")
        except OSError:
            pass


def _memory_view(stdscr, curses, pal) -> None:
    """Two-pane memory browser: facts left, full content right; / search, x delete."""
    import textwrap
    mdir = _resolve_memory_dir(None)
    if not mdir:
        _info_screen(stdscr, curses, pal, "memory",
                     [("warn", "No memory store found."),
                      ("info", "Set GENESEED_HARNESS or GENESEED_MEMORY to point at it.")],
                     "Enter: close")
        return
    facts = _memory_facts(mdir)
    if not facts:
        _info_screen(stdscr, curses, pal, "memory",
                     [("ok", f"Memory is empty — {mdir}")], "Enter: close")
        return
    sel = dtop = list_top = 0
    query = ""
    filtering = confirm = False
    while True:
        view = [f for f in facts
                if not query or query.lower() in (f["name"] + " " + f["desc"]).lower()]
        if sel >= len(view):
            sel = max(0, len(view) - 1)
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()

        def put(y, x, s, a=0):
            _put(stdscr, y, x, s, a)

        if _too_small(stdscr, 6, 40):
            stdscr.refresh()
            if stdscr.getch() in (ord("q"), 27):
                return
            continue
        _topbar(stdscr, pal, f"Memory  ·  {len(facts)} facts")
        dx = max(18, min(40, w // 3))
        body_h = h - 2
        if sel < list_top:
            list_top = sel
        elif sel >= list_top + body_h:
            list_top = sel - body_h + 1
        list_top = _clamp(list_top, len(view), body_h)
        for i in range(body_h):
            fi = list_top + i
            if fi >= len(view):
                break
            f = view[fi]
            put(1 + i, 0, _fit(f" {_icon('memory')} {f['name']}", dx), pal["SEL"] if fi == sel else 0)
        _scrollbar(stdscr, pal, dx - 1, 1, body_h, list_top, len(view))
        _vdiv(stdscr, pal, dx, 1, h - 1)
        rx, rw = dx + 2, max(4, w - dx - 3)
        body_lines = view[sel]["body"].splitlines() if view else []
        wrapped = []
        for ln in body_lines:
            wrapped.extend(textwrap.wrap(ln, rw) if ln else [""])
        dtop = _clamp(dtop, len(wrapped), body_h)
        for i in range(body_h):
            di = dtop + i
            if di >= len(wrapped):
                break
            put(1 + i, rx, wrapped[di][:rw], pal["HEAD"] if di == 0 else 0)
        if confirm and view:
            foot = f"  delete '{view[sel]['name']}' ?  y = yes   any other key = no  "
        elif filtering:
            foot = f"  search: /{query}    Enter apply · Esc clear  "
        else:
            foot = "  j/k file · / search · x delete · q close  "
        _scrollbar(stdscr, pal, w - 1, 1, body_h, dtop, len(wrapped))
        _botbar(stdscr, pal, foot.strip())
        stdscr.refresh()

        c = stdscr.getch()
        if confirm:
            if c in (ord("y"), ord("Y")) and view:
                try:
                    view[sel]["path"].unlink()
                except OSError:
                    pass
                _memory_drop_index(mdir, view[sel]["name"])
                facts = _memory_facts(mdir)
                sel = dtop = 0
            confirm = False
            continue
        if filtering:
            if c in (curses.KEY_ENTER, 10, 13):
                filtering = False
            elif c == 27:
                filtering = False
                query = ""
                sel = dtop = 0
            elif c in (curses.KEY_BACKSPACE, 127, 8):
                query = query[:-1]
                sel = dtop = 0
            elif 32 <= c < 127:
                query += chr(c)
                sel = dtop = 0
            continue
        if c == ord("q"):
            return
        elif c == 27:
            if query:
                query = ""
                sel = dtop = 0
            else:
                return
        elif c == ord("/"):
            filtering = True
        elif c == ord("x") and view:
            confirm = True
        elif c in (curses.KEY_DOWN, ord("j")):
            sel = min(sel + 1, max(0, len(view) - 1))
            dtop = 0
        elif c in (curses.KEY_UP, ord("k")):
            sel = max(0, sel - 1)
            dtop = 0
        elif c == curses.KEY_NPAGE:
            dtop += body_h
        elif c == curses.KEY_PPAGE:
            dtop = max(0, dtop - body_h)


def _status_view(stdscr, curses, pal) -> None:
    """A dashboard: theme, install mode, counts, memory, version, AGENT.md location.
    Shares `_status_data()` with the headless `status` command so they never drift."""
    d = _status_data()
    up_to_date = "up to date" in d["version_verdict"]
    lines = [
        ("ok", f"theme: {d['theme']}    (accent: {d['accent']})"),
        ("info", f"install mode: {d['emit']}"),
        ("info", f"agents {d['agents']} · skills {d['skills']} · laws {d['laws']}"),
        ("info", f"memory: {d['memory_dir'] or '(not found)'}  —  {d['facts']} fact(s)"),
        ("info", f"version: installed {d['installed_fp'] or '(none)'} · source {d['source_fp']}"),
        ("ok" if up_to_date else "warn", d["version_verdict"]),
    ]
    if d["agent_md"]:
        lines.append(("ok" if d["agent_md_present"] else "warn",
                      f"AGENT.md: {d['agent_md']}  ({'present' if d['agent_md_present'] else 'missing'})"))
    _info_screen(stdscr, curses, pal, "status", lines, "Enter: close")


def _mcp_view(stdscr, curses, pal) -> None:
    """Toggle known MCP servers into an OpenCode config. Each change rewrites the
    chosen opencode.json non-destructively — only the `mcp` block is touched — so a
    server is wired in (or out) without disturbing `instructions`, `permission`, or
    anything else the file already holds."""
    import textwrap
    targets = _mcp_targets()
    ti, sel, msg = _mcp_default_target(targets), 0, ""
    while True:
        label, path = targets[ti]
        config = _mcp_load(path)
        # Recompute per frame: presets + servers already in THIS target's config, so a
        # target switch (t) or an add/remove is reflected and user-added servers appear.
        names = _mcp_known_names(config)
        sel = min(sel, len(names) - 1)
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()

        def put(y, x, s, a=0):
            _put(stdscr, y, x, s, a)

        if _too_small(stdscr, 11, 44):
            stdscr.refresh()
            if stdscr.getch() in (ord("q"), 27):
                return
            continue
        _topbar(stdscr, pal, "Geneseed — MCP servers (OpenCode)")
        # Frame the panel (the one interactive screen that had no border). The box spans
        # rows 1..h-2; all content sits inside it (rows 2..h-3, cols 2..w-3).
        _draw_box(stdscr, curses, 1, 0, h - 2, w, pal["FRAME"])
        put(2, 2, f"target: {label}", pal["HEAD"])
        put(3, 2, f"{path}  ({'exists' if path.exists() else 'will be created'})", curses.A_DIM)
        for i, nm in enumerate(names):
            st = _mcp_state(config, nm)
            mark = _mark({"enabled": "mcp_on", "disabled": "mcp_off", "absent": "mcp_absent"}[st])
            row = f"{mark} {_mcp_meta(nm)[0]}  ({st})"
            y = 5 + i
            if y >= h - 7:
                break
            if i == sel:
                put(y, 2, _fit(f" {_SEL_G} {row} ", w - 4), pal["SEL"])
            else:
                put(y, 3, _truncd(f"  {row}", w - 4), 0)
        dy = 5 + min(len(names), max(1, h - 13)) + 1
        if dy < h - 3:
            _hline(stdscr, pal, dy - 1, 2, w - 4)
            for j, seg in enumerate(textwrap.wrap(_mcp_meta(names[sel])[1], w - 6)[:4]):
                if dy + j < h - 3:
                    put(dy + j, 3, seg, curses.A_DIM)
        if msg:
            put(h - 3, 2, _truncd(msg, w - 4), pal["OK"])
        _botbar(stdscr, pal,
                "↑↓ move · Enter add / enable-disable · x remove · t target · q back")
        stdscr.refresh()
        c = stdscr.getch()
        if c in (ord("q"), 27):
            return
        elif c in (curses.KEY_DOWN, ord("j")):
            sel, msg = (sel + 1) % len(names), ""
        elif c in (curses.KEY_UP, ord("k")):
            sel, msg = (sel - 1) % len(names), ""
        elif c in (ord("t"), ord("T")):
            ti, msg = (ti + 1) % len(targets), ""
        elif c in (curses.KEY_ENTER, 10, 13, ord(" ")):
            # Primary toggle — NON-destructive: an absent preset is added (enabled), a
            # present server flips its OpenCode `enabled` flag in place. Disabling keeps
            # the whole block so it can be turned back on without re-entering the config.
            nm = names[sel]
            st = _mcp_state(config, nm)
            new, ok = None, ""
            if st == "absent":
                if nm in _MCP_PRESETS:
                    new = _mcp_apply(config, nm, dict(_MCP_PRESETS[nm]["block"]))
                    ok = f"added {nm} (enabled) → {label}"
                else:
                    msg = f"{nm} has no preset block to add"
            else:
                new = _mcp_set_enabled(config, nm, st == "disabled")
                ok = f"{nm} {'enabled' if st == 'disabled' else 'disabled'} in {label}"
            if new is not None:
                if _mcp_commented(path):
                    msg = f"{path.name} has comments — not auto-edited; edit it by hand"
                else:
                    _mcp_save(path, new)
                    config, msg = new, ok
        elif c in (ord("x"), ord("X")):
            # Explicit, destructive: delete the server's config block entirely. Use Enter
            # to merely disable; reach for this only to drop the server for good.
            nm = names[sel]
            if _mcp_state(config, nm) != "absent":
                if _mcp_commented(path):
                    msg = f"{path.name} has comments — not auto-edited; edit it by hand"
                else:
                    config = _mcp_apply(config, nm, None)
                    _mcp_save(path, config)
                    msg = f"removed {nm} from {label} (config deleted)"
            else:
                msg = f"{nm} is not in {label}"


def _tui_loop(stdscr, inv: dict, focus: str | None = None) -> None:
    import curses
    import textwrap

    curses.curs_set(0)
    try:
        stdscr.keypad(True)
    except curses.error:
        pass
    pal = _tui_palette(curses, _accent_for(inv.get("theme", "neutral")))
    _maybe_splash(stdscr, curses, pal, inv.get("theme", "neutral"))
    g = _bx(curses)
    C_FRAME, C_BAR, C_SEL = pal["FRAME"], pal["BAR"], pal["SEL"]
    C_TITLE, C_ICON, C_HEAD = pal["TITLE"], pal["ICON"], pal["HEAD"]

    # Mode-aware icons; emoji are double-width but every draw below pads/truncates with
    # the display-width-aware _fit/_truncd, so alignment holds regardless of glyph width.
    ICON = {"agent": _icon("agent"), "skill": _icon("skill"), "law": _icon("law")}
    SECT = {"AGENTS": _icon("agent"), "SKILLS": _icon("skill"), "LAWS": _icon("law")}

    def clamp(v, lo, hi):
        return max(lo, min(v, hi))

    all_entries = _tui_entries(inv)
    query = ""
    filtering = False
    # focus = "agent" | "skill" | "law" lands the cursor on that section's first
    # item — used by the Library submenu so each entry opens scrolled to its own.
    sel = next((i for i, (k, _l, _d) in enumerate(all_entries) if k == focus), 0)
    list_top = 0
    detail_top = 0
    harness_py = str(Path(__file__).resolve())

    def _filtered():
        if not query:
            return all_entries
        q = query.lower()
        out = []
        for k, l, d in all_entries:
            if k == "head":
                continue
            hay = l.lower() + (" " + str(d.get("desc", "")) + " " + str(d.get("title", "")) if d else "")
            if q in hay:
                out.append((k, l, d))
        return out

    while True:
        _clear_frame(stdscr)
        h, w = stdscr.getmaxyx()

        def put(y, x, s, attr=0):
            _put(stdscr, y, x, s, attr)

        def ch(y, x, c, attr=0):
            try:
                stdscr.addch(y, x, c, attr)
            except curses.error:
                pass

        if _too_small(stdscr, 8, 48):
            stdscr.refresh()
            if stdscr.getch() in (ord("q"), 27):
                return
            continue

        dx = clamp(w // 3, 22, 40)
        dx = clamp(dx, 18, w - 24)
        ch_h = h - 4                 # inner rows 2 .. h-3
        liw = dx - 1                 # left inner width  (cols 1 .. dx-1)
        riw = w - dx - 3             # right inner width (cols dx+1 .. w-2)

        entries = _filtered()
        selectable = [i for i, (k, _l, _d) in enumerate(entries) if k != "head"]
        if not selectable:
            sel = 0
        elif sel not in selectable:
            sel = selectable[0]

        # ---- title bar ----
        head = f"Geneseed   theme {inv['theme']}   {len(selectable)} shown"
        if query:
            head += f"   /{query}"
        _topbar(stdscr, pal, head)

        # ---- frame + divider ----
        ch(1, 0, g["ul"], C_FRAME)
        ch(1, w - 1, g["ur"], C_FRAME)
        ch(h - 2, 0, g["ll"], C_FRAME)
        ch(h - 2, w - 1, g["lr"], C_FRAME)
        try:
            stdscr.hline(1, 1, g["h"] | C_FRAME, w - 2)
            stdscr.hline(h - 2, 1, g["h"] | C_FRAME, w - 2)
        except curses.error:
            pass
        ch(1, dx, g["ttee"], C_FRAME)
        ch(h - 2, dx, g["btee"], C_FRAME)
        for r in range(2, h - 2):
            ch(r, 0, g["v"], C_FRAME)
            ch(r, dx, g["v"], C_FRAME)
            ch(r, w - 1, g["v"], C_FRAME)
        put(1, 2, " Catalog ", C_HEAD)
        put(1, dx + 2, " Detail ", C_HEAD)

        # ---- left list ----
        if sel < list_top:
            list_top = sel
        elif sel >= list_top + ch_h:
            list_top = sel - ch_h + 1
        list_top = clamp(list_top, 0, max(0, len(entries) - ch_h))
        for i in range(ch_h):
            ri = list_top + i
            if ri >= len(entries):
                break
            y = 2 + i
            kind, label, _d = entries[ri]
            if kind == "head":
                name = label.split(" (")[0]
                put(y, 2, _truncd(f"{SECT.get(name, '•')} {label}", liw), C_HEAD)
            elif ri == sel:
                put(y, 1, _fit(f" {_GLYPH['sel']} {ICON.get(kind, '•')} {label}", liw), C_SEL)
            else:
                ic = ICON.get(kind, "•")
                lx = 2 + _dwidth(ic) + 1                 # icon, one space, then the label
                put(y, 2, ic, C_ICON)
                put(y, lx, _truncd(label, liw - lx + 1))

        # ---- right detail (wrapped, scrollable) ----
        if not entries:
            put(2, dx + 2, f"no matches for '{query}'", C_TITLE)
        else:
            kind, label, data = entries[sel]
            wrapped = _wrap_lines(_detail_lines(kind, label, data), riw)
            detail_top = _clamp(detail_top, len(wrapped), ch_h)
            for i in range(ch_h):
                di = detail_top + i
                if di >= len(wrapped):
                    break
                put(2 + i, dx + 2, wrapped[di][:riw], C_TITLE if di == 0 else 0)
            _scrollbar(stdscr, pal, w - 2, 2, ch_h, detail_top, len(wrapped))

        # ---- footer ----
        if filtering:
            _botbar(stdscr, pal, f"search: /{query}    Enter apply · Esc clear")
        else:
            _botbar(stdscr, pal,
                    "j/k move · / search · ? help · d doctor · x diff · b build · u update · w web · q quit")
        stdscr.refresh()

        c = stdscr.getch()
        if filtering:
            if c in (curses.KEY_ENTER, 10, 13):
                filtering = False
            elif c == 27:
                filtering = False
                query = ""
                detail_top = 0
            elif c in (curses.KEY_BACKSPACE, 127, 8):
                query = query[:-1]
                detail_top = 0
            elif 32 <= c < 127:
                query += chr(c)
                detail_top = 0
            continue
        if c == ord("q"):
            return
        elif c == 27:
            if query:
                query = ""
                detail_top = 0
            else:
                return
        elif c == ord("/"):
            filtering = True
        elif c == ord("?"):
            _help_overlay(stdscr, curses, pal)
        elif c in (curses.KEY_DOWN, ord("j")):
            sel = next((i for i in selectable if i > sel), sel)
            detail_top = 0
        elif c in (curses.KEY_UP, ord("k")):
            sel = next((i for i in reversed(selectable) if i < sel), sel)
            detail_top = 0
        elif c == curses.KEY_HOME:
            sel = selectable[0] if selectable else sel
            detail_top = 0
        elif c == curses.KEY_END:
            sel = selectable[-1] if selectable else sel
            detail_top = 0
        elif c == curses.KEY_NPAGE:
            detail_top += ch_h
        elif c == curses.KEY_PPAGE:
            detail_top = max(0, detail_top - ch_h)
        elif c == ord("d"):
            _doctor_view(stdscr, curses, pal)          # in-TUI health check with progress bar
        elif c == ord("x"):
            _diff_view(stdscr, curses, pal)            # in-TUI review of local edits
        elif c == ord("w"):
            curses.def_prog_mode()
            curses.endwin()
            print("[web] starting the local web UI — press Ctrl-C in this terminal to "
                  "stop it and return to the panel.")
            run([sys.executable, harness_py, "web"])
            try:
                input("\n[press Enter to return to the panel] ")
            except EOFError:
                pass
            curses.reset_prog_mode()
        elif c in (ord("b"), ord("u")):
            curses.def_prog_mode()
            curses.endwin()
            if c == ord("b"):
                run([sys.executable, str(BUILD)])
            else:
                # Update everything (sync + upgrade) — network op, so confirm first.
                root = Path(harness_py).resolve().parent.parent
                try:
                    ans = input("Update everything from upstream (sync + upgrade)? [y/N] ").strip().lower()
                except EOFError:
                    ans = ""
                if ans[:1] == "y":
                    run([sys.executable, harness_py, "sync-self"])
                    run([sys.executable, harness_py, "upgrade"])
            try:
                input("\n[press Enter to return to the panel] ")
            except EOFError:
                pass
            curses.reset_prog_mode()
        # KEY_RESIZE and any other key fall through and re-render


def cmd_web(args: argparse.Namespace) -> int:
    """Serve the deployed harness as a local web UI (browse + actions). Thin shell
    around rituals/web.py so the 4k-line CLI stays focused. With a start|stop|status
    action it runs the server as a background daemon instead of blocking the terminal."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import web  # noqa: E402
    action = getattr(args, "action", None)
    if action == "start":
        return web.start_daemon(args.theme, args.port, open_browser=not args.no_browser)
    if action == "stop":
        return web.stop_daemon(args.theme)
    if action == "restart":
        return web.restart_daemon(args.theme, args.port, open_browser=not args.no_browser)
    if action == "status":
        return web.status_daemon(args.theme)
    return web.serve(theme=args.theme, port=args.port,
                     open_browser=not args.no_browser,
                     daemon=getattr(args, "daemon_internal", False))


def cmd_tui(args: argparse.Namespace) -> int:
    """Full-screen control panel: browse agents/skills/laws and run build/doctor/diff.
    Runs natively on a VT-capable console — Unix curses, or the Windows VT shim — and
    degrades with a clear message when there is no interactive terminal / VT support."""
    if not sys.stdin.isatty():
        print("[tui] not an interactive terminal. Use `harness setup`, `doctor`, or `build`.")
        return 1
    try:
        import curses  # noqa: F401  (availability probe; VT shim on Windows)
    except ImportError:
        print("[tui] curses is unavailable in this Python. Use `harness setup`.")
        return 1
    inv = _tui_inventory(args.theme or _default_theme())
    import curses
    import locale
    try:
        locale.setlocale(locale.LC_ALL, "")   # enable UTF-8 box-drawing + icons
    except locale.Error:
        pass
    try:
        curses.wrapper(_tui_loop, inv)
    except Exception as e:  # e.g. the Windows shim's Unsupported when VT can't be enabled
        print(f"[tui] full-screen panel unavailable ({e}). Use `harness setup`, `doctor`, or `build`.")
        return 1
    _flush_export_notes()    # diff-view `e` exports / in-panel updates, re-shown post-TUI
    return 0
