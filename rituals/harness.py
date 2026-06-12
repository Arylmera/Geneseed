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
    harness uninstall [--target DIR] remove a global install via its manifest (owned
                                   files + opencode.json entry + markers); memory is
                                   never deleted — kept in place, or --archive-memory
                                   moves it to archived-memory/; --yes to skip prompt
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

import argparse
import contextlib
import datetime
import difflib
import fnmatch
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build.py"
sys.path.insert(0, str(ROOT))
import build  # noqa: E402  (path adjusted above)

# curses ships in the Unix stdlib but not on Windows. When it is absent, install the
# pure-stdlib VT shim (rituals/_winterm.py) under the `curses` name so the full-screen
# TUI runs natively on a VT-capable Windows console; every later `import curses`
# resolves to the shim, and its wrapper() raises Unsupported (caught by each caller)
# when no VT console is available, so we degrade to the line wizard.
try:
    import curses  # noqa: F401
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import _winterm  # noqa: E402
    sys.modules["curses"] = _winterm

TOKEN_RE = re.compile(r"\{\{[A-Z_]+\}\}")
LINK_RE = re.compile(r"\]\((?!https?://|#)([^)]+)\)")
# A link target that leaves the bundle: POSIX-absolute, home (~), or Windows drive.
ABS_LINK_RE = re.compile(r"^([A-Za-z]:[\\/]|/|~)")
FENCE_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`[^`]*`")
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def strip_code(text: str) -> str:
    """Remove fenced blocks, inline code, and HTML comments so link-syntax shown
    as documentation is not mistaken for a real link."""
    text = FENCE_RE.sub("", text)
    text = COMMENT_RE.sub("", text)
    return INLINE_CODE_RE.sub("", text)

# Cap the notes fed to the model so a long transcript can't blow up the prompt.
# The tail is kept — the most recent exchanges carry the durable decisions.
MAX_NOTES_CHARS = 16000

def _load_learn_prompt_head() -> str:
    """Single source of truth for the distil instructions is the OpenCode plugin
    (adapters/opencode/plugins/geneseed-learn.js) — the artifact that ships to the
    primary runtime. Extract its LEARN_PROMPT_HEAD template literal at load time so
    this CLI and the plugin can never drift (the old copy-pasted constant was a
    standing hazard, flagged "edit both together"). Falls back to a one-line
    instruction if the plugin is unreadable, so a Stop hook never crashes over it."""
    js = build.PLUGIN_SRC / "geneseed-learn.js"
    try:
        m = re.search(r"const LEARN_PROMPT_HEAD = `([\s\S]*?)`",
                      js.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    except OSError:
        pass
    return ("Distil at most one durable, reusable memory from the notes below. "
            "When in doubt, output exactly: NOTHING.")


LEARN_PROMPT_HEAD = _load_learn_prompt_head()


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, **kw)


def cmd_build(args: argparse.Namespace) -> int:
    extra = ["--theme", args.theme] if args.theme else []
    return run([sys.executable, str(BUILD), *extra]).returncode


def _within(child: Path, parent: Path) -> bool:
    """True if `child` is `parent` or sits under it — the hermeticity test."""
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _link_problems(md: Path, text: str, out: Path, rel: Path) -> list[str]:
    """Dead links AND non-hermetic links — any target that leaves the bundle.
    Hermeticity (DESIGN Decision 5) is the invariant that lets the bundle be
    copied/subtree-split into any repo; a link escaping `out` silently breaks it."""
    problems: list[str] = []
    for link in LINK_RE.findall(strip_code(text)):
        raw = link.split("#", 1)[0].strip()
        if not raw:
            continue
        if ABS_LINK_RE.match(raw):
            problems.append(f"non-hermetic absolute link '{link}' in {rel}")
            continue
        target = (md.parent / raw).resolve()
        if not target.exists():
            problems.append(f"dead link '{link}' in {rel}")
        elif not _within(target, out):
            problems.append(f"non-hermetic link '{link}' escapes the bundle in {rel}")
    return problems


def _check_build(theme_name: str, out: Path) -> list[str]:
    """Scan one rendered bundle for unresolved tokens, dead links, and escapes."""
    out = out.resolve()
    problems: list[str] = []
    for md in out.rglob("*.md"):
        rel = md.relative_to(out)
        # Vendored third-party skill folders are verbatim upstream docs: their internal
        # cross-links reference the upstream project's own (partly un-vendored) files and
        # they carry their own license, so they are exempt from Geneseed's hermeticity /
        # dead-link invariant. (None are vendored at present — see build.VENDORED_SKILL_DIRS.)
        if build.is_vendored_path(rel):
            continue
        text = md.read_text(encoding="utf-8")
        for tok in set(TOKEN_RE.findall(text)):
            problems.append(f"[{theme_name}] unresolved token {tok} in {rel}")
        problems += [f"[{theme_name}] {p}" for p in _link_problems(md, text, out, rel)]
    return problems


def _theme_parity_problems() -> list[str]:
    """Every theme must define the same VOICE keys. A token present in one theme but
    absent from another renders as a raw {{TOKEN}} only in the files that use it, and
    only under that theme — a plain build can miss it. Compare the maps directly."""
    themes: dict[str, dict] = {}
    for p in sorted(build.THEMES.glob("*.json")):
        try:
            themes[p.stem] = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            return [f"[themes] {p.name} unreadable: {e}"]
    if len(themes) < 2:
        return []
    allkeys = set().union(*(set(t) for t in themes.values()))
    problems: list[str] = []
    for name, t in themes.items():
        for k in sorted(allkeys - set(t)):
            problems.append(f"[themes] '{name}' missing key {{{k}}} (defined in another theme)")
    return problems


def _rendered_problems(bundle: Path) -> list[str]:
    """A committed bundle (e.g. ./Harness) must match a fresh render of src/ for its
    own recorded theme, or it has silently drifted — doctor's tmp builds never touch
    it. Render src/ in memory and compare only the files that come FROM src/ (AGENT.md,
    the laws, agents, skills, memory/README…). Host-state files (context.json,
    MEMORY.md, the .geneseed-* markers) are created once and never rendered, so they
    are not in the render set and are correctly ignored. Notebook files (except its
    `.gitignore`) are seed-once and agent-owned after the first build (spec
    2026-06-11) — a difference there is the agent's own rewrite, not drift, so they
    are compared only for existence."""
    if not bundle.is_dir():
        return []
    marker = bundle / ".geneseed-theme"
    if marker.exists():
        theme_name = marker.read_text(encoding="utf-8").strip()
    elif build.CONFIG.exists():
        theme_name = json.loads(build.CONFIG.read_text(encoding="utf-8")).get("theme", "neutral")
    else:
        theme_name = "neutral"
    try:
        _theme, items = build.render_all(theme_name)
    except SystemExit:
        return [f"[rendered] cannot render theme '{theme_name}' for {bundle.name}/"]
    problems: list[str] = []
    nb_dirname = build.STRUCTURE.get("DIR_NOTEBOOK", "notebook")
    for out_rel, text, src in items:
        dest = bundle / out_rel
        rel = Path(out_rel)
        if not dest.exists():
            problems.append(f"[rendered] {bundle.name}/{out_rel} missing — rebuild the bundle")
        elif rel.parts[0] == nb_dirname and rel.name != ".gitignore":
            continue   # seed-once, agent-owned: a rewrite is not drift
        elif text is not None:
            if dest.read_text(encoding="utf-8") != text:
                problems.append(f"[rendered] {bundle.name}/{out_rel} stale (differs from a fresh render) — rebuild")
        elif dest.read_bytes() != src.read_bytes():
            problems.append(f"[rendered] {bundle.name}/{out_rel} stale — rebuild")
    return problems


def _authoring_problems() -> list[str]:
    """Author-time gates on the source specs and plugins (not rendered output):
    every agent/skill spec must carry a one-line '>' purpose blockquote (else its
    OpenCode `description:` renders empty); the learn-prompt literal must stay
    extractable from the plugin (the single-source link harness.py depends on); and,
    if node is on PATH, the plugins must pass `node --check`."""
    problems: list[str] = []
    for folder in ("agents", "skills"):
        d = build.SRC / folder
        if not d.is_dir():
            continue
        for spec in sorted(d.glob("*.md")):
            if spec.name.startswith("_"):
                continue
            try:
                text = spec.read_text(encoding="utf-8")
            except OSError as e:
                problems.append(f"[authoring] {folder}/{spec.name} unreadable: {e}")
                continue
            if not build._first_blockquote(text):
                problems.append(f"[authoring] {folder}/{spec.name} has no '>' purpose line "
                                f"(its OpenCode description would render empty)")
    plugin = build.PLUGIN_SRC / "geneseed-learn.js"
    try:
        m = re.search(r"const LEARN_PROMPT_HEAD = `([\s\S]*?)`",
                      plugin.read_text(encoding="utf-8"))
    except OSError:
        m = None
    if not m:
        problems.append("[authoring] LEARN_PROMPT_HEAD literal not found in "
                        "geneseed-learn.js — harness.py would fall back (single source broken)")
    elif m.group(1) != LEARN_PROMPT_HEAD:
        problems.append("[authoring] LEARN_PROMPT_HEAD drifted between geneseed-learn.js "
                        "and harness.py's loaded copy")
    node = shutil.which("node")
    if node:
        for js in sorted(build.PLUGIN_SRC.glob("*.js")):
            r = run([node, "--check", str(js)], capture_output=True, text=True)
            if r.returncode != 0:
                tail = (r.stderr.strip().splitlines() or ["syntax error"])[-1]
                problems.append(f"[authoring] node --check failed for {js.name}: {tail}")
    return problems


def _themes_to_check(theme, all_themes, detected, available):
    """Which themes doctor validates. An explicit --theme wins. Otherwise, unless
    --all forces the full maintainer sweep, scope to the theme THIS host installed
    (detected from the deployed marker/sigil) so a user who installed one theme is
    not buried under the same problem echoed across all eight. Falls back to the
    full sweep when nothing is installed (a fresh clone) or the detected theme is
    unknown — so a maintainer in a clean checkout still gets full coverage."""
    if theme:
        return [theme]
    if not all_themes and detected and detected in available:
        return [detected]
    return sorted(available)


def _global_emit_problems(theme_name: str) -> list[str]:
    """Validate the opencode-global emit — the RECOMMENDED install, and otherwise a
    doctor blind spot (the files build and ./Harness were checked; the global layout
    never was). Render it into a throwaway config dir and scan AGENT.md, the native
    agents/skills, and the seeded memory store for unresolved tokens, dead links, and
    non-hermetic escapes — exactly as for a files build. Labelled '<theme> global' so
    a problem here is distinguishable from the plain build."""
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "cfg"
        try:
            with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's log
                build.emit_opencode_global(theme_name, out=Path(tmp) / "bundle", cfg=cfg)
        except SystemExit:
            return [f"[{theme_name} global] build failed"]
        return _check_build(f"{theme_name} global", cfg)


def _doctor_collect(theme=None, all_themes=False, bundle=None, no_bundle=False, on_progress=None):
    """Run every doctor check; return (themes, sorted_unique_problems). on_progress
    (i, total, label) is called as it advances, so a caller can draw a progress bar.

    Theme scope: with no explicit `theme` and without `all_themes`, validation is
    scoped to the installed theme (detected from the deployed bundle), not the full
    sweep — see `_themes_to_check`. The cross-theme PARITY check below runs
    regardless of scope, so the guarantee that motivated the sweep (a voice token
    present in one theme map but missing in another) is never lost."""
    available = [p.stem for p in build.THEMES.glob("*.json")]
    if not available:
        return [], ["[doctor] no themes found"]
    # Only probe the deployed install when we actually need it (no theme / not --all).
    detected = None if (theme or all_themes) else _installed_defaults().get("theme")
    themes = _themes_to_check(theme, all_themes, detected, available)
    total = len(themes) + 1
    problems: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, theme_name in enumerate(themes):
            if on_progress:
                on_progress(i, total, f"theme: {theme_name}")
            out = Path(tmp) / theme_name
            rc = run([sys.executable, str(BUILD), "--theme", theme_name, "--out", str(out)],
                     cwd=ROOT, capture_output=True, text=True).returncode
            if rc != 0:
                problems.append(f"[{theme_name}] build failed")
                continue
            problems += _check_build(theme_name, out)
            problems += _global_emit_problems(theme_name)   # also validate the global install
    if on_progress:
        on_progress(len(themes), total, "parity · authoring · bundle")
    problems += _theme_parity_problems()
    problems += _authoring_problems()
    if not no_bundle:
        b = Path(bundle).expanduser().resolve() if bundle else ROOT / "Harness"
        problems += _rendered_problems(b)
    if on_progress:
        on_progress(total, total, "done")
    return themes, sorted(set(problems))


def cmd_doctor(args: argparse.Namespace) -> int:
    """Validate the build. With --theme, checks that one theme. With no theme it
    scopes to the INSTALLED theme (so a one-theme install is not buried under the
    same issue repeated across all eight); pass --all for the full maintainer sweep
    of every theme. The cross-theme parity check runs in every mode."""
    all_themes = getattr(args, "all", False)
    themes, problems = _doctor_collect(theme=args.theme, all_themes=all_themes,
                                       bundle=args.bundle, no_bundle=args.no_bundle)
    if not themes:
        print(problems[0] if problems else "[doctor] no themes found")
        return 1
    scoped = not args.theme and not all_themes and len(themes) == 1
    note = (f"  (scoped to installed theme '{themes[0]}'; run with --all to sweep "
            f"every theme)" if scoped else "")
    if problems:
        print(f"[doctor] {len(problems)} problem(s) across {len(themes)} theme(s):")
        for p in problems:
            print("  -", p)
        if any("dead link" in p for p in problems):
            print("  tip: dead links to skills mean your source is incomplete — run "
                  "`./geneseed update` (or re-sync src/), then re-check.")
        if note:
            print(note)
        return 1
    print(f"[doctor] ok — {len(themes)} theme(s) clean: no unresolved tokens, no dead "
          f"links, nothing escapes the bundle; themes in parity; specs carry purpose "
          f"lines; rendered bundle in sync")
    if note:
        print(note)
    return 0


def _fence_for(text: str) -> str:
    """A backtick fence longer than the longest backtick run inside `text`, so
    embedded code fences never close the wrapper. Minimum four."""
    longest = run = 0
    for ch in text:
        run = run + 1 if ch == "`" else 0
        longest = max(longest, run)
    return "`" * max(4, longest + 1)


