#!/usr/bin/env python3
"""Reference half of the `--sync-themes` corpus probe — see tests/test_maintainer_tools_parity.py.

`<job.json> <result.json>`: the job names the FILES to lay down in a throwaway themes
directory, the probe points `_build_core.THEMES` at it and calls `build.sync_themes()`, and
the result records the return value, the exit status and every resulting file's BYTES.

THE TOOL'S OWN OUTPUT GOES TO THE PROBE'S REAL STDOUT and is compared as raw bytes by the
harness, rather than captured into the result document. That is deliberate and it is the only
way the comparison can see Python's newline translation: `sys.stdout` is a TextIOWrapper with
`newline=None`, so a `print()` leaves this process as `\r\n` on Windows, while an
`io.StringIO` capture would hand back `\n` and quietly make the port's `withPyNewlines` funnel
untestable. `Path.write_text`'s matching translation is what the base64 file bytes catch.
"""
from __future__ import annotations

import base64
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

import _build_core  # noqa: E402
import build  # noqa: E402


def main() -> None:
    # build.py's own `main()` does this before anything prints; the probe stands in for it.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="geneseed-themes-probe-") as td:
        tmp = Path(td)
        # write_BYTES, not write_text: the fixture must land identically on both hosts, and
        # `write_text` would translate its `\n` the way the tool under test does.
        for name, text in job["files"].items():
            (tmp / name).write_bytes(text.encode("utf-8"))
        orig = _build_core.THEMES
        _build_core.THEMES = tmp
        try:
            out["changed"] = build.sync_themes()
            out["exit"] = 0
        except SystemExit as e:
            out["changed"] = None
            out["exit"] = e.code
        finally:
            _build_core.THEMES = orig
        out["files"] = {p.name: base64.b64encode(p.read_bytes()).decode("ascii")
                        for p in sorted(tmp.iterdir()) if p.is_file()}
    Path(sys.argv[2]).write_text(json.dumps(out, sort_keys=True), encoding="utf-8")


if __name__ == "__main__":
    main()
