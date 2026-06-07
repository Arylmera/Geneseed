#!/usr/bin/env python3
"""Geneseed harness CLI — optional automation.

Dependency-free. Subcommands:

    harness build [--theme NAME]   render src/ -> Harness/ for a theme
    harness doctor [--theme NAME]  validate the build(s): unresolved tokens, dead
                                   links, and non-hermetic links that escape the
                                   bundle. Sweeps every theme unless one is named
    harness context                resolve context.json and print eager entries'
                                   contents (Rule XVIII enforcement; wire to a
                                   SessionStart hook so the manifest is injected,
                                   never merely requested)
    harness diff [--target DIR]    report how a DEPLOYED global harness differs from
                                   a fresh render of the source (back-port aid) —
                                   --full for unified diffs, --theme to match voice
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


def cmd_doctor(args: argparse.Namespace) -> int:
    """Validate the build. With --theme, checks that one theme; without, sweeps
    EVERY theme so a token only the imperial map breaks cannot slip through."""
    themes = [args.theme] if args.theme else sorted(p.stem for p in build.THEMES.glob("*.json"))
    if not themes:
        print("[doctor] no themes found")
        return 1
    problems: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for theme_name in themes:
            out = Path(tmp) / theme_name
            rc = run([sys.executable, str(BUILD), "--theme", theme_name, "--out", str(out)],
                     cwd=ROOT, capture_output=True, text=True).returncode
            if rc != 0:
                problems.append(f"[{theme_name}] build failed")
                continue
            problems += _check_build(theme_name, out)
    problems += _theme_parity_problems()
    problems += _authoring_problems()
    if not args.no_bundle:
        bundle = Path(args.bundle).expanduser().resolve() if args.bundle else ROOT / "Harness"
        problems += _rendered_problems(bundle)
    if problems:
        print(f"[doctor] {len(problems)} problem(s) across {len(themes)} theme(s):")
        for p in sorted(set(problems)):
            print("  -", p)
        return 1
    print(f"[doctor] ok — {len(themes)} theme(s) clean: no unresolved tokens, no dead "
          f"links, nothing escapes the bundle; themes in parity; specs carry purpose "
          f"lines; rendered bundle in sync")
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
    beside the CWD or under ./Harness. None => stdout-only mode (no writes)."""
    if explicit:
        p = Path(explicit)
        return p if p.is_dir() else None
    env = os.environ.get("GENESEED_MEMORY")
    if env and Path(env).is_dir():
        return Path(env)
    cwd = Path.cwd()
    for base in (cwd, cwd / "Harness"):
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


def cmd_diff(args: argparse.Namespace) -> int:
    """Report how a DEPLOYED (ported) global harness differs from a fresh render of
    the current source — so edits made in place can be reviewed and back-ported to
    src/. Compares only the files Geneseed owns (per each side's manifest). Pass the
    theme the deployment used so voice tokens line up; `--full` shows unified diffs."""
    target = Path(args.target).expanduser() if args.target else build._opencode_config_dir()
    if not (target / build.GLOBAL_MANIFEST).exists():
        sys.stderr.write(
            f"[diff] no global Geneseed install at {target} (no {build.GLOBAL_MANIFEST}). "
            f"Pass --target, or run `--emit opencode-global` first.\n")
        return 1

    theme = args.theme
    if not theme:
        cfgp = ROOT / "harness.config.json"
        theme = (json.loads(cfgp.read_text(encoding="utf-8")).get("theme", "neutral")
                 if cfgp.exists() else "neutral")

    with tempfile.TemporaryDirectory() as tmp:
        expected = Path(tmp) / "expected"
        with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's own log
            build.emit_opencode_global(theme, out=Path(tmp) / "bundle", cfg=expected)
        edited, added, missing, diffs = [], [], [], []
        for rel in sorted(_owned_set(target) | _owned_set(expected)):
            a, b = target / rel, expected / rel
            if a.is_file() and b.is_file():
                ta = a.read_text(encoding="utf-8", errors="replace")
                tb = b.read_text(encoding="utf-8", errors="replace")
                if ta != tb:
                    edited.append(rel)
                    if args.full:
                        diffs += list(difflib.unified_diff(
                            tb.splitlines(), ta.splitlines(),
                            fromfile=f"source/{rel}", tofile=f"deployed/{rel}", lineterm=""))
            elif a.is_file():
                added.append(rel)
            else:
                missing.append(rel)

    print(f"[diff] deployed {target}  vs  source (theme: {theme})")
    print(f"[diff] {len(edited)} edited, {len(added)} added-in-deployed, "
          f"{len(missing)} missing-from-deployed")
    for rel in edited:
        print(f"  ~ {rel}   (edited in deployed — review to back-port)")
    for rel in added:
        print(f"  + {rel}   (only in deployed — your addition)")
    for rel in missing:
        print(f"  - {rel}   (in source, not deployed — re-emit to add)")
    if args.full and diffs:
        print("\n--- unified diffs (source -> deployed) ---")
        print("\n".join(diffs))
    elif edited:
        print("\nRun with --full to see the line-level diffs.")
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


