"""Every capturing spawn suppresses the Windows console window — on BOTH sides.

WHY A SOURCE GATE AND NOT A CELL. Windows gives every console child of a console-less
parent a brand-new console window, and the web daemon is console-less by design. The
symptom is seven consoles flashing across the screen when the Doctor page runs `node
--check` once per plugin — and NOTHING ELSE CHANGES. A window is not a byte on stdout, so
`golden.py`'s 259 cells, the web corpus and every parity test compare two implementations
that agree perfectly while one of them is papering the desktop with consoles. There is no
observation available to a cell here; the flag's presence in the SOURCE is the property.

This is the same shape as P5b's transport hole (the universal-newline decode normalised the
CRLF/LF split out of every one of 103 cells) and P6a's encoding hole (a destamp cannot
reach inside a DEFLATE stream). When the transport, the harness or the operating system
eats the difference, the gate has to move to where the difference still exists.

CAPTURING ONLY, and the rule is the reference's. Python sets `STARTF_USESTDHANDLES` only
when a stream is redirected, so `CREATE_NO_WINDOW` on an INHERITING spawn gives the child a
fresh hidden console and discards everything it prints — P5e measured that as
`geneseed build > log.txt` writing an empty file. So a capturing spawn must carry the flag
and an inheriting one must not, and both halves are asserted: a gate that only checked one
direction would be satisfied by putting the flag on everything, which re-breaks the capture.

WHAT FOUND THE BUG. Not this file — a user watching consoles flash on a dashboard load.
Two of the four JS spawn sites were missing the flag because `NO_WINDOW` was private to
`js/update.mjs`, and a fifth (`java -version`) was missing it on BOTH sides because the
Python reached for a bare `subprocess.run` instead of `_harness_core.run`. That last one
matters most: a defect the two implementations SHARE is invisible to every cross-
implementation comparison, which is why the Python half below asserts against the wrapper
rather than against the Node side.
"""
from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# `js/web/` included: `jobs.mjs` and `server.mjs` own four of the spawn sites, and the
# daemon they belong to is the console-less parent this whole file is about.
JS_DIRS = ("js", "bin")

# The floor is a POSITIVE CONTROL. A scanner whose regex stops matching reports "0 sites,
# all clean" and passes forever — the vacuity that P4a's trap gate died of on Windows. The
# number is deliberately below the current count so adding a spawn does not fail this, and
# far enough above zero that a broken scan cannot slip through.
MIN_JS_SPAWNS = 10


def _js_sources() -> "list[Path]":
    out: list[Path] = []
    for d in JS_DIRS:
        out.extend(sorted((ROOT / d).rglob("*.mjs")))
    return out


def _call_body(text: str, open_paren: int) -> str:
    """The source between a call's parentheses, balanced.

    A regex cannot do this: an options object holds nested braces, and `spawnSync(cmd[0],
    cmd.slice(1), {...})` has parens inside its own arguments.
    """
    depth = 0
    for i in range(open_paren, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_paren + 1:i]
    return text[open_paren:]


def _spawn_calls(text: str) -> "list[tuple[int, str, str]]":
    """(line number, callee, argument source) for every spawn in one file."""
    calls = []
    for m in re.finditer(r"\b(spawnSync|spawn|execFileSync|execFile)\s*\(", text):
        body = _call_body(text, m.end() - 1)
        calls.append((text.count("\n", 0, m.start()) + 1, m.group(1), body))
    return calls


def _inherits(body: str) -> bool:
    """`stdio: 'inherit'`, or a file descriptor handed straight to the child.

    `spawnDetached` passes `stdio: ['ignore', out, out]` where `out` is an OPEN FD — the
    child writes to the log through a real handle, which is the inheriting case even though
    the word `inherit` never appears.
    """
    return "'inherit'" in body or '"inherit"' in body or "stdio: ['ignore', out, out]" in body


def _excludes_windows(test: "ast.expr") -> bool:
    """`sys.platform == "darwin"`, `!= "win32"`, `os.name != "nt"` — a guard under which
    no Windows console can be created, so the flag is meaningless inside it."""
    for cmp_node in [n for n in ast.walk(test) if isinstance(n, ast.Compare)]:
        left = ast.unparse(cmp_node.left)
        if "sys.platform" not in left and "os.name" not in left:
            continue
        for op, comparator in zip(cmp_node.ops, cmp_node.comparators):
            if not isinstance(comparator, ast.Constant):
                continue
            windows = comparator.value in ("win32", "nt")
            if isinstance(op, ast.Eq) and not windows:
                return True           # `== "darwin"` — this branch is not Windows
            if isinstance(op, ast.NotEq) and windows:
                return True           # `!= "win32"` — likewise
    return False


