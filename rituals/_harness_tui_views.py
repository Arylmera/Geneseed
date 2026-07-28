"""Geneseed harness — TUI screens and flows: doctor, info/help overlays, the
themed reveal, setup/retheme/grow flows, the diff/memory/status/mcp views.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



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
    footprint = sel.get("footprint", "full")
    posture = sel.get("posture", "peer")
    mode = sel.get("mode", "direct")
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
    argv = _setup_build_args(theme, emit, out, root, footprint, posture, mode)
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
