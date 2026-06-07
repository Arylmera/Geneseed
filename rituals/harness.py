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
import io
import json
import os
import re
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
    if problems:
        print(f"[doctor] {len(problems)} problem(s) across {len(themes)} theme(s):")
        for p in sorted(set(problems)):
            print("  -", p)
        return 1
    print(f"[doctor] ok — {len(themes)} theme(s) clean: no unresolved tokens, "
          f"no dead links, nothing escapes the bundle")
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


def cmd_context(args: argparse.Namespace) -> int:
    """Resolve context.json beside the harness and print eager entries' contents
    so a SessionStart hook injects them into context — Rule XVIII without relying
    on the agent to read the manifest itself. Lazy entries are only listed.

    Designed to be safe in a hook: any error prints a note to stderr and exits 0,
    so it never blocks a session start."""
    manifest = ROOT / "context.json"
    if not manifest.exists():
        sys.stderr.write(f"[context] no context.json at {manifest} — nothing to load.\n")
        return 0
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        entries = data.get("context", [])
    except (json.JSONDecodeError, OSError) as e:
        sys.stderr.write(f"[context] could not parse {manifest}: {e}\n")
        return 0

    eager = [e for e in entries if e.get("load") == "eager"]
    lazy = [e for e in entries if e.get("load") == "lazy"]
    if not eager and not lazy:
        sys.stderr.write("[context] context.json is empty — fill it in to load project docs.\n")
        return 0

    out: list[str] = [
        "=== PROJECT CONTEXT (context.json) — binding for this repo per Rule XVIII ===",
        "",
    ]
    for entry in eager:
        path = entry.get("path", "")
        desc = entry.get("description", "")
        target = Path(path)
        if not target.is_absolute():
            target = ROOT / path
        header = f"----- {path}" + (f" — {desc}" if desc else "") + " -----"
        out.append(header)
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
            out.append(f"  - {path}" + (f" — {desc}" if desc else ""))
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
                            "links, non-hermetic escapes (--theme NAME for just one)")
    d.add_argument("--theme", default=None)
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

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