def build_prompt(theme_name: str) -> str:
    _, items = build.render_all(theme_name)
    n_text = sum(1 for _, t, _ in items if t is not None)
    out = [
        f"# Geneseed Harness — install prompt (theme: {theme_name})",
        "",
        "You are an AI agent. Recreate the Geneseed harness file tree below, writing",
        "every file **verbatim**. No Python or build step is required.",
        "",
        "## Target directory",
        "Write all files under the directory the user specifies. If none was given, ask",
        "for it, defaulting to the current repository root. Preserve the exact relative",
        "path shown in each file heading, creating subfolders as needed.",
        "",
        "## Rules",
        "- Copy each file's content exactly — do not summarise, reflow, or edit it.",
        "- After writing, create an empty context.json at the repo root if absent, and list the repo's docs in it.",
        "- When finished, list every file you created.",
        "",
        f"## Files ({n_text} text files)",
    ]
    for out_rel, text, _src in items:
        if text is None:
            out.append(f"\n### `{out_rel}` (binary — copy it from the Geneseed repo)")
            continue
        fence = _fence_for(text)
        out += [f"\n### `{out_rel}`", "", fence, text.rstrip("\n"), fence]
    return "\n".join(out) + "\n"


def cmd_prompt(args: argparse.Namespace) -> int:
    text = build_prompt(args.theme or "neutral")
    if args.out:
        dest = Path(args.out)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        print(f"[prompt] wrote {args.out} ({args.theme or 'neutral'})")
    else:
        sys.stdout.write(text)
    return 0


# ---- project-context discovery ---------------------------------------------------
# Kept in step with adapters/opencode/plugins/geneseed-context.js (EAGER_ROOT /
# LAZY_DIRS / EXCLUDE_DIRS) so the Claude hook and the OpenCode plugin discover the
# SAME docs. Root entry docs are injected in full; doc trees are listed lazily.
EAGER_ROOT = ("AGENTS.md", "AGENT.md", "CLAUDE.md", ".cursorrules",
              "README.md", "CONTRIBUTING.md")
LAZY_DIRS = ("docs", "doc", "documentation", "architecture", "adr", "ADR")
EXCLUDE_DIRS = {"node_modules", ".git", "dist", "build", "vendor", ".next",
                "target", ".venv", "__pycache__", ".opencode", ".harness"}


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


# ---- learn helpers: input normalisation, dedup, index maintenance ----------

MEMORY_DIR_NAMES = ("memory", "anamnesis")  # neutral + imperial themed names
FRONTMATTER_RE = re.compile(r"\s*---\s*\n(?P<fm>.*?)\n---\s*\n?(?P<body>.*)$", re.S)
FILE_SEP_RE = re.compile(r"(?m)^---FILE---\s*$")