def cmd_setup(args: argparse.Namespace) -> int:
    """Guided, dependency-free install wizard: answer a few prompts and it runs the
    right build, then offers a health check. Nothing is written until you confirm."""
    if not sys.stdin.isatty():
        sys.stderr.write("[setup] needs an interactive terminal. Non-interactive? e.g.:\n"
                         "  python build.py --emit opencode-global --theme neutral\n")
        return 1
    print("Geneseed setup — answer a few questions; nothing is written until you confirm.")
    theme = _ask_choice("Theme", _theme_options(), _default_theme())
    emit = _ask_choice("Install mode",
                       [("opencode-global", "OpenCode global config dir (recommended)"),
                        ("opencode", "OpenCode per-repo .opencode/ layer"),
                        ("files", "plain bundle (any AGENT.md tool)")], "opencode-global")
    out = root = None
    if emit == "opencode":
        root = _ask("Repo root to install into", ".")
        out = root
    elif emit == "files":
        out = _ask("Output dir for the bundle", "Harness")

    argv = _setup_build_args(theme, emit, out, root)
    print("\nAbout to run:  python build.py " + " ".join(argv))
    if not _confirm("Proceed?", True):
        print("[setup] aborted — nothing written.")
        return 0
    rc = run([sys.executable, str(BUILD), *argv]).returncode
    if rc != 0:
        sys.stderr.write("[setup] build failed.\n")
        return rc

    print("\nDone.")
    if emit == "opencode-global":
        print('Next: point the learn plugin at the store —\n'
              '  export GENESEED_HARNESS="$HOME/.config/opencode"   (add to your shell profile)')
    elif emit == "files":
        print(f"Next: point your tool's instructions at  {out or 'Harness'}/AGENT.md")
    if _confirm("\nRun a health check (doctor) now?", True):
        return cmd_doctor(argparse.Namespace(theme=None, bundle=None, no_bundle=False))
    return 0


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


