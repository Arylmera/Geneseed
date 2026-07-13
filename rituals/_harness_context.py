"""Geneseed harness — Project-context discovery (Rule XVIII) and the git-gate hook.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



# ---- project-context discovery ---------------------------------------------------
# Kept in step with adapters/opencode/plugins/geneseed-context.js (EAGER_ROOT /
# LAZY_DIRS / EXCLUDE_DIRS) so the Claude hook and the OpenCode plugin discover the
# SAME docs. Root entry docs are injected in full; doc trees are listed lazily.
EAGER_ROOT = ("AGENTS.md", "AGENT.md", "CLAUDE.md", ".cursorrules",
              "README.md", "CONTRIBUTING.md", "user-rules.md", "PROFILE.md")
LAZY_DIRS = ("docs", "doc", "documentation", "architecture", "adr", "ADR")
EXCLUDE_DIRS = {"node_modules", ".git", "dist", "build", "vendor", ".next",
                "target", ".venv", "__pycache__", ".opencode", ".harness"}


# ---- project-bypasses-global stand-down ------------------------------------------
# The emitted SessionStart hook passes its own install dir as --root. A GLOBAL install's
# hook (root is a host config dir, e.g. ~/.claude) must stand down when a Geneseed PROJECT
# install of the SAME host sits at/above cwd — the project's own hook injects, so the
# global one must not double up. Detection is an up-walk for the host's marker dir carrying
# a Geneseed manifest, matching how Claude itself finds CLAUDE.md/settings from a subdir.
# Literals (not imported from build) keep the hook dependency-free. GENESEED_STACK_GLOBAL=1
# restores the old stacking.
_CLAUDE_MARKERS = (".claude", ".bob")
_GENESEED_MANIFEST = ".geneseed-manifest.json"


def _global_hook_standing_down(hook_root: Path, cwd: Path) -> bool:
    """True iff `hook_root` is a host marker dir and a Geneseed project install of the SAME
    host (its marker + manifest) sits at/above `cwd` and is a DIFFERENT install — i.e. this
    is the global hook and a project hook will cover the session."""
    marker = hook_root.name
    if marker not in _CLAUDE_MARKERS:
        return False
    for d in (cwd, *cwd.parents):
        cand = d / marker
        if (cand / _GENESEED_MANIFEST).is_file():
            return cand.resolve() != hook_root.resolve()
    return False


# ---- sovereign-repo bypass ---------------------------------------------------------
# The user's excludes.json (seeded by every global emit, managed by `harness exclude`)
# lists folders where the GLOBAL install goes fully dormant — typically repos that are
# complete agent harnesses of their own. Read on EVERY hook call so edits take effect
# immediately, no re-emit. Literal filename (not imported from build) keeps the hook
# dependency-free, same as _GENESEED_MANIFEST above.
_EXCLUDES_FILE = "excludes.json"


def sovereign_bypass(root) -> bool:
    """True iff cwd sits at/under any folder listed in <root>/excludes.json. Every
    failure mode (no root, missing/malformed file, unreadable cwd) degrades to False —
    a hook must never fail or block on the user's own file."""
    if not root:
        return False
    try:
        data = json.loads((Path(root) / _EXCLUDES_FILE).read_text(encoding="utf-8"))
        entries = data.get("excludes") or []
    except (OSError, json.JSONDecodeError, AttributeError, ValueError):
        return False
    try:
        cwd = os.path.normcase(str(Path.cwd().resolve()))
    except OSError:
        return False
    for entry in entries:
        raw = (entry.get("path") if isinstance(entry, dict) else entry) or ""
        if not isinstance(raw, str) or not raw.strip():
            continue
        base = os.path.normcase(str(Path(raw.strip()).expanduser())).rstrip("\\/")
        if cwd == base or cwd.startswith(base + os.sep):
            return True
    return False


def _disp(path_str: str, root: Path) -> str:
    """Show a path relative to the repo root when it sits under it, else verbatim."""
    try:
        return os.path.relpath(path_str, root).replace(os.sep, "/")
    except ValueError:
        return path_str


