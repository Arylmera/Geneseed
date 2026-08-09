#!/usr/bin/env python3
"""The pure functions no cell can reach, gated as a CORPUS.

RENAMED IN P5e, from `test_status_panel_parity` / `status_probe`. It was named for the
panel when the panel was all it held; P5d already put `pyLen`/`pyLjust` in it and P5e adds
`fenceFor` from `js/generate.mjs`, so a probe named `status_probe` importing the generator's
CLI module would be a name claiming something other than what exists — which is the class of
defect this port keeps finding. The MECHANISM is deliberately not duplicated: one corpus
gate, extended, rather than a second one per module.

WHY THIS FILE EXISTS. `tests/harness_golden.py` compares two CLIs by running them, and a
process's stdout is a pipe. `_color_enabled()` is `sys.stdout.isatty() and NO_COLOR is None
and TERM != "dumb"`, so the entire ANSI half of `_status_lines` is structurally unreachable
in every cell that can be written — deleting the escape codes would be byte-identical
across the whole matrix. The P5c handoff posed that as a choice between three bad answers:
fake a tty, ship it ungated, or drop colour from the Node CLI and regress a real terminal.

There is a fourth, and it is the shape P5c already found for `pyPathStr`: `_status_lines` is
documented PURE, so it does not need the CLI to be exercised at all. Call it directly on
both sides over a corpus of inputs and the tty question never arises. Three more functions
come along for the same ride, each unreachable from a cell for its own reason:

  * `_version_verdict`'s "up to date" branch needs a `.geneseed-version` holding the
    CURRENT source fingerprint, which changes every commit and no cell may name.
  * `_manifest_is_claude` is only consulted for a candidate with no known host, and
    `ROOT/"Harness"` is ordered ahead of the sandbox's own bundle path — and ROOT is the one
    thing `golden.cell_env` cannot redirect.
  * `_accent_for`'s cyan fallback needs a theme name `themes/` does not have, and
    `effective_theme` refuses one upstream before the accent is ever read.

And `pyLen`/`pyLjust`, because they reproduce a language primitive and P5c's rule for those
is a corpus rather than a cell: `len()` counts code points where `String.length` counts
UTF-16 units, and the panel turns both into column widths.

P5e adds `fenceFor` (`_harness_build._fence_for`), unreachable for a fifth distinct reason:
it is reachable in every `prompt` cell but never VARIES in one. Measured over the whole
rendered tree, the longest backtick run in any source text is 3, so `max(4, longest + 1)`
returns 4 for all 96 files and a port that hardcoded four backticks is byte-identical across
the matrix. Varying it needs a file in `src/`, and `src/` is the tree no fixture can
redirect. That the branch is dead is a claim about CONTENT, so it is re-derived here rather
than trusted — `test_the_fence_corpus_still_describes_the_real_tree` fails the day a source
file grows a four-backtick run, at which point a cell becomes possible and should be written.

P5f adds the largest entry so far and a sixth reason: **`difflib.unified_diff`**. `harness
diff`'s entire user-visible payload comes from it, and a cell can only produce a whole-file
replacement or an append. What separates `difflib` from any other correct diff — its
longest-block recursion rather than an edit-script minimiser, its earliest-wins tie rule, and
`autojunk`, which drops over-frequent lines once `b` reaches 200 elements — needs inputs a
fixture cannot seed. `test_the_diff_corpus_reaches_past_what_a_cell_can_seed` is the
positive control, and the unreachability is measured in BOTH directions: switching `autojunk`
off in `js/lib/pydiff.mjs` turns 28 of these cases red and leaves all 250-odd acceptance
cells green.

Four smaller ones ride along with it: `pySplitLines` (`str.splitlines()` breaks on U+2028 and
U+2029 where `split('\\n')` does not, and a deployed file acquires those from one paste),
`cmpKey` (its whole point is suppressing a BUILD-DATE difference, which needs a marker
holding the live fingerprint — the one value no cell may name), `pyCapitalize` (Python
lowercases the rest of the string and JS does not, invisible while every posture name is
already lowercase) and `setupBuildArgs` (a cell reaches only the flag combinations a deployed
install can actually be in).

The ASCII overlay gets a corpus too even though a cell CAN reach it, for a reason specific
to it: `_TUI_ASCII` is read at import time on the Python side and at call time on the Node
one, so the two probes run once per setting rather than switching inside a process.

POSITIVE CONTROL. An absolute gate needs one, or it passes on a pair of probes that both
return nothing: `test_the_probes_produce_the_panel_and_not_an_empty_echo` names literal
output, including a literal escape sequence, so a probe that answered `[]` fails.
"""
from __future__ import annotations