def _tui_loop(stdscr, inv: dict) -> None:
    import curses
    import textwrap

    curses.curs_set(0)
    color = False
    try:
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_BLACK, curses.COLOR_CYAN)    # header / footer bar
        curses.init_pair(2, curses.COLOR_CYAN, -1)                    # section headers
        curses.init_pair(3, curses.COLOR_BLACK, curses.COLOR_GREEN)   # selected row
        curses.init_pair(4, curses.COLOR_YELLOW, -1)                  # detail heading
        color = curses.has_colors()
    except curses.error:
        color = False
    A_BAR = curses.color_pair(1) if color else curses.A_REVERSE
    A_HEAD = (curses.color_pair(2) | curses.A_BOLD) if color else curses.A_BOLD
    A_SEL = curses.color_pair(3) if color else curses.A_REVERSE
    A_TITLE = (curses.color_pair(4) | curses.A_BOLD) if color else curses.A_BOLD

    def clamp(v, lo, hi):
        return max(lo, min(v, hi))

    entries = _tui_entries(inv)
    selectable = [i for i, (k, _l, _d) in enumerate(entries) if k != "head"]
    sel = selectable[0] if selectable else 0
    list_top = 0
    detail_top = 0
    harness_py = str(Path(__file__).resolve())

    while True:
        stdscr.erase()
        h, w = stdscr.getmaxyx()
        body_h = max(1, h - 2)
        lw = clamp(w // 3, 22, 38)
        lw = clamp(lw, 10, max(10, w - 12))
        rx = lw + 2
        rw = max(1, w - rx)

        stdscr.addnstr(0, 0, f" Geneseed · theme: {inv['theme']} ".ljust(w), w, A_BAR)

        if sel < list_top:
            list_top = sel
        elif sel >= list_top + body_h:
            list_top = sel - body_h + 1
        list_top = clamp(list_top, 0, max(0, len(entries) - body_h))

        # left: navigable list, with a vertical separator
        for i in range(body_h):
            ri = list_top + i
            y = 1 + i
            if ri < len(entries):
                kind, label, _d = entries[ri]
                if ri == sel:
                    stdscr.addnstr(y, 0, (" " + label).ljust(lw)[:lw], lw, A_SEL)
                elif kind == "head":
                    stdscr.addnstr(y, 0, (" " + label)[:lw], lw, A_HEAD)
                else:
                    stdscr.addnstr(y, 0, ("   " + label)[:lw], lw, curses.A_NORMAL)
            try:
                stdscr.addch(y, lw, curses.ACS_VLINE)
            except curses.error:
                pass

        # right: full detail of the selection, wrapped and scrollable
        kind, label, data = entries[sel]
        wrapped: list[str] = []
        for ln in _detail_lines(kind, label, data):
            wrapped.extend(textwrap.wrap(ln, rw) if ln else [""])
        detail_top = clamp(detail_top, 0, max(0, len(wrapped) - body_h))
        for i in range(body_h):
            di = detail_top + i
            if di >= len(wrapped):
                break
            stdscr.addnstr(1 + i, rx, wrapped[di][:rw], rw,
                           A_TITLE if di == 0 else curses.A_NORMAL)

        more = "  ▾ more" if len(wrapped) > detail_top + body_h else ""
        stdscr.addnstr(h - 1, 0,
                       (" j/k move · PgUp/PgDn scroll · b build · d doctor · x diff · "
                        "u update · q quit" + more).ljust(w), w, A_BAR)
        stdscr.refresh()

        c = stdscr.getch()
        if c in (ord("q"), 27):
            return
        elif c in (curses.KEY_DOWN, ord("j")):
            sel = next((i for i in selectable if i > sel), sel)
            detail_top = 0
        elif c in (curses.KEY_UP, ord("k")):
            sel = next((i for i in reversed(selectable) if i < sel), sel)
            detail_top = 0
        elif c == curses.KEY_NPAGE:
            detail_top += body_h
        elif c == curses.KEY_PPAGE:
            detail_top = max(0, detail_top - body_h)
        elif c in (ord("b"), ord("d"), ord("x"), ord("u")):
            curses.def_prog_mode()
            curses.endwin()
            if c == ord("b"):
                run([sys.executable, str(BUILD)])
            elif c == ord("u"):
                # Update everything (sync + upgrade) — network op, so confirm first.
                root = Path(harness_py).resolve().parent.parent
                try:
                    ans = input("Update everything from upstream (sync + upgrade)? [y/N] ").strip().lower()
                except EOFError:
                    ans = ""
                if ans[:1] == "y":
                    run(["bash", str(root / "sync-self.sh")])
                    run(["bash", str(root / "upgrade.sh")])
            else:
                run([sys.executable, harness_py, "doctor" if c == ord("d") else "diff"])
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
    curses.wrapper(_tui_loop, inv)
    return 0


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
                       help="validate every theme's build: unresolved tokens, dead "
                            "links, non-hermetic escapes, theme-key parity, and that a "
                            "committed bundle matches src (--theme NAME for just one)")
    d.add_argument("--theme", default=None)
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
    df.add_argument("--theme", default=None, help="theme the deployment used (default: harness.config.json)")
    df.add_argument("--full", action="store_true", help="show unified diffs, not just the file-level summary")
    df.set_defaults(fn=cmd_diff)

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

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