def _discover_context(root: Path) -> tuple[list[dict], list[dict]]:
    """Auto-discover a repo's docs by convention — the no-manifest path, mirroring the
    OpenCode context plugin. Root entry docs are eager; other root .md, doc trees, and
    monorepo package READMEs are lazy. Returns (eager, lazy) lists of {path,
    description} with absolute paths and empty descriptions (discovery has none)."""
    eager: dict[str, None] = {}
    lazy: dict[str, None] = {}
    try:
        for entry in sorted(root.iterdir()):
            if entry.is_file():
                if entry.name in EAGER_ROOT:
                    eager[str(entry)] = None
                elif entry.suffix.lower() == ".md":
                    lazy[str(entry)] = None
    except OSError:
        pass
    for d in LAZY_DIRS:
        sub = root / d
        if sub.is_dir():
            for md in sorted(sub.rglob("*.md")):
                if EXCLUDE_DIRS.intersection(md.relative_to(root).parts):
                    continue
                if str(md) not in eager:
                    lazy.setdefault(str(md), None)
    for group in ("packages", "apps"):
        base = root / group
        if not base.is_dir():
            continue
        try:
            pkgs = sorted(base.iterdir())
        except OSError:
            pkgs = []
        for pkg in pkgs:
            if pkg.is_dir() and pkg.name not in EXCLUDE_DIRS:
                readme = pkg / "README.md"
                if readme.is_file() and str(readme) not in eager:
                    lazy.setdefault(str(readme), None)
    e = [{"path": p, "description": ""} for p in eager]
    l = [{"path": p, "description": ""} for p in lazy if p not in eager]
    return e, l


def _resolve_context_sets(root: Path) -> tuple[list[dict], list[dict], str]:
    """Resolve eager/lazy entry sets + a source label. Precedence mirrors the OpenCode
    plugin: an explicit manifest ($GENESEED_CONTEXT, .harness/context.json, or
    context.json) wins; "extend": true layers it on top of discovery; an empty (stub)
    manifest falls through to pure auto-discovery — so usually you configure nothing."""
    manifest = None
    env = os.environ.get("GENESEED_CONTEXT")
    if env and Path(env).is_file():
        manifest = Path(env)
    else:
        for cand in (root / ".harness" / "context.json", root / "context.json"):
            if cand.is_file():
                manifest = cand
                break

    if manifest is None:
        e, l = _discover_context(root)
        return e, l, f"auto-discovery [{root}]"

    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        entries = data.get("context", []) or []
        extend = bool(data.get("extend"))
    except (json.JSONDecodeError, OSError) as exc:
        sys.stderr.write(f"[context] could not parse {manifest}: {exc}\n")
        return [], [], str(manifest)

    if not entries and not extend:
        e, l = _discover_context(root)
        return e, l, f"auto-discovery [{root}] (empty {manifest.name})"

    recs: dict[str, dict] = {}

    def put(path_str: str, load: str, desc: str) -> None:
        prev = recs.get(path_str)
        recs[path_str] = {"path": path_str, "load": load,
                          "description": desc or (prev or {}).get("description", "")}

    if extend:
        de, dl = _discover_context(root)
        for x in de:
            put(x["path"], "eager", "")
        for x in dl:
            put(x["path"], "lazy", "")

    for entry in entries:
        raw = (entry.get("path") or "").strip()
        if not raw:
            continue
        load = entry.get("load", "eager")
        desc = entry.get("description", "")
        if "*" in raw:
            # A glob reclassifies already-known files (matches the plugin); it never
            # pulls in new ones.
            for path_str, rec in list(recs.items()):
                if fnmatch.fnmatch(_disp(path_str, root), raw):
                    put(path_str, load, desc or rec["description"])
            continue
        abs_path = raw if os.path.isabs(raw) else str((root / raw).resolve())
        put(abs_path, load, desc)

    eager = [{"path": r["path"], "description": r["description"]}
             for r in recs.values() if r["load"] == "eager"]
    lazy = [{"path": r["path"], "description": r["description"]}
            for r in recs.values() if r["load"] == "lazy"]
    return eager, lazy, str(manifest)


