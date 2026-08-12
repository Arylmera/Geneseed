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
import os
import platform
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
    # `encoding="utf-8"` and NOT a bare `text=True`: node writes UTF-8 whatever the console
    # code page is, while `text=True` decodes with the PARENT's locale encoding — cp1252 on
    # a Windows machine that is not in UTF-8 mode. The corpus has an accented row, so the
    # candidate came back as `GÃ©nÃ©seed` and every unicode subtest failed on the first CI
    # run. It was green here only because this repo's runbook exports `PYTHONUTF8=1`, which
    # makes the locale encoding UTF-8 and a bare `text=True` accidentally right.
    p = subprocess.run([NODE, "--input-type=module", "-e", src], cwd=str(ROOT),
                       capture_output=True, encoding="utf-8", timeout=120)
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

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_the_accented_row_survives_the_pipe(self):
        """The ABSOLUTE half of the unicode row, which the comparison above cannot give.

        A comparison is green when both sides are wrong and red when either is — but it
        cannot say WHICH, and a mojibake'd candidate reads exactly like a builder bug. This
        asserts the candidate's own bytes: the accented directory has to come back out of
        node's pipe as itself."""
        cand = _candidate()
        self.assertIn(CORPUS["unicode"], cand["add\u0000unicode"],
                      "the accented path did not survive the transport — the pipe was "
                      "decoded with something other than UTF-8")

    @unittest.skipUnless(NODE and sys.platform == "win32", "no node, or not Windows")
    @unittest.skipIf(os.environ.get("GENESEED_NO_UTF8_PROBE"), "this IS the probe")
    def test_the_comparison_still_holds_outside_utf8_mode(self):
        """RUN THE COMPARISON IN THE ENVIRONMENT THAT HAS THE BUG.

        Both tests above are green under either decoder as long as this process is in UTF-8
        mode, and this repo's runbook always puts it there (`PYTHONUTF8=1`). CI does not,
        which is how a bare `text=True` survived to the first non-developer machine. So the
        gate re-runs the comparison in a child with UTF-8 mode explicitly OFF, where the
        locale encoding on Windows is cp1252 and the defect is reachable."""
        env = {**os.environ, "PYTHONUTF8": "0", "GENESEED_NO_UTF8_PROBE": "1"}
        p = subprocess.run(
            [sys.executable, "-m", "unittest",
             "tests.test_win_user_path.TheTwoScriptBuildersAgree"],
            cwd=str(ROOT), env=env, capture_output=True, encoding="utf-8",
            errors="replace", timeout=300)
        self.assertEqual(p.returncode, 0,
                         "the two builders stop agreeing once the interpreter is out of "
                         f"UTF-8 mode:\n{p.stderr[-3000:]}")

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


SNAPSHOT = ROOT / "tests" / "__snapshots__" / "win_user_path.json"


def record(dest: Path) -> Path:
    """A SEPARATE CORPUS, and that is the whole reason this entry point exists.

    Every migration plan for this branch assumed `win_user_path` rode along with the pure
    probe. It does not: `win_user_path_script` appears ZERO times in
    `tests/fixtures/pure_probe.py`, so nothing in `tests/__snapshots__/primitives/` would
    have covered one line of it and the omission would have surfaced on the day the
    reference was gone.

    ONE FILE, NO PLATFORM SPLIT, and the claim is checkable rather than asserted.
    `_win_user_path_script` is a `str.replace` and two f-strings — no `os.sep`, no
    `os.linesep`, no `Path`, nothing that reads the host — so a Windows recording has to
    replay on Linux. `TheRecordedCorpusStillMatchesTheReference` below is what makes that a
    measurement: it runs on every host, and CI runs `validate` on ubuntu AND windows, so the
    first Linux run either confirms the claim or names the row that breaks it. (The verb
    itself is Windows-only; the string BUILDER is not, and only the builder is here.)

    The DIRECTORY travels beside the script, so the replay drives `winUserPathScript` from
    the corpus rather than from a hand-copied `CORPUS` — Task 8's rule that no cell id is
    hand-written, one layer down.
    """
    import _harness_lifecycle
    build = _harness_lifecycle._win_user_path_script
    doc = {
        "corpus": "win_user_path",
        "recorded_on": sys.platform,
        "recorded_with": {"python": platform.python_version(),
                          "implementation": platform.python_implementation()},
        "platform_independent": True,
        "actions": list(ACTIONS),
        "cases": [{"action": action, "row": name, "directory": directory,
                   "script": build(action, directory)}
                  for action in ACTIONS for name, directory in CORPUS.items()],
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n",
                    encoding="utf-8", newline="\n")
    return dest


class TheRecordedCorpusStillMatchesTheReference(unittest.TestCase):
    """The corpus, replayed against the implementation that produced it.

    Two jobs, and the second is the one worth having. The first is the ordinary staleness
    check — edit the builder, forget to re-record, this names the row. The second is the
    PLATFORM ARGUMENT: this file is recorded on Windows and committed once, and `validate`
    runs the unit suite on ubuntu-latest as well, so a POSIX run of this test is what turns
    "the builder reads nothing host-shaped" from a reading of the source into a measurement.
    """

    @classmethod
    def setUpClass(cls):
        if not SNAPSHOT.exists():
            raise unittest.SkipTest(
                f"{SNAPSHOT} has not been recorded — run `python "
                "tests/test_win_user_path.py --record tests/__snapshots__/win_user_path.json`")
        cls.doc = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    def test_every_recorded_case_still_builds_its_recorded_script(self):
        import _harness_lifecycle
        self.assertTrue(self.doc["cases"], "the recorded corpus is empty")
        for case in self.doc["cases"]:
            with self.subTest(action=case["action"], row=case["row"]):
                self.assertEqual(
                    _harness_lifecycle._win_user_path_script(case["action"],
                                                             case["directory"]),
                    case["script"],
                    f"{case['action']}/{case['row']} no longer builds what was recorded on "
                    f"{self.doc['recorded_on']}")

    def test_the_recording_covers_every_row_of_the_live_corpus(self):
        """A recording is only a gate over what it recorded. Without this, deleting a row
        from `CORPUS` and never re-recording leaves a green suite over a smaller corpus —
        and adding one leaves it ungated by the file that outlives the reference."""
        self.assertEqual({(c["action"], c["row"]) for c in self.doc["cases"]},
                         {(a, n) for a in ACTIONS for n in CORPUS},
                         "the recorded corpus and the live one are no longer the same set")


if __name__ == "__main__":
    if "--record" in sys.argv:
        raise SystemExit(print(f"recorded "
                               f"{record(Path(sys.argv[sys.argv.index('--record') + 1]))}"))
    unittest.main()