def _bare_capturing_runs(source: str) -> "list[int]":
    """Line numbers of `subprocess.run(...)` calls that CAPTURE and bypass the wrapper.

    AST and not a regex, because the question "is this call inside a non-Windows branch?"
    is about nesting. `_web_actions.py`'s `osascript` picker capture-runs a bare
    `subprocess.run` and is completely correct: it sits under `if sys.platform ==
    "darwin"`, where `CREATE_NO_WINDOW` does not exist and `run()`'s NO_WINDOW is an empty
    dict anyway. A regex reported it as a defect, and the honest fix is for the gate to see
    the guard rather than for a hand-maintained exception list to paper over it — a list
    that grows is a list that eventually hides a real one.
    """
    tree = ast.parse(source)
    guarded: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and _excludes_windows(node.test):
            for child in node.body:
                for inner in ast.walk(child):
                    guarded.add(id(inner))

    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if ast.unparse(node.func) != "subprocess.run" or id(node) in guarded:
            continue
        kwargs = {k.arg for k in node.keywords if k.arg}
        if not ({"capture_output", "stdout"} & kwargs):
            continue                  # inheriting: the flag would discard its output
        if "creationflags" in kwargs:
            continue                  # states the flag itself
        # `**NO_WINDOW` / `**harness.NO_WINDOW` — a `**` unpack has `arg is None`, so it is
        # invisible to the name set above. Six call sites spell the flag this way and every
        # one of them is correct; missing this reports the whole codebase as broken, which
        # is a gate that would have been deleted rather than believed.
        if any(k.arg is None and "NO_WINDOW" in ast.unparse(k.value) for k in node.keywords):
            continue
        out.append(node.lineno)
    return out


class EveryCapturingJsSpawnHidesItsConsole(unittest.TestCase):

    def test_the_scan_finds_the_spawn_sites_at_all(self):
        """The positive control. Without it every assertion below is vacuously true."""
        found = sum(len(_spawn_calls(p.read_text(encoding="utf-8"))) for p in _js_sources())
        self.assertGreaterEqual(
            found, MIN_JS_SPAWNS,
            f"the scanner found {found} spawn calls under {JS_DIRS}, which is too few to "
            "be real — the regex has stopped matching and this file now asserts nothing")

    def test_no_capturing_spawn_is_missing_windowsHide(self):
        missing = []
        for path in _js_sources():
            text = path.read_text(encoding="utf-8")
            for line, callee, body in _spawn_calls(text):
                if _inherits(body):
                    continue
                if "windowsHide" in body or "NO_WINDOW" in body:
                    continue
                rel = path.relative_to(ROOT).as_posix()
                missing.append(f"{rel}:{line} {callee}(...)")
        self.assertFalse(
            missing,
            "these capturing spawns will pop a console window each when the web daemon "
            "reaches them — spread `...NO_WINDOW` from js/lib/pyproc.mjs into the options "
            f"object:\n  " + "\n  ".join(missing))

    def test_the_flag_comes_from_the_shared_module(self):
        """One owner. A second private `const NO_WINDOW` is how two sites lost the flag."""
        owners = []
        for path in _js_sources():
            if path.name == "pyproc.mjs":
                continue
            if re.search(r"^\s*(const|let|var)\s+NO_WINDOW\s*=", path.read_text(encoding="utf-8"),
                         re.M):
                owners.append(path.relative_to(ROOT).as_posix())
        self.assertFalse(
            owners,
            f"{owners} define their own NO_WINDOW; import it from js/lib/pyproc.mjs so the "
            "next spawn site inherits the rule instead of re-deciding it")


class EveryCapturingPythonSpawnGoesThroughTheWrapper(unittest.TestCase):
    """The reference's half — and the only one that can catch a SHARED defect.

    `_harness_core.run` is where `CREATE_NO_WINDOW` is folded in, so a capturing
    `subprocess.run` that bypasses it is the Python spelling of the same bug. The java
    probe in `_harness_setup.py` was exactly that, and because the Node twin copied the
    behaviour faithfully, no comparison between the two could ever have reported it.
    """

    def test_no_bare_capturing_subprocess_run_in_rituals(self):
        offenders = []
        for path in sorted((ROOT / "rituals").glob("*.py")):
            for line in _bare_capturing_runs(path.read_text(encoding="utf-8")):
                offenders.append(f"{path.relative_to(ROOT).as_posix()}:{line}")
        self.assertFalse(
            offenders,
            "these capture their child's output with a bare `subprocess.run`, so they miss "
            "the CREATE_NO_WINDOW that `_harness_core.run` folds in and flash a console "
            f"from the windowless daemon:\n  " + "\n  ".join(offenders))


if __name__ == "__main__":
    unittest.main()
