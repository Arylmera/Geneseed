#!/usr/bin/env python3
"""Geneseed harness CLI — optional automation.

Dependency-free. Subcommands:

    harness build [--theme NAME]   render src/ -> Harness/ for a theme
    harness doctor [--theme NAME]  validate the build: unresolved tokens, dead
                                   links, and non-hermetic links that escape the
                                   bundle. Defaults to the installed theme; --all
                                   sweeps every theme (parity is checked in all modes)
    harness context                resolve context.json and print eager entries'
                                   contents (Rule XVIII enforcement; wire to a
                                   SessionStart hook so the manifest is injected,
                                   never merely requested)
    harness diff [--target DIR]    report how a DEPLOYED global harness differs from
                                   a fresh render of the source (back-port aid) —
                                   --full for unified diffs, --theme to match voice,
                                   --out FILE to export a markdown improvements file
    harness version [--target DIR] show the current source fingerprint vs the
                                   deployed install's, and whether they match
    harness status                 print the install dashboard as text (theme, mode,
                                   counts, memory, version) — headless, any OS
    harness uninstall [--target DIR] remove a global OR project-scoped install via its
                                   manifest (owned files + hooks/instructions entry +
                                   markers); --target takes a repo or a config dir, else
                                   the cwd is checked before falling back to the OpenCode
                                   global config dir. memory/notebook are never deleted —
                                   kept in place, or --archive-memory moves both to
                                   archived-memory/ + archived-notebook/; --yes to skip
                                   the confirm prompt
    harness setup                  interactive, dependency-free install wizard (all OSes)
    harness tui                    full-screen control panel (any VT-capable console)
    harness web                    local web UI over the deployed harness — browse
                                   agents/skills/laws/memory + run doctor/build/
                                   update/diff in the browser (binds 127.0.0.1)
    harness learn [FILE]           distil notes/transcript into memory entries
                                   via a model CLI of your choice (no API key)

`learn` shells out to whatever LLM CLI you configure in $GENESEED_LLM
(e.g. `claude -p`, `llm`, `ollama run ...`). If it is unset, learn prints the
prompt to stdout so you can paste it into any assistant. Geneseed never embeds
an API key and never calls a paid API directly.

Its input is normalised: a lifecycle-hook JSON payload on stdin (with a
`transcript_path`) is read and flattened automatically — so wiring `learn` to a
Stop hook just works, no redirection needed. Given a bundle memory directory
(--memory / $GENESEED_MEMORY, else auto-located), learn dedups against the slugs
already stored, writes only genuinely new fact files, and appends their pointer
lines to `MEMORY.md` — maintaining the index, not just printing suggestions.
"""

from __future__ import annotations

import argparse  # noqa: F401  (used by main(); also re-exported below)

# Topic submodules. harness.py is a thin facade: it owns argument parsing and
# dispatch, while each concern lives in its own _harness_<topic>.py. The file was
# one flat module whose functions call freely across what are now file boundaries
# (the call graph has real cycles), so after importing the submodules we link them
# into ONE shared namespace — every name visible to every submodule and to this
# facade, exactly as when it was a single file. This keeps the CLI / TUI / web and
# the `import harness` surface (web.py, tests) byte-for-byte unchanged.
import _harness_core
import _harness_context
import _harness_learn
import _harness_diff
import _harness_status
import _harness_build
import _harness_setup
import _harness_mcp
import _harness_tui_draw
import _harness_tui_views
import _harness_tui
import _harness_lifecycle
import _harness_menu

_SUBMODULES = (
    _harness_core,
    _harness_context,
    _harness_learn,
    _harness_diff,
    _harness_status,
    _harness_build,
    _harness_setup,
    _harness_mcp,
    _harness_tui_draw,
    _harness_tui_views,
    _harness_tui,
    _harness_lifecycle,
    _harness_menu,
)
_SHARED = {}
for _m in _SUBMODULES:
    _SHARED.update({k: v for k, v in vars(_m).items() if not k.startswith("__")})
for _m in _SUBMODULES:
    vars(_m).update(_SHARED)
globals().update(_SHARED)
del _m