def _content_text(content) -> str:
    """Flatten a message 'content' field (string, or a list of blocks) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "\n".join(parts)
    return ""


def _flatten_transcript(path: str) -> str:
    """Render a Claude-Code-style JSONL transcript into 'role: text' notes."""
    try:
        raw = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    out: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get("message") or {}
        role = msg.get("role") or obj.get("role") or obj.get("type")
        if role not in ("user", "assistant"):
            continue
        text = _content_text(msg.get("content", obj.get("content"))).strip()
        if text:
            out.append(f"{role}: {text}")
    return "\n\n".join(out)


def _read_notes(raw: str) -> str:
    """Normalise learn input. Accepts, in order:
      - a lifecycle-hook JSON payload on stdin ({"transcript_path": ...}) — the
        transcript is read and flattened (this is what makes the Stop hook work);
      - raw notes / a transcript already flattened to text — used as-is."""
    s = raw.strip()
    if not s:
        return ""
    if s[0] == "{":
        try:
            payload = json.loads(s)
        except json.JSONDecodeError:
            return raw  # not JSON after all — treat as raw notes
        tp = payload.get("transcript_path")
        if tp:
            return _flatten_transcript(tp)
        return raw
    return raw


def _resolve_memory_dir(explicit: str | None) -> Path | None:
    """Find the bundle's memory directory so learn can dedup and index in place.
    Precedence: --memory arg > $GENESEED_MEMORY > a memory/ (or anamnesis/) dir
    beside the CWD or under ./Harness > $GENESEED_HARNESS/memory > the OpenCode
    GLOBAL config dir's memory/. The last two matter for the recommended
    opencode-global install, whose store lives in ~/.config/opencode (not beside
    any repo) — without them, running learn / the memory browser from an arbitrary
    repo wrongly reports 'no memory store'. None => stdout-only mode (no writes)."""
    if explicit:
        p = Path(explicit)
        return p if p.is_dir() else None
    env = os.environ.get("GENESEED_MEMORY")
    if env and Path(env).is_dir():
        return Path(env)
    cwd = Path.cwd()
    bases = [cwd, cwd / "Harness"]
    gh = os.environ.get("GENESEED_HARNESS")
    if gh:
        bases.append(Path(gh).expanduser())
    try:
        bases.append(build._opencode_config_dir())  # the global install's store
    except Exception:
        pass
    for base in bases:
        for name in MEMORY_DIR_NAMES:
            cand = base / name
            if cand.is_dir():
                return cand
    return None


def _frontmatter(md: str) -> tuple[dict, str]:
    """Parse leading YAML-ish frontmatter into a flat dict, plus the body."""
    m = FRONTMATTER_RE.match(md)
    if not m:
        return {}, md
    fm: dict[str, str] = {}
    for line in m.group("fm").splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            fm[key.strip()] = val.strip().strip('"')
    return fm, m.group("body")


def _existing_slugs(mem_dir: Path) -> set[str]:
    """Slugs already stored, so learn never re-emits a known fact (Rule: no dups)."""
    skip = {"memory", "readme"}
    return {f.stem for f in mem_dir.glob("*.md") if f.stem.lower() not in skip}


def _build_learn_prompt(notes: str, existing: set[str]) -> str:
    parts = [LEARN_PROMPT_HEAD, ""]
    if existing:
        parts.append("ALREADY STORED — do NOT emit a memory matching any of these "
                     "slugs (skip updates too; only genuinely new facts):")
        parts += [f"- {slug}" for slug in sorted(existing)]
        parts.append("")
    parts += ["NOTES:", notes]
    return "\n".join(parts)


def _write_memories(model_output: str, mem_dir: Path, existing: set[str]) -> list[str]:
    """Split the model output into files, write each NEW one, and append a pointer
    line to MEMORY.md — the index convention the agent relies on at session start."""
    written: list[str] = []
    index_lines: list[str] = []
    for chunk in FILE_SEP_RE.split(model_output):
        chunk = chunk.strip()
        if not chunk or chunk.upper() == "NOTHING":
            continue
        fm, _body = _frontmatter(chunk)
        name = fm.get("name", "").strip()
        if not name or name in existing:
            continue
        (mem_dir / f"{name}.md").write_text(chunk.rstrip("\n") + "\n", encoding="utf-8")
        existing.add(name)
        written.append(name)
        desc = fm.get("description", "").strip()
        index_lines.append(f"- [{name}]({name}.md)" + (f" — {desc}" if desc else ""))
    if index_lines:
        index = mem_dir / "MEMORY.md"
        current = (index.read_text(encoding="utf-8").rstrip("\n") + "\n"
                   if index.exists() else "# Memory Index\n")
        index.write_text(current + "\n".join(index_lines) + "\n", encoding="utf-8")
    return written


def cmd_learn(args: argparse.Namespace) -> int:
    raw = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    notes = _read_notes(raw)
    if not notes.strip():
        sys.stderr.write("[learn] no notes or transcript content — nothing to distil.\n")
        return 0
    notes = notes[-MAX_NOTES_CHARS:]  # keep the tail: most recent, most durable

    mem_dir = _resolve_memory_dir(args.memory)
    existing = _existing_slugs(mem_dir) if mem_dir else set()
    prompt = _build_learn_prompt(notes, existing)

    llm = os.environ.get("GENESEED_LLM")
    if not llm:
        sys.stderr.write("[learn] $GENESEED_LLM unset — printing prompt instead.\n\n")
        print(prompt)
        return 0

    proc = run(llm.split() + [prompt], capture_output=True, text=True)
    output = proc.stdout
    if mem_dir and output.strip() and output.strip().upper() != "NOTHING":
        written = _write_memories(output, mem_dir, existing)
        if written:
            sys.stderr.write(f"[learn] wrote {len(written)} memory file(s) to "
                             f"{mem_dir}: {', '.join(written)}\n")
        else:
            sys.stderr.write("[learn] nothing new to store (all duplicates).\n")
    else:
        # No memory dir found, or model said NOTHING — surface the output instead.
        sys.stdout.write(output)
    if proc.returncode != 0 and proc.stderr:
        # Surface the LLM's own error (auth, quota, bad model name) — a bare
        # non-zero exit with stderr swallowed is undiagnosable.
        sys.stderr.write(proc.stderr)
    return proc.returncode


def _owned_set(d: Path) -> set:
    """The files a global Geneseed install owns, per its .geneseed-manifest.json."""
    try:
        data = json.loads((d / build.GLOBAL_MANIFEST).read_text(encoding="utf-8"))
        return set(data.get("owned", []))
    except (json.JSONDecodeError, OSError):
        return set()


def _diff_collect(target=None, theme=None):
    """Compute the deployed-vs-source diff. Returns (target, theme, files) where files
    is a sorted list of {rel, status (edited|added|missing), diff (unified lines)} —
    or None when there is no deployed global install at target."""
    target = Path(target).expanduser() if target else build._opencode_config_dir()
    if not (target / build.GLOBAL_MANIFEST).exists():
        return target, theme, None
    if not theme:
        # Render the 'expected' copy in the theme the deployment ACTUALLY uses, so
        # themed wording is not reported as a difference — only genuine local edits
        # surface. Fall back to the configured/neutral theme only if undetectable.
        theme = _theme_of_dir(target)
    if not theme:
        cfgp = ROOT / "harness.config.json"
        theme = (json.loads(cfgp.read_text(encoding="utf-8")).get("theme", "neutral")
                 if cfgp.exists() else "neutral")
    files = []
    with tempfile.TemporaryDirectory() as tmp:
        expected = Path(tmp) / "expected"
        with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's own log
            build.emit_opencode_global(theme, out=Path(tmp) / "bundle", cfg=expected)
        for rel in sorted(_owned_set(target) | _owned_set(expected)):
            a, b = target / rel, expected / rel
            if a.is_file() and b.is_file():
                ta = a.read_text(encoding="utf-8", errors="replace")
                tb = b.read_text(encoding="utf-8", errors="replace")
                if ta != tb:
                    diff = list(difflib.unified_diff(
                        tb.splitlines(), ta.splitlines(),
                        fromfile=f"source/{rel}", tofile=f"deployed/{rel}", lineterm=""))
                    files.append({"rel": rel, "status": "edited", "diff": diff})
            elif a.is_file():
                body = a.read_text(encoding="utf-8", errors="replace").splitlines()
                files.append({"rel": rel, "status": "added",
                              "diff": ["(only in deployed — your addition)", ""]
                              + ["+" + ln for ln in body]})
            else:
                files.append({"rel": rel, "status": "missing",
                              "diff": ["(in source, not deployed — re-emit to add)"]})
    files.sort(key=lambda f: f["rel"])
    return target, theme, files


def _improvements_md(target, theme, files, when: str) -> str:
    """Render the deployed-vs-source drift as a self-contained markdown report — the
    artifact a user hands to an agent in this source repo to back-port the deployed
    harness's self-improvements into src/. Pure (unit-tested); `when` is the caller's
    timestamp so the render itself is reproducible."""
    edited = [f for f in files if f["status"] == "edited"]
    added = [f for f in files if f["status"] == "added"]
    missing = [f for f in files if f["status"] == "missing"]
    lines = [
        "# Geneseed — deployed improvements to back-port",
        "",
        f"- captured: {when}",
        f"- deployed: `{target}`",
        f"- theme: {theme}",
        f"- {len(edited)} edited · {len(added)} added in deployed · {len(missing)} missing from deployed",
        "",
        "The deployed harness drifted from a fresh render of `src/` — typically the",
        "self-improvement loops editing agent/skill files in place. Hand this file to",
        "an agent in the Geneseed source repo and ask it to fold the changes below",
        "back into `src/`. Diffs read source -> deployed; the expected copy was",
        "rendered in the deployed theme, so only genuine local edits appear.",
        "",
    ]
    label = {"edited": "edited in deployed",
             "added": "only in deployed — your addition",
             "missing": "in source, not deployed"}
    for f in files:
        lines += [f"## `{f['rel']}`  ({label[f['status']]})", "", "```diff",
                  *f["diff"], "```", ""]
    return "\n".join(lines) + "\n"


def _write_improvements(target, theme, files, out_path=None) -> Path:
    """Write the drift report for an already-collected diff. Default destination is
    a timestamped file under improvements/ INSIDE the deployed harness dir — the
    report lives beside the install it describes (e.g. ~/.config/opencode for the
    global emit). Never in the manifest: rebuilds compare only owned files so it is
    not reported as drift, re-emits do not clobber it, and uninstall leaves it in
    place (same contract as memory)."""
    now = datetime.datetime.now()
    path = (Path(out_path).expanduser() if out_path else
            Path(target) / "improvements" / now.strftime("improvements-%Y%m%d-%H%M%S.md"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_improvements_md(target, theme, files,
                                     now.strftime("%Y-%m-%d %H:%M:%S")),
                    encoding="utf-8")
    return path


def export_improvements(target=None, theme=None, out_path=None):
    """Collect the deployed-vs-source drift and, when there IS any, write it as a
    markdown improvements file. Returns (path, files): path is None when nothing was
    written — no deployed install (files is None) or no drift (files is [])."""
    target, theme, files = _diff_collect(target, theme)
    if not files:
        return None, files
    return _write_improvements(target, theme, files, out_path), files


_T0 = datetime.datetime.now().timestamp()    # process start — _flush_export_notes scans from here


def _flush_export_notes() -> None:
    """Re-print, on the RESTORED terminal, the path of any improvements file exported
    since this process started — the in-TUI notices live on the alternate screen and
    vanish with it (or hide below a theme banner). Called after each curses session
    ends and before a re-exec replaces this process. Scans the global install's
    improvements/ dir rather than tracking calls, so exports made by subprocess steps
    (the upgrade inside bootstrap / update) are caught too."""
    try:
        d = build._opencode_config_dir() / "improvements"
        fresh = sorted(p for p in d.glob("improvements-*.md")
                       if p.stat().st_mtime >= _T0 - 1)
    except OSError:
        return
    if not fresh:
        return
    for p in fresh:
        print(f"[geneseed] improvements file saved: {p}")
    print("[geneseed] the deployed harness carried local edits — hand the file to "
          "your agent to back-port them into src/.")


def cmd_diff(args: argparse.Namespace) -> int:
    """Report how a DEPLOYED (ported) global harness differs from a fresh render of
    the current source — so edits made in place can be reviewed and back-ported to
    src/. `--full` shows the unified diffs. (The browse panel / main menu show this
    interactively, file-by-file.)"""
    target, theme, files = _diff_collect(args.target, args.theme)
    if files is None:
        sys.stderr.write(
            f"[diff] no global Geneseed install at {target} (no {build.GLOBAL_MANIFEST}). "
            f"Pass --target, or run `--emit opencode-global` first.\n")
        return 1
    edited = [f for f in files if f["status"] == "edited"]
    added = [f for f in files if f["status"] == "added"]
    missing = [f for f in files if f["status"] == "missing"]
    print(f"[diff] deployed {target}  vs  source (theme: {theme})")
    print(f"[diff] {len(edited)} edited, {len(added)} added-in-deployed, "
          f"{len(missing)} missing-from-deployed")
    for f in edited:
        print(f"  ~ {f['rel']}   (edited in deployed — review to back-port)")
    for f in added:
        print(f"  + {f['rel']}   (only in deployed — your addition)")
    for f in missing:
        print(f"  - {f['rel']}   (in source, not deployed — re-emit to add)")
    if args.out:
        if files:
            path = _write_improvements(target, theme, files, args.out)
            print(f"[diff] improvements file written: {path}")
        else:
            print("[diff] no differences — nothing written.")
    if args.full:
        for f in edited:
            print(f"\n--- {f['rel']} (source -> deployed) ---")
            print("\n".join(f["diff"]))
    elif edited and not args.out:
        print("\nRun with --full to see the line-level diffs, or --out FILE to export them.")
    return 0


# ---- version + uninstall (deployed-install lifecycle) ----------------------------

def _version_verdict(installed: "str | None", current: str) -> str:
    """One-line verdict comparing a deployed fingerprint to the current source."""
    if installed is None:
        return "no Geneseed install detected to compare"
    if installed == current:
        return "up to date with this source"
    return ("installed build differs from the current source — run "
            "`./geneseed update` (or rebuild) to apply it")


def cmd_version(args: argparse.Namespace) -> int:
    """Show the current source fingerprint vs the deployed install's, and whether
    they match. Network-free: it compares against the source tree this CLI runs from
    (`upgrade` is what pulls newer source from upstream)."""
    current = build.source_fingerprint()
    target = Path(args.target).expanduser().resolve() if args.target else build._opencode_config_dir()
    installed = build.read_version(target)
    if installed is None:                       # fall back to common bundle locations
        for base in (ROOT / "Harness", Path.cwd() / "Harness", Path.cwd()):
            v = build.read_version(base)
            if v:
                installed, target = v, base
                break
    print(f"[version] source:    {current}   ({ROOT})")
    print(f"[version] installed: {installed or '(none found)'}"
          + (f"   ({target})" if installed else ""))
    print(f"[version] {_version_verdict(installed, current)}")
    return 0


def _status_data() -> dict:
    """Gather everything the status dashboard reports — the single source for both the
    headless `status` command and the TUI panel, so the two never drift. Detects the
    installed theme/emit, counts agents/skills/laws, locates the memory store and
    counts facts, and compares the deployed version fingerprint to the source."""
    inst = _installed_defaults()
    theme = inst["theme"] or _default_theme()
    mdir = _resolve_memory_dir(None)
    inv = _tui_inventory(theme)
    try:
        cfg = build._opencode_config_dir()
    except Exception:
        cfg = None
    source_fp = build.source_fingerprint()
    installed_fp = ver_target = None
    candidates = ([cfg] if cfg else []) + [ROOT / "Harness", Path.cwd() / "Harness", Path.cwd()]
    for base in candidates:
        v = build.read_version(base)
        if v:
            installed_fp, ver_target = v, base
            break
    agent_md = (cfg / "AGENT.md") if (inst["emit"] == "opencode-global" and cfg) else None
    return {
        "theme": theme, "accent": _accent_for(theme), "emit": inst["emit"] or "—",
        "agents": len(inv["agents"]), "skills": len(inv["skills"]), "laws": len(inv["laws"]),
        "memory_dir": str(mdir) if mdir else None, "facts": len(_memory_facts(mdir)) if mdir else 0,
        "source_fp": source_fp, "installed_fp": installed_fp,
        "version_target": str(ver_target) if ver_target else None,
        "version_verdict": _version_verdict(installed_fp, source_fp),
        "agent_md": str(agent_md) if agent_md else None,
        "agent_md_present": bool(agent_md and agent_md.exists()),
    }


# Terminal escape-code map ({name: "31"}) — named _ANSI_CODES, not _ANSI, so it
# cannot be confused with build._ANSI, which maps the same names to bare ints for
# OpenCode theme slots.
_ANSI_CODES = {"red": "31", "green": "32", "yellow": "33", "blue": "34",
               "magenta": "35", "cyan": "36", "white": "37"}


def _color_enabled() -> bool:
    """ANSI only when writing to a real terminal and not muted by NO_COLOR / dumb."""
    return (sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
            and os.environ.get("TERM") != "dumb")


def _status_lines(d: dict, color: bool = False) -> list[str]:
    """Render the status dashboard as a framed, aligned panel. Pure — returns the
    lines. `color` adds ANSI (accent frame + bold title, green/amber/dim verdict).
    GENESEED_TUI_ASCII swaps every non-ASCII glyph (box-drawing, ◆ · ✓ —) for a plain
    equivalent so fonts that tofu them still render and align."""
    asc = _TUI_ASCII
    H, V = ("-", "|") if asc else ("─", "│")
    TL, TR, BL, BR, LT, RT = (("+",) * 6 if asc else ("┌", "┐", "└", "┘", "├", "┤"))
    DOT = "-" if asc else "·"               # inline separator
    badge = "*" if asc else "◆"
    emdash = "-" if asc else "—"

    up = "up to date" in d["version_verdict"]
    none_inst = d["installed_fp"] is None
    mark = ("OK" if asc else "✓") if up else (("-" if asc else "·") if none_inst else "!")
    vcode = "32" if up else ("2" if none_inst else "33")

    rows = [
        ("theme", f"{d['theme']}  (accent: {d['accent']})"),
        ("install", d["emit"]),
        ("components", f"{d['agents']} agents {DOT} {d['skills']} skills {DOT} {d['laws']} laws"),
        ("memory", f"{d['memory_dir'] or '(not found)'}  "
                   f"({d['facts']} fact{'' if d['facts'] == 1 else 's'})"),
        ("version", f"{d['installed_fp'] or '(none)'}  {DOT}  source {d['source_fp']}"),
    ]
    if d["agent_md"]:
        rows.append(("AGENT.md",
                     f"{d['agent_md']}  ({'present' if d['agent_md_present'] else 'MISSING'})"))

    label_w = max(len(k) for k, _ in rows)
    body = [f"  {k.ljust(label_w)}   {v}" for k, v in rows]
    verdict = f"  {mark} {d['version_verdict']}"
    title = f" {badge} Geneseed {emdash} status "
    width = max([len(b) for b in body] + [len(verdict), len(title) + 2])

    ac = _ANSI_CODES.get(d["accent"], "36")

    def c(s: str, code: str) -> str:
        return f"\x1b[{code}m{s}\x1b[0m" if color else s

    top = (c(TL + H, ac) + c(title, f"{ac};1") + c(H * (width - len(title) - 1) + TR, ac)
           if color else TL + H + title + H * (width - len(title) - 1) + TR)
    edge = c(V, ac)
    lines = [top]
    lines += [edge + b.ljust(width) + edge for b in body]
    lines.append(c(LT + H * width + RT, ac))
    lines.append(edge + c(verdict.ljust(width), vcode) + edge)
    lines.append(c(BL + H * width + BR, ac))
    return lines


def cmd_status(args: argparse.Namespace) -> int:
    """Print the install dashboard — theme, install mode, component counts, memory
    store, version vs source, and (for a global install) AGENT.md — as a framed,
    aligned panel. The headless equivalent of the TUI status view, so Windows / CI /
    no-TTY hosts can see it too (color is auto-disabled when piped)."""
    for line in _status_lines(_status_data(), color=_color_enabled()):
        print(line)
    return 0


def _unmerge_opencode_json(path: Path, entry: str) -> bool:
    """Remove `entry` from the OpenCode config's `instructions`, leaving every other
    key intact. Resolves a sibling `opencode.jsonc` first (the file OpenCode treats as
    authoritative) and reads it comment-tolerantly. Returns True if the file was
    changed. A commented `.jsonc` is NOT rewritten — that would drop the comments — so
    the user is told to remove the entry by hand and this returns False (unchanged)."""
    target = build._opencode_target(path)
    if not target.exists():
        return False
    try:
        cfg, had_comments = build._read_jsonc(target.read_text(encoding="utf-8"))
    except OSError:
        return False
    if not isinstance(cfg, dict):
        return False
    instr = cfg.get("instructions")
    if not isinstance(instr, list) or entry not in instr:
        return False
    if target.suffix == ".jsonc" and had_comments:
        print(f"[uninstall] {target.name} has comments — not rewriting it. Remove this "
              f"from its \"instructions\" by hand: {json.dumps(entry)}")
        return False
    cfg["instructions"] = [i for i in instr if i != entry]
    target.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return True


# ---- MCP servers (OpenCode) -------------------------------------------------
# Known, ready-to-wire MCP server presets the TUI can toggle into an opencode.json.
# Each `block` is written verbatim under the config's `mcp` key. Registering a server
# only points OpenCode at a command — the user still installs the tool itself (the
# harness never installs a converter silently; see SETUP.md → "MarkItDown via MCP").
_MCP_PRESETS = {
    "markitdown": {
        "label": "MarkItDown",
        "desc": "PDF / Office / HTML -> Markdown for the ingest skill. Install it with "
                "`pipx install markitdown-mcp` (or switch the command to "
                "[\"uvx\", \"markitdown-mcp\"]). Exposes one tool: convert_to_markdown(uri).",
        "block": {"type": "local", "command": ["markitdown-mcp"], "enabled": True},
    },
    "gitlab": {
        "label": "GitLab",
        "desc": "GitLab repo / MR / issue / CI tools via @zereight/mcp-gitlab (npx, no "
                "install). Edit GITLAB_PERSONAL_ACCESS_TOKEN (scopes: api, read_repository) "
                "and GITLAB_API_URL before use. Add a second entry (gitlab-2) for another "
                "instance.",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@zereight/mcp-gitlab"],
                  "environment": {"GITLAB_PERSONAL_ACCESS_TOKEN": "",
                                  "GITLAB_API_URL": "https://gitlab.com/api/v4"},
                  "enabled": True},
    },
    "gitlab-2": {
        "label": "GitLab (2nd instance)",
        "desc": "A second GitLab instance (e.g. a self-hosted server) via the same "
                "@zereight/mcp-gitlab command. Point GITLAB_API_URL at the other instance "
                "and give it that instance's own token.",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@zereight/mcp-gitlab"],
                  "environment": {"GITLAB_PERSONAL_ACCESS_TOKEN": "",
                                  "GITLAB_API_URL": "https://gitlab.example.com/api/v4"},
                  "enabled": True},
    },
    "filesystem": {
        "label": "Filesystem",
        "desc": "Read/write files under explicitly allowed directories via "
                "@modelcontextprotocol/server-filesystem (npx, no install). Replace the "
                "trailing path arg(s) with only the dir(s) the agent may touch "
                "(least-privilege).",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem",
                              "/path/to/allowed/dir"],
                  "enabled": True},
    },
}


def _mcp_apply(config: dict, name: str, block: "dict | None") -> dict:
    """Pure: return a copy of `config` with MCP server `name` set to `block`, or
    removed when `block` is None. Never touches another key; drops an emptied `mcp`
    map; keeps `$schema` so a freshly created file is valid."""
    cfg = dict(config)
    cfg.setdefault("$schema", "https://opencode.ai/config.json")
    servers = dict(cfg.get("mcp") or {})
    if block is None:
        servers.pop(name, None)
    else:
        servers[name] = block
    if servers:
        cfg["mcp"] = servers
    else:
        cfg.pop("mcp", None)
    return cfg


def _mcp_state(config: dict, name: str) -> str:
    """'enabled' | 'disabled' | 'absent' for server `name`. A server with no explicit
    `enabled` key counts as enabled (OpenCode's default)."""
    server = (config.get("mcp") or {}).get(name)
    if not isinstance(server, dict):
        return "absent"
    return "enabled" if server.get("enabled", True) else "disabled"


def _mcp_set_enabled(config: dict, name: str, enabled: bool) -> dict:
    """Pure: flip a present server's `enabled` flag. No-op when the server is absent."""
    server = (config.get("mcp") or {}).get(name)
    if not isinstance(server, dict):
        return config
    block = dict(server)
    block["enabled"] = enabled
    return _mcp_apply(config, name, block)


def _mcp_load(path: Path) -> dict:
    """Read an OpenCode config into a dict; {} if missing or malformed. Comment-tolerant
    so a hand-maintained `opencode.jsonc` parses (its `//` and `/* */` are stripped)."""
    if not path.exists():
        return {}
    try:
        data, _ = build._read_jsonc(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except OSError:
        return {}


def _mcp_commented(path: Path) -> bool:
    """True when `path` is an existing `.jsonc` that carries comments — the case where
    a non-destructive rewrite would drop the user's comments, so the MCP screen must
    refuse to save and warn instead."""
    if path.suffix != ".jsonc" or not path.exists():
        return False
    try:
        _, had = build._read_jsonc(path.read_text(encoding="utf-8"))
        return had
    except OSError:
        return False


def _mcp_save(path: Path, config: dict) -> None:
    """Write `config` back as pretty JSON (the same shape build.py emits)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _mcp_targets() -> "list[tuple[str, Path]]":
    """Candidate OpenCode config files to manage, most-local first: the current
    project's, then OpenCode's global config dir. Each resolves to a present sibling
    `opencode.jsonc` (the file OpenCode treats as authoritative) when one exists, else
    `opencode.json`. Both targets are offered whether or not they exist yet — choosing
    one creates the `.json` on first write."""
    targets = [("this project", build._opencode_target(Path.cwd() / "opencode.json"))]
    try:
        targets.append(("global config",
                        build._opencode_target(build._opencode_config_dir() / "opencode.json")))
    except Exception:
        pass
    return targets


def _mcp_default_target(targets: "list[tuple[str, Path]]") -> int:
    """Pick which target the screen opens on. The strongest signal is which config
    file already exists — that's the one OpenCode actually reads — so if exactly one
    is present, land there (this is what stops edits going to a stray `<cwd>/
    opencode.json` while the user watches the global file). If none or both exist,
    follow the detected install mode: a global install opens on the global config,
    otherwise the project."""
    existing = [i for i, (_l, p) in enumerate(targets) if p.exists()]
    if len(existing) == 1:
        return existing[0]
    prefer = "global config" if (_installed_defaults().get("emit") or "") == \
        "opencode-global" else "this project"
    return next((i for i, (label, _p) in enumerate(targets) if label == prefer), 0)


def _mcp_known_names(config: dict) -> list:
    """Server names to show in the MCP screen: the built-in presets first, then any
    server already present in THIS config that isn't a preset — so user-added servers
    (gitlab, filesystem, …) are visible and manageable, not just the presets. Pure."""
    names = list(_MCP_PRESETS)
    present = list((config.get("mcp") or {}).keys()) if isinstance(config, dict) else []
    names += [n for n in present if n not in _MCP_PRESETS]
    return names


def _mcp_meta(name: str) -> "tuple[str, str]":
    """(label, description) for a server row: the preset's metadata when known, else the
    bare server name and a generic note (a server discovered in the config, not a
    Geneseed preset — still toggleable/removable). Pure."""
    p = _MCP_PRESETS.get(name)
    if p:
        return p["label"], p["desc"]
    return name, ("User-defined MCP server (not a Geneseed preset). It lives in this "
                  "config already — 'e' enables/disables it, Enter removes it.")


def _archive_memory(memory_dir: Path) -> Path:
    """Move a memory store into a timestamped snapshot under a sibling
    `archived-memory/` (created if absent). Memory is NEVER deleted — only set aside,
    so learned facts survive an uninstall and can be restored by copying back.
    Returns the archive path."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = memory_dir.parent / "archived-memory" / stamp
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(memory_dir), str(dest))
    return dest


def _uninstall_global(target: Path, archive_memory: bool) -> dict:
    """Reverse a global install at `target` using its manifest: remove owned files,
    prune emptied dirs, drop the AGENT.md entry from opencode.json, and delete the
    markers. The memory store is NEVER deleted — kept in place by default, or moved to
    a sibling `archived-memory/<timestamp>/` when archive_memory. Returns a summary
    dict (with `archived` = the archive path, or None)."""
    try:
        owned = json.loads((target / build.GLOBAL_MANIFEST).read_text(encoding="utf-8")).get("owned", [])
    except (json.JSONDecodeError, OSError):
        owned = []
    removed = 0
    failed = []
    for rel in owned:
        victim = target / rel
        try:
            if victim.is_file():
                victim.unlink()
                removed += 1
                if victim.name == "SKILL.md" and victim.parent != target \
                        and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError as e:
            failed.append(f"{rel} ({e})")
    if failed:
        # A locked or permission-blocked file survives the uninstall while the
        # manifest below is deleted — name the leftovers so the user can finish
        # the job by hand instead of believing the dir is clean.
        sys.stderr.write("[uninstall] WARN: could not remove "
                         f"{len(failed)} owned file(s): {', '.join(failed)}\n")
    for d in ("agents", "skills", "plugins"):
        p = target / d
        try:
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
        except OSError:
            pass
    unmerged = _unmerge_opencode_json(target / "opencode.json", (target / "AGENT.md").as_posix())
    for m in (build.GLOBAL_MANIFEST, ".geneseed-theme", ".geneseed-emit", build.VERSION_MARKER):
        try:
            (target / m).unlink()
        except OSError:
            pass
    archived = None
    if archive_memory and (target / "memory").is_dir():
        archived = _archive_memory(target / "memory")
    return {"removed": removed, "unmerged": unmerged, "archived": archived}


def cmd_uninstall(args: argparse.Namespace) -> int:
    """Remove a global Geneseed install (the manifest-tracked opencode-global one):
    its owned files, the opencode.json instructions entry, and the markers. The
    memory store is NEVER deleted — kept in place by default, or moved aside to a
    sibling `archived-memory/<timestamp>/` with --archive-memory. Per-repo `.opencode/`
    installs have no manifest — remove those manually (`rm -rf .opencode`, drop
    AGENT.md from opencode.json)."""
    target = Path(args.target).expanduser().resolve() if args.target else build._opencode_config_dir()
    if not (target / build.GLOBAL_MANIFEST).exists():
        sys.stderr.write(
            f"[uninstall] no global Geneseed install at {target} (no {build.GLOBAL_MANIFEST}).\n"
            f"[uninstall] per-repo installs: rm -rf .opencode and drop AGENT.md from "
            f"opencode.json's instructions.\n")
        return 1
    has_memory = (target / "memory").is_dir()
    print(f"[uninstall] target: {target}")
    print("[uninstall] removes: AGENT.md, agents/, skills/, plugins/, markers, and the "
          "opencode.json instructions entry.")
    if has_memory:
        print("[uninstall] memory: " + ("will be ARCHIVED to archived-memory/ (never deleted)"
                                         if args.archive_memory
                                         else "KEPT in place — pass --archive-memory to set it aside"))
    if not args.yes:
        if not sys.stdin.isatty():
            sys.stderr.write("[uninstall] refusing to proceed without --yes (non-interactive).\n")
            return 1
        if not _confirm("Proceed with uninstall?", False):
            print("[uninstall] cancelled — nothing removed.")
            return 0
    s = _uninstall_global(target, args.archive_memory)
    mem = f"archived -> {s['archived']}" if s["archived"] else "kept in place"
    print(f"[uninstall] done — removed {s['removed']} file(s); opencode.json "
          f"{'updated' if s['unmerged'] else 'unchanged'}; memory {mem}. "
          f"Start a new OpenCode session to apply.")
    return 0


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


# ---- shared curses helpers (used by the setup form and the control panel) -------

_TUI_ASCII = bool(os.environ.get("GENESEED_TUI_ASCII"))

# One glyph table for the whole TUI — every non-ASCII glyph swaps to a plain-ASCII
# stand-in when GENESEED_TUI_ASCII is set (for fonts that render them as tofu). This is
# the single source of truth: screens read from `_GLYPH` and never hardcode a glyph.
def _glyphs(ascii_mode):
    """The TUI glyph table for the given mode — unicode by default, plain-ASCII
    stand-ins when ascii_mode is set. Pure, so it is unit-tested."""
    return {
        "sel":   ">" if ascii_mode else "▸",
        "up":    "^" if ascii_mode else "▴",
        "down":  "v" if ascii_mode else "▾",
        "head":  "*" if ascii_mode else "◆",
        "skill": "*" if ascii_mode else "✦",
        "law":   "#" if ascii_mode else "§",
    }


_GLYPH = _glyphs(_TUI_ASCII)
_SEL_G = _GLYPH["sel"]       # back-compat aliases
_MORE_G = _GLYPH["down"]

# Two display tiers layered on top of GENESEED_TUI_ASCII:
#   GENESEED_TUI_PLAIN  — calm, deterministic look: keep unicode box/symbols but drop
#                         the colourful emoji and all motion (good for CI/screenshots).
#   (default)           — full emoji icons + the splash/spinner animation.
# GENESEED_TUI_ASCII still wins (pure ASCII, no emoji, no box-drawing, no motion).
_TUI_PLAIN = bool(os.environ.get("GENESEED_TUI_PLAIN"))
_TUI_EMOJI = not (_TUI_ASCII or _TUI_PLAIN)
_TUI_ANIM = _TUI_EMOJI


def _dwidth(s: str) -> int:
    """Display width of `s` in terminal columns. East-Asian wide/fullwidth and every
    emoji codepoint (the supplementary symbol planes) occupy two columns; combining
    marks occupy zero; a U+FE0F emoji-presentation selector promotes the preceding
    single-width base to two (so ⚠️/ℹ️ measure correctly). Pure — unit-tested. This is
    what lets emoji live in framed/padded screens without shearing the alignment."""
    import unicodedata
    w = 0
    prev = 0
    for ch in s:
        if ch == "️":            # emoji-presentation selector: base becomes wide
            if prev == 1:
                w += 1
                prev = 2
            continue
        if ch == "︎":            # text-presentation selector: leave the base as-is
            continue
        if unicodedata.combining(ch):
            prev = 0
            continue
        cw = 2 if (ord(ch) >= 0x1F000 or unicodedata.east_asian_width(ch) in ("W", "F")) else 1
        w += cw
        prev = cw
    return w


def _truncd(s: str, width: int) -> str:
    """Truncate `s` to at most `width` display columns (never splits a glyph)."""
    if width <= 0:
        return ""
    if _dwidth(s) <= width:
        return s
    out, w = "", 0
    for ch in s:
        cw = _dwidth(ch)
        if w + cw > width:
            break
        out += ch
        w += cw
    return out


def _fit(s: str, width: int) -> str:
    """Truncate to `width` display columns, then pad with spaces to exactly `width`.
    The display-width-aware replacement for `f"…".ljust(width)[:width]` so an emoji
    (two columns, one `str` char) can't drift a selection bar or a pane divider. Pure."""
    s = _truncd(s, width)
    return s + " " * max(0, width - _dwidth(s))


# Action / section icons, three tiers picked by mode: emoji (default), unicode symbol
# (GENESEED_TUI_PLAIN), ASCII (GENESEED_TUI_ASCII). Every emoji is a single-codepoint,
# supplementary-plane glyph (display width 2, no FE0F variants) so _fit's math is exact.
_ICONS = {
    "browse":    ("📖", "▤", "#"),
    "diff":      ("🔍", "≈", "~"),
    "setup":     ("🧩", "⊞", "%"),
    "theme":     ("🎨", "◈", "*"),
    "update":    ("🔄", "↻", "@"),
    "bootstrap": ("🚀", "⇧", "^"),
    "build":     ("🔨", "⚒", "+"),
    "memory":    ("🧠", "❖", "&"),
    "status":    ("📊", "▦", "="),
    "settings":  ("🔧", "⚙", "%"),
    "quit":      ("🚪", "✕", "x"),
    "doctor":    ("🩺", "✚", "+"),
    "mcp":       ("🔌", "⊕", "&"),
    "link":      ("🔗", "∞", "&"),
    "unlink":    ("🔓", "∝", "-"),
    "uninstall": ("🗑", "⊗", "x"),
    "back":      ("🔙", "←", "<"),
    "agent":     ("🤖", "◆", "@"),
    "skill":     ("✨", "✦", "*"),
    "law":       ("📜", "§", "#"),
    "badge":     ("🧬", "⬡", "G"),
    "web":       ("🌐", "◍", "W"),
}


def _icon(name: str) -> str:
    """The icon for `name` in the active display tier (emoji / symbol / ASCII)."""
    emoji, sym, asc = _ICONS.get(name, ("•", "•", "*"))
    return asc if _TUI_ASCII else (emoji if _TUI_EMOJI else sym)


_MARKS = {"ok": ("✅", "✓", "+"), "fail": ("❌", "✗", "x"),
          "warn": ("⚠️", "!", "!"), "info": ("ℹ️", "·", "-"),
          # in-progress / not-yet-run step marker (the bootstrap/doctor step list)
          "pending": ("·", "·", "-"),
          # diff file-status — same semantics as git M/A/D, tier-aware so ASCII honours it
          "edited": ("📝", "~", "~"), "added": ("🆕", "+", "+"), "missing": ("🗑", "-", "-"),
          # MCP server state in _mcp_view (on / off / not-installed)
          "mcp_on": ("🟢", "●", "x"), "mcp_off": ("⚪", "○", "~"), "mcp_absent": ("⚫", "·", " ")}


def _mark(kind: str) -> str:
    """Status glyph for ok/fail/warn/info in the active tier. Used by the result panes
    so they honour GENESEED_TUI_ASCII (the old hardcoded ✓/✗ ignored it)."""
    emoji, sym, asc = _MARKS.get(kind, ("•", "·", "-"))
    return asc if _TUI_ASCII else (emoji if _TUI_EMOJI else sym)


_SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"          # braille spinner (single-width BMP), ASCII fallback below


def _spin(i: int) -> str:
    """One spinner frame for tick `i` — a braille whirl in the animated (emoji) tier,
    `|/-\\` under ASCII. In the calm tiers (PLAIN, or any non-animated mode) motion is
    suppressed: a static dot, so a per-keypress redraw never flickers a braille glyph
    where the tier contract promises no motion."""
    if not _TUI_ANIM:
        return "-" if _TUI_ASCII else "·"
    frames = "|/-\\" if _TUI_ASCII else _SPIN
    return frames[i % len(frames)]


# Block-letter masks for the GENESEED splash logo (5 rows, '#' = ink). Compact, hand
# tuned to ~7 cols/letter so the eight-letter word fits ~52 columns.
_LOGO_FONT = {
    "G": [" ### ", "#    ", "# ## ", "#  # ", " ### "],
    "E": ["#### ", "#    ", "###  ", "#    ", "#### "],
    "N": ["#   #", "##  #", "# # #", "#  ##", "#   #"],
    "S": [" ####", "#    ", " ### ", "    #", "#### "],
    "D": ["###  ", "#  # ", "#   #", "#  # ", "###  "],
}


def _logo_lines() -> list[str]:
    """The 'GENESEED' wordmark as 5 text rows (filled with the full-block glyph), or an
    ASCII '#'-rendered version under GENESEED_TUI_ASCII. Letters joined by a space gap."""
    ink = "#" if _TUI_ASCII else "█"
    rows = []
    for r in range(5):
        cells = [_LOGO_FONT[c][r].replace("#", ink) for c in "GENESEED"]
        rows.append(" ".join(cells))
    return rows


def _put(stdscr, y, x, s, attr=0):
    """The one bounds-guarded draw primitive for every TUI screen. Clips to the window
    and swallows the edge-cell curses.error so a write to the last column never crashes."""
    import curses
    h, w = stdscr.getmaxyx()
    if 0 <= y < h and 0 <= x < w:
        try:
            stdscr.addnstr(y, x, s, max(0, w - x - 1), attr)
        except curses.error:
            pass


def _addch(stdscr, y, x, c, attr=0):
    """Bounds-guarded single-cell draw — the `addch` sibling of `_put`. Clips to the
    window and swallows the edge-cell curses.error, so the box/divider primitives never
    crash on the last row/column. One source for the try/except every screen duplicated."""
    import curses
    h, w = stdscr.getmaxyx()
    if 0 <= y < h and 0 <= x < w:
        try:
            stdscr.addch(y, x, c, attr)
        except curses.error:
            pass


def _hline(stdscr, pal, y, x, w, attr=None):
    """A horizontal rule of `w` display columns at (y, x): ACS ─, or ASCII `-` under
    GENESEED_TUI_ASCII. One source for the inline `("-" if _TUI_ASCII else "─")*n` rules."""
    ch = "-" if _TUI_ASCII else "─"
    _put(stdscr, y, x, ch * max(0, w), pal["FRAME"] if attr is None else attr)


def _clear_frame(stdscr):
    """Erase the frame *and* force a full physical repaint on the next refresh.

    A plain `erase()` does a diff-based update: ncurses repaints only the cells it
    thinks changed. That leaves ghosts behind in two common cases — content from a
    different prior screen, and the trailing half of a double-width glyph (the themed
    sigils/emoji, the `·`/box-drawing characters) that a single-width blank doesn't
    cover. These screens redraw only on a keypress (`getch` blocks between frames), so
    a guaranteed full repaint per frame costs nothing and is flicker-free — unlike a
    continuously animating loop. `clearok(True)` is reset by the refresh it triggers,
    so it is set each frame."""
    stdscr.erase()
    stdscr.clearok(True)


def _topbar(stdscr, pal, text):
    """Top title bar (row 0), with the consistent badge glyph (🧬 in emoji mode)."""
    _, w = stdscr.getmaxyx()
    badge = _icon("badge")
    _put(stdscr, 0, 0, _fit(f"  {badge} {text}  ", w - 1), pal["BAR"])


def _botbar(stdscr, pal, hints):
    """Bottom hint bar (row h-1). `hints` is a ready string, or a list of (key, label)
    pairs joined uniformly so every screen's footer reads the same way."""
    h, w = stdscr.getmaxyx()
    text = hints if isinstance(hints, str) else " · ".join(f"{k} {lbl}" for k, lbl in hints)
    _put(stdscr, h - 1, 0, _fit(f"  {text}  ", w - 1), pal["BAR"])


def _clamp(top, total, view_h):
    """Clamp a scroll offset so the [top, top+view_h) window stays inside `total` rows."""
    return max(0, min(top, max(0, total - view_h)))


def _wrap_lines(lines, width):
    """Flatten raw lines into width-wrapped display lines (blank lines preserved)."""
    import textwrap
    out = []
    for ln in lines:
        if ln:
            out.extend(textwrap.wrap(ln, max(1, width)) or [""])
        else:
            out.append("")
    return out


def _too_small(stdscr, min_h, min_w):
    """Draw the 'enlarge the window' guard and return True when the terminal is below
    the minimum; the caller then refreshes, reads a key, and continues/returns."""
    import curses
    h, w = stdscr.getmaxyx()
    if h < min_h or w < min_w:
        _put(stdscr, 0, 0, "Terminal too small — enlarge the window, or press q.", curses.A_BOLD)
        return True
    return False


def _vdiv(stdscr, pal, dx, y0, y1):
    """Vertical divider at column dx over rows [y0, y1) — the two-pane split."""
    import curses
    g = _bx(curses)
    for r in range(y0, y1):
        _addch(stdscr, r, dx, g["v"], pal["FRAME"])


def _scrollbar(stdscr, pal, x, y0, view_h, top, total):
    """Consistent ▴/▾ scroll markers at column x: ▴ at the top row when scrolled down,
    ▾ at the last visible row when more remains below. No-op when everything fits."""
    if total <= view_h:
        return
    if top > 0:
        _put(stdscr, y0, x, _GLYPH["up"], pal["FRAME"])
    if top + view_h < total:
        _put(stdscr, y0 + view_h - 1, x, _GLYPH["down"], pal["FRAME"])


def _bx(curses) -> dict:
    """Line/box glyphs — ASCII (+ - |) when GENESEED_TUI_ASCII is set (for fonts that
    render ACS box-drawing as tofu), else ACS line glyphs."""
    if _TUI_ASCII:
        return {"ul": "+", "ur": "+", "ll": "+", "lr": "+", "ttee": "+", "btee": "+",
                "h": ord("-"), "v": ord("|"), "up": "^", "down": "v"}
    return {"ul": curses.ACS_ULCORNER, "ur": curses.ACS_URCORNER, "ll": curses.ACS_LLCORNER,
            "lr": curses.ACS_LRCORNER, "ttee": curses.ACS_TTEE, "btee": curses.ACS_BTEE,
            "h": curses.ACS_HLINE, "v": curses.ACS_VLINE, "up": curses.ACS_UARROW,
            "down": curses.ACS_DARROW}


def _accent_for(theme: str) -> str:
    """The ACCENT colour name a theme declares (default cyan)."""
    try:
        return json.loads((build.THEMES / f"{theme}.json").read_text(encoding="utf-8")).get("ACCENT", "cyan")
    except (OSError, json.JSONDecodeError):
        return "cyan"


def _draw_box(stdscr, curses, y, x, hh, ww, attr=0) -> None:
    """Single-line box; ASCII when GENESEED_TUI_ASCII, else ACS glyphs. Bounds-guarded."""
    g = _bx(curses)

    def ch(yy, xx, c):
        _addch(stdscr, yy, xx, c, attr)
    x2, y2 = x + ww - 1, y + hh - 1
    ch(y, x, g["ul"]); ch(y, x2, g["ur"]); ch(y2, x, g["ll"]); ch(y2, x2, g["lr"])
    try:
        stdscr.hline(y, x + 1, g["h"] | attr, ww - 2)
        stdscr.hline(y2, x + 1, g["h"] | attr, ww - 2)
        stdscr.vline(y + 1, x, g["v"] | attr, hh - 2)
        stdscr.vline(y + 1, x2, g["v"] | attr, hh - 2)
    except curses.error:
        pass


def _tui_palette(curses, accent="cyan") -> dict:
    """Shared colour attributes (frame, bars, selection, headings, icons). The frame /
    bar / header colour follows the theme ACCENT. Degrades to monochrome attributes
    when the terminal has no colour."""
    cols = {"cyan": curses.COLOR_CYAN, "yellow": curses.COLOR_YELLOW, "red": curses.COLOR_RED,
            "green": curses.COLOR_GREEN, "magenta": curses.COLOR_MAGENTA,
            "blue": curses.COLOR_BLUE, "white": curses.COLOR_WHITE}
    acc = cols.get(accent, curses.COLOR_CYAN)
    color = False
    try:
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, acc, -1)
        curses.init_pair(2, curses.COLOR_BLACK, acc)
        curses.init_pair(3, curses.COLOR_BLACK, curses.COLOR_GREEN)
        curses.init_pair(4, curses.COLOR_YELLOW, -1)
        curses.init_pair(5, curses.COLOR_MAGENTA, -1)
        curses.init_pair(6, curses.COLOR_GREEN, -1)
        curses.init_pair(7, curses.COLOR_RED, -1)
        curses.init_pair(8, curses.COLOR_YELLOW, -1)
        color = curses.has_colors()
    except curses.error:
        color = False
    cp = curses.color_pair
    return {
        "FRAME": cp(1) if color else curses.A_DIM,
        "BAR": (cp(2) | curses.A_BOLD) if color else curses.A_REVERSE,
        "SEL": (cp(3) | curses.A_BOLD) if color else curses.A_REVERSE,
        "TITLE": (cp(4) | curses.A_BOLD) if color else curses.A_BOLD,
        "ICON": cp(5) if color else 0,
        "HEAD": (cp(1) | curses.A_BOLD) if color else curses.A_BOLD,
        "OK": (cp(6) | curses.A_BOLD) if color else curses.A_BOLD,
        "FAIL": (cp(7) | curses.A_BOLD) if color else curses.A_BOLD,
        # WARN is yellow (distinct from red FAIL) so a warning never reads as a failure;
        # MUTED is the dim attribute, formalised as a named slot for hints/secondary text.
        "WARN": (cp(8) | curses.A_BOLD) if color else curses.A_BOLD,
        "MUTED": curses.A_DIM,
    }


