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
                                   --full for unified diffs, --theme to match voice
    harness version [--target DIR] show the current source fingerprint vs the
                                   deployed install's, and whether they match
    harness status                 print the install dashboard as text (theme, mode,
                                   counts, memory, version) — headless, any OS
    harness uninstall [--target DIR] remove a global install via its manifest (owned
                                   files + opencode.json entry + markers); memory is
                                   never deleted — kept in place, or --archive-memory
                                   moves it to archived-memory/; --yes to skip prompt
    harness setup                  interactive, dependency-free install wizard (all OSes)
    harness tui                    full-screen curses control panel (Unix only)
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
        text = md.read_text(encoding="utf-8")
        rel = md.relative_to(out)
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
    are not in the render set and are correctly ignored."""
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
    for out_rel, text, src in items:
        dest = bundle / out_rel
        if not dest.exists():
            problems.append(f"[rendered] {bundle.name}/{out_rel} missing — rebuild the bundle")
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
    if args.full:
        for f in edited:
            print(f"\n--- {f['rel']} (source -> deployed) ---")
            print("\n".join(f["diff"]))
    elif edited:
        print("\nRun with --full to see the line-level diffs.")
    return 0
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


_ANSI = {"red": "31", "green": "32", "yellow": "33", "blue": "34",
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

    ac = _ANSI.get(d["accent"], "36")

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
    """Remove `entry` from opencode.json's `instructions`, leaving every other key
    intact. Returns True if the file was changed."""
    if not path.exists():
        return False
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    instr = cfg.get("instructions")
    if not isinstance(instr, list) or entry not in instr:
        return False
    cfg["instructions"] = [i for i in instr if i != entry]
    path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
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
    """Read an opencode.json into a dict; {} if missing or malformed."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _mcp_save(path: Path, config: dict) -> None:
    """Write `config` back as pretty JSON (the same shape build.py emits)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _mcp_targets() -> "list[tuple[str, Path]]":
    """Candidate opencode.json files to manage, most-local first: the current project's,
    then OpenCode's global config dir. Both are offered whether or not they exist yet —
    choosing one creates it on first write."""
    targets = [("this project", Path.cwd() / "opencode.json")]
    try:
        targets.append(("global config", build._opencode_config_dir() / "opencode.json"))
    except Exception:
        pass
    return targets


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
    for rel in owned:
        victim = target / rel
        try:
            if victim.is_file():
                victim.unlink()
                removed += 1
                if victim.name == "SKILL.md" and victim.parent != target \
                        and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError:
            pass
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
    if not sys.platform.startswith("win") and sys.stdin.isatty():
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
        lines.append(("info", 'learn plugin: export GENESEED_HARNESS="$HOME/.config/opencode"'))
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
    argv = _setup_build_args(theme, emit, out, root)
    print("Running:  python build.py " + " ".join(argv))
    rc = run([sys.executable, str(BUILD), *argv]).returncode
    if rc != 0:
        sys.stderr.write("[setup] build failed — no harness written (see the output above).\n")
        return rc
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
    if not sys.platform.startswith("win"):
        try:
            import curses
            import locale
            try:
                locale.setlocale(locale.LC_ALL, "")
            except locale.Error:
                pass
            return curses.wrapper(_setup_flow)
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
        "agent": "@" if ascii_mode else "◆",
        "skill": "*" if ascii_mode else "✦",
        "law":   "#" if ascii_mode else "§",
    }


_GLYPH = _glyphs(_TUI_ASCII)
_SEL_G = _GLYPH["sel"]       # back-compat aliases
_MORE_G = _GLYPH["down"]


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


def _topbar(stdscr, pal, text):
    """Top title bar (row 0), with the consistent badge glyph."""
    _, w = stdscr.getmaxyx()
    _put(stdscr, 0, 0, f"  {_GLYPH['head']} {text}  ".ljust(w - 1), pal["BAR"])


def _botbar(stdscr, pal, hints):
    """Bottom hint bar (row h-1). `hints` is a ready string, or a list of (key, label)
    pairs joined uniformly so every screen's footer reads the same way."""
    h, w = stdscr.getmaxyx()
    text = hints if isinstance(hints, str) else " · ".join(f"{k} {lbl}" for k, lbl in hints)
    _put(stdscr, h - 1, 0, f"  {text}  ".ljust(w - 1), pal["BAR"])


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
        try:
            stdscr.addch(r, dx, g["v"], pal["FRAME"])
        except curses.error:
            pass


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
        try:
            stdscr.addch(yy, xx, c, attr)
        except curses.error:
            pass
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
    }


