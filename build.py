#!/usr/bin/env python3
"""Geneseed harness generator.

Renders the canonical neutral source in `src/` into a themed, ready-to-port
bundle in `Harness/`. The only thing a theme changes is *terminology* (the labels
in the prose); folder and file names in `Harness/` stay neutral so any
AGENT.md-aware tool can consume them unchanged.

Stdlib only. No dependencies.

Usage:
    python build.py                      # use default theme from harness.config.json
    python build.py --theme imperial     # render the Warhammer-flavoured bundle
    python build.py --theme neutral --out Harness
"""
from __future__ import annotations

# build.py is a thin facade mirroring harness.py: it owns the CLI entry (main)
# and the import-time wiring. The render/emit/global pipelines live in
# _build_{render,emit,global}.py; foundational imports and constants in
# _build_core.py. After importing the submodules we link them into ONE shared
# namespace so cross-module calls resolve as in the original flat file, and the
# `import build` surface (harness, web, tests) stays byte-for-byte unchanged.
#
# Constraint for maintainers: the _build_* submodules must import ONLY stdlib and
# _build_core — never harness or web. harness.py imports build, so a back-import
# here would be circular; that is also why this merge exists instead of build
# simply reusing a shared facade helper from the harness tree.
import _build_core
import _build_render
import _build_emit
import _build_global

_SUBMODULES = (_build_core, _build_render, _build_emit, _build_global)
_SHARED = {}
for _m in _SUBMODULES:
    _SHARED.update({k: v for k, v in vars(_m).items() if not k.startswith('__')})
for _m in _SUBMODULES:
    vars(_m).update(_SHARED)
globals().update(_SHARED)
del _m

# A function reads module-level config (ROOT/SRC/THEMES/CONFIG/...) from the
# namespace it was DEFINED in, not from this facade. So that `build.SRC = tmp`
# (the long-standing way tests redirect the source/theme roots) keeps reaching
# the render/emit code after the split, mirror every attribute write on the
# facade out to the submodules — restoring the single-global behaviour of the
# original flat module without leaking the submodule layout into callers.
import types as _types


class _BuildFacade(_types.ModuleType):
    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        # Only mirror names a submodule already exports, so redirecting a real
        # shared constant (build.SRC = tmp) reaches the code that reads it while
        # a typo (build.ROOTS = ...) can't silently poison every submodule.
        for _sub in _SUBMODULES:
            if hasattr(_sub, name):
                setattr(_sub, name, value)


sys.modules[__name__].__class__ = _BuildFacade


def main() -> None:
    default_theme = "neutral"
    if CONFIG.exists():
        default_theme = json.loads(CONFIG.read_text(encoding="utf-8")).get("theme", "neutral")

    ap = argparse.ArgumentParser(description="Render the Geneseed harness for a theme.")
    ap.add_argument("--theme", default=default_theme, help="theme name (neutral, imperial, ...)")
    ap.add_argument("--out", "--target", dest="out", default="Harness",
                    help="output directory — absolute, or relative to the current "
                         "directory (default: ./Harness)")
    ap.add_argument("--emit",
                    choices=["files", "opencode", "opencode-global", "claude", "claude-global",
                             "bob", "bob-global"],
                    default="files",
                    help="files: plain bundle (default). opencode: bundle + per-repo "
                         ".opencode/ subagents, native skills & opencode.json. "
                         "opencode-global: render straight into OpenCode's global config "
                         "dir ($OPENCODE_CONFIG_DIR / ~/.config/opencode) — everything "
                         "global, zero per-repo files (GLOBAL-HARNESS-SPEC.md). "
                         "claude: per-repo CLAUDE.md + .claude/ (agents, skills, hooks). "
                         "claude-global: render into Claude Code's global config dir "
                         "(~/.claude) — CLAUDE.md, agents, skills, settings.json hooks. "
                         "bob: per-repo AGENTS.md + .bob/ for IBM Bob (agents, skills, "
                         "settings.json). bob-global: render into ~/.bob ($BOB_CONFIG_DIR)")
    ap.add_argument("--root", default=None,
                    help="project root the agent/OpenCode run from — where opencode.json "
                         "and .opencode/ are placed (default: same as --out). Set this when "
                         "the bundle lives in a subfolder, e.g. --out myrepo/Harness "
                         "--root myrepo; instruction paths are prefixed accordingly")
    args = ap.parse_args()

    out = resolve_out(args.out)
    root = resolve_out(args.root) if args.root else out
    if args.emit == "opencode":
        emit_opencode(args.theme, out, root)
    elif args.emit == "opencode-global":
        emit_opencode_global(args.theme, out)
    elif args.emit == "claude":
        emit_claude(args.theme, out, root)
    elif args.emit == "claude-global":
        emit_claude_global(args.theme, out)
    elif args.emit == "bob":
        emit_bob(args.theme, out, root)
    elif args.emit == "bob-global":
        emit_bob_global(args.theme, out)
    else:
        build(args.theme, out)

    # Persist the emit mode + theme (host state) so a later bare `./upgrade.sh` keeps
    # deploying the same way and the setup wizard can detect the install. A global emit
    # renders into the config dir without calling build(), so its markers go there;
    # other modes' go in `out`. The emit name disambiguates the target — no --host flag.
    if args.emit == "opencode-global":
        marker_dir = _opencode_config_dir()
    elif args.emit == "claude-global":
        marker_dir = _claude_config_dir()
    elif args.emit == "bob-global":
        marker_dir = _bob_config_dir()
    else:
        marker_dir = out
    try:
        marker_dir.mkdir(parents=True, exist_ok=True)
        (marker_dir / ".geneseed-emit").write_text(args.emit + "\n", encoding="utf-8")
    except OSError:
        pass
    # build() already drops a .geneseed-theme marker in `out`; the global emits render
    # into the config dir without calling build(), so record the theme there too.
    if args.emit in ("opencode-global", "claude-global", "bob-global"):
        try:
            (marker_dir / ".geneseed-theme").write_text(args.theme + "\n", encoding="utf-8")
        except OSError:
            pass
    # Register per-repo HOST deploy roots so the web console lists harnesses deployed
    # outside its cwd / the global config dirs. Allow-list (not "not global") so a plain
    # `--emit files` bundle — the default dev build — never pollutes the registry: only
    # opencode/claude project emits are ones _EMIT_HOST_SCOPE can map back to a row.
    # Best-effort — mirrors the marker writes above; a registry hiccup must never fail
    # a build. Records `out` (where the marker is); the web Deploy always sends out==root.
    # ponytail: a CLI `--root != --out` bundle records `out` and may read 'absent' (the
    # install layer sits under `root`) — unsupported edge; fix marker_dir=root if needed.
    if args.emit in ("opencode", "claude", "bob"):
        try:
            import _install_registry
            _install_registry.record(marker_dir)
        except Exception:
            pass


if __name__ == "__main__":
    main()