_BAR_EIGHTHS = " ▏▎▍▌▋▊▉█"   # 0..8 eighths of a cell — sub-character resolution


def _progress_bar(frac: float, width: int = 24) -> str:
    """A determinate bar exactly `width` display columns wide. In the emoji/plain tiers
    it fills at 8-eighths sub-cell resolution (one partial block at the frontier) so the
    bar advances smoothly instead of jumping a whole cell at a time; ASCII falls back to
    a #/- bar (set GENESEED_TUI_ASCII=1 if a font garbles the block glyphs)."""
    frac = max(0.0, min(1.0, frac))
    if _TUI_ASCII:
        filled = int(round(frac * width))
        return "#" * filled + "-" * (width - filled)
    eighths = int(round(frac * width * 8))
    full, rem = divmod(eighths, 8)
    if full >= width:
        return "█" * width
    return "█" * full + _BAR_EIGHTHS[rem] + " " * (width - full - 1)


def _theme_preview(key):
    """Right-panel preview lines for a theme, read live from its JSON: tagline, sigil,
    voice, and a sample law title. Returns (kind, text) rows."""
    try:
        data = json.loads((build.THEMES / f"{key}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [("dim", "(no preview available)")]
    lines = [("title", key), ("", "")]
    if data.get("TAGLINE"):
        lines += [("dim", data["TAGLINE"]), ("", "")]
    if data.get("LOADED_SIGIL"):
        lines += [("ok", data["LOADED_SIGIL"]), ("", "")]
    if data.get("VOICE"):
        lines += [("", "Voice — " + data["VOICE"]), ("", "")]
    if data.get("LEX_I"):
        lines.append(("", "e.g.  Rule I — " + data["LEX_I"]))
    if data.get("BENEDICTION"):
        lines += [("", ""), ("dim", data["BENEDICTION"])]
    return lines


def _theme_flair(theme: str) -> dict:
    """The voice elements the setup chrome speaks in once a theme is chosen, read live
    from its JSON (pure — unit-tested): accent colour, tagline, loaded-sigil, banner
    rows, and benediction. Every field degrades to an empty string / list when the
    theme omits it, so the caller falls back to plain text instead of crashing. This is
    what carries the theme rework's 'voice, vocabulary, and a banner' into the wizard's
    confirm and success screens — the same flavour the rendered bundle now wears."""
    try:
        data = json.loads((build.THEMES / f"{theme}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    return {
        "accent": data.get("ACCENT", "cyan"),
        "tagline": data.get("TAGLINE", ""),
        "sigil": data.get("LOADED_SIGIL", ""),
        "banner": data.get("BANNER", "").splitlines(),
        "benediction": data.get("BENEDICTION", ""),
    }


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
    emit_prompt = "Choose an install mode" + (f"   (installed: {inst['emit']})" if inst["emit"] else "")
    emit = _menu(stdscr, curses, emit_prompt,
                 [(k, k, d) for k, d in EMIT_OPTIONS], default=inst["emit"] or "opencode-global")
    if emit is None:
        return None
    out = root = None
    if emit == "opencode":
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
    summary = f"theme = {theme}     mode = {emit}" + (f"     target = {target}" if target else "")
    # Once a theme is chosen the confirm step speaks in its voice: the tagline is the
    # prompt and the accent tints the frame, so you feel the flavour you're about to
    # implant before committing to the build.
    prompt = flair["tagline"] or "Ready to build the harness?"
    choice = _menu(stdscr, curses, prompt,
                   [("go", "Build now", summary),
                    ("cancel", "Cancel", "Make no changes and exit.")],
                   default="go", accent=flair["accent"])
    return {"theme": theme, "emit": emit, "out": out, "root": root} if choice == "go" else None


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
    emit = inst["emit"] or "opencode-global"
    flair = _theme_flair(theme)
    summary = f"theme = {theme}     mode = {emit} (unchanged)"
    prompt = flair["tagline"] or "Ready to rebuild the harness?"
    choice = _menu(stdscr, curses, prompt,
                   [("go", "Build now", summary),
                    ("cancel", "Cancel", "Make no changes and exit.")],
                   default="go", accent=flair["accent"])
    return {"theme": theme, "emit": emit, "out": None, "root": None} if choice == "go" else None


# Law heading in the rendered laws file, e.g. "### Rule XVIII — Load the Project Context".
LAW_HEADING_RE = re.compile(r"^###\s+\S+\s+([IVXLCDM]+)\s+[—-]\s+(.+?)\s*$")


def _parse_laws(text: str) -> list[dict]:
    """Split the rendered laws file into {num, title, body} entries."""
    laws: list[dict] = []
    cur: dict | None = None
    for line in text.splitlines():
        m = LAW_HEADING_RE.match(line)
        if m:
            if cur:
                laws.append(cur)
            cur = {"num": m.group(1), "title": m.group(2), "body": ""}
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
            entry = {"name": parts[1][:-3], "desc": build._first_blockquote(text), "body": text}
            if parts[0] == "agents":
                agents.append(entry)
            elif parts[0] == "skills":
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
    return [label]


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
    argv = _setup_build_args(theme, emit, out, root)
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


def _tui_loop(stdscr, inv: dict) -> None:
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
    sel = 0
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
    around rituals/web.py so the 4k-line CLI stays focused."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import web  # noqa: E402
    return web.serve(theme=args.theme, port=args.port,
                     open_browser=not args.no_browser)


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


# ---- bootstrap: update everything with a curses progress screen, then setup -------

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _clean_line(s: str) -> str:
    """Strip ANSI escapes and control characters from streamed subprocess output so
    they can't garble the curses log pane."""
    s = ANSI_RE.sub("", s)
    return "".join(ch if (ch == "\t" or ord(ch) >= 32) else " " for ch in s)


def _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading="updating") -> None:
    _clear_frame(stdscr)   # full repaint so a narrowing spinner leaves no double-width ghost
    h, w = stdscr.getmaxyx()

    def put(y, x, s, a=0):
        _put(stdscr, y, x, s, a)

    # Plain layout (no box-drawing frame) — matches the doctor progress screen, which
    # renders cleanly; the ACS frame showed as tofu in some terminal fonts.
    _topbar(stdscr, pal, f"Geneseed — {heading}")
    _bootstrap_draw.tick = getattr(_bootstrap_draw, "tick", 0) + 1
    tick = _bootstrap_draw.tick

    def step_mark(st):
        if st == "running":
            return _spin(tick)
        return {"pending": _mark("pending"), "done": _mark("ok"),
                "failed": _mark("fail")}.get(st, _mark("pending"))
    for i, (title, _c) in enumerate(steps):
        st = status[i]
        attr = pal["HEAD"] if st == "running" else (curses.A_DIM if st == "pending" else 0)
        # _fit the mark to a fixed 2 columns so a width-2 emoji mark and a width-1 dot
        # leave every step title starting at the same column (no per-row jitter).
        put(2 + i, 3, f"{_fit(step_mark(st), 2)} {title}", attr)
    done = sum(1 for s in status if s in ("done", "failed"))
    w_bar = max(10, min(40, w - 22))
    put(2 + len(steps) + 1, 3,
        f"[{_progress_bar(done / len(steps) if steps else 0.0, w_bar)}] {done}/{len(steps)}",
        pal["HEAD"])
    top = 2 + len(steps) + 3
    put(top, 3, "output:", pal["HEAD"])
    inner = max(0, h - top - 2)
    for j, ln in enumerate(log[-inner:]):
        put(top + 1 + j, 3, ln[:w - 4], curses.A_DIM)
    _botbar(stdscr, pal, f"{_spin(tick)} working… please wait")
    stdscr.refresh()


def _pipe_select_ok() -> bool:
    """Whether select() can poll the subprocess pipe. On Windows select() is WinSock-only
    — handing it a pipe fd raises OSError — so Windows always streams plainly instead."""
    import select
    return hasattr(select, "select") and not sys.platform.startswith("win")


def _install_logfile() -> Path | None:
    """The persistent install log `_update.py` writes to — so a failed in-process update
    step lands its diagnosis in the SAME file a real `upgrade` run logs to, giving the user
    one place to read regardless of which path failed. Honours $GENESEED_LOG. None only if
    even the fallback is unwritable."""
    try:
        import _update
        return _update._logfile()
    except Exception:
        return Path.home() / ".geneseed-install.log"


def _stale_factory_hint(output: str, sub: str, ref: str) -> list[str]:
    """If `output` is argparse's 'invalid choice' reject for the self-update subcommand
    `sub`, return the targeted cure; else []. This is the partial-update skew behind the
    field report: step 1/2 (sync-self) refreshed the launchers + _update.py, but the factory
    (rituals/harness.py) is still too old to know `upgrade`/`sync-self`, so step 2/2 dies in
    argparse before `_update` is ever reached. The launchers self-heal via _update.py; this
    points a manual run at the same cure."""
    low = (output or "").lower()
    if not (sub and "invalid choice" in low and sub in low):
        return []
    return [
        f"[geneseed]   diagnosis: the installed rituals/harness.py PREDATES the '{sub}' subcommand.",
        "[geneseed]   step 1/2 refreshed the launchers + _update.py, but the factory is still old —",
        f"[geneseed]   so step 2/2 'harness.py {sub}' hit argparse 'invalid choice'. Self-heal directly:",
        f"[geneseed]     python rituals/_update.py update {ref}",
    ]


def _diagnose_failed_step(n: int, total: int, title: str, cmd: list,
                          rc: int, output: str) -> list[str]:
    """Build — and persist to the install log — the diagnosis for a failed update step.
    Returns the human lines to ALSO surface live (progress pane / stdout). `output` is the
    step's captured combined output (curses path) or a captured re-probe (plain path); it is
    scanned for the stale-factory signature. Persisting matters: the curses log pane is
    ephemeral and the plain path's child output scrolls past, so without this the only trace
    of WHY a step failed is gone the moment the screen tears down."""
    sub = cmd[2] if len(cmd) > 2 else ""
    ref = cmd[3] if len(cmd) > 3 else "main"
    lines = [f"[geneseed] ✗ step {n}/{total} FAILED (exit {rc}): {title}"]
    lines += _stale_factory_hint(output, sub, ref)
    logpath = _install_logfile()
    if logpath is not None:
        try:
            with logpath.open("a", encoding="utf-8") as fh:
                fh.write(f"\n==== geneseed update: step {n}/{total} '{title}' FAILED (exit {rc}) ====\n")
                fh.write("command: " + " ".join(str(c) for c in cmd) + "\n")
                if output.strip():
                    fh.write(output.rstrip("\n") + "\n")
                for ln in lines[1:]:
                    fh.write(ln + "\n")
            lines.append(f"[geneseed] ── full install log: {logpath}")
        except OSError:
            pass
    return lines


def _harness_supports(hp: str, sub: str) -> bool:
    """True iff this harness.py knows subcommand `sub`. A side-effect-free `--help` exits 0
    only when the subparser exists — argparse rejects an unknown choice with exit 2. This is
    the same probe the launchers use to detect a stale factory."""
    try:
        pr = subprocess.run([sys.executable, hp, sub, "--help"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return pr.returncode == 0
    except OSError:
        return False


def _update_step_cmd(here: Path, sub: str, ref: str) -> list:
    """The command for one update step, self-healing a STALE factory. Prefer the in-tree
    `harness.py <sub>`; but when harness.py predates it — the partial-update skew that breaks
    step 2/2 with argparse 'invalid choice' — drop to `rituals/_update.py <sub>`, the exact
    same code path (and the same fallback the launchers use). So an update started from a
    stale factory now REPAIRS itself in-process instead of dead-ending."""
    hp = str(here / "rituals" / "harness.py")
    if _harness_supports(hp, sub):
        return [sys.executable, hp, sub, ref]
    return [sys.executable, str(here / "rituals" / "_update.py"), sub, ref]


def _run_logged(stdscr, curses, pal, steps, status, log, cmd, heading="updating") -> int:
    """Run cmd, streaming its (sanitized) output into the progress screen's log pane."""
    try:
        # Decode as UTF-8 regardless of the console code page: the children (harness.py,
        # build.py) reconfigure THEIR stdout to UTF-8, and a cp1252-strict wrapper dies
        # on the first ⚠️/✓ they emit. errors="replace" keeps a stray byte cosmetic.
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace", bufsize=1)
    except OSError as e:
        log.append(f"[error] cannot run {cmd[0]}: {e}")
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
        return 1
    import time
    import select
    last = 0.0

    def _emit_lines(buf: str) -> str:
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            log.append(_clean_line(line))
            if len(log) > 400:
                del log[: len(log) - 400]
        return buf

    fd = p.stdout.fileno() if p.stdout else None
    if fd is not None and _pipe_select_ok():
        # Poll the pipe with an 80 ms timeout so the screen redraws — and the spinner
        # advances — even while a step produces NO output (the silent-step freeze). Only
        # this main thread touches curses; os.read on the raw fd gives a clean EOF.
        buf = ""
        while True:
            r, _w, _e = select.select([fd], [], [], 0.08)
            if r:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    chunk = b""
                if not chunk:
                    break                       # subprocess closed stdout → done
                buf = _emit_lines(buf + chunk.decode("utf-8", "replace"))
            now = time.monotonic()
            if (not r) or now - last > 0.06:     # tick on idle; throttle on busy output
                _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
                last = now
        if buf:
            log.append(_clean_line(buf))
    else:                                        # no pipe select (non-Unix) — stream plainly
        for line in p.stdout or []:
            log.append(_clean_line(line.rstrip("\n")))
            if len(log) > 400:
                del log[: len(log) - 400]
            now = time.monotonic()
            if now - last > 0.06:
                _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
                last = now
    _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)   # final frame
    if p.stdout is not None:
        p.stdout.close()
    return p.wait()


def _run_steps(stdscr, curses, pal, steps, heading="working") -> list:
    """Run each (title, cmd) step in the progress UI; return the per-step status list."""
    status = ["pending"] * len(steps)
    log: list[str] = []
    for i, (title, cmd) in enumerate(steps):
        status[i] = "running"
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
        rc = _run_logged(stdscr, curses, pal, steps, status, log, cmd, heading)
        status[i] = "done" if rc == 0 else "failed"
        if rc != 0:
            # The pane scrolls and curses tears down on exit — capture WHY to the install
            # log and surface the diagnosis (incl. the stale-factory cure) in the pane.
            for ln in _diagnose_failed_step(i + 1, len(steps), title, cmd, rc, "\n".join(log)):
                log.append(ln)
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
    return status


def _bootstrap_progress(stdscr, here, ref) -> None:
    import curses
    pal = _tui_palette(curses)
    curses.curs_set(0)
    if ref is None:
        ref = _text_input(stdscr, curses, "Update from which upstream ref?", "main") or "main"
        curses.curs_set(0)
    steps = [("Refresh orchestration scripts", _update_step_cmd(here, "sync-self", ref)),
             ("Update factory & rebuild bundle", _update_step_cmd(here, "upgrade", ref))]
    status = _run_steps(stdscr, curses, pal, steps, heading="updating")
    failed = any(s == "failed" for s in status)
    msg = ("a step FAILED — press any key to continue to setup" if failed
           else "update complete — continuing to setup…")
    _botbar(stdscr, pal, msg)
    stdscr.refresh()
    if failed:
        stdscr.getch()          # pause so the error is readable
    else:
        curses.napms(700)       # brief beat, then continue automatically


def _bootstrap_plain(here, ref) -> None:
    """Non-curses fallback: run the update steps with plain output (never fatal).
    Cross-platform — invokes the harness's own Python `sync-self`/`upgrade` subcommands
    (no bash), so this works identically on native Windows. On a step failure it reports
    the exit code and (for the stale-factory skew) the exact self-heal command — the old
    code ignored the return codes, so a broken step 2/2 left no verdict at all."""
    r = ref or "main"
    steps = [("Refresh orchestration scripts", _update_step_cmd(here, "sync-self", r)),
             ("Update factory & rebuild bundle", _update_step_cmd(here, "upgrade", r))]
    failed = False
    for i, (title, cmd) in enumerate(steps):
        print(f"[geneseed] step {i + 1}/{len(steps)}: {title} ...")
        rc = run(cmd).returncode
        if rc != 0:
            failed = True
            # The live run inherited stdout, so its output was not captured. Re-probe the
            # subcommand (captured) to confirm the stale-factory signature for the diagnosis.
            hp = str(here / "rituals" / "harness.py")
            sub = cmd[2] if len(cmd) > 2 else ""
            probe = ""
            if sub in ("upgrade", "sync-self"):
                pr = subprocess.run([sys.executable, hp, sub, "--help"],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, encoding="utf-8", errors="replace")
                if pr.returncode != 0:
                    probe = pr.stdout or ""
            for ln in _diagnose_failed_step(i + 1, len(steps), title, cmd, rc, probe):
                print(ln)
    if not failed:
        print("[geneseed] ✓ update complete.")


def cmd_upgrade(args: argparse.Namespace) -> int:
    """Self-upgrade from the published source, then rebuild the bundle. Cross-platform
    (stdlib download + extract) — replaces upgrade.sh; the wrapper now delegates here.
    Before anything is refreshed, any drift in the deployed global harness (the
    self-improvement loops edit it in place) is exported to an improvements file —
    the rebuild overwrites those edits, and the export must compare against the
    PRE-refresh source the deployment was built from."""
    try:
        ipath, _ = export_improvements()
        if ipath:
            print(f"[upgrade] deployed harness carries local edits — saved to {ipath}")
            print("[upgrade] hand that file to your agent to back-port them into src/.")
    except Exception as e:                  # never block an upgrade on the export
        sys.stderr.write(f"[upgrade] ⚠️  could not export local edits ({e}) — "
                         f"run `geneseed diff --out FILE` before upgrading to keep them.\n")
    import _update
    return _update.upgrade(args.ref, args.theme)


def cmd_sync_self(args: argparse.Namespace) -> int:
    """Refresh the orchestration layer (launchers + update scripts) that `upgrade` does
    not touch. Cross-platform — replaces sync-self.sh; the wrapper now delegates here."""
    import _update
    return _update.sync_self(args.ref)


# --- run-from-anywhere (link/unlink): cross-platform PATH install ------------------
# Unix symlinks the launcher into a bin dir; Windows writes a small `geneseed.cmd` shim
# into a dedicated dir and puts THAT on the user PATH (no admin/Dev-Mode symlink needed).

def _win_bin_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / "Geneseed" / "bin"


def _win_user_path(action: str, directory: str) -> bool:
    """Add/remove `directory` from the persistent USER Path via PowerShell (operates on
    the user scope only, so it never truncates the system PATH). Returns success."""
    if action == "add":
        ps = (f"$d='{directory}';"
              "$p=[Environment]::GetEnvironmentVariable('Path','User');"
              "if (-not $p) {$p=''};"
              "$parts=$p.Split(';') | Where-Object {$_ -ne ''};"
              "if ($parts -notcontains $d) {"
              "  $np=(@($parts)+$d) -join ';';"
              "  [Environment]::SetEnvironmentVariable('Path',$np,'User')}")
    else:
        ps = (f"$d='{directory}';"
              "$p=[Environment]::GetEnvironmentVariable('Path','User');"
              "if ($p) {"
              "  $np=(($p.Split(';') | Where-Object {$_ -ne '' -and $_ -ne $d}) -join ';');"
              "  [Environment]::SetEnvironmentVariable('Path',$np,'User')}")
    try:
        return run(["powershell", "-NoProfile", "-Command", ps]).returncode == 0
    except OSError:
        return False


def cmd_link(args: argparse.Namespace) -> int:
    """Put `geneseed` on PATH so it runs from any directory."""
    here = ROOT
    if sys.platform.startswith("win"):
        bindir = _win_bin_dir()
        bindir.mkdir(parents=True, exist_ok=True)
        shim = bindir / "geneseed.cmd"
        shim.write_text(
            "@echo off\r\n"
            f'python "{here / "rituals" / "harness.py"}" %*\r\n', encoding="utf-8")
        print(f"geneseed: wrote shim {shim}")
        on_path = str(bindir).lower() in (os.environ.get("PATH") or "").lower()
        if on_path or _win_user_path("add", str(bindir)):
            print(f"geneseed: '{bindir}' is on your user PATH — open a NEW terminal, then run `geneseed`.")
        else:
            print(f"geneseed: add '{bindir}' to your PATH manually, then run `geneseed` from anywhere.")
        return 0
    # Unix: symlink the launcher into a bin dir (default ~/.local/bin, no sudo).
    target_dir = Path(args.dir) if getattr(args, "dir", None) else None
    if target_dir is None:
        local = Path.home() / ".local" / "bin"
        try:
            local.mkdir(parents=True, exist_ok=True)
            target_dir = local
        except OSError:
            target_dir = Path("/usr/local/bin")
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / "geneseed"
    try:
        if dest.is_symlink() or dest.exists():
            dest.unlink()
        dest.symlink_to(here / "geneseed")
    except OSError as e:
        print(f"geneseed: could not write {dest} ({e}) — pick a writable dir: "
              f"geneseed link <dir>", file=sys.stderr)
        return 1
    print(f"geneseed: linked {dest} -> {here / 'geneseed'}")
    if str(target_dir) in (os.environ.get("PATH") or "").split(os.pathsep):
        print(f"geneseed: '{target_dir}' is on PATH — run 'geneseed' from anywhere.")
    else:
        print(f"geneseed: NOTE '{target_dir}' is not on your PATH. Add it, e.g.:")
        print(f"  echo 'export PATH=\"{target_dir}:$PATH\"' >> ~/.zshrc   # or ~/.bashrc")
    return 0


def cmd_unlink(args: argparse.Namespace) -> int:
    """Remove the `geneseed` launcher from PATH (the symlink on Unix / shim + PATH entry
    on Windows)."""
    if sys.platform.startswith("win"):
        bindir = _win_bin_dir()
        shim = bindir / "geneseed.cmd"
        removed = False
        if shim.exists():
            shim.unlink()
            removed = True
            print(f"geneseed: removed {shim}")
        if _win_user_path("remove", str(bindir)):
            print(f"geneseed: removed '{bindir}' from your user PATH (open a new terminal).")
        if not removed:
            print("geneseed: no linked launcher found.")
        return 0
    removed = False
    candidates = [Path.home() / ".local" / "bin", Path("/usr/local/bin")]
    candidates += [Path(d) for d in (os.environ.get("PATH") or "").split(os.pathsep) if d]
    seen: set[Path] = set()
    for d in candidates:
        if d in seen:
            continue
        seen.add(d)
        f = d / "geneseed"
        if f.is_symlink() and Path(os.readlink(f)).name == "geneseed":
            try:
                f.unlink()
                print(f"geneseed: removed {f}")
                removed = True
            except OSError:
                pass
    if not removed:
        print("geneseed: no linked launcher found on PATH")
    return 0


def _reexec(argv: list) -> None:
    """Hand off to a FRESH harness process (so just-updated code on disk runs, not the
    stale modules this process still holds). Unix execv truly replaces the process.
    Windows has no exec — os.execv there spawns the child and kills this parent, which
    hands the console back to the launcher's cmd.exe mid-run and the two then fight
    over input — so run the child as a normal subprocess and exit with its code."""
    if sys.platform.startswith("win"):
        raise SystemExit(subprocess.run(argv).returncode)
    os.execv(argv[0], argv)


def cmd_bootstrap(args: argparse.Namespace) -> int:
    """Update everything (sync scripts + upgrade), shown in a curses progress screen
    where supported, then hand off to a FRESH setup process so the wizard runs the
    just-updated code. `--no-setup` stops after the update."""
    here = Path(__file__).resolve().parent.parent
    if sys.stdin.isatty():
        try:
            import curses
            import locale
            try:
                locale.setlocale(locale.LC_ALL, "")
            except locale.Error:
                pass
            curses.wrapper(_bootstrap_progress, here, args.ref)
        except Exception as e:
            sys.stderr.write(f"[bootstrap] progress UI unavailable ({e}); running plainly.\n")
            _bootstrap_plain(here, args.ref)
    else:
        _bootstrap_plain(here, args.ref)
    # Before the re-exec replaces this process: surface any improvements file the
    # upgrade step exported (its own notice scrolled by inside the progress screen).
    _flush_export_notes()
    if not args.no_setup:
        # Re-exec the freshly-updated harness so setup uses the new code (this running
        # process still holds the pre-update modules in memory).
        _reexec([sys.executable, str(Path(__file__).resolve()), "setup"])
    return 0


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


def main() -> int:
    # Force UTF-8 I/O so injected docs / templates with unicode (sigils, em-dashes)
    # do not crash on a legacy code page (e.g. Windows cp1252). Dependency-free.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass

    ap = argparse.ArgumentParser(prog="harness", description="Geneseed harness CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="render src/ -> Harness/")
    b.add_argument("--theme", default=None)
    b.set_defaults(fn=cmd_build)

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
    c.set_defaults(fn=cmd_context)

    gg = sub.add_parser("git-gate", help="PreToolUse hook: force an ASK before every git commit/push (Law XX backstop)")
    gg.set_defaults(fn=cmd_git_gate)

    df = sub.add_parser("diff", help="report how a deployed global harness differs from a fresh render (back-port aid)")
    df.add_argument("--target", default=None,
                    help="deployed config dir (default: $OPENCODE_CONFIG_DIR / ~/.config/opencode)")
    df.add_argument("--theme", default=None, help="theme the deployment used "
                    "(default: auto-detected from the deployed marker/sigil)")
    df.add_argument("--full", action="store_true", help="show unified diffs, not just the file-level summary")
    df.add_argument("--out", default=None, metavar="FILE",
                    help="also write the drift as a markdown improvements file — the "
                         "artifact to hand to an agent to back-port edits into src/")
    df.set_defaults(fn=cmd_diff)

    ve = sub.add_parser("version", help="show installed vs current-source fingerprint and whether they match")
    ve.add_argument("--target", default=None,
                    help="deployed dir to check (default: the OpenCode global config dir)")
    ve.set_defaults(fn=cmd_version)

    st = sub.add_parser("status", help="print the install dashboard as text (theme, mode, counts, memory, version)")
    st.set_defaults(fn=cmd_status)

    un = sub.add_parser("uninstall",
                        help="remove a global Geneseed install (manifest-tracked); keeps memory unless --purge-memory")
    un.add_argument("--target", default=None,
                    help="config dir to uninstall from (default: the OpenCode global config dir)")
    un.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    un.add_argument("--archive-memory", action="store_true",
                    help="move the memory store aside to archived-memory/<timestamp>/ "
                         "(never deleted; default keeps it in place)")
    un.set_defaults(fn=cmd_uninstall)

    le = sub.add_parser("learn", help="distil notes/transcript into memory entries")
    le.add_argument("file", nargs="?",
                    help="notes file, or a transcript (default: stdin — also accepts "
                         "a lifecycle-hook JSON payload with a transcript_path)")
    le.add_argument("--memory", default=None,
                    help="bundle memory dir to dedup against and index into "
                         "(default: $GENESEED_MEMORY, else ./memory or ./Harness/memory)")
    le.set_defaults(fn=cmd_learn)

    su = sub.add_parser("setup", help="interactive install wizard (dependency-free, all OSes)")
    su.set_defaults(fn=cmd_setup)

    tu = sub.add_parser("tui", help="full-screen curses control panel (Unix)")
    tu.add_argument("--theme", default=None, help="theme to show (default: harness.config.json)")
    tu.set_defaults(fn=cmd_tui)

    me = sub.add_parser("menu", help="interactive main menu (the default for ./geneseed)")
    me.set_defaults(fn=cmd_menu)

    bs = sub.add_parser("bootstrap", help="update everything (sync + upgrade) with a "
                                          "progress UI, then run setup")
    bs.add_argument("ref", nargs="?", default=None,
                    help="upstream ref (default: main; asked interactively if omitted)")
    bs.add_argument("extra", nargs="*", help=argparse.SUPPRESS)  # tolerate a legacy [theme] arg
    bs.add_argument("--no-setup", action="store_true", help="update only; skip the setup wizard")
    bs.set_defaults(fn=cmd_bootstrap)

    up = sub.add_parser("upgrade", help="self-upgrade from the published source, then rebuild "
                                        "the bundle (cross-platform; replaces upgrade.sh)")
    up.add_argument("ref", nargs="?", default=None, help="branch or tag (default: main)")
    up.add_argument("theme", nargs="?", default=None, help="optional: force a theme (neutral|imperial|…)")
    up.set_defaults(fn=cmd_upgrade)

    ss = sub.add_parser("sync-self", help="refresh the orchestration layer — launchers + update "
                                          "scripts (cross-platform; replaces sync-self.sh)")
    ss.add_argument("ref", nargs="?", default=None, help="branch or tag (default: main)")
    ss.set_defaults(fn=cmd_sync_self)

    wb = sub.add_parser("web", help="serve the deployed harness as a local web UI "
                                    "(browse agents/skills/laws/memory + run actions)")
    wb.add_argument("--theme", default=None, help="force a theme (default: detected)")
    wb.add_argument("--port", type=int, default=4747, help="port (default: 4747)")
    wb.add_argument("--no-browser", action="store_true",
                    help="don't auto-open the browser")
    wb.set_defaults(fn=cmd_web)

    lk = sub.add_parser("link", help="put `geneseed` on PATH so it runs from any directory")
    lk.add_argument("dir", nargs="?", default=None, help="bin dir to install into (Unix; default ~/.local/bin)")
    lk.set_defaults(fn=cmd_link)

    ul = sub.add_parser("unlink", help="remove the `geneseed` launcher from PATH")
    ul.set_defaults(fn=cmd_unlink)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
