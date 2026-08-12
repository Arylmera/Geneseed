#!/usr/bin/env python3
"""The two MAINTAINER TOOLS, gated across implementations for the first time.

`build.py --sync-themes` and `build.py --validate-only` are the last two things the generator
answers to, and until this file neither had a cross-implementation gate of any kind.
`tests/golden.py`'s `_argv` builds every one of its 259 cells out of the RENDER flags and
emits neither of these two — argued in situ where the driver used to refuse them — so the
acceptance matrix that proves all nine emits byte-identical is structurally blind to both.
The Node driver refused them for exactly that reason.

WHY THE GATE HAD TO BE WRITTEN BEFORE THE PORT, and why it could only be written now. A byte
comparison needs two implementations AND a reference to compare against. `rituals/harness.py`
and `build.py` are deleted later in this migration; after that there is no reference left, and
whatever the port does becomes the definition of correct by default. This phase is the only
window in which these two tools can be pinned to the behaviour they actually had.

`--sync-themes` IS A BYTE-EXACT TEXTUAL EDIT OF COMMITTED FILES — it opens fourteen theme
JSONs a human wrote, inserts one line into each, and must leave every other line alone. Six
primitives decide whether it does:

  1. `str.splitlines()`, which breaks on U+2028/U+2029 where `split('\\n')` does not;
  2. `str.strip`/`lstrip`/`rstrip`, whose whitespace set is not `String.prototype.trim`'s;
  3. `json.dumps(value, ensure_ascii=False)` on a CONTAINER — the compact separators
     `', '`/`': '` that `JSON.stringify` does not write — reachable through exactly one key,
     `AGENT_COLORS`, the only non-string among `themes/_TEMPLATE.json`'s 137 values;
  4. `Path.write_text`'s `os.linesep` translation, which turns every `\\n` into `\\r\\n` on
     Windows and which `fs.writeFileSync` does not do;
  5. the reparse-equality safety net, where `==` on two `json.loads` results is `pyEq` and not
     `===` — a `===` there returns False every time and silently routes every theme through
     the re-dump fallback, i.e. rewrites all fourteen files in full;
  6. the full re-dump fallback itself, which no shipped theme reaches.

Traps 4 and 6 are why the corpus compares FILE BYTES and not parsed documents: every case
here has a JSON-equal, byte-different wrong answer, and a comparison of `json.loads` results
would pass on all of them.

THE PROBES WRITE THE TOOL'S OUTPUT TO THEIR OWN STDOUT rather than capturing it, so the
comparison sees Python's stream translation too. An `io.StringIO` capture on the reference
side would fold `\\r\\n` back to `\\n` and make trap 4's stream half untestable.

`--validate-only` is compared by running the two CLIs, because its payload is a whole rendered
tree scanned for problems plus the doctor's verdict, and there is no smaller seam. It is slow
and the case list is short on purpose; what it has to catch is a port that answers a different
COUNT, a different set of paths, or a different exit code.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY_PROBE = ROOT / "tests" / "fixtures" / "sync_themes_probe.py"
JS_PROBE = ROOT / "tests" / "fixtures" / "sync_themes_probe.mjs"
NODE = shutil.which("node")

# The one non-string value in the real template, verbatim. Read rather than transcribed: a
# corpus entry that has drifted from the thing it is named for is a comment, not a test.
AGENT_COLORS = json.loads(
    (ROOT / "themes" / "_TEMPLATE.json").read_text(encoding="utf-8"))["AGENT_COLORS"]


def _tmpl(**pairs) -> str:
    """A conventionally-formatted template: `{` alone, one `  "K": v` per line."""
    body = ",\n".join(f'  "{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in pairs.items())
    return "{\n" + body + "\n}\n"


def corpus() -> "list[dict]":
    """One case per axis that changes what gets written, not a product of them."""
    cases: list[dict] = []

    def case(name, files):
        cases.append({"name": name, "files": files})

    # ---- the three the brief names ------------------------------------------------------
    # A KEY THAT ALREADY EXISTS, and is the anchor the insertion is placed after.
    case("a-key-that-already-exists-anchors-the-insertion", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>", C="<c>"),
        "mytheme.json": '{\n  "A": "hello",\n  "C": "world"\n}\n',
    })
    # AGENT_COLORS — the container. `json.dumps` separators, and `ensure_ascii=False`.
    case("the-one-container-value-in-the-real-template", {
        "_TEMPLATE.json": _tmpl(VOICE="<v>", AGENT_COLORS=AGENT_COLORS, LAST="<l>"),
        "mytheme.json": '{\n  "VOICE": "plain",\n  "LAST": "end"\n}\n',
    })
    # AN UNCONVENTIONALLY-FORMATTED FILE — the whole object on one line, so `lines[0].strip()`
    # is not `{` and the re-dump fallback is the only path that can answer.
    case("an-unconventionally-formatted-theme-falls-back-to-a-full-re-dump", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>", ZED="<z>"),
        "mytheme.json": '{"A": "hello", "ZED": "café — raw"}\n',
    })

    # ---- the insertion positions --------------------------------------------------------
    # No earlier template key exists: insert right after `{`, and something follows.
    case("a-missing-first-key-goes-straight-after-the-brace", {
        "_TEMPLATE.json": _tmpl(FIRST="<f>", A="<a>"),
        "mytheme.json": '{\n  "A": "hello"\n}\n',
    })
    # ... and nothing follows: an empty theme takes the key with no comma at all.
    case("an-empty-theme-takes-the-key-with-no-trailing-comma", {
        "_TEMPLATE.json": _tmpl(ONLY="<o>"),
        "mytheme.json": "{\n}\n",
    })
    # The predecessor was the LAST entry: it gains the comma and the new line goes last.
    case("a-missing-last-key-gives-its-predecessor-the-comma", {
        "_TEMPLATE.json": _tmpl(A="<a>", LAST="<l>"),
        "mytheme.json": '{\n  "A": "hello"\n}\n',
    })
    # `rstrip()` and not `endswith(",")`: trailing spaces after the comma decide which of the
    # two branches runs, and picking the wrong one writes a second comma.
    case("trailing-whitespace-after-a-comma-still-reads-as-a-comma", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>", C="<c>"),
        "mytheme.json": '{\n  "A": "hello",   \n  "C": "world"\n}\n',
    })
    # Several missing keys at once, in TEMPLATE order, each anchoring the next.
    case("several-missing-keys-insert-in-template-order", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>", C="<c>", D="<d>", E="<e>"),
        "mytheme.json": '{\n  "A": "hello",\n  "E": "end"\n}\n',
    })

    # ---- what must NOT move -------------------------------------------------------------
    # A no-op must not rewrite one byte, including formatting `json.dumps` cannot reproduce.
    case("an-in-sync-theme-is-not-rewritten-at-all", {
        "_TEMPLATE.json": _tmpl(A="<a>"),
        "mytheme.json": '{\n  "A": "caf\\u00e9 — raw"\n}\n',
    })
    # The churn guarantee: raw Unicode stays raw, a legacy \\uXXXX escape stays escaped, and
    # only the inserted line differs. A re-dump cannot preserve both spellings at once.
    case("a-one-key-sync-keeps-both-unicode-spellings-byte-for-byte", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>", C="<c>"),
        "mytheme.json": '{\n  "A": "hello — caf\\u00e9",\n  "C": "\\u2603 world"\n}\n',
    })
    # Extra keys are REPORTED and never removed — with and without a missing key beside them.
    case("an-extra-key-is-reported-and-kept-when-nothing-is-missing", {
        "_TEMPLATE.json": _tmpl(A="<a>"),
        "mytheme.json": '{\n  "A": "hello",\n  "ZZZ": "keep-me"\n}\n',
    })
    case("an-extra-key-survives-a-sync-that-adds-one", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>"),
        "mytheme.json": '{\n  "A": "hello",\n  "ZZZ": "keep-me"\n}\n',
    })

    # ---- the primitives -----------------------------------------------------------------
    # `splitlines()` breaks on U+2028, `split('\\n')` does not. The joined text then carries a
    # raw newline inside a string literal, the reparse fails, and the fallback answers — so
    # the two implementations agree only if BOTH split there.
    #
    # THE `\\u00e9` IS LOAD-BEARING AND WAS ADDED AFTER A MUTATION SURVIVED. Without it the
    # case reached the fallback and proved nothing: a one-key indent-2 theme re-dumps to
    # EXACTLY what the surgical insert would have written, so a port that never split on
    # U+2028 produced identical bytes. A legacy escape is the one spelling a re-dump cannot
    # reproduce (`ensure_ascii=False` turns it into the raw character), which is what makes
    # "reached the fallback" and "took the surgical path" tell each other apart at all.
    case("a-line-separator-inside-a-value-reaches-the-reparse-safety-net", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>"),
        "mytheme.json": '{\n  "A": "caf\\u00e9 before after"\n}\n',
    })
    # int vs float: `json.dumps(1)` is `1` and `json.dumps(1.0)` is `1.0`, a distinction
    # `JSON.parse` loses and `parseJson` keeps.
    case("an-int-and-a-float-template-value-keep-their-spelling", {
        "_TEMPLATE.json": '{\n  "N": 1,\n  "F": 1.0,\n  "A": "<a>"\n}\n',
        "mytheme.json": '{\n  "A": "hello"\n}\n',
    })
    # A key argparse-free but Object.prototype-shaped: `k in theme` would answer True for
    # `constructor` in JS and the key would never be reported missing.
    case("a-prototype-shaped-key-is-still-a-missing-key", {
        "_TEMPLATE.json": _tmpl(constructor="<c>", A="<a>"),
        "mytheme.json": '{\n  "A": "hello"\n}\n',
    })
    # `sorted(THEMES.glob(...))` sorts PATHS, which compare through `_str_normcase` — so on
    # Windows an upper-case theme name sorts case-folded and a bare code-unit sort does not.
    case("theme-files-are-visited-in-the-references-order", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>"),
        "Zebra.json": '{\n  "A": "z"\n}\n',
        "apple.json": '{\n  "A": "a"\n}\n',
    })
    # `_`-prefixed scaffolds are not themes, and the template is the scaffold.
    case("an-underscore-prefixed-file-is-a-scaffold-and-not-a-theme", {
        "_TEMPLATE.json": _tmpl(A="<a>", B="<b>"),
        "_scratch.json": '{\n  "A": "ignore me"\n}\n',
        "mytheme.json": '{\n  "A": "hello"\n}\n',
    })
    # Every theme already in sync: the summary line, and no file touched.
    case("nothing-to-do-says-so-once", {
        "_TEMPLATE.json": _tmpl(A="<a>"),
        "one.json": '{\n  "A": "1"\n}\n',
        "two.json": '{\n  "A": "2"\n}\n',
    })

    # ---- the refusal (P2 decision) ------------------------------------------------------
    # A missing or unreadable template used to print and return 0 — "already in sync", a false
    # green in the one job the tool exists for. It now refuses with exit 2, on both sides.
    case("an-unreadable-template-refuses-instead-of-reporting-sync", {
        "_TEMPLATE.json": "{ this is not json\n",
        "mytheme.json": '{\n  "A": "hello"\n}\n',
    })
    case("a-missing-template-refuses-too", {
        "mytheme.json": '{\n  "A": "hello"\n}\n',
    })
    return cases


def _run_probe(cmd: "list[str]", case: dict) -> "tuple[bytes, bytes, int, dict]":
    with tempfile.TemporaryDirectory() as td:
        job = Path(td) / "job.json"
        res = Path(td) / "result.json"
        job.write_text(json.dumps({"files": case["files"]}), encoding="utf-8")
        env = dict(os.environ, PYTHONUTF8="1")
        # No text=True: the whole point is the RAW bytes, translation included.
        proc = subprocess.run(cmd + [str(job), str(res)], capture_output=True, env=env,
                              cwd=str(ROOT))
        if proc.returncode != 0:
            raise AssertionError(f"{cmd[0]} probe failed ({proc.returncode}) on "
                                 f"{case['name']}:\n{proc.stderr.decode('utf-8', 'replace')}")
        return (proc.stdout, proc.stderr, proc.returncode,
                json.loads(res.read_text(encoding="utf-8")))


@unittest.skipIf(NODE is None, "node is not on PATH")
class SyncThemesAgreesOnEveryInputNoCellCanBuild(unittest.TestCase):
    """The corpus, run once per side and compared case by case."""

    @classmethod
    def setUpClass(cls):
        cls.cases = corpus()
        cls.ref = [_run_probe([sys.executable, str(PY_PROBE)], c) for c in cls.cases]
        cls.new = [_run_probe([NODE, str(JS_PROBE)], c) for c in cls.cases]

    def test_the_printed_report_is_byte_identical(self):
        for c, r, n in zip(self.cases, self.ref, self.new):
            with self.subTest(case=c["name"]):
                self.assertEqual(r[0], n[0], "`--sync-themes` printed different BYTES; the "
                                             "newline translation and the em dash both live "
                                             "in this comparison")
                self.assertEqual(r[1], n[1])

    def test_the_written_files_are_byte_identical(self):
        for c, r, n in zip(self.cases, self.ref, self.new):
            with self.subTest(case=c["name"]):
                self.assertEqual(sorted(r[3]["files"]), sorted(n[3]["files"]))
                for name in sorted(r[3]["files"]):
                    with self.subTest(file=name):
                        self.assertEqual(
                            base64.b64decode(r[3]["files"][name]),
                            base64.b64decode(n[3]["files"][name]),
                            f"{name} differs BYTE-wise after the sync — a JSON-equal answer "
                            f"is not the same answer for a tool that edits committed files")

    def test_the_verdict_and_the_exit_status_agree(self):
        for c, r, n in zip(self.cases, self.ref, self.new):
            with self.subTest(case=c["name"]):
                self.assertEqual(r[3]["changed"], n[3]["changed"])
                self.assertEqual(r[3]["exit"], n[3]["exit"])

    # ---- positive controls: the corpus is not comparing two silences -------------------

    def test_the_reference_actually_does_something_in_each_direction(self):
        """Absolute, on the REFERENCE side only, so two probes that both answered nothing
        cannot pass the three comparisons above."""
        by_name = {c["name"]: r for c, r in zip(self.cases, self.ref)}

        def out(name):
            return by_name[name][0].decode("utf-8")

        self.assertIn("added 1 key(s) from the template",
                      out("a-key-that-already-exists-anchors-the-insertion"))
        self.assertIn("RESTYLE these in this theme's voice: B",
                      out("a-key-that-already-exists-anchors-the-insertion"))
        self.assertIn("all themes already carry every template key.",
                      out("nothing-to-do-says-so-once"))
        self.assertIn("not removed: ZZZ",
                      out("an-extra-key-is-reported-and-kept-when-nothing-is-missing"))
        self.assertIn("is missing or unreadable",
                      out("an-unreadable-template-refuses-instead-of-reporting-sync"))
        for name, changed, code in (
                ("a-key-that-already-exists-anchors-the-insertion", 1, 0),
                ("nothing-to-do-says-so-once", 0, 0),
                ("several-missing-keys-insert-in-template-order", 1, 0),
                ("an-unreadable-template-refuses-instead-of-reporting-sync", None, 2),
                ("a-missing-template-refuses-too", None, 2)):
            with self.subTest(case=name):
                self.assertEqual(by_name[name][3]["changed"], changed)
                self.assertEqual(by_name[name][3]["exit"], code)

    def test_the_reference_writes_the_exact_bytes_the_churn_guarantee_promises(self):
        """The insertion is TEXTUAL, stated absolutely rather than only compared. Both
        Unicode spellings survive, and only the new line differs from the input."""
        by_name = {c["name"]: (c, r) for c, r in zip(self.cases, self.ref)}
        case, res = by_name["a-one-key-sync-keeps-both-unicode-spellings-byte-for-byte"]
        after = base64.b64decode(res[3]["files"]["mytheme.json"]).decode("utf-8")
        self.assertEqual(
            after.replace("\r\n", "\n"),
            '{\n  "A": "hello — caf\\u00e9",\n  "B": "<b>",\n  "C": "\\u2603 world"\n}\n')
        before = case["files"]["mytheme.json"]
        self.assertEqual(
            [ln for ln in after.replace("\r\n", "\n").split("\n") if '"B"' not in ln],
            before.split("\n"),
            "a line other than the inserted one moved")

    def test_the_no_op_case_really_leaves_the_bytes_alone(self):
        by_name = {c["name"]: (c, r) for c, r in zip(self.cases, self.ref)}
        case, res = by_name["an-in-sync-theme-is-not-rewritten-at-all"]
        self.assertEqual(base64.b64decode(res[3]["files"]["mytheme.json"]),
                         case["files"]["mytheme.json"].encode("utf-8"))

    def test_the_fallback_case_really_reaches_the_fallback(self):
        """The re-dump is the one branch no shipped theme reaches, so the corpus has to prove
        its own case gets there — a one-line file that came back one-line would mean the
        surgical path answered and the fallback is still ungated."""
        by_name = {c["name"]: r for c, r in zip(self.cases, self.ref)}
        after = base64.b64decode(
            by_name["an-unconventionally-formatted-theme-falls-back-to-a-full-re-dump"][3]
            ["files"]["mytheme.json"]).decode("utf-8")
        self.assertEqual(after.replace("\r\n", "\n"),
                         '{\n  "A": "hello",\n  "B": "<b>",\n  "ZED": "café — raw"\n}\n')

    def test_the_container_value_is_written_with_pythons_separators(self):
        """`json.dumps({...})` writes `{"a": 1, "b": 2}`; `JSON.stringify` writes
        `{"a":1,"b":2}`. One key in the real template can tell them apart."""
        by_name = {c["name"]: r for c, r in zip(self.cases, self.ref)}
        after = base64.b64decode(
            by_name["the-one-container-value-in-the-real-template"][3]
            ["files"]["mytheme.json"]).decode("utf-8")
        self.assertIn('"AGENT_COLORS": {"architect": "primary", ', after)

    def test_the_template_still_has_exactly_one_container_value(self):
        """The claim this corpus is built on, re-derived rather than trusted: the day a second
        non-string value lands in the template, this case stops being the whole of trap 3."""
        tmpl = json.loads((ROOT / "themes" / "_TEMPLATE.json").read_text(encoding="utf-8"))
        containers = sorted(k for k, v in tmpl.items() if not isinstance(v, str))
        self.assertEqual(containers, ["AGENT_COLORS"],
                         f"themes/_TEMPLATE.json's non-string values are {containers}; the "
                         f"corpus covers AGENT_COLORS only")


# --------------------------------------------------------------------------------------
# --validate-only
# --------------------------------------------------------------------------------------

VALIDATE_CASES = [
    # The default shape: a plain `files` bundle, scanned where it was rendered.
    ["--theme", "neutral", "--emit", "files"],
    # `--root` SPLITS the output — bundle under `out`, native layer under `root` — and `-v`
    # is the only flag that prints the individual paths, so it is the only one that can catch
    # a port whose `relative_to` base is the wrong one of the two.
    ["--theme", "neutral", "--emit", "claude", "--out", "myrepo/Harness", "--root", "myrepo",
     "-v"],
    # A refusal FROM THE RENDER (`load_theme`'s `sys.exit`), which prints the FAILED line and
    # returns 1 before any scan or doctor run happens. `--theme` carries no `choices`, so an
    # unknown one gets past the parser on both sides and dies where the theme is loaded.
    ["--theme", "no-such-theme", "--emit", "files"],
]


@unittest.skipIf(NODE is None, "node is not on PATH")
class ValidateOnlyAgreesWithTheReference(unittest.TestCase):
    """`python build.py --validate-only …` against `node bin/geneseed-cli.mjs validate …`.

    THE VERB IS NOT THE FLAG, and that is the one deliberate difference. `--validate-only`
    runs the doctor, `js/doctor.mjs` starts a process, and `bin/geneseed.mjs` is under a
    transitive ban on reaching any module that can — gated by a source grep in
    `tests/test_node_cli_parity.py` and by an import walk in `tests/test_hook_cli_parity.py`.
    Moving the tool to the CLI binary crosses it with neither gate amended. Everything after
    the verb is the generator's own flag surface, parsed by the generator's own parser.
    """

    #: The ONE thing that legitimately differs, destamped rather than fenced off: the emit
    #: prints the directory it rendered into, and each side makes its own `mkdtemp` (Python
    #: draws 8 characters, Node 6). Everything else in the sandbox path — the resolved temp
    #: root and the `out`/`root`/`cfg` nesting under it — is compared as written.
    SANDBOX_RE = re.compile(r"geneseed-validate-[A-Za-z0-9_]+")

    @classmethod
    def _destamp(cls, raw: bytes) -> bytes:
        return cls.SANDBOX_RE.sub("geneseed-validate-<X>", raw.decode("utf-8")).encode("utf-8")

    def _both(self, flags):
        env = dict(os.environ, PYTHONUTF8="1")
        ref = subprocess.run([sys.executable, "build.py", "--validate-only", *flags],
                             capture_output=True, cwd=str(ROOT), env=env)
        new = subprocess.run([NODE, "bin/geneseed-cli.mjs", "validate", *flags],
                             capture_output=True, cwd=str(ROOT), env=env)
        return ref, new

    def test_every_case_agrees_on_stdout_stderr_and_the_exit_code(self):
        for flags in VALIDATE_CASES:
            with self.subTest(flags=" ".join(flags)):
                ref, new = self._both(flags)
                self.assertEqual(self._destamp(ref.stdout), self._destamp(new.stdout))
                self.assertEqual(self._destamp(ref.stderr), self._destamp(new.stderr))
                self.assertEqual(ref.returncode, new.returncode)

    def test_the_destamp_only_removes_the_one_thing_it_claims(self):
        """A normaliser that ate more than the random suffix would make the comparison above
        pass on outputs that genuinely differ — the standing lesson of this port's harnesses.
        So it is measured: the reference's own stdout must still name the sandbox root, and
        the substitution must fire exactly where it is supposed to."""
        ref, _ = self._both(VALIDATE_CASES[0])
        raw = ref.stdout.decode("utf-8")
        self.assertIn("geneseed-validate-", raw)
        self.assertEqual(len(self.SANDBOX_RE.findall(raw)), 1)
        self.assertIn("geneseed-validate-<X>", self._destamp(ref.stdout).decode("utf-8"))

    def test_the_reference_says_something_in_each_case(self):
        """Absolute, for the reason every comparison in this port needs one: `--validate-only`
        is SILENT ON SUCCESS in the sense that matters — a stub printing the same two lines
        and skipping the scan entirely would be byte-identical here."""
        ref, _ = self._both(VALIDATE_CASES[0])
        text = ref.stdout.decode("utf-8")
        self.assertIn("[validate-only] theme=neutral emit=files footprint=lean", text)
        self.assertRegex(text, r"\[validate-only\] would write [1-9]\d+ file\(s\) under Harness")
        self.assertIn("nothing was actually written (sandboxed).", text)
        self.assertIn("[validate-only] ok — would render and emit cleanly", text)
        self.assertEqual(ref.returncode, 0)

    def test_the_verbose_case_lists_relative_paths_under_the_right_base(self):
        ref, _ = self._both(VALIDATE_CASES[1])
        text = ref.stdout.decode("utf-8")
        self.assertIn("(root myrepo)", text)
        listed = [ln.split("would write: ", 1)[1]
                  for ln in text.splitlines() if "  would write: " in ln]
        self.assertGreater(len(listed), 20, "the -v listing is empty, so its comparison is "
                                            "vacuous")
        absolute = [p for p in listed if p.startswith(("/", "\\")) or (len(p) > 1 and p[1] == ":")]
        self.assertFalse(absolute, f"{absolute[:3]} are absolute; `relative_to(base)` did not "
                                   f"run against the directory that was scanned")

    def test_nothing_survives_the_sandbox(self):
        """The whole promise of the verb: no marker, no manifest, no registry row, and not one
        file under the `--out` it names."""
        before = {p for p in ROOT.iterdir()}
        self._both(["--theme", "neutral", "--emit", "claude", "--out", "no-such-dir/Harness",
                    "--root", "no-such-dir"])
        self.assertFalse((ROOT / "no-such-dir").exists(),
                         "--validate-only created the directory it promised not to write to")
        self.assertEqual(before, {p for p in ROOT.iterdir()})


if __name__ == "__main__":
    unittest.main()