def cmd_context(args: argparse.Namespace) -> int:
    """Resolve the project context and print eager entries' contents so a SessionStart
    hook injects them — Rule XVIII without relying on the agent to read anything. With
    no manifest (or an empty stub) the repo's docs are AUTO-DISCOVERED by convention,
    matching the OpenCode context plugin; a manifest overrides and "extend": true
    layers on top. Lazy entries are only listed.

    Safe in a hook: any error prints a note to stderr and exits 0, never blocking a
    session start."""
    # Discover against the project root the hook runs from (Claude runs SessionStart
    # hooks with cwd = repo root), not the harness package dir — so the project's own
    # docs are found. $GENESEED_ROOT overrides for non-standard layouts.
    root = Path(os.environ.get("GENESEED_ROOT") or Path.cwd()).resolve()
    # Project-bypasses-global: a global install's hook stands down when a project install of
    # the same host covers this repo (the project hook injects instead). Opt out with
    # GENESEED_STACK_GLOBAL=1. Never blocks a session — worst case it injects as before.
    hook_root = Path(args.root).resolve() if getattr(args, "root", None) else None
    # Sovereign-repo bypass: inside a user-excluded folder the global install is fully
    # dormant — exit silently before any discovery. See excludes.json / `harness exclude`.
    if hook_root and sovereign_bypass(hook_root):
        return 0
    if hook_root and not os.environ.get("GENESEED_STACK_GLOBAL") \
            and _global_hook_standing_down(hook_root, root):
        return 0
    eager, lazy, source = _resolve_context_sets(root)
    if not eager and not lazy:
        sys.stderr.write(f"[context] nothing to load for {root} "
                         f"(no docs discovered, no manifest entries).\n")
        return 0

    out: list[str] = [
        f"=== PROJECT CONTEXT — binding for this repo per Rule XVIII (via {source}) ===",
        "",
    ]
    for entry in eager:
        path = entry.get("path", "")
        desc = entry.get("description", "")
        target = Path(path)
        if not target.is_absolute():
            target = root / path
        out.append(f"----- {_disp(path, root)}" + (f" — {desc}" if desc else "") + " -----")
        try:
            out.append(target.read_text(encoding="utf-8").rstrip("\n"))
        except OSError as e:
            out.append(f"[context] MISSING eager file: {e}")
        out.append("")

    if lazy:
        out.append("--- Lazy entries (load only when the task needs them) ---")
        for entry in lazy:
            path = entry.get("path", "")
            desc = entry.get("description", "")
            out.append(f"  - {_disp(path, root)}" + (f" — {desc}" if desc else ""))
        out.append("")

    sys.stdout.write("\n".join(out) + "\n")
    return 0


# ---- git-gate: per-action commit/push confirmation (Law XX tool-boundary backstop) -
# A `git` verb anywhere in the command — including chained (`git add . && git commit
# … && git push`) and `-C <path>` forms — trips the gate, so a compound one-liner can
# never slip a commit/push past the prompt.
GIT_GATE_RE = re.compile(r"\bgit\b[^\n]*\b(?:commit|push)\b")


def cmd_git_gate(args: argparse.Namespace) -> int:
    """PreToolUse hook: force the host to ASK before EVERY git commit or push, on any
    branch — Law XX's tool-boundary backstop. Reads the Claude Code PreToolUse payload
    from stdin ({"tool_name","tool_input":{"command":...}}); when the command runs a
    git commit/push it prints a `permissionDecision: "ask"` so the host re-prompts on
    every call — a decision a one-time "don't ask again" cannot suppress, since the
    allow rule it writes is only consulted AFTER this hook runs. Every other tool call
    (and any unreadable payload) exits 0 with no output, deferring to the normal
    permission flow — a hook must never break a tool call (cf. cmd_context)."""
    # Sovereign-repo bypass (see cmd_context): inside an excluded folder the gate
    # defers entirely to the host's normal permission flow.
    if sovereign_bypass(getattr(args, "root", None)):
        return 0
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        command = (payload.get("tool_input") or {}).get("command", "")
    except (json.JSONDecodeError, AttributeError, TypeError):
        return 0
    if not isinstance(command, str) or not GIT_GATE_RE.search(command):
        return 0
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason":
            "Geneseed Law XX — every git commit/push needs explicit approval",
    }}))
    return 0
