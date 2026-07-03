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

import subprocess
import tempfile

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


# Mirrors _harness_core.NO_WINDOW: suppress the console flash Windows spawns for a
# child console process started from a console-less parent (the web job runner).
_NO_WINDOW: dict = (
    {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
)


# Mirrors _harness_core.LINK_RE / ABS_LINK_RE (rituals/_harness_build.py's
# _link_problems): build.py cannot import the harness tree (see the module
# docstring's import-direction constraint), so --validate-only's own hermeticity/
# token scan is a small, self-contained duplicate of that regex pair rather than a
# cross-boundary import. Kept intentionally minimal — the full authoring/parity/
# count-table gates below are NOT duplicated; those run for real via a `harness.py
# doctor` subprocess, the same way `doctor` itself already shells out to build.py.
_VALIDATE_TOKEN_RE = re.compile(r"\{\{[A-Z_]+\}\}")
_VALIDATE_LINK_RE = re.compile(r"\]\((?!https?://|#)([^)]+)\)")
_VALIDATE_ABS_LINK_RE = re.compile(r"^([A-Za-z]:[\\/]|/|~)")
_VALIDATE_FENCE_RE = re.compile(r"```.*?```", re.S)
_VALIDATE_INLINE_CODE_RE = re.compile(r"`[^`]*`")
_VALIDATE_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def _validate_strip_code(text: str) -> str:
    text = _VALIDATE_FENCE_RE.sub("", text)
    text = _VALIDATE_COMMENT_RE.sub("", text)
    return _VALIDATE_INLINE_CODE_RE.sub("", text)


def _validate_is_vendored(rel: Path) -> bool:
    """Like build.is_vendored_path, but tolerant of a `skills` segment appearing
    anywhere in the relative path — not only at index 0. is_vendored_path assumes a
    'files'/opencode-global bundle-relative path (skills/<name>/...); the opencode/
    claude/bob PER-REPO native layers nest skills one level deeper
    (.opencode/skills/<name>/..., .claude/skills/<name>/..., .bob/skills/<name>/...),
    a shape doctor's own _check_build has never scanned (it only validates the
    `files` build and the opencode-global emit). --validate-only extends the scan to
    those per-repo layers too, so it must recognise the same vendored exemption there."""
    parts = rel.parts
    for i, part in enumerate(parts[:-1]):
        if part == "skills" and i + 1 < len(parts) and parts[i + 1] in VENDORED_SKILL_DIRS:
            return True
    return False


def _validate_sandbox_problems(sandbox: Path) -> list[str]:
    """Unresolved-token / dead-link / non-hermetic-link scan over an already-rendered
    sandbox tree — the target-specific half of doctor's `_check_build`, reimplemented
    locally (see the constant block above) since build.py cannot import harness.

    .resolve() mirrors _harness_build._check_build's own `out = out.resolve()`: link
    TARGETS below are resolved via `(md.parent / raw).resolve()`, so `sandbox` must be
    resolved too or `_within` compares an unresolved root (possibly an 8.3 short form
    like Windows CI's `RUNNER~1`) against a resolved long-form target and fails
    `relative_to` for every relative link, not just genuinely escaping ones."""
    sandbox = sandbox.resolve()
    problems: list[str] = []
    for md in sandbox.rglob("*.md"):
        rel = md.relative_to(sandbox)
        if _validate_is_vendored(rel):
            continue
        try:
            text = md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for tok in sorted(set(_VALIDATE_TOKEN_RE.findall(text))):
            problems.append(f"unresolved token {{{tok}}} in {rel}")
        for link in _VALIDATE_LINK_RE.findall(_validate_strip_code(text)):
            raw = link.split("#", 1)[0].strip()
            if not raw:
                continue
            if _VALIDATE_ABS_LINK_RE.match(raw):
                problems.append(f"non-hermetic absolute link '{link}' in {rel}")
                continue
            target = (md.parent / raw).resolve()
            if not target.exists():
                problems.append(f"dead link '{link}' in {rel}")
            elif not _within(target, sandbox):
                problems.append(f"non-hermetic link '{link}' escapes the bundle in {rel}")
    return problems


def _within(child: Path, parent: Path) -> bool:
    """Deliberate duplicate of rituals/_harness_core.py's `_within` — build.py cannot
    import the harness tree (see the module docstring's import-direction constraint),
    and four lines of pure Path logic don't justify a shared module across it."""
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _validate_only(args: argparse.Namespace) -> int:
    """--validate-only: render + emit the requested target into a throwaway
    TemporaryDirectory sandbox (never the real --out/--root), run every validation
    that would gate a real build, print what would have been written, and return the
    process exit code (0 clean, 1 any problem) — nothing under the sandbox survives
    past this call, and no marker/manifest/registry write ever happens for real."""
    problems: list[str] = []
    with tempfile.TemporaryDirectory(prefix="geneseed-validate-") as tmp_s:
        # .resolve() mirrors _harness_build._check_build's `out = out.resolve()`: on
        # Windows, TemporaryDirectory can hand back an 8.3 short-form path (e.g. CI
        # runners whose %TEMP% resolves to `RUNNER~1`), while _validate_sandbox_problems
        # below resolves each link TARGET via `(md.parent / raw).resolve()`. Comparing
        # an unresolved short-form sandbox root against a resolved long-form target in
        # `_within` fails `relative_to` for every relative link, not just genuinely
        # escaping ones — resolving here keeps both sides of that comparison in the
        # same (long) form.
        tmp = Path(tmp_s).resolve()
        # With a distinct --root, the per-repo emits split their output: the bundle
        # under `out`, the NATIVE layer (.opencode/ / .claude/ / .bob/, opencode.json)
        # under `root`. Mirror the documented usage (`--out myrepo/Harness --root
        # myrepo`) by nesting the sandbox bundle INSIDE the sandbox root, and scan the
        # root — which then covers both layers; scanning only the bundle silently
        # skipped the native layer entirely on a --root run.
        if args.root:
            root = tmp / "root"
            sandbox = root / "bundle"
        else:
            root = sandbox = tmp / "out"
        cfg = tmp / "cfg"
        emit = args.emit
        try:
            if emit == "opencode":
                emit_opencode(args.theme, sandbox, root, args.footprint)
                scan_dirs = [root]
            elif emit == "opencode-global":
                emit_opencode_global(args.theme, out=sandbox, cfg=cfg, footprint=args.footprint)
                scan_dirs = [cfg]
            elif emit == "claude":
                emit_claude(args.theme, sandbox, root, args.footprint)
                scan_dirs = [root]
            elif emit == "claude-global":
                emit_claude_global(args.theme, out=sandbox, cfg=cfg, footprint=args.footprint)
                scan_dirs = [cfg]
            elif emit == "bob":
                emit_bob(args.theme, sandbox, root, args.footprint)
                scan_dirs = [root]
            elif emit == "bob-global":
                emit_bob_global(args.theme, out=sandbox, cfg=cfg, footprint=args.footprint)
                scan_dirs = [cfg]
            else:
                build(args.theme, sandbox, args.footprint)
                scan_dirs = [sandbox]
        except SystemExit as e:
            print(f"[validate-only] render/emit FAILED for theme '{args.theme}' "
                  f"emit '{emit}': {e}")
            return 1

        written = sorted(p for d in scan_dirs if d.is_dir() for p in d.rglob("*") if p.is_file())
        print(f"[validate-only] theme={args.theme} emit={emit} footprint={args.footprint}")
        print(f"[validate-only] would write {len(written)} file(s) under "
              f"{args.out}" + (f" (root {args.root})" if args.root else "") + " — "
              "nothing was actually written (sandboxed).")
        if args.verbose:
            base = scan_dirs[0]
            for p in written:
                for d in scan_dirs:
                    if _within(p, d):
                        base = d
                        break
                print(f"  would write: {p.relative_to(base)}")

        for d in scan_dirs:
            problems += [f"[{emit}] {p}" for p in _validate_sandbox_problems(d)]

    # Source-tree-wide checks (theme parity, authoring/Task-6 gates, AGENT.md table
    # parity, colour themes) are identical regardless of --out/--root/--emit, and
    # already live fully-tested in the harness tree — shelling to `doctor` reuses them
    # exactly rather than re-deriving them here (build.py cannot import harness; see
    # the module docstring). Mirrors how doctor itself already shells to build.py.
    harness_cli = ROOT / "rituals" / "harness.py"
    doctor_argv = [sys.executable, str(harness_cli), "doctor", "--theme", args.theme,
                   "--no-bundle"]
    # encoding="utf-8" (not text=True's locale default): harness.py reconfigures its
    # OWN stdout to utf-8, but the PARENT's capture_output pipe still decodes with the
    # ambient Windows locale (cp1252) unless told otherwise — the same class of bug
    # this codebase already guards against elsewhere (an em dash/checkmark in the
    # child's doctor output would otherwise come back mojibake'd).
    r = subprocess.run(doctor_argv, capture_output=True, text=True, encoding="utf-8",
                       cwd=ROOT, **_NO_WINDOW)
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.stderr.strip():
        print(r.stderr.strip(), file=sys.stderr)
    if r.returncode != 0:
        problems.append(f"[doctor] source-tree validation failed for theme '{args.theme}' "
                        f"(see output above)")

    if problems:
        print(f"[validate-only] {len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        return 1
    print("[validate-only] ok — would render and emit cleanly, no problems found.")
    return 0


def main() -> None:
    # Same UTF-8 reconfigure as harness.py/_update.py: build.py is also spawned with
    # PIPED stdout (web jobs, upgrade), where Windows defaults to cp1252 — a ⚠️/✗ in a
    # merge warning or E-INCOMPLETE refusal would crash print() with UnicodeEncodeError
    # and eat the diagnostic exactly when it matters.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass
    default_theme = "neutral"
    if CONFIG.exists():
        # A truncated/corrupt config must not brick the CLI — fall back to neutral.
        try:
            data = json.loads(CONFIG.read_text(encoding="utf-8"))
            default_theme = data.get("theme", "neutral") if isinstance(data, dict) else "neutral"
        except (OSError, json.JSONDecodeError):
            print(f"[geneseed] WARN: {CONFIG.name} is unreadable — using theme 'neutral'.",
                  file=sys.stderr)

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
    ap.add_argument("--footprint", choices=["lean", "full"], default="full",
                    help="instruction-set footprint. full (default): every law's full text "
                         "is inlined into AGENT.md §1. lean: §1 carries terse rule lines + a "
                         "pointer to the standalone laws/universal.md (smaller context, lower "
                         "token cost per turn); the full law text always ships alongside, read "
                         "on demand. Applies to every host (opencode/claude/bob) and scope.")
    ap.add_argument("--root", default=None,
                    help="project root the agent/OpenCode run from — where opencode.json "
                         "and .opencode/ are placed (default: same as --out). Set this when "
                         "the bundle lives in a subfolder, e.g. --out myrepo/Harness "
                         "--root myrepo; instruction paths are prefixed accordingly")
    ap.add_argument("--sync-themes", action="store_true",
                    help="maintainer tool: add any key `themes/_TEMPLATE.json` defines "
                         "but a theme JSON is missing (filled with the template's "
                         "placeholder value), print what to restyle, then exit — no "
                         "bundle is rendered. Never removes a theme's extra keys; those "
                         "are reported only. Exits non-zero when it changed files "
                         "(usable as a CI drift check), 0 when already in sync.")
    ap.add_argument("--validate-only", action="store_true",
                    help="dry run: render + emit the requested --theme/--emit/--out/"
                         "--root/--footprint into a throwaway sandbox — nothing under "
                         "the real --out/--root is written, no marker files, no "
                         "settings merge, no install-registry record — then run every "
                         "doctor-grade check (unresolved tokens, dead/non-hermetic "
                         "links, theme parity, authoring gates, AGENT.md table parity) "
                         "against it. Prints what WOULD be written (add -v for full "
                         "paths) and exits non-zero on any problem, 0 when clean.")
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="with --validate-only, list full file paths instead of just "
                         "per-layer counts.")
    args = ap.parse_args()

    if args.sync_themes:
        # Non-zero when files were CHANGED (0 == already in sync), so CI can run
        # `build.py --sync-themes` as a drift check: a red run means keys were
        # filled and now need restyling + committing.
        sys.exit(1 if sync_themes() else 0)

    if args.validate_only:
        sys.exit(_validate_only(args))

    out = resolve_out(args.out)
    root = resolve_out(args.root) if args.root else out
    if args.emit == "opencode":
        emit_opencode(args.theme, out, root, args.footprint)
    elif args.emit == "opencode-global":
        emit_opencode_global(args.theme, out, footprint=args.footprint)
    elif args.emit == "claude":
        emit_claude(args.theme, out, root, args.footprint)
    elif args.emit == "claude-global":
        emit_claude_global(args.theme, out, footprint=args.footprint)
    elif args.emit == "bob":
        emit_bob(args.theme, out, root, args.footprint)
    elif args.emit == "bob-global":
        emit_bob_global(args.theme, out, footprint=args.footprint)
    else:
        build(args.theme, out, args.footprint)

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
        # Footprint marker, written for EVERY emit here (unlike theme, which build() drops
        # for non-globals): claude/bob project installs never call build(), so this is
        # their only footprint record. Read by harness._footprint_of_dir (default 'full').
        (marker_dir / ".geneseed-footprint").write_text(args.footprint + "\n", encoding="utf-8")
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
