#!/usr/bin/env python3
"""A deterministic stand-in for whatever `$GENESEED_LLM` names.

`harness learn` shells out to a model CLI of the user's choosing — `claude -p`, `llm`,
`ollama run …` — as `llm.split() + [prompt]`. A real one is non-deterministic, needs
credentials, and Geneseed never calls a paid API, so the acceptance harness supplies this
instead. It is the LLM in the same sense the sandbox is a home directory.

Driven entirely by environment, so one fixture serves every learn cell:

    FAKE_LLM_OUT    file whose contents go to stdout (absent => empty stdout)
    FAKE_LLM_ERR    literal text for stderr
    FAKE_LLM_RC     exit code (default 0)
    FAKE_LLM_ECHO   file to write the PROMPT into

`FAKE_LLM_ECHO` is the load-bearing one. The prompt is most of what `learn` computes
before it delegates — the head lifted out of the OpenCode plugin, the already-stored slug
list, the 16k tail truncation — and none of it is observable in the emitted memory files.
Echoing it into the sandbox turns the prompt into a compared artefact instead of an
internal value. Nothing else in a learn cell can see a prompt built from the wrong slugs.

`llm.split()` is whitespace-split, so the command this fixture is invoked through cannot
contain a space. That is a property of the interface being tested, not of this file; when
the interpreter path does contain one the cell fails its `expect` guard rather than
passing vacuously.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    echo = os.environ.get("FAKE_LLM_ECHO")
    if echo:
        prompt = sys.argv[1] if len(sys.argv) > 1 else ""
        Path(echo).parent.mkdir(parents=True, exist_ok=True)
        Path(echo).write_text(prompt, encoding="utf-8")
    src = os.environ.get("FAKE_LLM_OUT")
    if src and Path(src).is_file():
        sys.stdout.write(Path(src).read_text(encoding="utf-8"))
    err = os.environ.get("FAKE_LLM_ERR")
    if err:
        sys.stderr.write(err)
    return int(os.environ.get("FAKE_LLM_RC") or 0)


if __name__ == "__main__":
    raise SystemExit(main())