def _progress_bar(frac: float, width: int = 24) -> str:
    # Full block (█, near-universal, single-width) on a blank track. Set
    # GENESEED_TUI_ASCII=1 to fall back to a pure-ASCII bar if a font garbles it.
    frac = max(0.0, min(1.0, frac))
    filled = int(round(frac * width))
    if _TUI_ASCII:
        return "#" * filled + "-" * (width - filled)
    return "█" * filled + " " * (width - filled)


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


def _menu(stdscr, curses, prompt, options, default=None, detail_fn=None):
    """Framed, colored single-choice menu. Returns the chosen key or None (cancel).
    options: list of (key, label, description). With detail_fn, render two panes — the
    list on the left and detail_fn(key)'s lines on the right; else the focused row's
    description shows beneath the list."""
    import textwrap
    pal = _tui_palette(curses)
    curses.curs_set(0)
    idx = 0
    if default is not None:
        idx = next((i for i, (k, _l, _d) in enumerate(options) if k == default), 0)
    while True:
        stdscr.erase()
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
                    put(2 + vi, 1, f" {_GLYPH['sel']} {label} ".ljust(liw)[:liw], pal["SEL"])
                else:
                    put(2 + vi, 2, f" {label}"[:liw - 1], 0)
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
                    put(y, 2, f" {_SEL_G} {label} ".ljust(w - 4)[:w - 4], pal["SEL"])
                else:
                    put(y, 3, f"  {label}", 0)
            dy = 2 + len(options) + 1
            if dy < h - 2:
                put(dy - 1, 2, ("-" if _TUI_ASCII else "─") * (w - 4), pal["FRAME"])
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
            stdscr.erase()
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
    summary = f"theme = {theme}     mode = {emit}" + (f"     target = {target}" if target else "")
    choice = _menu(stdscr, curses, "Ready to build the harness?",
                   [("go", "Build now", summary),
                    ("cancel", "Cancel", "Make no changes and exit.")], default="go")
    return {"theme": theme, "emit": emit, "out": out, "root": root} if choice == "go" else None


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

    state = {"i": 0, "total": 1, "label": "starting"}

    def on_progress(i, total, label):
        state.update(i=i, total=total, label=label)
        stdscr.erase()
        h, w = stdscr.getmaxyx()
        _topbar(stdscr, pal, "Geneseed — health check")
        frac = i / total if total else 0.0
        put(2, 3, f"Validating:  {label}", pal["TITLE"])
        put(4, 3, f"[{_progress_bar(frac, max(10, min(40, w - 22)))}] {int(frac * 100):3d}%", pal["HEAD"])
        _botbar(stdscr, pal, "please wait…")
        stdscr.refresh()

    themes, problems = _doctor_collect(on_progress=on_progress)
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
        stdscr.erase()
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
                put(1 + r, 2, f"✓ {seg}", pal["OK"])
            elif kind == "fail":
                put(1 + r, 2, f"✗ {seg}", pal["FAIL"])
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
    if (not sys.platform.startswith("win")) and sys.stdin.isatty():
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
    icon = {"ok": "✓", "warn": "!", "info": "·"}
    attr = {"ok": pal["OK"], "warn": pal["FAIL"], "info": 0}
    top = 0
    while True:
        stdscr.erase()
        h, w = stdscr.getmaxyx()

        def put(y, x, s, a=0):
            _put(stdscr, y, x, s, a)

        _topbar(stdscr, pal, f"Geneseed — {title}")
        flat = []
        for kind, text in lines:
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