import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402

ROOT = golden.ROOT
PY_PROBE = ROOT / "tests" / "fixtures" / "pure_probe.py"
JS_PROBE = ROOT / "tests" / "fixtures" / "pure_probe.mjs"

# A status dict as `_status_data` returns one. Every field the panel reads, and nothing it
# does not — the panel is pure, so the corpus is its whole input.
_BASE = {
    "theme": "imperial", "accent": "yellow", "emit": "opencode-global",
    "agents": 17, "skills": 47, "laws": 37,
    "memory_dir": "/home/u/.config/opencode/memory", "facts": 3,
    "source_fp": "aaaaaaaaaaaa", "installed_fp": "aaaaaaaaaaaa",
    "version_target": "/home/u/.config/opencode",
    "version_verdict": "up to date with this source",
    "agent_md": "/home/u/.config/opencode/AGENT.md", "agent_md_present": True,
}


def _d(**kw) -> dict:
    return dict(_BASE, **kw)


def _panel_corpus() -> list[dict]:
    """The axes that change a rendered line, one case per axis rather than a product."""
    return [
        _BASE,
        # The three verdict states, which pick the mark AND its colour code.
        _d(installed_fp=None, version_verdict="no Geneseed install detected to compare"),
        _d(installed_fp="bbbbbbbbbbbb",
           version_verdict="installed build differs from the current source — run "
                           "`./geneseed update` (or rebuild) to apply it"),
        # The optional row, which changes the label column width from 7 to 8.
        _d(agent_md=None, agent_md_present=False),
        _d(agent_md_present=False),
        # Pluralisation, and the zero that is not None.
        _d(facts=1), _d(facts=0), _d(memory_dir=None, facts=0),
        # An accent with no ANSI code falls back to 36 — the `.get(x, "36")` branch.
        _d(accent="chartreuse"),
        # Width selection: a verdict LONGER than every body line, and the reverse.
        _d(version_verdict="x" * 200),
        _d(memory_dir="/" + "d" * 200),
        # len() is code POINTS. An astral theme name and an astral path shear the frame by
        # one column per character under String.length, and by nothing under pyLen.
        _d(theme="𝔤𝔬𝔱𝔥𝔦𝔠", memory_dir="/home/u/𝕄𝕖𝕞/memory"),
        # Combining marks are single code points in BOTH languages — the control that says
        # the astral case above is about surrogate pairs and not about "non-ASCII".
        _d(theme="néutral"),
        # An empty emit and an em-dash one, the two shapes `inst["emit"] or "—"` produces.
        _d(emit="—"),
        # Counts that are not two digits, so the panel's alignment is not accidentally
        # right for one width only.
        _d(agents=0, skills=1, laws=999),
    ]


