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
                      root: str | None = None, footprint: str = "full") -> list[str]:
    """The build.py argv for a wizard selection (pure — unit-tested). The global
    emit takes no out/root; the others may. `footprint` adds --footprint only when it
    departs from build.py's own default ('full'), so existing call sites and the argv
    stay byte-identical for full installs."""
    argv = ["--theme", theme, "--emit", emit]
    if emit not in ("opencode-global", "claude-global", "bob-global"):   # globals take no out/root
        if out:
            argv += ["--out", out]
        if root:
            argv += ["--root", root]
    if footprint and footprint != "full":
        argv += ["--footprint", footprint]
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
    opts = [(p.stem, THEME_BLURBS.get(p.stem, "")) for p in build.theme_files()]
    opts.sort(key=lambda kv: (kv[0] != "neutral", kv[0]))
    return opts or [("neutral", THEME_BLURBS["neutral"])]


def _theme_from_agent(agent_md: Path) -> "str | None":
    """Infer a deployed harness's theme by matching each theme's unique LOADED_SIGIL
    line in its AGENT.md — so an install made before .geneseed-theme markers existed
    (or one whose marker was lost) is still recognised."""
    try:
        text = agent_md.read_text(encoding="utf-8")
    except OSError:
        return None
    for tf in build.theme_files():
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
    # Sigil fallback: AGENT.md (OpenCode), CLAUDE.md (Claude), rules/geneseed.md
    # (global Bob — its emit writes no AGENTS.md; the rules file carries the preamble
    # and thus the sigil), AGENTS.md (older Bob installs) — each host's instructions
    # carrier holds the theme sigil. Per-repo Claude/Bob installs write no
    # .geneseed-theme marker, so this is their ONLY detection path.
    return (_theme_from_agent(d / "AGENT.md") or _theme_from_agent(d / "CLAUDE.md")
            or _theme_from_agent(d / "rules" / "geneseed.md")
            or _theme_from_agent(d / "AGENTS.md"))


def _footprint_of_dir(d: Path) -> str:
    """The instruction-set footprint a deployed harness in `d` was built with: the
    `.geneseed-footprint` marker if present, else 'full'. Unlike theme, footprint can't
    be inferred from content, so a pre-marker install (or any built before footprints
    existed) reads as 'full' — which is exactly what it is. Single source of footprint
    detection, mirroring _theme_of_dir."""
    try:
        marker = d / ".geneseed-footprint"
        if marker.is_file():
            v = marker.read_text(encoding="utf-8").strip()
            if v in ("lean", "full"):
                return v
    except OSError:
        pass
    return "full"


def _installed_defaults() -> dict:
    """Best-effort detection of the CURRENT install's theme + emit, so the wizard can
    pre-select them. Prefers the .geneseed-* markers; falls back to inferring the theme
    from a deployed AGENT.md's sigil and the emit from a global manifest — so installs
    predating the markers are still recognised. Checks the global config dir first
    (the recommended install), then common bundle locations."""
    found = {"theme": None, "emit": None, "footprint": None}
    # (base, known_global_emit). Each host's config dir first (OpenCode global is the
    # recommended primary, then Claude, then Bob — every host in build.HOSTS, so a new
    # host can't be forgotten), then common bundle locations (host unknown -> None).
    candidates = []
    for host, spec in build.HOSTS.items():
        try:
            candidates.append((spec["config_dir"](), f"{host}-global"))
        except Exception:
            pass
    candidates += [(p, None) for p in (ROOT / "Harness", ROOT.parent / "Harness",
                                       Path.cwd() / "Harness")]
    for base, known_emit in candidates:
        try:
            if found["emit"] is None:
                em = base / ".geneseed-emit"
                if em.is_file():
                    found["emit"] = em.read_text(encoding="utf-8").strip() or None
                elif (base / ".geneseed-manifest.json").is_file():
                    # A manifest with no emit marker (pre-marker install): a known config
                    # dir names its own host; a bundle tells Claude from OpenCode by shape.
                    found["emit"] = known_emit or (
                        "claude-global" if _manifest_is_claude(base) else "opencode-global")
            if found["theme"] is None:
                found["theme"] = _theme_of_dir(base)
            if found["footprint"] is None and (base / ".geneseed-footprint").is_file():
                found["footprint"] = _footprint_of_dir(base)
        except OSError:
            pass
    return found