def _setup_flow(stdscr) -> int:
    """One seamless curses setup: form → build → summary → health check."""
    import curses
    pal = _tui_palette(curses)
    sel = _setup_tui(stdscr)
    if not sel:
        return 0
    theme, emit = sel["theme"], sel["emit"]
    out, root = sel.get("out"), sel.get("root")
    argv = _setup_build_args(theme, emit, out, root)
    status = _run_steps(stdscr, curses, pal,
                        [("Build the harness", [sys.executable, str(BUILD), *argv])],
                        heading="building")
    ok = bool(status) and status[0] == "done"
    _info_screen(stdscr, curses, pal, "setup complete" if ok else "setup",
                 _setup_summary_lines(theme, emit, out, root, ok),
                 "Enter: run health check" if ok else "Enter: close")
    if not ok:
        return 1
    _doctor_view(stdscr, curses, pal)
    return 0


def _diff_view(stdscr, curses, pal) -> None:
    """Two-pane review of local edits: changed files on the left, the selected file's
    colored unified diff on the right (j/k file, PgUp/PgDn scroll, q close)."""
    target, _theme, files = _diff_collect()
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
    sym = {"edited": "~", "added": "+", "missing": "-"}
    sel = 0
    dtop = 0
    list_top = 0
    while True:
        stdscr.erase()
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
            put(1 + i, 0, f" {sym[st]} {f['rel']}".ljust(dx)[:dx], attr)
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
        _botbar(stdscr, pal, "j/k file · PgUp/PgDn scroll · q close")
        stdscr.refresh()
        c = stdscr.getch()
        if c in (ord("q"), 27, curses.KEY_ENTER, 10, 13):
            return
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
        ("info", "?                 this help"),
        ("info", "q                 quit the panel"),
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
    sel = dtop = 0
    query = ""
    filtering = confirm = False
    while True:
        view = [f for f in facts
                if not query or query.lower() in (f["name"] + " " + f["desc"]).lower()]
        if sel >= len(view):
            sel = max(0, len(view) - 1)
        stdscr.erase()
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
        for i in range(body_h):
            if i >= len(view):
                break
            f = view[i]
            put(1 + i, 0, f" {f['name']}".ljust(dx)[:dx], pal["SEL"] if i == sel else 0)
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
            put(1 + i, rx, wrapped[di][:rw], pal["TITLE"] if di == 0 else 0)
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
    ti, sel, msg = 0, 0, ""
    names = list(_MCP_PRESETS)
    while True:
        label, path = targets[ti]
        config = _mcp_load(path)
        stdscr.erase()
        h, w = stdscr.getmaxyx()

        def put(y, x, s, a=0):
            _put(stdscr, y, x, s, a)

        if _too_small(stdscr, 11, 44):
            stdscr.refresh()
            if stdscr.getch() in (ord("q"), 27):
                return
            continue
        _topbar(stdscr, pal, "Geneseed — MCP servers (OpenCode)")
        put(1, 2, f"target: {label}", pal["HEAD"])
        put(2, 2, f"{path}  ({'exists' if path.exists() else 'will be created'})", curses.A_DIM)
        for i, nm in enumerate(names):
            st = _mcp_state(config, nm)
            mark = {"enabled": "[x]", "disabled": "[~]", "absent": "[ ]"}[st]
            row = f"{mark} {_MCP_PRESETS[nm]['label']}  ({st})"
            y = 4 + i
            if y >= h - 6:
                break
            if i == sel:
                put(y, 2, f" {_SEL_G} {row} ".ljust(w - 4)[:w - 4], pal["SEL"])
            else:
                put(y, 3, f"  {row}", 0)
        dy = 4 + min(len(names), max(1, h - 10)) + 1
        if dy < h - 2:
            put(dy - 1, 2, ("-" if _TUI_ASCII else "─") * (w - 4), pal["FRAME"])
            for j, seg in enumerate(textwrap.wrap(_MCP_PRESETS[names[sel]]["desc"], w - 6)[:4]):
                if dy + j < h - 2:
                    put(dy + j, 3, seg, curses.A_DIM)
        if msg:
            put(h - 2, 2, msg[:w - 4], pal["OK"])
        _botbar(stdscr, pal,
                "↑↓ move · Enter add/remove · e enable/disable · t target · q back")
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
            nm = names[sel]
            if _mcp_state(config, nm) == "absent":
                config = _mcp_apply(config, nm, dict(_MCP_PRESETS[nm]["block"]))
                msg = f"added {nm} → {path.name}"
            else:
                config = _mcp_apply(config, nm, None)
                msg = f"removed {nm} from {path.name}"
            _mcp_save(path, config)
        elif c in (ord("e"), ord("E")):
            nm = names[sel]
            st = _mcp_state(config, nm)
            if st == "absent":
                msg = "add it first (Enter), then enable/disable"
            else:
                config = _mcp_set_enabled(config, nm, st == "disabled")
                _mcp_save(path, config)
                msg = f"{nm} {'enabled' if st == 'disabled' else 'disabled'}"