def _cases() -> list[dict]:
    cases = []
    for d in _panel_corpus():
        for color in (False, True):
            cases.append({"fn": "status_lines", "args": [d, color]})
    for installed, current in ((None, "aaaaaaaaaaaa"), ("aaaaaaaaaaaa", "aaaaaaaaaaaa"),
                               ("bbbbbbbbbbbb", "aaaaaaaaaaaa"), ("", "aaaaaaaaaaaa")):
        cases.append({"fn": "version_verdict", "args": [installed, current]})
    for theme in ("imperial", "neutral", "cyberpunk", "nosuchtheme", "", "_TEMPLATE",
                  "../harness.config"):
        cases.append({"fn": "accent_for", "args": [theme]})
    cases.append({"fn": "default_theme", "args": []})
    # `len()` / `str.ljust()` against `String.length` / `padEnd`.
    for s in ("", "abc", "é", "é", "𝔊", "𝔊𝔊𝔊", "a𝔊b", "日本語", "\U0001F9EC"):
        cases.append({"fn": "py_len", "args": [s]})
        cases.append({"fn": "py_ljust", "args": [s, 6]})
        cases.append({"fn": "py_ljust", "args": [s, 1]})
    for s in _FENCE_CORPUS:
        cases.append({"fn": "fence_for", "args": [s]})
    for a, b in _DIFF_CORPUS:
        cases.append({"fn": "unified_diff", "args": [a, b]})
    for s in _SPLITLINES_CORPUS:
        cases.append({"fn": "py_split_lines", "args": [s]})
    for rel, text in _CMP_KEY_CORPUS:
        cases.append({"fn": "cmp_key", "args": [rel, text]})
    for s in ("peer", "PEER", "Peer", "foreman", "fOrEmAn", "", "a", "élan", "ÉLAN",
              "𝔤othic", "peer mode", "1st"):
        cases.append({"fn": "py_capitalize", "args": [s]})
    for args in _BUILD_ARGS_CORPUS:
        cases.append({"fn": "setup_build_args", "args": args})
    return cases


# `_setup_build_args`'s three elision rules, one case per rule and per side of it. Reachable
# through `rebuild-all` in principle — but a cell can only reach the combinations a DEPLOYED
# install can be in, and `--root` without `--out`, an empty footprint and a global emit
# carrying an `out` are not among them.
_BUILD_ARGS_CORPUS = (
    ["neutral", "opencode-global"],
    ["neutral", "opencode-global", "/repo", "/repo", "lean", "peer", "direct"],
    ["neutral", "claude-global", "/repo", "/repo", "full", "artisan", "foreman"],
    ["neutral", "opencode", "/repo", "/repo", "lean", "peer", "direct"],
    ["neutral", "opencode", "/repo", None, "full", "peer", "direct"],
    ["neutral", "opencode", None, "/repo", "lean", "peer", "direct"],
    ["neutral", "claude", None, None, "", "peer", "direct"],
    ["neutral", "bob", "/repo", "/repo", "lean", "artisan", "direct"],
    ["neutral", "copilot", "/repo", "/repo", "lean", "peer", "foreman"],
    ["neutral", "bob-global", "/ignored", "/ignored", "lean", "expert", "foreman"],
)

# `_cmp_key`'s reason for existing, and it is cell-unreachable in the direction that matters.
# `.geneseed-version` IS an owned file, so every `diff` cell runs this branch — but making it
# SUPPRESS a difference needs a deployed marker holding the CURRENT source fingerprint, which
# changes every commit and `test_no_cell_hardcodes_a_source_fingerprint` refuses to let a cell
# name. Here the two stamps share a token and differ in everything else, which is exactly the
# case the branch was written for: a rebuild is not a local edit.
_CMP_KEY_CORPUS = (
    (".geneseed-version", "abc123def456 (built 2020-01-01) [release 0.1]\n"),
    (".geneseed-version", "abc123def456 (built 2026-08-09) [release 9.9]\n"),
    (".geneseed-version", "   abc123def456   trailing\n"),
    (".geneseed-version", "\n"),
    (".geneseed-version", ""),
    (".geneseed-version", "   "),
    # `str.split()` with no argument collapses runs AND strips — `split(" ")` does neither,
    # and would answer `""` for a marker that begins with a space.
    (".geneseed-version", "\t\n  abc123def456\tx"),
    ("AGENT.md", "abc123def456 (built 2020-01-01)\n"),
    ("AGENT.md", ""),
)