def build_argparser() -> argparse.ArgumentParser:
    """The harness CLI parser, extracted so web/UI layers can introspect it
    (subcommands, flags, help text) without spawning a subprocess. main() and the
    web docs page must read the *same* parser — that is why this lives apart."""
    ap = argparse.ArgumentParser(prog="harness", description="Geneseed harness CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="render src/ -> Harness/")
    b.add_argument("--theme", default=None)
    b.set_defaults(fn=cmd_build)

    rb = sub.add_parser("rebuild-all",
                        help="rebuild every active install in place (each in its own "
                             "theme+emit), best-effort — continue past failures")
    rb.set_defaults(fn=cmd_rebuild_all)

    th = sub.add_parser("theme", help="create a user OpenCode colour theme (solid + transparent) "
                                      "in the live themes dir; survives rebuilds")
    th.add_argument("name", help="theme name (auto-prefixed 'geneseed-'; selected as /theme geneseed-<name>)")
    th.add_argument("--from", dest="from_theme", default=None, metavar="SHIPPED",
                    help="seed the full palette from a shipped theme (e.g. tokyonight), then tweak")
    th.add_argument("--palette", default=None, metavar="FILE",
                    help="JSON palette to apply: {\"palette\":{…}} or a bare role->#hex map")
    th.add_argument("--dir", default=None, help="explicit themes dir (default: auto-detect repo/global)")
    th.add_argument("--global", dest="global_dir", action="store_true",
                    help="write to OpenCode's global themes dir even inside a repo with .opencode/")
    g = th.add_mutually_exclusive_group()
    g.add_argument("--solid-only", action="store_true", help="write only the opaque flavour")
    g.add_argument("--transparent-only", action="store_true", help="write only the transparent flavour")
    th.set_defaults(fn=cmd_theme)

    d = sub.add_parser("doctor",
                       help="validate the build: unresolved tokens, dead links, "
                            "non-hermetic escapes, theme-key parity, and that a "
                            "committed bundle matches src. Defaults to the INSTALLED "
                            "theme (--theme NAME for one, --all to sweep every theme)")
    d.add_argument("--theme", default=None)
    d.add_argument("--all", action="store_true",
                   help="sweep EVERY theme (maintainer full check / CI), not just the "
                        "installed one — the default scopes to the installed theme")
    d.add_argument("--bundle", default=None,
                   help="committed bundle to check for drift vs a fresh render (default: ./Harness)")
    d.add_argument("--no-bundle", action="store_true",
                   help="skip the committed-bundle drift check")
    d.set_defaults(fn=cmd_doctor)

    p = sub.add_parser("prompt", help="emit a self-contained install prompt (no Python needed to use it)")
    p.add_argument("--theme", default=None)
    p.add_argument("--out", default=None, help="write to FILE (default: stdout)")
    p.set_defaults(fn=cmd_prompt)

    c = sub.add_parser("context", help="print context.json eager entries for a SessionStart hook (Rule XVIII)")
    c.add_argument("--root", default=None,
                   help="the install's own dir (set by the emitted hook). A GLOBAL install's "
                        "hook stands down when a Geneseed project install of the same host is "
                        "at/above cwd (project-bypasses-global); GENESEED_STACK_GLOBAL=1 disables.")
    c.set_defaults(fn=cmd_context)

    gg = sub.add_parser("git-gate", help="PreToolUse hook: force an ASK before every git commit/push (Law XX backstop)")
    gg.set_defaults(fn=cmd_git_gate)

    df = sub.add_parser("diff", help="report how a deployed global harness differs from a fresh render (back-port aid)")
    df.add_argument("--target", default=None,
                    help="deployed config dir (default: $OPENCODE_CONFIG_DIR / ~/.config/opencode)")
    df.add_argument("--theme", default=None, help="theme the deployment used "
                    "(default: auto-detected from the deployed marker/sigil)")
    df.add_argument("--full", action="store_true", help="show unified diffs, not just the file-level summary")
    df.add_argument("--out", nargs="?", const=True, default=None, metavar="FILE",
                    help="also write the drift as a markdown improvements file — the "
                         "artifact to hand to an agent to back-port edits into src/ "
                         "(bare --out picks a timestamped file under improvements/)")
    df.set_defaults(fn=cmd_diff)

    ve = sub.add_parser("version", help="show installed vs current-source fingerprint and whether they match")
    ve.add_argument("--target", default=None,
                    help="deployed dir to check (default: the OpenCode global config dir)")
    ve.set_defaults(fn=cmd_version)

    st = sub.add_parser("status", help="print the install dashboard as text (theme, mode, counts, memory, version)")
    st.set_defaults(fn=cmd_status)

    un = sub.add_parser("uninstall",
                        help="remove a global or project-scoped Geneseed install "
                             "(manifest-tracked); memory/notebook are never deleted "
                             "(--archive-memory moves them aside)")
    un.add_argument("--target", default=None,
                    help="repo (project scope) or config dir (global scope) to uninstall "
                         "from; default: the cwd if it holds a project install, else the "
                         "OpenCode global config dir")
    un.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    un.add_argument("--archive-memory", action="store_true",
                    help="move the memory and notebook stores aside to sibling "
                         "archived-memory/ + archived-notebook/ <timestamp> dirs "
                         "(never deleted; default keeps them in place)")
    un.set_defaults(fn=cmd_uninstall)

    le = sub.add_parser("learn", help="distil notes/transcript into memory entries")
    le.add_argument("file", nargs="?",
                    help="notes file, or a transcript (default: stdin — also accepts "
                         "a lifecycle-hook JSON payload with a transcript_path)")
    le.add_argument("--memory", default=None,
                    help="bundle memory dir to dedup against and index into "
                         "(default: $GENESEED_MEMORY, else ./memory or ./Harness/memory)")
    le.add_argument("--consolidate", action="store_true",
                    help="rebuild MEMORY.md from the fact files on disk: re-index "
                         "orphans, prune dead lines, report duplicate descriptions")
    le.set_defaults(fn=cmd_learn)

    su = sub.add_parser("setup", help="interactive install wizard (dependency-free, all OSes)")
    su.set_defaults(fn=cmd_setup)

    tu = sub.add_parser("tui", help="full-screen curses control panel (Unix)")
    tu.add_argument("--theme", default=None, help="theme to show (default: harness.config.json)")
    tu.set_defaults(fn=cmd_tui)

    me = sub.add_parser("menu", help="interactive main menu (the default for ./geneseed)")
    me.set_defaults(fn=cmd_menu)

    hm = sub.add_parser("home", help="default entry for a bare ./geneseed: open the web UI "
                                     "when possible (interactive + GUI browser), else the TUI menu")
    hm.set_defaults(fn=cmd_home)

    bs = sub.add_parser("bootstrap", help="update everything (sync + upgrade) with a "
                                          "progress UI, then run setup")
    bs.add_argument("ref", nargs="?", default=None,
                    help="accepted for back-compat; ignored (git follows the current branch)")
    bs.add_argument("extra", nargs="*", help=argparse.SUPPRESS)  # tolerate a legacy [theme] arg
    bs.add_argument("--no-setup", action="store_true", help="update only; skip the setup wizard")
    bs.set_defaults(fn=cmd_bootstrap)

    up = sub.add_parser("upgrade", help="self-update: git pull the install's origin (ff-only), "
                                        "validate, then rebuild the bundle + every install",
                        aliases=["update"])
    up.add_argument("ref", nargs="?", default=None, help=argparse.SUPPRESS)  # ignored; git follows the current branch
    up.add_argument("theme", nargs="?", default=None, help="optional: force a theme (neutral|imperial|…)")
    up.set_defaults(fn=cmd_upgrade)

    ss = sub.add_parser("sync-self", help="refresh the orchestration layer — launchers + update "
                                          "scripts (cross-platform; replaces sync-self.sh)")
    ss.add_argument("ref", nargs="?", default=None, help=argparse.SUPPRESS)  # ignored; git follows the current branch
    ss.set_defaults(fn=cmd_sync_self)

    wb = sub.add_parser("web", help="serve the deployed harness as a local web UI "
                                    "(browse agents/skills/laws/memory + run actions)")
    wb.add_argument("action", nargs="?", choices=["start", "stop", "restart", "status"], default=None,
                    help="start|stop|restart|status — run the UI as a background daemon so it "
                         "doesn't block the terminal (omit to run in the foreground)")
    wb.add_argument("--theme", default=None, help="force a theme (default: detected)")
    wb.add_argument("--port", type=int, default=4747, help="port (default: 4747)")
    wb.add_argument("--no-browser", action="store_true",
                    help="don't auto-open the browser")
    wb.add_argument("--daemon-internal", action="store_true", help=argparse.SUPPRESS)
    wb.set_defaults(fn=cmd_web)

    lk = sub.add_parser("link", help="put `geneseed` on PATH so it runs from any directory")
    lk.add_argument("dir", nargs="?", default=None, help="bin dir to install into (Unix; default ~/.local/bin)")
    lk.set_defaults(fn=cmd_link)

    ul = sub.add_parser("unlink", help="remove the `geneseed` launcher from PATH")
    ul.set_defaults(fn=cmd_unlink)

    return ap


def main() -> int:
    # Force UTF-8 I/O so injected docs / templates with unicode (sigils, em-dashes)
    # do not crash on a legacy code page (e.g. Windows cp1252). Dependency-free.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass
    ap = build_argparser()
    args = ap.parse_args()
    try:
        return args.fn(args)
    except KeyboardInterrupt:
        # Ctrl-C at any prompt/step is a cancel, not a crash — no traceback.
        print("\n[geneseed] cancelled.", file=sys.stderr)
        return 130
    except BrokenPipeError:
        # `geneseed status | head` closes our stdout early; exit quietly. os._exit
        # avoids the interpreter's own flush-on-exit re-raising into a traceback.
        try:
            sys.stderr.close()
        finally:
            os._exit(0)


if __name__ == "__main__":
    raise SystemExit(main())
