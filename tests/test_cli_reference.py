"""`cli.json` — the gates a doctor check and a cell cannot give.

P10c made `harness.build_argparser()`'s metadata a FILE both implementations read, because
Node cannot introspect argparse and a hand-written twin would have been the largest
copy-of-a-value-under-test in the port. Three things then have to be true, and each is true
for a different reason and needs a different gate:

  * **the file describes the parser.** `doctor` checks a DIGEST of `rituals/harness.py`, on
    both binaries, because that is the check Node can also perform — but a digest cannot see
    a hand-edited `cli.json`, and hand-editing it is the exact failure the arrangement exists
    to prevent. So the REGENERATE-AND-COMPARE lives here. It is Python-only by nature and
    that costs nothing: `python -m unittest discover -s tests` is in the acceptance loop
    beside both doctors.
  * **both implementations read it the same way.** `tests/web_golden.py` compares the `cli`
    docs page, but both sides answer it out of one file, so that comparison is close to
    vacuous by construction. The payload equality below is the direct cross-implementation
    check, and the hidden-argument assertions are the ABSOLUTE half a comparison of two
    equally-wrong readers could never supply.
  * **`bin/geneseed-cli.mjs` cannot parse anything without it.** That dependency is the price
    of not having a second transcription, and it is a real divergence from the reference,
    which has argparse compiled in. No `harness_golden` cell can hold it — a copy with no
    `cli.json` has the Node side refusing the verb and the reference running it — so the
    refusal is asserted here, absolutely, against a checkout copy with the file removed.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

import harness  # noqa: E402
import harness_golden  # noqa: E402
import golden  # noqa: E402

NODE = shutil.which("node")


def setUpModule() -> None:
    """P7b. This module emits nothing, so `tests/test_home_sandbox.py`'s derivation does not
    name it — and it was still reading the developer's machine, because the derivation
    measures in-process WRITES and the defect here was a spawned child's READ.

    A child inherits this process's environment, so a `subprocess.run` of a `bin/` entry
    resolves `~` to the real home unless the home has already moved. Every verb that
    consults the install state answers differently on a laptop with Geneseed installed than
    on a clean one, and a test that does not care which is a test whose result is the
    machine's. See `test_the_same_copy_with_the_file_present_runs` for the one that did.
    """
    golden.sandbox_process_home()


def tearDownModule() -> None:
    golden.restore_process_home()


def _node_json(src: str, cwd: Path = ROOT) -> object:
    r = subprocess.run([NODE, "--input-type=module", "-e", src], cwd=str(cwd),
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise AssertionError(f"node failed: {r.stderr[-1500:]}")
    return json.loads(r.stdout)


class TheFileIsWhatTheParserProduces(unittest.TestCase):
    def test_the_committed_file_is_what_the_parser_produces(self):
        """The gate a digest cannot be. Regenerate in memory and byte-compare.

        This is what makes `cli.json` a GENERATED file rather than a hand-written one that
        happens to have been generated once. `tests/gen_cli_reference.py` writes exactly
        these bytes, so a failure here has one fix and the message names it."""
        want = {"source_sha256": harness.cli_source_digest(),
                **harness.build_cli_reference(harness.build_argparser())}
        text = json.dumps(want, indent=2, ensure_ascii=False) + "\n"
        got = harness.CLI_JSON.read_text(encoding="utf-8")
        self.assertEqual(text, got,
                         "cli.json no longer matches rituals/harness.py's parser — run "
                         "`python tests/gen_cli_reference.py` and commit the result")

    def test_the_digest_names_the_file_the_parser_lives_in(self):
        """The positive control for doctor's check, and the reason it is not vacuous.

        `_cli_reference_problems` returns `[]` on a clean tree, and so would a stub. This
        asserts the two halves it compares are really the committed digest and a live hash of
        `rituals/harness.py` — the file `build_argparser` is defined in."""
        recorded = json.loads(harness.CLI_JSON.read_text(encoding="utf-8"))["source_sha256"]
        self.assertEqual(recorded, harness.cli_source_digest())
        self.assertEqual(len(recorded), 64)
        self.assertEqual(harness._cli_reference_problems(), [])
        # And it MOVES with the parser: a byte appended to harness.py must change the digest.
        # Computed from the bytes rather than by writing to the checkout.
        import hashlib
        moved = hashlib.sha256(
            (ROOT / "rituals" / "harness.py").read_bytes().replace(b"\r\n", b"\n")
            + b"\n# drift\n").hexdigest()
        self.assertNotEqual(moved, recorded)

    def test_the_file_carries_the_arguments_argparse_hides(self):
        """The FILE is the whole parser; the PAGE is a view of it. This is the direction the
        payload comparison cannot state, and the one the Node CLI breaks without.

        `help=argparse.SUPPRESS` arguments used to be dropped by the walk entirely. Four of
        them bind real values, and `bin/geneseed-cli.mjs` mis-parses every one of these
        spellings without them: `upgrade v1 imperial`, `sync-self v1`,
        `bootstrap main imperial`, `web --daemon-internal` (which tests/web_golden.py passes
        95 times a run)."""
        data = json.loads(harness.CLI_JSON.read_text(encoding="utf-8"))
        by_name = {c["name"]: c for c in data["commands"]}
        hidden = {(c["name"], a["dest"])
                  for c in data["commands"]
                  for a in c["positionals"] + c["options"] if a["hidden"]}
        for want in (("upgrade", "ref"), ("sync-self", "ref"),
                     ("bootstrap", "extra"), ("web", "daemon_internal")):
            self.assertIn(want, hidden, f"{want} is not in cli.json as a hidden argument")
        # And the two fields the old walk never carried, each with exactly one consumer.
        port = next(a for a in by_name["web"]["options"] if a["dest"] == "port")
        self.assertEqual(port["type"], "int", "`--port` must be typed, or `--port abc` "
                                              "silently binds the default 4747")
        self.assertEqual(by_name["theme"]["mutex"],
                         [["--solid-only", "--transparent-only"]],
                         "the mutually exclusive group must survive, or the Node entry "
                         "accepts a pair argparse refuses")

    def test_the_page_is_the_file_minus_what_argparse_hides(self):
        """The other direction: nothing hidden reaches the docs payload, and neither does the
        generator's own bookkeeping. Asserted against the REFERENCE's reader."""
        page = harness.load_cli_reference()
        blob = json.dumps(page)
        self.assertNotIn("daemon-internal", blob)
        self.assertNotIn('"hidden"', blob)
        self.assertNotIn('"mutex"', blob)
        for command in page["commands"]:
            for arg in command["positionals"] + command["options"]:
                self.assertNotIn("hidden", arg)
                self.assertNotIn("type", arg)
        # 26 invocable names — 25 subparsers plus argparse's `update` alias, which carries no
        # help of its own because `_choices_actions` registers the text under the canonical
        # name only. Both readers inherit that, and the Node entry dispatches `update`
        # BECAUSE of it. (24 subparsers until P10d added `migrate`.)
        self.assertEqual(len(page["commands"]), 26)
        alias = next(c for c in page["commands"] if c["name"] == "update")
        self.assertEqual(alias["help"], "")


class TheRecordingIsWhatTheParserAnswers(unittest.TestCase):
    """`tests/__snapshots__/` — what P2's transcription has to reproduce once this file's
    subject is deleted.

    Everything here is Python-only BY NATURE and that costs nothing, exactly as the
    regenerate-and-compare above: the oracle is argparse, and the point of the recording is to
    outlive it. `tests/cli_help.test.mjs` replays the same fixtures against the port from
    `node --test`, on both runners. What lives HERE is only what needs the reference alive:
    that the recording still matches the parser, and that the port's one simplification is
    still standing on a dead branch.
    """

    SNAP = ROOT / "tests" / "__snapshots__"

    def test_the_recorded_reference_is_cli_json_minus_the_deleted_files_digest(self):
        live = json.loads(harness.CLI_JSON.read_text(encoding="utf-8"))
        recorded = json.loads((self.SNAP / "cli_reference.json").read_text(encoding="utf-8"))
        self.assertIn("source_sha256", live)
        self.assertNotIn("source_sha256", recorded,
                         "the recording froze a digest of `rituals/harness.py`, a file this "
                         "migration deletes — the claim would outlive its subject")
        del live["source_sha256"]
        self.assertEqual(recorded, live,
                         "the recording is stale — run `python tests/record_help.py "
                         "tests/__snapshots__` and commit the result")

    def test_the_recorded_help_is_still_what_the_parser_prints(self):
        """The gate that keeps the corpus from quietly going stale.

        A help string edited in `rituals/harness.py` changes what argparse renders and changes
        nothing else in this suite — `tests/harness_golden.py` has zero `--help` cells, which
        is why this surface had never been compared at all. Without this, the fixtures would
        stop describing the parser on the first such edit and no run would say so."""
        import record_help  # noqa: PLC0415 — the recorder is the owner of the COLUMNS pin
        meta = json.loads((self.SNAP / "help" / "_recorded_with.json")
                          .read_text(encoding="utf-8"))
        self.assertEqual(record_help.COLUMNS, meta["columns"],
                         "the recorder's pinned width has moved since the recording")
        subs = record_help._subparsers(harness.build_argparser())
        self.assertEqual(sorted(subs), sorted(meta["verbs"]))
        self.assertEqual(len(meta["verbs"]), 26)
        # Through the recorder's own fenced helper, so this comparison renders at the width the
        # corpus was recorded at rather than at whatever the test runner's terminal is.
        live = record_help.help_texts(subs, meta["verbs"])
        for name in meta["verbs"]:
            self.assertEqual(subs[name].prog, meta["progs"][name])
            self.assertEqual(
                live[name],
                (self.SNAP / "help" / f"{name}.txt").read_text(encoding="utf-8"),
                f"`{name} --help` has moved since it was recorded — re-record with "
                f"`python tests/record_help.py tests/__snapshots__`")

    def test_the_recorded_reference_carries_the_hidden_surface(self):
        """What a careless transcription drops, asserted on the RECORDING rather than on the
        live file — the recording is what P2 reads, and a gate on the live file says nothing
        about the copy that outlives it.

        FIVE, NOT FOUR. The four `help=argparse.SUPPRESS` arguments this suite has asserted by
        CONTAINMENT since P10c are `upgrade ref`, `sync-self ref`, `bootstrap extra` and
        `web daemon_internal` — and `update` carries a fifth, because argparse's alias is a
        second command row in `cli.json` with its own copy of `upgrade`'s positionals. An
        equality found it; four `assertIn`s could not."""
        rec = json.loads((self.SNAP / "cli_reference.json").read_text(encoding="utf-8"))
        hidden = sorted((c["name"], a["dest"]) for c in rec["commands"]
                        for a in c["positionals"] + c["options"] if a["hidden"])
        self.assertEqual(hidden, [("bootstrap", "extra"), ("sync-self", "ref"),
                                  ("update", "ref"), ("upgrade", "ref"),
                                  ("web", "daemon_internal")])
        by_name = {c["name"]: c for c in rec["commands"]}
        port = next(a for a in by_name["web"]["options"] if a["dest"] == "port")
        self.assertEqual(port["type"], "int", "`--port` must be typed, or `--port abc` "
                                              "silently binds the default 4747")
        self.assertEqual(by_name["theme"]["mutex"], [["--solid-only", "--transparent-only"]])

    @unittest.skipIf(NODE is None, "node is not on PATH")
    def test_the_ports_line_breaker_is_textwrap_at_every_width(self):
        """`js/cli.mjs`'s `pyTextWrap` against the `textwrap.wrap` argparse calls, over the help
        strings this parser actually carries, at every width the renderer can choose.

        THE FIRST DRAFT OF THIS WAS A GREEDY SPACE-ONLY WRAP AND THIS TEST REFUSED IT. `textwrap`
        splits a hyphenated word into two chunks, so it can break a line inside `back-compat`
        where a space-only wrap cannot. 26 recorded fixtures at width 78 could not see it —
        every one of them still matched — and the sweep below found all 38 help strings
        disagreeing somewhere, the widest at 175. A corpus at ONE width is not evidence about
        an algorithm; this is P5c's rule for a language primitive, and the answer is the same:
        reproduce it, gate it with a corpus rather than a cell.

        The width band is the renderer's whole range: `_format_action`'s help column floors at
        11, and 198 is what a 200-column terminal gives. The recorded corpus only ever exercises
        54..64 of it.

        THE ORACLE IS PINNED TO POST-gh-139065 `textwrap`, BECAUSE THE PATCH DIGIT IS NOT AN
        ANSWER. This sweep computes `want` from the RUNNING interpreter's `textwrap`, and
        `textwrap` is not frozen: gh-139065 (main 1c598e0, 3.13 backport b1bc743, first shipped
        in 3.13.14) stopped `_handle_long_word` appending an empty chunk to a line that is
        already exactly `width` long, which changed whether the line keeps its trailing space.
        `ci.yml` pins `python-version: "3.13"`, which setup-python resolves to the newest patch,
        so an unpinned oracle reported OK on a 3.13.5 workstation and named a real divergence on
        CI's 3.13.14 — the same gate, two verdicts, and neither machine at fault. The port
        targets FIXED `textwrap` (the old behaviour is the bug CPython fixed), so on an
        interpreter older than the fix the upstream one-liner is applied here. Detected by
        BEHAVIOUR rather than by `sys.version_info`, so a distro backport is read correctly."""
        import re
        import textwrap

        class _Gh139065(textwrap.TextWrapper):
            """`if self.break_long_words and space_left > 0:` — the whole of the upstream fix.

            Returning early is exactly equivalent to failing that condition: the `elif not
            cur_line` arm below it is unreachable when `space_left <= 0`, because an empty
            `cur_line` has `cur_len == 0` and so `space_left == width` (or 1 when width < 1)."""

            def _handle_long_word(self, reversed_chunks, cur_line, cur_len, width):
                if (1 if width < 1 else width - cur_len) <= 0:
                    return
                super()._handle_long_word(reversed_chunks, cur_line, cur_len, width)

        # A line of exactly `width` followed by a word too long for any line: 'ab ' pre-fix.
        pre_fix = textwrap.wrap("ab cdefgh", 3)[0] == "ab "
        wrapper = _Gh139065 if pre_fix else textwrap.TextWrapper
        self.assertEqual(wrapper(width=3).wrap("ab cdefgh"), ["ab", "cde", "fgh"],
                         "the oracle is not post-gh-139065, so this sweep measures the "
                         "interpreter's patch digit rather than the port")

        data = json.loads(harness.CLI_JSON.read_text(encoding="utf-8"))
        texts = ["show this help message and exit"]  # argparse's own, absent from the file
        for c in data["commands"]:
            texts += [a["help"] for a in c["positionals"] + c["options"] if a["help"]]
        # `_whitespace_matcher` is `re.ASCII`, so this is the string `_split_lines` is handed.
        cases = [t for t in (re.sub(r"\s+", " ", raw, flags=re.ASCII).strip() for raw in texts)
                 if t]
        self.assertGreater(len(cases), 30, "the corpus collapsed, so this measured nothing")
        widths = list(range(11, 199))
        want = [[wrapper(width=w).wrap(t) for w in widths] for t in cases]
        got = _node_json(
            "import {pyTextWrap} from './js/cli.mjs';"
            f"const cases = {json.dumps(cases)}, widths = {json.dumps(widths)};"
            "process.stdout.write(JSON.stringify("
            "  cases.map((t) => widths.map((w) => pyTextWrap(t, w)))));")
        for i, t in enumerate(cases):
            for j, w in enumerate(widths):
                self.assertEqual(got[i][j], want[i][j],
                                 f"width {w}: the port's line breaker disagrees with "
                                 f"textwrap.wrap on {t!r}")
        self.assertGreater(len(cases) * len(widths), 1000)


@unittest.skipIf(NODE is None, "node is not on PATH")
class BothImplementationsReadTheSameFile(unittest.TestCase):
    def test_the_two_digests_agree(self):
        """The primitive, compared directly. Both sides normalise CRLF before hashing, and a
        side that forgot would report drift on a machine that has none — invisible in this
        working tree, where `rituals/harness.py` happens to be LF."""
        got = _node_json("import {cliSourceDigest} from './js/cli.mjs';"
                         "process.stdout.write(JSON.stringify(cliSourceDigest()));")
        self.assertEqual(got, harness.cli_source_digest())

    def test_the_two_digests_agree_on_a_crlf_file(self):
        """The corpus the working tree cannot be.

        `rituals/harness.py` is LF here, so the test above passes for an implementation that
        never normalises anything — the mutation is green for a reason that is about the
        INPUTS, not the code. A CRLF file and its LF twin must hash the SAME on both sides,
        and the reference's own answer is what both are checked against. Without this, a
        Windows checkout whose `.py` files came out CRLF would see doctor report permanent
        drift against a digest recorded on an LF machine, and no gate would have said so."""
        body = "def build_argparser():\n    pass\n# é\n"
        with tempfile.TemporaryDirectory() as tmp:
            lf = Path(tmp) / "lf.py"
            crlf = Path(tmp) / "crlf.py"
            lf.write_bytes(body.encode("utf-8"))
            crlf.write_bytes(body.replace("\n", "\r\n").encode("utf-8"))
            want = harness.cli_source_digest(lf)
            self.assertEqual(harness.cli_source_digest(crlf), want,
                             "the reference's digest is line-ending sensitive")
            got = _node_json(
                "import {cliSourceDigest} from './js/cli.mjs';"
                f"process.stdout.write(JSON.stringify([{json.dumps(str(lf))},"
                f" {json.dumps(str(crlf))}].map(cliSourceDigest)));")
            self.assertEqual(got, [want, want],
                             "the port's digest disagrees with the reference on a CRLF file")

    def test_the_two_readers_produce_the_same_page(self):
        got = _node_json("import {cliReference} from './js/cli.mjs';"
                         "process.stdout.write(JSON.stringify(cliReference()));")
        self.assertEqual(got, harness.load_cli_reference())

    def test_every_verb_the_entry_dispatches_has_a_spec(self):
        """`bin/geneseed-cli.mjs`'s `VERBS` rows are `{ fn }` since P10c; everything argparse
        knows comes from `cliSpec()`. A verb the file does not describe would reach `parse`
        with no rules — which accepts every token and binds none — so the entry refuses it,
        and this says the refusal is never the normal path."""
        verbs = sorted(harness_golden_cli_verbs())
        self.assertTrue(verbs, "the VERBS scrape found nothing, so this is vacuous")
        got = _node_json(
            "import {cliSpec} from './js/cli.mjs';"
            f"const vs = {json.dumps(verbs)};"
            "process.stdout.write(JSON.stringify(vs.filter((v) => cliSpec(v) === null)));")
        self.assertEqual(got, [], "cli.json describes no subcommand for these verbs")


def harness_golden_cli_verbs() -> set[str]:
    """`bin/geneseed-cli.mjs`'s table, through the scraper that already owns the regex."""
    import test_hook_cli_parity
    return test_hook_cli_parity.cli_verbs()


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheEntryRefusesWithoutIt(unittest.TestCase):
    """The divergence the port bought, asserted where a cell cannot reach it.

    The reference compiles its parser in; this entry reads it. So a tree with no `cli.json`
    is the one state where the two answer differently ON PURPOSE, and a `harness_golden` cell
    would only report the difference as a failure. What must hold is that the Node side
    REFUSES — loudly, with the fix in the message — rather than parsing with an empty spec,
    which would accept every token and bind none of them: `uninstall --target X` would run
    against the default target while the operator believes they named one.
    """

    def test_the_entry_refuses_when_the_parser_metadata_is_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "checkout"
            harness_golden._copy_checkout(copy, {"cli.json": None})
            self.assertFalse((copy / "cli.json").exists())
            r = subprocess.run(
                [NODE, str(copy / "bin" / "geneseed-cli.mjs"), "uninstall", "--target", "X"],
                cwd=str(copy), capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 2, f"expected a refusal, got {r.returncode}: "
                                              f"{r.stdout[-500:]}{r.stderr[-500:]}")
            self.assertIn("cli.json describes no subcommand 'uninstall'", r.stderr)
            self.assertIn("python tests/gen_cli_reference.py", r.stderr)
            # The absolute half: it refused rather than proceeding with no rules.
            self.assertNotIn("[uninstall]", r.stdout)

    def test_the_same_copy_with_the_file_present_runs(self):
        """The control this refusal needs, and the reason it is beside it: a copy that could
        not run ANY verb would produce the same exit code for a reason that has nothing to do
        with `cli.json`.

        ⚠ IT USED TO READ THE DEVELOPER'S MACHINE, and P7a found it. The verb was `exclude
        list`, which exits 0 when a global install exists and 1 with `[geneseed] no global
        install found.` when none does — so this control passed on a laptop with Geneseed
        installed and failed everywhere else, including under this suite's own home sandbox.
        A control whose answer depends on the machine is not a control.

        `version` replaces it because its exit code is a property of the COPY: it reads the
        copy's own `Harness/` and its source fingerprint, and answers 0 whether or not the
        machine has anything installed. What the control has to prove is that the entry
        PARSED a verb out of `cli.json` and dispatched it, and `version` proves that as well
        as any verb with side effects would — better, since it has none.
        """
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "checkout"
            harness_golden._copy_checkout(copy, {})
            r = subprocess.run([NODE, str(copy / "bin" / "geneseed-cli.mjs"), "version"],
                               cwd=str(copy), capture_output=True, text=True,
                               encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr[-800:])
            self.assertNotIn("cli.json describes no subcommand", r.stderr)
            # The absolute half: it ran the verb rather than exiting 0 without doing so.
            self.assertIn("[version]", r.stdout)


if __name__ == "__main__":
    unittest.main()