# `str.splitlines()` against `split('\n')`. The two U+2028/U+2029 cases are the ones a real
# deployed file can acquire — paste a paragraph from a web page into an install's AGENT.md —
# and they shift every hunk after them by one line on the Python side only.
_SPLITLINES_CORPUS = (
    "", "a", "a\n", "a\nb", "a\nb\n", "\n", "\n\n", "a\n\nb",
    "a\r\nb\r\n", "a\rb", "a\r\n\rb",
    "para one\u2028para two", "para one\u2029para two", "a\u2028",
    "a\x0bb", "a\x0cb", "a\x1cb", "a\x1db", "a\x1eb", "a\x85b",
    "trailing spaces   \nnext",
    "\U0001D50A\n\U0001D50A",
)


def _diff_corpus() -> tuple:
    """Input pairs for `difflib.unified_diff`, chosen for the choices no cell can vary.

    A `diff` cell seeds one deployed file and gets a whole-file replacement or an append. It
    cannot produce a tie between two equal-length blocks, cannot reach the recursion's
    alignment decisions, and above all cannot cross the **autojunk** threshold in a way it
    controls: `SequenceMatcher` drops any line occurring more than `len(b)//100 + 1` times
    once `b` reaches 200 elements, which is every real harness file and no fixture's.

    Deterministically random rather than hand-written past the first block: ties and near-ties
    are what separate `difflib` from any other correct diff, and they are far easier to
    generate than to think of. The seed is fixed so a failure is reproducible.
    """
    rnd = random.Random(20260809)
    out = [
        ([], []), ([], ["a"]), (["a"], []), (["a"], ["a"]),
        (["a", "b", "c"], ["a", "x", "c"]),
        (["a"] * 5, ["a"] * 5),
        (list("abcdefghij"), list("acbdefghij")),
        (["x"] * 10 + list("abc"), list("abc") + ["x"] * 10),
        # One change in the middle of a long identical run — the grouping path, and the
        # `i2-i1 > nn` split that ends a hunk.
        ([f"l{i}" for i in range(40)],
         [f"l{i}" if i != 20 else "CHANGED" for i in range(40)]),
        ([f"l{i}" for i in range(60)],
         [f"l{i}" if i not in (5, 50) else "X" for i in range(60)]),
        # The autojunk threshold, from one element below it to one above.
        ([f"l{i % 7}" for i in range(199)], [f"l{i % 7}" for i in range(199)] + ["tail"]),
        ([f"l{i % 7}" for i in range(200)], [f"l{i % 7}" for i in range(200)] + ["tail"]),
        ([f"l{i % 7}" for i in range(400)], ["head"] + [f"l{i % 7}" for i in range(400)]),
        # Blank lines between paragraphs, which is what a real markdown file looks like to
        # the popular-element purge.
        (sum(([f"p{i}", ""] for i in range(150)), []),
         sum(([f"p{i}" if i != 77 else "EDIT", ""] for i in range(150)), [])),
        # Lines that look like integers: `b2j` is a Map for the same reason `loadUserPalette`
        # holds one, and a plain object would hoist these to the front of the index.
        (["0", "1", "2", "zzz"], ["zzz", "0", "1", "2"]),
        (["a", "", "b", "", "a", "", "b"], ["a", "", "b", "", "b", "", "a"]),
    ]
    for _ in range(120):
        a = [rnd.choice("abcde") for _ in range(rnd.randrange(0, 60))]
        b = list(a)
        for _ in range(rnd.randrange(0, 8)):
            op = rnd.choice(("ins", "del", "sub"))
            if op == "ins":
                b.insert(rnd.randrange(0, len(b) + 1), rnd.choice("abcdez"))
            elif b:
                i = rnd.randrange(0, len(b))
                if op == "del":
                    del b[i]
                else:
                    b[i] = rnd.choice("abcdez")
        out.append((a, b))
    for _ in range(40):
        a = [rnd.choice(("alpha", "beta", "", "", "gamma"))
             for _ in range(rnd.randrange(150, 320))]
        b = list(a)
        for _ in range(rnd.randrange(1, 10)):
            b[rnd.randrange(0, len(b))] = "MUTATED"
        out.append((a, b))
    return tuple(out)