def _tui_loop(stdscr, inv: dict) -> None:
    import curses
    import textwrap

    curses.curs_set(0)
    try:
        stdscr.keypad(True)
    except curses.error:
        pass
    pal = _tui_palette(curses, _accent_for(inv.get("theme", "neutral")))
    g = _bx(curses)
    C_FRAME, C_BAR, C_SEL = pal["FRAME"], pal["BAR"], pal["SEL"]
    C_TITLE, C_ICON, C_HEAD = pal["TITLE"], pal["ICON"], pal["HEAD"]

    # Single-width BMP glyphs only — no emoji-presentation chars (e.g. ⚙/⏳) that
    # render double-width and break alignment in some terminal fonts.
    ICON = {"agent": _GLYPH["agent"], "skill": _GLYPH["skill"], "law": _GLYPH["law"]}
    SECT = {"AGENTS": _GLYPH["agent"], "SKILLS": _GLYPH["skill"], "LAWS": _GLYPH["law"]}

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
        stdscr.erase()
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
                put(y, 2, f"{SECT.get(name, '•')} {label}"[:liw], C_HEAD)
            elif ri == sel:
                put(y, 1, f" {_GLYPH['sel']} {ICON.get(kind, '•')} {label}".ljust(liw)[:liw], C_SEL)
            else:
                put(y, 2, f"{ICON.get(kind, '•')}", C_ICON)
                put(y, 4, label[:liw - 3])

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
                    "j/k move · / search · ? help · d doctor · x diff · b build · u update · q quit")
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
                    run(["bash", str(root / "sync-self.sh")])
                    run(["bash", str(root / "upgrade.sh")])
            try:
                input("\n[press Enter to return to the panel] ")
            except EOFError:
                pass
            curses.reset_prog_mode()
        # KEY_RESIZE and any other key fall through and re-render


def cmd_tui(args: argparse.Namespace) -> int:
    """Full-screen curses control panel: browse agents/skills/laws and run
    build/doctor/diff. Unix only (stdlib curses); degrades with a clear message."""
    if sys.platform.startswith("win"):
        print("[tui] the curses panel needs a Unix terminal. Use `harness setup` instead.")
        return 1
    if not sys.stdin.isatty():
        print("[tui] not an interactive terminal. Use `harness setup`, `doctor`, or `build`.")
        return 1
    try:
        import curses  # noqa: F401  (availability probe)
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
    curses.wrapper(_tui_loop, inv)
    return 0


# ---- bootstrap: update everything with a curses progress screen, then setup -------

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _clean_line(s: str) -> str:
    """Strip ANSI escapes and control characters from streamed subprocess output so
    they can't garble the curses log pane."""
    s = ANSI_RE.sub("", s)
    return "".join(ch if (ch == "\t" or ord(ch) >= 32) else " " for ch in s)


