"""Geneseed harness — Line-mode install wizard plus theme/install introspection helpers.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



# ---- interactive: setup wizard + curses control panel ----------------------

def _ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        ans = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        return default
    return ans or default


def _confirm(prompt: str, default: bool = True) -> bool:
    ans = _ask(f"{prompt} ({'Y/n' if default else 'y/N'})").lower()
    return default if not ans else ans[0] == "y"


def _ask_choice(prompt: str, options: list[tuple[str, str]], default: str) -> str:
    """Print numbered options; return the chosen key (default on empty/invalid)."""
    print(f"\n{prompt}:")
    for i, (key, desc) in enumerate(options, 1):
        label = f"{key} — {desc}" if desc else key
        print(f"  {i}) {label}" + ("   (default)" if key == default else ""))
    default_idx = str(next(i for i, (k, _) in enumerate(options, 1) if k == default))
    raw = _ask("Choose", default_idx)
    try:
        idx = int(raw)
        if 1 <= idx <= len(options):
            return options[idx - 1][0]
    except ValueError:
        for key, _ in options:
            if raw == key:
                return key
    return default


def _setup_build_args(theme: str, emit: str, out: str | None = None,
                      root: str | None = None) -> list[str]:
    """The build.py argv for a wizard selection (pure — unit-tested). The global
    emit takes no out/root; the others may."""
    argv = ["--theme", theme, "--emit", emit]
    if emit != "opencode-global":
        if out:
            argv += ["--out", out]
        if root:
            argv += ["--root", root]
    return argv


def _default_theme() -> str:
    if build.CONFIG.exists():
        try:
            return json.loads(build.CONFIG.read_text(encoding="utf-8")).get("theme", "neutral")
        except (json.JSONDecodeError, OSError):
            pass
    return "neutral"


# Short blurbs for the setup wizard's theme picker; any theme without one just shows
# its name. Themes are discovered from themes/*.json, so a new theme appears with no
# code change — only an (optional) line here for a friendlier label.
THEME_BLURBS = {
    "neutral": "plain professional voice",
    "imperial": "Warhammer 40k",
    "military": "ops / SOP / radio-brevity",
    "pirate": "high-seas crew",
    "wizard": "arcane grimoire",
    "cyberpunk": "netrunner",
    "gamer": "speedrunner / co-op",
    "sports": "play-by-play commentator",
}


def _theme_options() -> list[tuple[str, str]]:
    opts = [(p.stem, THEME_BLURBS.get(p.stem, "")) for p in sorted(build.THEMES.glob("*.json"))]
    return opts or [("neutral", THEME_BLURBS["neutral"])]


def _theme_from_agent(agent_md: Path) -> "str | None":
    """Infer a deployed harness's theme by matching each theme's unique LOADED_SIGIL
    line in its AGENT.md — so an install made before .geneseed-theme markers existed
    (or one whose marker was lost) is still recognised."""
    try:
        text = agent_md.read_text(encoding="utf-8")
    except OSError:
        return None
    for tf in sorted(build.THEMES.glob("*.json")):
        try:
            sig = json.loads(tf.read_text(encoding="utf-8")).get("LOADED_SIGIL", "")
        except (json.JSONDecodeError, OSError):
            continue
        if sig and sig in text:
            return tf.stem
    return None


def _theme_of_dir(d: Path) -> "str | None":
    """The theme a deployed harness in `d` was built with: the `.geneseed-theme`
    marker if present, else inferred from its AGENT.md sigil. Single source of theme
    detection — used by install detection, the doctor's default scope, and the diff's
    'expected' render so each compares against the theme actually deployed."""
    try:
        marker = d / ".geneseed-theme"
        if marker.is_file():
            name = marker.read_text(encoding="utf-8").strip()
            if name:
                return name
    except OSError:
        pass
    return _theme_from_agent(d / "AGENT.md")


def _installed_defaults() -> dict:
    """Best-effort detection of the CURRENT install's theme + emit, so the wizard can
    pre-select them. Prefers the .geneseed-* markers; falls back to inferring the theme
    from a deployed AGENT.md's sigil and the emit from a global manifest — so installs
    predating the markers are still recognised. Checks the global config dir first
    (the recommended install), then common bundle locations."""
    found = {"theme": None, "emit": None}
    candidates = []
    try:
        candidates.append(build._opencode_config_dir())
    except Exception:
        pass
    candidates += [ROOT / "Harness", ROOT.parent / "Harness", Path.cwd() / "Harness"]
    for base in candidates:
        try:
            if found["emit"] is None:
                em = base / ".geneseed-emit"
                if em.is_file():
                    found["emit"] = em.read_text(encoding="utf-8").strip() or None
                elif (base / ".geneseed-manifest.json").is_file():
                    found["emit"] = "opencode-global"
            if found["theme"] is None:
                found["theme"] = _theme_of_dir(base)
        except OSError:
            pass
    return found


EMIT_OPTIONS = [
    ("opencode-global", "OpenCode global config dir — every repo inherits it (recommended)."),
    ("opencode", "Per-repo .opencode/ layer committed into one repository."),
    ("files", "Plain bundle for any AGENT.md tool."),
]


def _collect_setup_lines() -> "dict | None":
    """Line-based selection — the cross-platform / no-curses fallback. Returns the
    confirmed selection dict, or None if cancelled."""
    print("Geneseed setup — answer a few questions; nothing is written until you confirm.")
    inst = _installed_defaults()
    theme = _ask_choice("Theme", _theme_options(), inst["theme"] or _default_theme())
    emit = _ask_choice("Install mode", EMIT_OPTIONS, inst["emit"] or "opencode-global")
    out = root = None
    if emit == "opencode":
        root = _ask("Repo root to install into", ".")
        out = root
    elif emit == "files":
        out = _ask("Output dir for the bundle", "Harness")
    print("\nAbout to run:  python build.py " + " ".join(_setup_build_args(theme, emit, out, root)))
    if not _confirm("Proceed?", True):
        return None
    return {"theme": theme, "emit": emit, "out": out, "root": root}


def _collect_setup() -> "dict | None":
    """Gather the install selection — a colored curses form where the terminal
    supports it, else the line prompts. Returns the confirmed selection or None."""
    if sys.stdin.isatty():
        try:
            import curses
            import locale
            try:
                locale.setlocale(locale.LC_ALL, "")
            except locale.Error:
                pass
            return curses.wrapper(_setup_tui)
        except Exception:
            pass  # any curses failure → fall back to the line wizard
    return _collect_setup_lines()


def _setup_summary_lines(theme, emit, out, root, ok):
    """Post-build summary as (kind, text) rows. kind is ok | warn | info."""
    agent_md = (build._opencode_config_dir() / "AGENT.md" if emit == "opencode-global"
                else build.resolve_out(out or "Harness") / "AGENT.md")
    lines = []
    if ok and agent_md.exists():
        lines.append(("ok", f"AGENT.md written to {agent_md}"))
    elif ok:
        lines.append(("warn", f"expected AGENT.md at {agent_md} but it is not there"))
    else:
        lines.append(("warn", "build failed — see the output above"))
    if emit == "opencode-global":
        cfg_dir = build._opencode_config_dir()
        if sys.platform.startswith("win"):
            hint = f'learn plugin: $env:GENESEED_HARNESS = "{cfg_dir}"  (persist: setx GENESEED_HARNESS "{cfg_dir}")'
        else:
            hint = 'learn plugin: export GENESEED_HARNESS="$HOME/.config/opencode"'
        lines.append(("info", hint))
    elif emit == "files":
        lines.append(("info", f"point your tool's instructions at {agent_md}"))
    try:
        cfg = build._opencode_config_dir()
        if emit != "opencode-global" and (cfg / ".geneseed-manifest.json").exists():
            lines.append(("warn", f"a global install exists at {cfg} — OpenCode loads THAT, "
                                  f"not this build; re-run with 'opencode-global' to change it"))
    except Exception:
        pass
    lines.append(("info", f"theme is now '{theme}' — start a NEW OpenCode session for the new voice"))
    return lines


def _setup_lines() -> int:
    """Line-based setup (Windows / no-curses): gather, build, summary, optional doctor."""
    sel = _collect_setup_lines()
    if not sel:
        print("[setup] cancelled — nothing written.")
        return 0
    theme, emit, out, root = sel["theme"], sel["emit"], sel.get("out"), sel.get("root")
    if emit == "opencode-global":
        # The build below overwrites the deployed global harness; the self-improvement
        # loops may have edited it in place. Preserve that drift first.
        try:
            ipath, _ifiles = export_improvements()
            if ipath:
                print(f"- local edits found in the deployed harness — saved to {ipath}")
                print("  (hand that file to your agent to back-port them into src/)")
        except Exception as e:
            print(f"! could not export local edits ({e}) — continuing.")
    argv = _setup_build_args(theme, emit, out, root)
    print("Running:  python build.py " + " ".join(argv))
    rc = run([sys.executable, str(BUILD), *argv]).returncode
    if rc != 0:
        sys.stderr.write("[setup] build failed — no harness written (see the output above).\n")
        return rc
    try:
        import theme_anim
        theme_anim.play_line(theme, True)        # themed install animation (motion → reveal card)
    except Exception:
        pass                                     # cosmetic only — never block a successful install
    for kind, text in _setup_summary_lines(theme, emit, out, root, True):
        print({"ok": "✓", "warn": "!", "info": "-"}.get(kind, "-") + " " + text)
    if _confirm("\nRun a health check (doctor) now?", True):
        # Scope to the theme we just installed — no full-sweep noise post-install.
        return cmd_doctor(argparse.Namespace(theme=theme, all=False,
                                             bundle=None, no_bundle=False))
    return 0


def cmd_setup(args: argparse.Namespace) -> int:
    """Guided install wizard. On a Unix terminal it is one seamless curses flow —
    form → build → summary → health check, without leaving the TUI. Falls back to
    line prompts on Windows / no-TTY / any curses failure."""
    if not sys.stdin.isatty():
        sys.stderr.write("[setup] needs an interactive terminal. Non-interactive? e.g.:\n"
                         "  python build.py --emit opencode-global --theme neutral\n")
        return 1
    try:
        import curses
        import locale
        try:
            locale.setlocale(locale.LC_ALL, "")
        except locale.Error:
            pass
        rc = curses.wrapper(_setup_flow)
        _flush_export_notes()    # the in-TUI notice dies with the alternate screen
        return rc
    except Exception as e:
        sys.stderr.write(f"[setup] TUI unavailable ({e}); using prompts.\n")
    return _setup_lines()