_DIFF_CORPUS = _diff_corpus()


# `_fence_for`'s whole job is picking a fence longer than the longest run INSIDE the text,
# and the live tree only ever exercises "shorter than four". Every case beyond the first two
# is a shape `src/` does not currently contain and a user's repo might after one commit.
_FENCE_CORPUS = (
    "",                        # no backticks at all — the `max(4, 0 + 1)` floor
    "a ``` fenced ``` block",  # the tree's real maximum: 3, so still 4
    "````",                    # exactly at the floor — the first case that must return 5
    "`````",
    "a " + "`" * 12 + " b",
    "`" * 3 + "\n" + "`" * 7 + "\n" + "`" * 2,   # the longest run is not the first
    "``` a ``` b ```",         # several runs of the same length
    "`",
    # A run at the very END of the string: an off-by-one in the loop's bookkeeping shows
    # here and nowhere else, because there is no following character to reset the count on.
    "trailing " + "`" * 6,
    "`" * 6 + " leading",
    # Astral characters around the run. The Python iterates CHARACTERS and this port
    # iterates code UNITS — identical for counting backticks, and this is the case that
    # says so rather than leaving it argued in a comment.
    "\U0001D50A\U0001D50A" + "`" * 5 + "\U0001D50A",
)


def _manifest_cases(tmp: Path) -> list[dict]:
    """`_manifest_is_claude` reads a file, so its corpus is a set of seeded directories."""
    worlds = {
        "managed-map": '{"managed": {"claude_md": true}}',
        "managed-empty-map": '{"managed": {}}',
        "managed-list": '{"managed": []}',
        "managed-null": '{"managed": null}',
        "managed-string": '{"managed": "yes"}',
        "no-managed": '{"owned": []}',
        "a-json-list": '[1, 2, 3]',
        "a-json-string": '"hello"',
        "not-json": "{nope",
        "empty": "",
    }
    cases = []
    for name, body in worlds.items():
        d = tmp / name
        d.mkdir(parents=True, exist_ok=True)
        (d / ".geneseed-manifest.json").write_text(body, encoding="utf-8")
        cases.append({"fn": "manifest_is_claude", "args": [str(d)]})
    missing = tmp / "no-manifest-at-all"
    missing.mkdir(parents=True, exist_ok=True)
    cases.append({"fn": "manifest_is_claude", "args": [str(missing)]})
    # A DIRECTORY where the manifest should be: `read_text` raises IsADirectoryError, which
    # is an OSError, and both sides must degrade to {} rather than propagate.
    weird = tmp / "manifest-is-a-directory"
    (weird / ".geneseed-manifest.json").mkdir(parents=True, exist_ok=True)
    cases.append({"fn": "manifest_is_claude", "args": [str(weird)]})
    return cases


def _run(cmd: list[str], cases: list[dict], ascii_mode: bool) -> list:
    with tempfile.TemporaryDirectory() as td:
        job = Path(td) / "job.json"
        job.write_text(json.dumps({"cases": cases}), encoding="utf-8")
        env = dict(os.environ, PYTHONUTF8="1")
        env.pop("GENESEED_TUI_ASCII", None)
        if ascii_mode:
            env["GENESEED_TUI_ASCII"] = "1"
        # No text=True: both probes write UTF-8 whatever the console code page is, and the
        # decoder is pinned for the same reason harness_golden pins it.
        proc = subprocess.run(cmd + [str(job)], capture_output=True, env=env, cwd=str(ROOT))
        if proc.returncode != 0:
            raise AssertionError(f"{cmd[0]} probe failed ({proc.returncode}):\n"
                                 f"{proc.stderr.decode('utf-8', 'replace')}")
        return json.loads(proc.stdout.decode("utf-8"))["results"]