def _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading="updating") -> None:
    stdscr.erase()
    h, w = stdscr.getmaxyx()

    def put(y, x, s, a=0):
        _put(stdscr, y, x, s, a)

    # Plain layout (no box-drawing frame) — matches the doctor progress screen, which
    # renders cleanly; the ACS frame showed as tofu in some terminal fonts.
    _topbar(stdscr, pal, f"Geneseed — {heading}")
    sym = {"pending": "-", "running": ">", "done": "+", "failed": "x"}
    for i, (title, _c) in enumerate(steps):
        st = status[i]
        attr = pal["HEAD"] if st == "running" else (curses.A_DIM if st == "pending" else 0)
        put(2 + i, 3, f"[{sym.get(st, '-')}] {title}", attr)
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
    _botbar(stdscr, pal, "working… please wait")
    stdscr.refresh()


def _run_logged(stdscr, curses, pal, steps, status, log, cmd, heading="updating") -> int:
    """Run cmd, streaming its (sanitized) output into the progress screen's log pane."""
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, bufsize=1)
    except OSError as e:
        log.append(f"[error] cannot run {cmd[0]}: {e}")
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
        return 1
    import time
    last = 0.0
    for line in p.stdout or []:
        log.append(_clean_line(line.rstrip("\n")))
        if len(log) > 400:
            del log[: len(log) - 400]
        now = time.monotonic()
        if now - last > 0.06:        # throttle redraws to avoid flicker on fast output
            _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
            last = now
    _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)   # final frame
    return p.wait()


def _run_steps(stdscr, curses, pal, steps, heading="working") -> list:
    """Run each (title, cmd) step in the progress UI; return the per-step status list."""
    status = ["pending"] * len(steps)
    log: list[str] = []
    for i, (_title, cmd) in enumerate(steps):
        status[i] = "running"
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
        rc = _run_logged(stdscr, curses, pal, steps, status, log, cmd, heading)
        status[i] = "done" if rc == 0 else "failed"
        _bootstrap_draw(stdscr, curses, pal, steps, status, log, heading)
    return status


def _bootstrap_progress(stdscr, here, ref) -> None:
    import curses
    pal = _tui_palette(curses)
    curses.curs_set(0)
    if ref is None:
        ref = _text_input(stdscr, curses, "Update from which upstream ref?", "main") or "main"
        curses.curs_set(0)
    steps = [("Refresh orchestration scripts", ["bash", str(here / "sync-self.sh"), ref]),
             ("Update factory & rebuild bundle", ["bash", str(here / "upgrade.sh"), ref])]
    status = _run_steps(stdscr, curses, pal, steps, heading="updating")
    failed = any(s == "failed" for s in status)
    h, w = stdscr.getmaxyx()
    msg = ("  a step FAILED — press any key to continue to setup  " if failed
           else "  update complete — continuing to setup…  ")
    try:
        stdscr.addnstr(h - 1, 0, msg.ljust(w - 1), max(0, w - 1), pal["BAR"])
    except curses.error:
        pass
    stdscr.refresh()
    if failed:
        stdscr.getch()          # pause so the error is readable
    else:
        curses.napms(700)       # brief beat, then continue automatically


def _bootstrap_plain(here, ref) -> None:
    """Non-curses fallback: run the update steps with plain output (never fatal)."""
    r = ref or "main"
    print("[geneseed] refreshing orchestration scripts ...")
    run(["bash", str(here / "sync-self.sh"), r])
    print("[geneseed] updating factory + rebuilding ...")
    run(["bash", str(here / "upgrade.sh"), r])


def cmd_bootstrap(args: argparse.Namespace) -> int:
    """Update everything (sync scripts + upgrade), shown in a curses progress screen
    where supported, then hand off to a FRESH setup process so the wizard runs the
    just-updated code. `--no-setup` stops after the update."""
    here = Path(__file__).resolve().parent.parent
    if (not sys.platform.startswith("win")) and sys.stdin.isatty():
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
    if not args.no_setup:
        # Re-exec the freshly-updated harness so setup uses the new code (this running
        # process still holds the pre-update modules in memory).
        os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve()), "setup"])
    return 0


