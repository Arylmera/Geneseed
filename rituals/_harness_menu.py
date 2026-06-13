"""Geneseed harness — Main menu, settings menu and splash — the interactive entry surface.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives
from _harness_tui import _icon  # noqa: E402  (load-time use in _MENU_ACTIONS)



# (key, label, description). Labels carry a leading mode-aware icon (emoji / symbol /
# ASCII) so the menu reads at a glance; the icon never affects the returned key.
_MENU_ACTIONS_RAW = [
    ("bootstrap", "Install & set up", "Download the latest from upstream, then run the setup wizard."),
    ("theme", "Change theme", "Pick a new voice theme and rebuild in place — install mode and target unchanged."),
    ("browse", "Browse", "Agents, skills and laws, with their full specs."),
    ("memory", "Memory", "Browse / search the memory store; delete stale facts."),
    ("status", "Status", "Theme, install mode, counts, and the memory store."),
    ("diff", "Review local edits", "Compare a deployed harness against source."),
    ("web", "Web UI", "Open the local browser interface over the deployed harness."),
    ("settings", "Settings", "Configuration & maintenance: updates, rebuilds, MCP servers, PATH."),
    ("quit", "Quit", "Leave."),
    # 'doctor' (Health check) intentionally not listed: it runs after setup and via
    # the browse panel's `d` key. The dispatch below still handles it if re-added.
    # The maintenance trio (update / rebuild / change install mode) lives in Settings:
    # the menu leads with the two things a user actually comes back for — get the
    # latest, or change the flavour — instead of four overlapping install variants.
]
_MENU_ACTIONS = [(k, f"{_icon(k)}  {lbl}", d) for (k, lbl, d) in _MENU_ACTIONS_RAW]


# The Settings submenu groups configuration AND maintenance actions reached from the
# main menu — deliberate, occasional flows (updates, rebuilds, mode changes) that
# would otherwise crowd the main menu's install block.
_SETTINGS_ACTIONS_RAW = [
    ("mcp", "MCP servers", "Wire the MarkItDown, GitLab & Filesystem presets (and your own) into OpenCode."),
    ("update", "Update only (download + rebuild)", "Download the latest scripts + factory from upstream and rebuild — no setup wizard."),
    ("build", "Rebuild bundle", "Re-render the harness from src."),
    ("setup", "Change install mode", "Re-run the setup wizard from your LOCAL source — no upstream download."),
    ("link", "Run from anywhere", "Put `geneseed` on your PATH so it runs from any directory."),
    ("unlink", "Remove from PATH", "Remove the `geneseed` launcher symlink from your PATH."),
    ("uninstall", "Uninstall harness", "Remove a global Geneseed install (memory is kept, never deleted)."),
    ("back", "Back", "Return to the main menu."),
]
_SETTINGS_ACTIONS = [(k, f"{_icon(k)}  {lbl}", d) for (k, lbl, d) in _SETTINGS_ACTIONS_RAW]


def _settings_menu(stdscr, curses, pal, here) -> None:
    """Settings submenu — configuration and maintenance (MCP servers, update, rebuild,
    install mode, PATH install). The in-TUI ones return here; link/unlink shell out to
    the launcher's own commands; update re-execs a fresh process (it changed the code
    on disk). Returns to the main menu on Back / cancel."""
    while True:
        sel = _menu(stdscr, curses, "Geneseed  ·  Settings", _SETTINGS_ACTIONS, default="mcp")
        if sel in (None, "back"):
            return
        if sel == "mcp":
            _mcp_view(stdscr, curses, pal)
        elif sel == "update":
            _bootstrap_progress(stdscr, here, None)
            curses.endwin()
            _flush_export_notes()    # before the re-exec replaces this process
            _reexec([sys.executable, str(here / "rituals" / "harness.py"), "menu"])
        elif sel == "build":
            status = _run_steps(stdscr, curses, pal,
                                [("Build the harness", [sys.executable, str(BUILD)])],
                                heading="building")
            ok = bool(status) and status[0] == "done"
            _info_screen(stdscr, curses, pal, "build",
                         [("ok", "Build complete.")] if ok else
                         [("fail", "Build failed — see the output above.")],
                         "Enter: close")
        elif sel == "setup":
            _setup_flow(stdscr)
            # The wizard may have re-themed the install: repaint this submenu's chrome
            # in the new accent (the main menu refreshes itself on return).
            pal = _tui_palette(curses, _accent_for(_installed_defaults()["theme"] or _default_theme()))
        elif sel in ("link", "unlink", "uninstall"):
            # Run the harness's own Python subcommand (no bash): link/unlink manage the
            # PATH entry on every OS; uninstall removes a global install (it prompts on
            # the restored terminal and keeps memory).
            curses.def_prog_mode()
            curses.endwin()
            run([sys.executable, str(here / "rituals" / "harness.py"), sel])
            try:
                input("\n[press Enter to return to settings] ")
            except EOFError:
                pass
            curses.reset_prog_mode()


_SPLASH_SHOWN = False


def _splash(stdscr, curses, pal, theme_data) -> None:
    """A brief, skippable intro: the GENESEED wordmark reveals row by row in the accent
    colour, a strand sweeps beneath it, then the theme sigil fades in — then it clears
    to the menu. No-op under GENESEED_TUI_PLAIN/_ASCII (motion off) or when the terminal
    is too small to frame the wordmark. Any keypress skips straight to the menu."""
    if not _TUI_ANIM:
        return
    h, w = stdscr.getmaxyx()
    logo = _logo_lines()
    lw = _dwidth(logo[0])
    if h < 14 or w < lw + 4:
        return
    sigil = (theme_data.get("LOADED_SIGIL") or theme_data.get("TAGLINE") or "").strip()
    y0 = max(1, (h - len(logo) - 4) // 2)
    lx = max(0, (w - lw) // 2)
    sy = y0 + len(logo) + 1
    curses.curs_set(0)
    stdscr.nodelay(True)
    try:
        for i in range(len(logo)):                       # 1) reveal the wordmark
            stdscr.erase()
            for j in range(i + 1):
                _put(stdscr, y0 + j, lx, logo[j], pal["TITLE"])
            stdscr.refresh()
            if stdscr.getch() != -1:
                raise StopIteration
            curses.napms(70)
        dash = "-" if _TUI_ASCII else "─"
        steps = lw // 2 + 2
        # Width-stable: the strand sweep totals ~700 ms on any terminal width (8–20 ms
        # per step) instead of running longer the wider the wordmark.
        step_ms = max(8, min(20, 700 // max(1, steps)))
        for step in range(1, steps):                     # 2) strand sweeps across
            _put(stdscr, sy, lx, _truncd(dash * (step * 2), lw), pal["FRAME"])
            stdscr.refresh()
            if stdscr.getch() != -1:
                raise StopIteration
            curses.napms(step_ms)
        if sigil:                                        # 3) sigil settles beneath, in
            _put(stdscr, sy + 2, max(0, (w - _dwidth(sigil)) // 2),  # the theme accent
                 _truncd(sigil, w - 2), pal["HEAD"])
            stdscr.refresh()
        curses.napms(280)
    except StopIteration:
        pass
    finally:
        stdscr.nodelay(False)
        stdscr.erase()
        stdscr.clearok(True)


def _maybe_splash(stdscr, curses, pal, theme) -> None:
    """Show the intro animation at most once per process (guarded so re-entering the
    menu or the browse panel doesn't replay it)."""
    global _SPLASH_SHOWN
    if _SPLASH_SHOWN:
        return
    _SPLASH_SHOWN = True
    try:
        data = json.loads((build.THEMES / f"{theme}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    _splash(stdscr, curses, pal, data)


def _main_menu(stdscr) -> int:
    """The hub for a bare `./geneseed`: pick any action. In-TUI ones return here;
    bootstrap (and Settings → update) re-exec a fresh process (they change the code
    on disk)."""
    import curses
    here = Path(__file__).resolve().parent.parent
    hp = str(Path(__file__).resolve())
    inst = _installed_defaults()
    theme = inst["theme"] or _default_theme()
    emit = inst["emit"] or "files"
    pal = _tui_palette(curses, _accent_for(theme))
    _maybe_splash(stdscr, curses, pal, theme)
    while True:
        sel = _menu(stdscr, curses, f"Geneseed  ·  {theme}  ·  {emit}", _MENU_ACTIONS, default="bootstrap")
        if sel in (None, "quit"):
            return 0
        if sel == "browse":
            _tui_loop(stdscr, _tui_inventory(theme))
        elif sel == "doctor":
            _doctor_view(stdscr, curses, pal)
        elif sel == "memory":
            _memory_view(stdscr, curses, pal)
        elif sel in ("theme", "settings"):
            if sel == "theme":
                _retheme_flow(stdscr)
            else:
                _settings_menu(stdscr, curses, pal, here)
            inst = _installed_defaults()
            theme = inst["theme"] or theme   # reflect a re-theme (Settings hosts the wizard too)
            emit = inst["emit"] or emit
            pal = _tui_palette(curses, _accent_for(theme))
        elif sel == "status":
            _status_view(stdscr, curses, pal)
        elif sel == "diff":
            _diff_view(stdscr, curses, pal)
        elif sel == "web":
            curses.def_prog_mode()
            curses.endwin()
            print("[web] starting the local web UI — press Ctrl-C to stop it and "
                  "return to the menu.")
            run([sys.executable, hp, "web"])
            try:
                input("\n[press Enter to return to the menu] ")
            except EOFError:
                pass
            curses.reset_prog_mode()
        elif sel == "bootstrap":
            _bootstrap_progress(stdscr, here, None)
            curses.endwin()
            _flush_export_notes()    # before the re-exec replaces this process
            _reexec([sys.executable, hp, "setup"])


def cmd_menu(args: argparse.Namespace) -> int:
    """Interactive main menu — the default for a bare `./geneseed`. Falls back to a
    one-line command list off a TTY / when no VT console / if curses is unavailable."""
    def _menu_help() -> int:
        print("Geneseed — no interactive menu here. Get started with:  python harness.py setup")
        print("Other commands:  bootstrap · update · build · doctor · diff · tui · web")
        print("On a VT-capable terminal, a bare `./geneseed` opens the interactive menu of these.")
        return 0

    if not sys.stdin.isatty():
        return _menu_help()
    try:
        import curses
        import locale
        try:
            locale.setlocale(locale.LC_ALL, "")
        except locale.Error:
            pass
        rc = curses.wrapper(_main_menu)
        _flush_export_notes()    # re-theme / setup / diff exports, re-shown post-TUI
        return rc
    except Exception as e:
        sys.stderr.write(f"[menu] TUI unavailable ({e}).\n")
        return _menu_help()
