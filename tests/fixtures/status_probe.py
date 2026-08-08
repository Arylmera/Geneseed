#!/usr/bin/env python3
"""Reference half of the status corpus probe — see tests/test_status_panel_parity.py.

Reads a JSON job `{"cases": [{"fn": ..., "args": [...]}, ...]}` from argv[1] and writes
`{"results": [...]}` to stdout as UTF-8. One process per environment, because
`_harness_tui_draw._TUI_ASCII` is read at IMPORT time: switching it inside a process is
monkeypatching, and running a second process is the same thing the real CLI does.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "rituals"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import harness  # noqa: E402


def run(fn: str, args: list):
    if fn == "version_verdict":
        return harness._version_verdict(*args)
    if fn == "status_lines":
        return harness._status_lines(args[0], args[1])
    if fn == "manifest_is_claude":
        return harness._manifest_is_claude(Path(args[0]))
    if fn == "accent_for":
        return harness._accent_for(args[0])
    if fn == "default_theme":
        return harness._default_theme()
    if fn == "py_len":
        return len(args[0])
    if fn == "py_ljust":
        return args[0].ljust(args[1])
    raise SystemExit(f"status_probe: unknown fn {fn!r}")


def main() -> int:
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = [run(c["fn"], c["args"]) for c in job["cases"]]
    sys.stdout.buffer.write(json.dumps({"results": out}).encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