_MENU_ACTIONS = [
    ("browse", "Browse", "Agents, skills and laws, with their full specs."),
    ("diff", "Review local edits", "Compare a deployed harness against source."),
    ("setup", "Set up / re-theme", "Pick a theme and install mode, then build."),
    ("update", "Update only", "Refresh the scripts + factory from upstream (no setup)."),
    ("bootstrap", "Update & set up", "Pull the latest from upstream, then run the setup wizard."),
    ("build", "Rebuild bundle", "Re-render the harness from src."),
    ("memory", "Memory", "Browse / search the memory store; delete stale facts."),
    ("mcp", "MCP servers", "Wire document conversion (MarkItDown) & other MCP servers into OpenCode."),
    ("status", "Status", "Theme, install mode, counts, and the memory store."),
    ("quit", "Quit", "Leave."),
    # 'doctor' (Health check) intentionally not listed: it runs after setup and via
    # the browse panel's `d` key. The dispatch below still handles it if re-added.
]


def _main_menu(stdscr) -> int:
    """The hub for a bare `./geneseed`: pick any action. In-TUI ones return here;
    update/bootstrap re-exec a fresh process (they change the code on disk)."""
    import curses
    here = Path(__file__).resolve().parent.parent
    hp = str(Path(__file__).resolve())
    inst = _installed_defaults()
    theme = inst["theme"] or _default_theme()
    emit = inst["emit"] or "files"
    pal = _tui_palette(curses, _accent_for(theme))
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
        elif sel == "mcp":
            _mcp_view(stdscr, curses, pal)
        elif sel == "status":
            _status_view(stdscr, curses, pal)
        elif sel == "setup":
            _setup_flow(stdscr)
            inst = _installed_defaults()
            theme = inst["theme"] or theme   # reflect a re-theme
            emit = inst["emit"] or emit
            pal = _tui_palette(curses, _accent_for(theme))
        elif sel == "diff":
            _diff_view(stdscr, curses, pal)
        elif sel == "build":
            curses.def_prog_mode()
            curses.endwin()
            run([sys.executable, str(BUILD)])
            try:
                input("\n[press Enter to return to the menu] ")
            except EOFError:
                pass
            curses.reset_prog_mode()
        elif sel in ("update", "bootstrap"):
            _bootstrap_progress(stdscr, here, None)
            curses.endwin()
            os.execv(sys.executable, [sys.executable, hp, "setup" if sel == "bootstrap" else "menu"])


def cmd_menu(args: argparse.Namespace) -> int:
    """Interactive main menu — the default for a bare `./geneseed`. Falls back to a
    one-line command list off a TTY / on Windows / if curses is unavailable."""
    if sys.platform.startswith("win") or not sys.stdin.isatty():
        print("Geneseed — run one of:  setup · bootstrap · update · build · doctor · diff · tui")
        print("On a Unix terminal, `./geneseed` opens an interactive menu of these.")
        return 0
    try:
        import curses
        import locale
        try:
            locale.setlocale(locale.LC_ALL, "")
        except locale.Error:
            pass
        return curses.wrapper(_main_menu)
    except Exception as e:
        sys.stderr.write(f"[menu] TUI unavailable ({e}).\n")
        return 1


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

    df = sub.add_parser("diff", help="report how a deployed global harness differs from a fresh render (back-port aid)")
    df.add_argument("--target", default=None,
                    help="deployed config dir (default: $OPENCODE_CONFIG_DIR / ~/.config/opencode)")
    df.add_argument("--theme", default=None, help="theme the deployment used "
                    "(default: auto-detected from the deployed marker/sigil)")
    df.add_argument("--full", action="store_true", help="show unified diffs, not just the file-level summary")
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

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
