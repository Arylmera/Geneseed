"""Geneseed harness — TUI widgets, inventory, and the control-panel event loop.

The rendering primitives live in _harness_tui_draw and the individual screens
in _harness_tui_views; this module owns the menu/text-input widgets, the
render-accurate inventory, the main event loop, and the web/tui CLI entries.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives


# ---- widgets: framed menu + text input + setup/retheme line wizards ----------

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
    posture_prompt = "Choose a posture" + (f"   (installed: {inst['posture']})" if inst["posture"] else "")
    posture = _menu(stdscr, curses, posture_prompt,
                    [(k, k, blurb or "collaboration register") for k, blurb in _posture_options()],
                    default=inst["posture"] or _default_posture())
    if posture is None:
        return None
    emit_prompt = "Choose an install mode" + (f"   (installed: {inst['emit']})" if inst["emit"] else "")
    emit = _menu(stdscr, curses, emit_prompt,
                 [(k, k, d) for k, d in EMIT_OPTIONS], default=inst["emit"] or "opencode-global")
    if emit is None:
        return None
    fp_prompt = "Choose a footprint" + (f"   (installed: {inst['footprint']})" if inst["footprint"] else "")
    footprint = _menu(stdscr, curses, fp_prompt,
                      [(k, k, d) for k, d in FOOTPRINT_OPTIONS], default=inst["footprint"] or "full")
    if footprint is None:
        return None
    out = root = None
    # Every PROJECT emit needs the repo root (claude/bob/copilot too — without --out
    # their CLAUDE.md/.claude land in ./Harness, never loaded). Mirrors _collect_setup_lines.
    if emit in ("opencode", "claude", "bob", "copilot"):
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
    summary = (f"theme = {theme}     posture = {posture}     mode = {emit}     footprint = {footprint}"
               + (f"     target = {target}" if target else ""))
    # Once a theme is chosen the confirm step speaks in its voice: the tagline is the
    # prompt and the accent tints the frame, so you feel the flavour you're about to
    # implant before committing to the build.
    prompt = flair["tagline"] or "Ready to build the harness?"
    choice = _menu(stdscr, curses, prompt,
                   [("go", "Build now", summary),
                    ("cancel", "Cancel", "Make no changes and exit.")],
                   default="go", accent=flair["accent"])
    return ({"theme": theme, "posture": posture, "emit": emit, "out": out,
             "root": root, "footprint": footprint}
            if choice == "go" else None)


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
    posture_prompt = "Choose a posture" + (f"   (installed: {inst['posture']})" if inst["posture"] else "")
    posture = _menu(stdscr, curses, posture_prompt,
                    [(k, k, blurb or "collaboration register") for k, blurb in _posture_options()],
                    default=inst["posture"] or _default_posture())
    if posture is None:
        return None
    emit = inst["emit"] or "opencode-global"
    fp_prompt = "Choose a footprint" + (f"   (installed: {inst['footprint']})" if inst["footprint"] else "")
    footprint = _menu(stdscr, curses, fp_prompt,
                      [(k, k, d) for k, d in FOOTPRINT_OPTIONS], default=inst["footprint"] or "full")
    if footprint is None:
        return None
    flair = _theme_flair(theme)
    summary = f"theme = {theme}     posture = {posture}     mode = {emit} (unchanged)     footprint = {footprint}"
    prompt = flair["tagline"] or "Ready to rebuild the harness?"
    choice = _menu(stdscr, curses, prompt,
                   [("go", "Build now", summary),
                    ("cancel", "Cancel", "Make no changes and exit.")],
                   default="go", accent=flair["accent"])
    return ({"theme": theme, "posture": posture, "emit": emit, "out": None,
             "root": None, "footprint": footprint}
            if choice == "go" else None)


# Law heading in the rendered laws file, e.g. "### Rule XVIII — Load the Project Context".
LAW_HEADING_RE = re.compile(r"^###\s+\S+\s+([IVXLCDM]+)\s+[—-]\s+(.+?)\s*$")

# Each rule's governance class. Six classes distilled from src/laws/universal.md
# so the web Laws view can filter by intent (security, verification, process,
# craft, context, communication). Keyed by Roman numeral, matching the heading
# numbering — same source of truth across TUI and web. Update when a new rule
# lands in universal.md.
LAW_CLASS: dict[str, str] = {
    "I": "security",
    "II": "process",
    "III": "verify",
    "IV": "security",
    "V": "craft",
    "VI": "context",
    "VII": "verify",
    "VIII": "comms",
    "IX": "comms",
    "X": "comms",
    "XI": "craft",
    "XII": "craft",
    "XIII": "craft",
    "XIV": "process",
    "XV": "process",
    "XVI": "context",
    "XVII": "context",
    "XVIII": "context",
    "XIX": "context",
    "XX": "security",
    "XXI": "process",
    "XXII": "security",
    "XXIII": "security",
    "XXIV": "craft",
    "XXV": "craft",
    "XXVI": "craft",
    "XXVII": "verify",
    "XXVIII": "process",
    "XXIX": "comms",
    "XXX": "comms",
    "XXXI": "comms",
    "XXXII": "craft",
    "XXXIII": "craft",
    "XXXIV": "verify",
    "XXXV": "verify",
}

# The six governance classes a law may carry — the web Laws filter chips read
# exactly this set. LAW_CLASS values must be drawn from it; doctor rejects any
# value outside it (see _count_table_problems in _harness_build.py).
LAW_CLASSES: tuple[str, ...] = (
    "security", "process", "verify", "craft", "context", "comms",
)

# Each skill's category. Six classes mirroring the Laws taxonomy so the web
# Skills ledger can filter by intent (design, build, review, ship, understand,
# learn). Keyed by skill file stem — same source of truth across TUI and web.
# Update when a new skill lands in src/skills/ (doctor enforces full coverage).
SKILL_CLASS: dict[str, str] = {
    "brainstorm": "design",
    "clarify": "design",
    "plan": "design",
    "council": "design",
    "workflow": "design",
    "parallel-agents": "design",
    "codebase-design": "design",
    "domain-modeling": "design",
    "wayfinder": "design",
    "tickets": "design",
    "tdd": "build",
    "develop": "build",
    "refactor": "build",
    "debug": "build",
    "migrate": "build",
    "frontend-design": "build",
    "opencode-theme": "build",
    "prototype": "build",
    "forge-mcp": "build",
    "geneseed-code-review": "review",
    "fresh-eyes": "review",
    "gap-detector": "review",
    "roast-me": "review",
    "review-response": "review",
    "ponytail": "review",
    "commit": "ship",
    "ship": "ship",
    "release": "ship",
    "handoff": "ship",
    "git-rescue": "ship",
    "repo-map": "understand",
    "git-archaeology": "understand",
    "decode": "understand",
    "research": "understand",
    "ingest": "understand",
    "document-project": "understand",
    "wiki": "understand",
    "prose": "understand",
    "geneseed": "understand",
    "rule": "understand",
    "profile": "understand",
    "herdr": "understand",
    "crash-course": "learn",
    "drill": "learn",
    "feynman": "learn",
    "learning-path": "learn",
}


def _parse_laws(text: str) -> list[dict]:
    """Split the rendered laws file into {num, title, klass, body} entries.

    `klass` is the rule's governance class (security, verify, process, craft,
    context, comms) — see LAW_CLASS above — surfaced so the web Laws ledger
    can filter by intent without duplicating the taxonomy client-side.
    """
    laws: list[dict] = []
    cur: dict | None = None
    for line in text.splitlines():
        m = LAW_HEADING_RE.match(line)
        if m:
            if cur:
                laws.append(cur)
            num = m.group(1)
            cur = {
                "num": num,
                "title": m.group(2),
                "klass": LAW_CLASS.get(num, "craft"),
                "body": "",
            }
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
            entry = {"name": parts[1][:-3], "desc": build._first_blockquote(text),
                     "body": text, "source": str(src.resolve())}
            if parts[0] == "agents":
                agents.append(entry)
            elif parts[0] == "skills":
                entry["klass"] = SKILL_CLASS.get(parts[1][:-3], "build")
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
