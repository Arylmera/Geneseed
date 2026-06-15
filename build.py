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
    ap.add_argument("--emit", choices=["files", "opencode", "opencode-global"], default="files",
                    help="files: plain bundle (default). opencode: bundle + per-repo "
                         ".opencode/ subagents, native skills & opencode.json. "
                         "opencode-global: render straight into OpenCode's global config "
                         "dir ($OPENCODE_CONFIG_DIR / ~/.config/opencode) — everything "
                         "global, zero per-repo files (GLOBAL-HARNESS-SPEC.md)")
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
    else:
        build(args.theme, out)

    # Persist the emit mode (host state) so a later bare `./upgrade.sh` keeps
    # deploying the same way — regardless of which entrypoint chose it. Global mode's
    # marker lives in the config dir (no Harness is built); other modes' in `out`.
    emit_marker = (_opencode_config_dir() if args.emit == "opencode-global" else out) / ".geneseed-emit"
    try:
        emit_marker.parent.mkdir(parents=True, exist_ok=True)
        emit_marker.write_text(args.emit + "\n", encoding="utf-8")
    except OSError:
        pass

    # build() already drops a .geneseed-theme marker in `out`; the global emit renders
    # into the config dir without calling build(), so record the theme there too —
    # so tools (e.g. the setup wizard) can detect the installed theme later.
    if args.emit == "opencode-global":
        try:
            (_opencode_config_dir() / ".geneseed-theme").write_text(args.theme + "\n", encoding="utf-8")
        except OSError:
            pass


if __name__ == "__main__":
    main()