@unittest.skipIf(shutil.which("node") is None, "node is not on PATH")
class ThePureFunctionsAgreeOnEveryInputNoCellCanBuild(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls._tmp.name)
        cls.cases = _cases() + _manifest_cases(tmp)
        cls.out = {}
        for ascii_mode in (False, True):
            cls.out[ascii_mode] = (
                _run([sys.executable, str(PY_PROBE)], cls.cases, ascii_mode),
                _run(["node", str(JS_PROBE)], cls.cases, ascii_mode),
            )

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_every_case_agrees_in_both_glyph_modes(self):
        for ascii_mode, (ref, new) in self.out.items():
            self.assertEqual(len(ref), len(self.cases))
            self.assertEqual(len(new), len(self.cases))
            for case, a, b in zip(self.cases, ref, new):
                with self.subTest(ascii=ascii_mode, fn=case["fn"], args=case["args"]):
                    self.assertEqual(a, b)

    def test_the_probes_produce_the_panel_and_not_an_empty_echo(self):
        """The positive control. Every assertion above is an EQUALITY between two probes,
        and two probes that both returned nothing would satisfy all of them — the same hole
        `test_remove_unwires_what_add_wired` closes beside P5c's ownership gate."""
        ref, new = self.out[False]
        idx = {id(c): i for i, c in enumerate(self.cases)}
        first_panel = ref[idx[id(self.cases[0])]]
        self.assertIsInstance(first_panel, list)
        self.assertIn("┌─ ◆ Geneseed — status ", first_panel[0])
        self.assertTrue(any("17 agents · 47 skills · 37 laws" in ln for ln in first_panel))
        self.assertTrue(any("✓ up to date" in ln for ln in first_panel))

        # The COLOURED variant of the same dict — the branch that exists only here. Yellow
        # is imperial's accent (33), and the verdict line carries the up-to-date green (32).
        coloured = ref[1]
        self.assertIn("\x1b[33m", coloured[0])
        self.assertIn("\x1b[33;1m", coloured[0])
        self.assertTrue(any("\x1b[32m" in ln for ln in coloured))
        self.assertNotEqual(first_panel, coloured,
                            "the colour argument changed nothing, so this corpus is not "
                            "covering the branch it exists for")
        self.assertEqual(new[1], coloured)

        # And the ASCII overlay really swaps glyphs rather than being ignored.
        ascii_panel = self.out[True][0][0]
        self.assertIn("* Geneseed - status", ascii_panel[0])
        self.assertNotIn("◆", "".join(ascii_panel))
        self.assertEqual(self.out[True][1][0], ascii_panel)

    def test_the_fence_corpus_actually_varies_the_fence(self):
        """The positive control for `fence_for`, and it needs one for a specific reason.

        The whole point of these cases is that the LIVE tree never leaves the floor, so a
        corpus whose every case also returned four backticks would be an equality between
        two constants — green forever, and green on a port that hardcoded the floor. This
        asserts the corpus reaches past it, and names both arms.
        """
        ref, new = self.out[False]
        fences = [a for case, a in zip(self.cases, ref) if case["fn"] == "fence_for"]
        self.assertEqual(fences, [b for case, b in zip(self.cases, new)
                                  if case["fn"] == "fence_for"])
        self.assertIn("`" * 4, fences, "no case exercises the max(4, ...) floor")
        self.assertTrue(any(len(f) > 4 for f in fences),
                        "every case returned the floor — this corpus cannot tell "
                        "`_fence_for` from a hardcoded four backticks")
        self.assertEqual(max(len(f) for f in fences), 13)   # the 12-run case, + 1

    def test_the_fence_corpus_still_describes_the_real_tree(self):
        """`js/generate.mjs` states that no CELL can vary the fence, and that is a claim
        about the CONTENT of `src/` rather than about the code — so it is re-derived here
        instead of trusted. The day a source file grows a four-backtick run the claim stops
        holding, a `prompt` cell becomes able to cover the branch, and this fails to say so.
        """
        sys.path.insert(0, str(ROOT))
        import build  # noqa: PLC0415  (the checkout's own generator, not a dependency)
        _, items = build.render_all("neutral")
        longest, where = 0, None
        for rel, text, _src in items:
            if text is None:
                continue
            for m in re.finditer(r"`+", text):
                if len(m.group()) > longest:
                    longest, where = len(m.group()), rel
        self.assertLess(longest, 4,
                        f"{where} now holds a run of {longest} backticks, so `_fence_for` "
                        f"no longer always returns the floor and the matrix CAN cover it — "
                        f"write the prompt cell and relax this test")

    def test_the_diff_corpus_reaches_past_what_a_cell_can_seed(self):
        """The positive control for `unifiedDiff`, and it has to assert three things.

        A corpus of pairs that all differ trivially would be an equality between two
        one-hunk diffs — green on any correct implementation, and green on one that got
        `autojunk` or the tie rule wrong. So: some case must produce MORE THAN ONE hunk (the
        grouping path and the `i2-i1 > nn` split), some case must be at or past the 200-line
        autojunk threshold, and some case must produce no output at all (two identical
        sequences yield an empty diff, not a header).
        """
        ref, new = self.out[False]
        diffs = [(c, a) for c, a in zip(self.cases, ref) if c["fn"] == "unified_diff"]
        self.assertEqual([a for _, a in diffs],
                         [b for c, b in zip(self.cases, new) if c["fn"] == "unified_diff"])
        hunks = [sum(1 for ln in a if ln.startswith("@@")) for _, a in diffs]
        self.assertTrue(any(h > 1 for h in hunks),
                        "no case produces two hunks, so the grouping path is untested")
        self.assertTrue(any(h == 0 for h in hunks),
                        "no case produces an EMPTY diff, so 'identical' is untested")
        self.assertTrue(
            any(len(c["args"][1]) >= 200 for c, _ in diffs),
            "no case reaches the 200-element autojunk threshold, so this corpus cannot "
            "tell SequenceMatcher from a diff that never purges popular elements — which "
            "is the one difference no acceptance cell can see either")
        # And the threshold cases must actually DIFFER from each other, or "reaches 200" is
        # a length assertion about the input rather than a claim about the output.
        long_diffs = [a for c, a in diffs if len(c["args"][1]) >= 200 and a]
        self.assertTrue(long_diffs, "every long case produced an empty diff")

    def test_the_splitlines_corpus_separates_python_boundaries_from_a_newline_split(self):
        """`pySplitLines` exists for the boundaries `split('\\n')` does not break on. A corpus
        without one of those is an equality between two `split('\\n')`s."""
        cases = [c["args"][0] for c in self.cases if c["fn"] == "py_split_lines"]
        extra = [s for s in cases if len(s.splitlines()) != len(s.split("\n"))]
        self.assertTrue(extra, "no case in this corpus breaks on a boundary `split('\\n')` "
                               "misses, so the pySplitLines gate is vacuous")

    def test_the_capitalize_corpus_has_a_case_where_the_rest_matters(self):
        """`str.capitalize()` lowercases the REST; `s[0].toUpperCase() + s.slice(1)` does
        not. Every shipped posture and mode name is already lowercase, so the difference is
        invisible in the live tree — which is the whole reason this is a corpus."""
        cases = [c["args"][0] for c in self.cases if c["fn"] == "py_capitalize"]
        naive = [s for s in cases if s and s.capitalize() != s[0].upper() + s[1:]]
        self.assertTrue(naive, "no case distinguishes str.capitalize() from a naive "
                               "uppercase-first, so this corpus proves nothing")

    def test_the_corpus_separates_code_points_from_utf16_units(self):
        """`len()` is the reason this corpus has astral characters in it, and a corpus
        without one cannot tell the two lengths apart. Measured here rather than trusted:
        at least one case must be a string whose two lengths DIFFER."""
        astral = [c for c in self.cases
                  if c["fn"] == "py_len" and len(c["args"][0]) != len(
                      c["args"][0].encode("utf-16-le")) // 2]
        self.assertTrue(astral, "no case in this corpus distinguishes code points from "
                                "UTF-16 units, so the pyLen gate is vacuous")


if __name__ == "__main__":
    unittest.main()
