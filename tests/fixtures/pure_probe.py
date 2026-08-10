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
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "rituals"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import harness  # noqa: E402


def run(fn: str, args: list):
    # `_update`'s pure four (P8a). Imported lazily so a probe that never asks for them does
    # not pay `import build` twice — `harness` above already did.
    # P7a. `args[0]` FAKES `sys.stdin.isatty()`, because a probe's stdin is a seeded file and
    # every branch past the isatty test would otherwise be dead on both sides — the one input
    # no cell and no ordinary corpus entry can vary. A stand-in object rather than a real
    # terminal: there is no pty on Windows, and `< /dev/null` is reported as a TTY by Python
    # here, which is how a previous session ran an entire wizard against a live install.
    if fn == "web_first_ok":
        class _Stdin:
            def __init__(self, tty): self._tty = tty
            def isatty(self): return self._tty
        real, sys.stdin = sys.stdin, _Stdin(args[0])
        try:
            return harness._web_first_ok()
        finally:
            sys.stdin = real
    if fn in ("parse_origin", "redact_url_creds", "count_or_zero", "fetch_phases"):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "rituals"))
        import _update
        if fn == "parse_origin":
            return list(_update._parse_origin(args[0]))
        if fn == "redact_url_creds":
            return _update._redact_url_creds(args[0])
        if fn == "count_or_zero":
            return _update._count(args[0])
        # `_fetch_streaming`'s reader loop, lifted out of its thread: the same lines in, the
        # ones it would LOG out, plus the phase it ends on. The loop is inline in the
        # reference (it closes over `p.stdout`, `lines` and `log`), so this reproduces it
        # rather than calling it — which is the one shape this corpus allows, and only
        # because the alternative is no gate at all on the branch that keeps a fetch's
        # thousand progress repaints out of the install log.
        logged, last = [], args[1]
        for raw in args[0]:
            line = _update._redact_url_creds(raw.strip())
            if not line:
                continue
            phase = line.split(":", 1)[0]
            if phase != last:
                logged.append(line)
                last = phase
        return [logged, last]
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
    if fn in ("slugify_heading", "slice_section", "strip_harness_blocks"):
        # `_web_docs`'s pure halves, reached through the facade so the cross-module
        # splice is the same one the server runs under. Imported lazily: `web` pulls
        # `build` in with it and every other case here is cheaper without that.
        import web  # noqa: PLC0415
        if fn == "slugify_heading":
            return web._slugify_heading(args[0])
        if fn == "slice_section":
            return list(web._slice_section(args[0], args[1]))
        return web._strip_harness_blocks(args[0], args[1])
    if fn in ("build_plan", "daemon_args", "restart_args"):
        # `_web_server`'s pure halves, reached through the facade for the reason the docs
        # ones below are: the cross-module splice is the same one the server runs under.
        import web  # noqa: PLC0415
        if fn == "build_plan":
            return web._build_plan(Path(args[0]), Path(args[1]), args[2], args[3])
        if fn == "daemon_args":
            return web._daemon_args(args[0], args[1])
        return web._restart_args(args[0])
    if fn == "py_unquote":
        return urllib.parse.unquote(args[0])
    if fn == "minute_stamp":
        # `_web_overview.api_overview`'s `build_time`, spelled as the reference spells it:
        # a NAIVE `fromtimestamp`, which is local time. `stamp_doctor`'s `checked_at` is
        # `time.strftime` of the same format on `localtime()`, so one corpus covers both.
        return datetime.datetime.fromtimestamp(args[0]).strftime("%Y-%m-%d %H:%M")
    if fn == "setup_summary_lines":
        return harness._setup_summary_lines(*args)
    # ---- the stdin readers. Their PROMPTS are stdout, which is why the wizard job is
    # compared as raw bytes rather than through `json.loads` — see the test's docstring.
    if fn == "prompt_line":
        # `input(prompt)`, with EOF told apart from an empty line — which is the whole
        # difference `_web_server.serve`'s npm prompt branches on. Spelled as two calls
        # because `input(prompt)` writes the prompt and then reads, which is what the twin
        # does explicitly; `input()` alone would leave the prompt out of the compared stdout.
        sys.stdout.write(args[0])
        try:
            return input()
        except EOFError:
            return None
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

    # ---- P7b: the TUI's pure half ----------------------------------------------------
    #
    # Reached through `harness`, not through `_harness_tui_draw` directly, because the
    # display tier is a MODULE CONSTANT read at import time and `harness` is what imports
    # it — asking the submodule again would be a second import in some Python versions and
    # a different constant in none of them, but the caller's view is the one under test.
    if fn == "glyphs":
        return harness._glyphs(args[0])
    if fn == "dwidth":
        return harness._dwidth(args[0])
    if fn == "truncd":
        return harness._truncd(args[0], args[1])
    if fn == "fit":
        return harness._fit(args[0], args[1])
    if fn == "icon":
        return harness._icon(args[0])
    if fn == "mark":
        return harness._mark(args[0])
    if fn == "spin":
        return harness._spin(args[0])
    if fn == "logo_lines":
        return harness._logo_lines()
    if fn == "clamp":
        return harness._clamp(args[0], args[1], args[2])
    if fn == "progress_bar":
        return harness._progress_bar(*args)
    if fn == "theme_preview":
        return [list(r) for r in harness._theme_preview(args[0])]
    if fn == "theme_flair":
        return harness._theme_flair(args[0])
    if fn == "tui_entries":
        return [list(r) for r in harness._tui_entries(args[0])]
    if fn == "detail_lines":
        return harness._detail_lines(args[0], args[1], args[2])
    if fn == "dwidth_rle":
        # THE EXHAUSTIVE ONE. `_dwidth` is the only function in this phase with no Node
        # equivalent at any rung — `unicodedata.east_asian_width` and `unicodedata.
        # combining` have no counterpart in JavaScript, whose `\p{...}` escapes carry
        # neither property — so the port carries hand-written range tables, and a
        # hand-written Unicode table is right until it is not.
        #
        # So this case is not a sample of the input space, it IS the input space: every
        # codepoint in [lo, hi), run-length encoded. A run boundary appears wherever the
        # width changes, so two implementations agree if and only if these lists are equal,
        # and a range the port got wrong has no input left to hide behind.
        #
        # Measured against the LIVE `unicodedata` on this side rather than a table copied
        # from it — the day the reference's Unicode version moves under the port's tables,
        # this goes red and names the codepoint instead of agreeing with itself.
        lo, hi = args
        runs, prev = [], None
        for cp in range(lo, hi):
            w = harness._dwidth(chr(cp))
            if w != prev:
                runs.append([cp, w])
                prev = w
        return runs
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
