"""The PATH verbs' quoting hazard, gated WITHOUT touching the real user PATH.

`link` and `unlink` edit the persistent USER Path — `HKCU\\Environment`, read and written
through PowerShell. **No test in this repo may run that.** A cell that did would edit the
machine running the suite, and the edit survives the cell, the suite and the checkout.

SO THE VERB WAS SHAPED SO THE GATE NEVER HAS TO. `_win_user_path` was one function that
built a PowerShell one-liner and ran it; P10b split it, in both implementations, into
`_win_user_path_script` / `winUserPathScript` (pure) and the spawn (four lines, no logic).
Everything that can be WRONG is in the pure half:

  * the `''` escape — a user called O'Brien has an apostrophe in `%LOCALAPPDATA%`, and an
    unescaped one ends the PowerShell string and turns the rest of the path into code;
  * the `Split(';') | Where-Object {$_ -ne ''}` — without the filter, a user Path with a
    trailing `;` grows an empty entry on every `link`;
  * the `-notcontains` — without it, `link` appends a duplicate on every run;
  * the REMOVE arm's `-ne $d`, which must compare against the escaped-then-unescaped value
    and not against the raw argument.

A CORPUS RUNS THE FUNCTION; a cell would run the program. This is the fifth corpus in the
port and it exists for the reason P5c's did: the inputs that break it (an apostrophe, a UNC
root, a trailing separator, a path that already contains a `;`) are not reachable from any
cell, because a cell can only pass the directory the fixture's `LOCALAPPDATA` produces.

WHAT THIS DOES NOT COVER, STATED RATHER THAN IMPLIED. It compares two string builders and
asserts what each produces. It does NOT prove PowerShell accepts the script, and it does not
prove the registry write works — the success arm of the spawn is UNGATED IN BOTH
IMPLEMENTATIONS, deliberately, because the only way to gate it is to edit this machine. The
arm that IS reachable is the failure one, and `tests/harness_golden.py` reaches it honestly:
its `unlink` cells hand the verb a `PATH` with no `powershell` on it, so the launch fails and
both sides take the "said nothing about PATH" branch with the registry untouched.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")

sys.path.insert(0, str(ROOT / "rituals"))

#: The inputs a cell cannot reach. Each row is a directory string; the name says which of
#: the four hazards above it is aimed at, and a row that exercises none of them is a comment
#: rather than a test — the lesson P6d's corpus wrote down.
CORPUS: dict[str, str] = {
    "plain": r"C:\Users\dev\AppData\Local\Geneseed\bin",
    # THE ESCAPE. One apostrophe, and the double at the end so a naive `replace` that only
    # handled the first is caught too.
    "apostrophe": r"C:\Users\O'Brien\AppData\Local\Geneseed\bin",
    "two_apostrophes": r"C:\Users\O'Br'ien\Geneseed\bin",
    # Already-escaped-looking input: the function must escape the pair into four, not leave
    # it alone, or a round trip through it is lossy.
    "doubled_apostrophe": r"C:\Users\O''Brien\Geneseed\bin",
    # A UNC root — the input P5c's corpus found invisible to all 125 cells.
    "unc": r"\\fileserver\team$\dev\Geneseed\bin",
    # A SEMICOLON INSIDE THE DIRECTORY. Legal in a UNC share name and fatal to a `;`-joined
    # PATH; the script cannot fix that, but both implementations must be wrong the SAME way.
    "semicolon": r"C:\Users\dev\we;ird\Geneseed\bin",
    "trailing_backslash": "C:\\Users\\dev\\Geneseed\\bin\\",
    "spaces": r"C:\Program Files\Geneseed (x86)\bin",
    "unicode": r"C:\Users\Guillaume Lemer\Généseed\bin",
    "empty": "",
}

ACTIONS = ("add", "remove")


def _reference() -> dict[str, str]:
    import _harness_lifecycle
    return {
        f"{action}\u0000{name}": _harness_lifecycle._win_user_path_script(action, directory)
        for action in ACTIONS for name, directory in CORPUS.items()
    }


def _candidate() -> dict[str, str]:
    src = (
        "import {winUserPathScript} from './js/link.mjs';"
        f"const corpus = {json.dumps(CORPUS)};"
        f"const actions = {json.dumps(list(ACTIONS))};"
        "const out = {};"
        "for (const a of actions) for (const [n, d] of Object.entries(corpus))"
        " out[`${a}\\u0000${n}`] = winUserPathScript(a, d);"
        "process.stdout.write(JSON.stringify(out));"
    )
    p = subprocess.run([NODE, "--input-type=module", "-e", src],
                       cwd=str(ROOT), capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise AssertionError(f"node failed: {p.stderr[-2000:]}")
    return json.loads(p.stdout)


class TheTwoScriptBuildersAgree(unittest.TestCase):

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_every_corpus_row_builds_the_same_script(self):
        ref, cand = _reference(), _candidate()
        self.assertEqual(sorted(ref), sorted(cand), "the two runs covered different rows")
        for key in sorted(ref):
            with self.subTest(row=key.replace("\u0000", "/")):
                self.assertEqual(cand[key], ref[key])

    def test_the_corpus_actually_contains_what_it_is_named_for(self):
        """P6d's rule: a corpus entry that does not contain the character it is named for is
        a comment, not a test. Asserted rather than trusted, because the rows are hand-written
        and a stray edit to a raw string is silent."""
        self.assertIn("'", CORPUS["apostrophe"])
        self.assertEqual(CORPUS["two_apostrophes"].count("'"), 2)
        self.assertIn("''", CORPUS["doubled_apostrophe"])
        self.assertTrue(CORPUS["unc"].startswith("\\\\"))
        self.assertIn(";", CORPUS["semicolon"])
        self.assertTrue(CORPUS["trailing_backslash"].endswith("\\"))
        self.assertIn(" ", CORPUS["spaces"])
        self.assertTrue(any(ord(c) > 127 for c in CORPUS["unicode"]))


class TheScriptSaysWhatItIsSupposedToSay(unittest.TestCase):
    """The ABSOLUTE half. A comparison of two builders is green when BOTH are wrong, and the
    apostrophe bug is exactly the kind both would share if it were copied across — so each
    property is asserted against the reference's output directly, not against the twin's."""

    def setUp(self):
        import _harness_lifecycle
        self.build = _harness_lifecycle._win_user_path_script

    def test_an_apostrophe_is_doubled_and_never_left_bare(self):
        script = self.build("add", r"C:\Users\O'Brien\bin")
        self.assertIn(r"$d='C:\Users\O''Brien\bin'", script)
        # The literal `'` count must be even inside the assignment: an odd one would close
        # the PowerShell string early and execute the tail.
        head = script.split(";", 1)[0]
        self.assertEqual(head.count("'") % 2, 0, f"unbalanced quoting in {head!r}")

    def test_add_is_idempotent_and_drops_empty_segments(self):
        script = self.build("add", r"C:\bin")
        self.assertIn("-notcontains $d", script)
        self.assertIn("Where-Object {$_ -ne ''}", script)
        self.assertIn("'User'", script)
        self.assertNotIn("'Machine'", script)

    def test_remove_filters_the_directory_out_and_leaves_the_rest(self):
        script = self.build("remove", r"C:\bin")
        self.assertIn("$_ -ne '' -and $_ -ne $d", script)
        self.assertIn("'User'", script)
        self.assertNotIn("'Machine'", script)

    def test_neither_arm_can_reach_the_machine_scope(self):
        """The severity assertion. `'Machine'` needs admin AND truncates the system PATH for
        every user on the box; the reference has always been user-scoped and this is what
        says so, in both arms, for every corpus row."""
        for action in ACTIONS:
            for name, directory in CORPUS.items():
                with self.subTest(action=action, row=name):
                    self.assertNotIn("'Machine'", self.build(action, directory))


if __name__ == "__main__":
    unittest.main()