EMIT_OPTIONS = [
    ("opencode-global", "OpenCode global config dir — every repo inherits it (recommended)."),
    ("claude-global", "Claude Code global config dir (~/.claude) — CLAUDE.md, agents, skills, hooks."),
    ("opencode", "Per-repo .opencode/ layer committed into one repository."),
    ("claude", "Per-repo CLAUDE.md + .claude/ committed into one repository."),
    ("bob-global", "IBM Bob global config dir (~/.bob) — rules/geneseed.md, agents, skills, settings.json."),
    ("bob", "Per-repo AGENTS.md + .bob/ for IBM Bob, committed into one repository."),
    ("files", "Plain bundle for any AGENT.md tool."),
]


# Instruction-set footprint — how much of the laws AGENT.md §1 carries inline. Lean
# trades a per-turn token saving for a one-read indirection; full is the original.
FOOTPRINT_OPTIONS = [
    ("full", "Full — every law's complete text inlined in AGENT.md (original)."),
    ("lean", "Lean — terse rule lines + a pointer to the full laws file (lighter context)."),
]


def _collect_setup_lines() -> "dict | None":
    """Line-based selection — the cross-platform / no-curses fallback. Returns the
    confirmed selection dict, or None if cancelled."""
    print("Geneseed setup — answer a few questions; nothing is written until you confirm.")
    inst = _installed_defaults()
    theme = _ask_choice("Theme", _theme_options(), inst["theme"] or _default_theme())
    emit = _ask_choice("Install mode", EMIT_OPTIONS, inst["emit"] or "opencode-global")
    footprint = _ask_choice("Footprint", [(k, d) for k, d in FOOTPRINT_OPTIONS],
                            inst["footprint"] or "full")
    out = root = None
    if emit == "opencode":
        root = _ask("Repo root to install into", ".")
        out = root
    elif emit == "files":
        out = _ask("Output dir for the bundle", "Harness")
    print("\nAbout to run:  python build.py "
          + " ".join(_setup_build_args(theme, emit, out, root, footprint)))
    if not _confirm("Proceed?", True):
        return None
    return {"theme": theme, "emit": emit, "out": out, "root": root, "footprint": footprint}


def _java_major_ok(version_output: str, minimum: int = 21) -> bool:
    """True if a `java -version` stderr names a major >= minimum. Handles modern
    '21.0.2' (-> 21) and legacy '1.8.0' (-> 1, never >= 21)."""
    import re
    m = re.search(r'version "(\d+)', version_output)
    return bool(m) and int(m.group(1)) >= minimum


def _lsp_prereqs() -> list[tuple[str, bool, str]]:
    """(label, present, install-hint) for the LSP prerequisites OpenCode cannot
    self-install. Today that's just a JDK 21+ for jdtls; the JS-runtime servers
    (typescript, pyright) self-download and SQL is uncovered by design. Returns a
    list so a future prereq drops in without changing callers."""
    import shutil, subprocess
    java = shutil.which("java")
    ok = False
    if java:
        try:
            out = subprocess.run([java, "-version"], capture_output=True, text=True).stderr
            ok = _java_major_ok(out)
        except Exception:
            ok = False
    return [("Java 21+ (jdtls)", ok,
             "install a JDK 21+ — e.g. `brew install openjdk@21`, "
             "SDKMAN `sdk install java 21-tem`, or your distro's package")]


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
    # LSP prereqs — only for OpenCode emits, which are the ones that get "lsp": true.
    # Self-installing servers (typescript, pyright) need no line; jdtls needs a JVM.
    if ok and emit.startswith("opencode"):
        for label, present, hint in _lsp_prereqs():
            lines.append(("ok", f"{label} present") if present
                         else ("warn", f"{label} missing — {hint}"))
    lines.append(("info", f"theme is now '{theme}' — start a NEW OpenCode session for the new voice"))
    return lines


def _setup_lines() -> int:
    """Line-based setup (Windows / no-curses): gather, build, summary, optional doctor."""
    sel = _collect_setup_lines()
    if not sel:
        print("[setup] cancelled — nothing written.")
        return 0
    theme, emit, out, root = sel["theme"], sel["emit"], sel.get("out"), sel.get("root")
    footprint = sel.get("footprint", "full")
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
    argv = _setup_build_args(theme, emit, out, root, footprint)
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
