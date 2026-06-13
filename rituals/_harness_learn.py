"""Geneseed harness — Distil notes/transcripts into deduped memory entries.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



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
