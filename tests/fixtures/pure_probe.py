#!/usr/bin/env python3
"""Reference half of the pure-function corpus probe — see tests/test_pure_function_parity.py.

Reads a JSON job `{"cases": [{"fn": ..., "args": [...]}, ...]}` from argv[1] and writes
`{"results": [...]}` to stdout as UTF-8. One process per environment, because
`_harness_tui_draw._TUI_ASCII` is read at IMPORT time: switching it inside a process is
monkeypatching, and running a second process is the same thing the real CLI does.
"""
from __future__ import annotations

import datetime
import difflib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "rituals"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import harness  # noqa: E402


def run(fn: str, args: list):
    if fn == "unified_diff":
        return list(difflib.unified_diff(args[0], args[1], fromfile="source/f",
                                         tofile="deployed/f", lineterm=""))
    if fn == "py_split_lines":
        return args[0].splitlines()
    if fn == "cmp_key":
        return harness._cmp_key(args[0], args[1])
    if fn == "py_capitalize":
        return args[0].capitalize()
    if fn == "setup_build_args":
        return harness._setup_build_args(*args)
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
    if fn == "fence_for":
        return harness._fence_for(args[0])
    if fn == "themes_to_check":
        return harness._themes_to_check(*args)
    if fn == "roman_to_int":
        return harness._roman_to_int(args[0])
    if fn == "desc_block_problem":
        return harness.build._desc_block_problem(args[0])
    if fn == "prose_mirror_problems":
        # `skill_stems` is a SET on this side and a Set on the other; JSON carries a list.
        return harness._prose_mirror_problems(args[0], args[1], args[2], set(args[3]), args[4])
    if fn == "is_vendored_path":
        return harness.build.is_vendored_path(Path(args[0]))
    if fn == "validate_is_vendored":
        return harness.build._validate_is_vendored(Path(args[0]))
    if fn == "py_which":
        return shutil.which(args[0], path=args[1])
    if fn == "py_is_absolute":
        return Path(args[0]).is_absolute()
    if fn == "py_int":
        # `int(s)`, or None where it raises. The corpus never pads: `int` strips whitespace
        # and `pyInt` deliberately does not, because both of its callers have already run
        # `str.strip()` — see its docblock.
        try:
            return int(args[0])
        except ValueError:
            return None
    if fn == "java_major_ok":
        return harness._java_major_ok(*args)
    if fn == "theme_options":
        return harness._theme_options()
    if fn == "posture_options":
        return harness._posture_options()
    if fn == "mode_options":
        return harness._mode_options()
    if fn == "installed_defaults":
        return harness._installed_defaults()
    if fn == "minute_stamp":
        # `_web_overview.api_overview`'s `build_time`, spelled as the reference spells it:
        # a NAIVE `fromtimestamp`, which is local time. `stamp_doctor`'s `checked_at` is
        # `time.strftime` of the same format on `localtime()`, so one corpus covers both.
        return datetime.datetime.fromtimestamp(args[0]).strftime("%Y-%m-%d %H:%M")
    if fn == "setup_summary_lines":
        return harness._setup_summary_lines(*args)
    # ---- the stdin readers. Their PROMPTS are stdout, which is why the wizard job is
    # compared as raw bytes rather than through `json.loads` — see the test's docstring.
    if fn == "ask":
        return harness._ask(*args)
    if fn == "confirm":
        return harness._confirm(*args)
    if fn == "ask_choice":
        return harness._ask_choice(args[0], [tuple(o) for o in args[1]], args[2])
    if fn == "collect_setup_lines":
        return harness._collect_setup_lines()
    if fn == "install_agent_entry_of":
        # `_install_agent_entry`'s project arm, minus the file read: the whole decision is
        # which `instructions` entry it picks, and the list is the input.
        for e in args[0]:
            if isinstance(e, str) and not Path(e).is_absolute() and Path(e).name == "AGENT.md":
                return e
        return "AGENT.md"
    raise SystemExit(f"pure_probe: unknown fn {fn!r}")


def main() -> int:
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = [run(c["fn"], c["args"]) for c in job["cases"]]
    # FLUSH BEFORE DROPPING TO `.buffer`. The wizard cases print through `sys.stdout`, whose
    # TextIOWrapper buffers when stdout is a pipe; writing to the underlying binary buffer
    # without flushing first puts the results document AHEAD of the prompts that produced it.
    sys.stdout.flush()
    # `separators` + `ensure_ascii=False` so this document is BYTE-identical to the Node
    # probe's `JSON.stringify` — P5i's wizard job compares the probes' whole stdout rather
    # than parsing it, which put the serialiser itself under the gate. `json.loads` on the
    # reading side is indifferent to both.
    sys.stdout.buffer.write(json.dumps({"results": out}, separators=(",", ":"),
                                       ensure_ascii=False).encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
