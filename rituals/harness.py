#!/usr/bin/env python3
"""Geneseed harness CLI — optional automation.

Dependency-free. Three subcommands:

    harness build [--theme NAME]   render src/ -> Harness/ for a theme
    harness doctor [--theme NAME]  validate a build: unresolved tokens, dead links
    harness learn [FILE]           distil notes/transcript into memory entries
                                   via a model CLI of your choice (no API key)

`learn` shells out to whatever LLM CLI you configure in $GENESEED_LLM
(e.g. `claude -p`, `llm`, `ollama run ...`). If it is unset, learn prints the
prompt to stdout so you can paste it into any assistant. Geneseed never embeds
an API key and never calls a paid API directly.
"""
from __future__ import annotations

import argparse
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
FENCE_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`[^`]*`")
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def strip_code(text: str) -> str:
    """Remove fenced blocks, inline code, and HTML comments so link-syntax shown
    as documentation is not mistaken for a real link."""
    text = FENCE_RE.sub("", text)
    text = COMMENT_RE.sub("", text)
    return INLINE_CODE_RE.sub("", text)

LEARN_PROMPT = """\
You are distilling durable memories from the notes below. Output zero or more
Markdown memory files in this exact format, separated by a line containing only
'---FILE---':

---
name: <kebab-case-slug>
description: <one-line summary>
type: user | feedback | project | reference
---
<the fact, stated plainly>

Only keep facts that are durable and non-obvious (decisions, corrections, stable
preferences, constraints). Skip anything derivable from the code or git history.
If nothing qualifies, output exactly: NOTHING.

NOTES:
"""


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, **kw)


def cmd_build(args: argparse.Namespace) -> int:
    extra = ["--theme", args.theme] if args.theme else []
    return run([sys.executable, str(BUILD), *extra]).returncode


def cmd_doctor(args: argparse.Namespace) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        extra = ["--theme", args.theme] if args.theme else []
        rc = run([sys.executable, str(BUILD), *extra, "--out", tmp],
                 cwd=ROOT, capture_output=True, text=True).returncode
        if rc != 0:
            print("[doctor] build failed")
            return 1
        out = Path(tmp)
        problems: list[str] = []
        for md in out.rglob("*.md"):
            text = md.read_text(encoding="utf-8")
            for tok in set(TOKEN_RE.findall(text)):
                problems.append(f"unresolved token {tok} in {md.relative_to(out)}")
            for link in LINK_RE.findall(strip_code(text)):
                target = (md.parent / link).resolve()
                if not target.exists():
                    problems.append(f"dead link '{link}' in {md.relative_to(out)}")
        if problems:
            print(f"[doctor] {len(problems)} problem(s):")
            for p in sorted(set(problems)):
                print("  -", p)
            return 1
        print("[doctor] ok — no unresolved tokens, no dead links")
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


def cmd_learn(args: argparse.Namespace) -> int:
    notes = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    prompt = LEARN_PROMPT + notes
    llm = os.environ.get("GENESEED_LLM")
    if not llm:
        sys.stderr.write("[learn] $GENESEED_LLM unset — printing prompt instead.\n\n")
        print(prompt)
        return 0
    proc = run(llm.split() + [prompt], capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    return proc.returncode


def main() -> int:
    ap = argparse.ArgumentParser(prog="harness", description="Geneseed harness CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="render src/ -> Harness/")
    b.add_argument("--theme", default=None)
    b.set_defaults(fn=cmd_build)

    d = sub.add_parser("doctor", help="validate a build")
    d.add_argument("--theme", default=None)
    d.set_defaults(fn=cmd_doctor)

    p = sub.add_parser("prompt", help="emit a self-contained install prompt (no Python needed to use it)")
    p.add_argument("--theme", default=None)
    p.add_argument("--out", default=None, help="write to FILE (default: stdout)")
    p.set_defaults(fn=cmd_prompt)

    le = sub.add_parser("learn", help="distil notes into memory entries")
    le.add_argument("file", nargs="?", help="notes file (default: stdin)")
    le.set_defaults(fn=cmd_learn)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
