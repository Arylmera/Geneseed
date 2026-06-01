#!/usr/bin/env python3
"""Geneseed harness CLI — optional automation.

Dependency-free. Three subcommands:

    harness build [--theme NAME]   render src/ -> dist/ for a theme
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

    b = sub.add_parser("build", help="render src/ -> dist/")
    b.add_argument("--theme", default=None)
    b.set_defaults(fn=cmd_build)

    d = sub.add_parser("doctor", help="validate a build")
    d.add_argument("--theme", default=None)
    d.set_defaults(fn=cmd_doctor)

    le = sub.add_parser("learn", help="distil notes into memory entries")
    le.add_argument("file", nargs="?", help="notes file (default: stdin)")
    le.set_defaults(fn=cmd_learn)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
