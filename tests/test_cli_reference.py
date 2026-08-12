"""`js/cli-table.json` — the gates a doctor check and a cell cannot give.

P10c made `harness.build_argparser()`'s metadata a FILE both implementations read, because
Node cannot introspect argparse and a hand-written twin would have been the largest
copy-of-a-value-under-test in the port. P2 moved that file to a product path and made it the
OWNED document: nothing generates it any more, and doctor's digest of `rituals/harness.py`
went with the generator, because a digest is a claim about a file this migration deletes.

THIS MODULE IS WHAT THE DIGEST WAS STANDING IN FOR, and it is strictly stronger. Three things
have to be true, each for a different reason and each needing a different gate:

  * **the table still describes the parser.** The ARGPARSE-VS-TABLE EQUALITY below is the only
    one of these gates that walks `build_argparser()` — it is what catches a wrong `nargs` on
    a flag no recorded cell exercises, and unlike a digest it also sees a HAND EDIT. It is
    Python-only by nature and that costs nothing: `python -m unittest discover -s tests` is in
    the acceptance loop beside both doctors. It must exist before `rituals/harness.py` goes,
    and this is the phase that can still write it. After the parser is deleted the table is
    simply the source of truth and is edited directly.
  * **both implementations read it the same way.** `tests/web_golden.py` compares the `cli`
    docs page, but both sides answer it out of one file, so that comparison is close to
    vacuous by construction. The payload equality below is the direct cross-implementation
    check, and the hidden-argument assertions are the ABSOLUTE half a comparison of two
    equally-wrong readers could never supply.
  * **`bin/geneseed-cli.mjs` cannot parse anything without it.** That dependency is the price
    of not having a second transcription, and it is a real divergence from the reference,
    which has argparse compiled in. No `harness_golden` cell can hold it — a copy with no
    table has the Node side refusing the verb and the reference running it — so the refusal is
    asserted here, absolutely, against a checkout copy with the file removed.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
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


class _Gh139065(textwrap.TextWrapper):
    """`if self.break_long_words and space_left > 0:` — the whole of the upstream fix.

    Returning early is exactly equivalent to failing that condition: the `elif not cur_line`
    arm below it is unreachable when `space_left <= 0`, because an empty `cur_line` has
    `cur_len == 0` and so `space_left == width` (or 1 when width < 1).

    AT MODULE SCOPE because there are now TWO sweeps that need the oracle normalised — the line
    breaker itself and the whole formatter that calls it — and an oracle correction defined
    inside one of them is an oracle correction the other silently does without.
    """

    def _handle_long_word(self, reversed_chunks, cur_line, cur_len, width):
        if (1 if width < 1 else width - cur_len) <= 0:
            return
        super()._handle_long_word(reversed_chunks, cur_line, cur_len, width)


#: True on an interpreter older than the gh-139065 backport (3.13.14). Detected BY BEHAVIOUR —
#: a line of exactly `width` followed by a word too long for any line yields 'ab ' pre-fix — so
#: a distro backport is read correctly and `sys.version_info` is never consulted.
_PRE_GH139065 = textwrap.wrap("ab cdefgh", 3)[0] == "ab "


def _node_json(src: str, cwd: Path = ROOT) -> object:
    r = subprocess.run([NODE, "--input-type=module", "-e", src], cwd=str(cwd),
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise AssertionError(f"node failed: {r.stderr[-1500:]}")
    return json.loads(r.stdout)


class TheFileIsWhatTheParserProduces(unittest.TestCase):
    def test_the_committed_table_is_what_the_parser_describes(self):
        """THE ARGPARSE-VS-TABLE EQUALITY — the gate P2's design would have deleted, and the
        one that has to exist before `rituals/harness.py` does not.

        A digest of the parser's FILE could only ever say "the source moved". This walks the
        parser itself, so it also sees a hand edit to the table — and it is the only thing in
        the tree that catches a wrong `nargs` on a flag no recorded cell exercises, since
        `nargs` only shows up in behaviour when a user spells the argument that way.

        BOTH DIRECTIONS, AND FIELD FOR FIELD FIRST. The byte equality at the end is the
        stricter claim (key order and indentation are part of what a hand edit breaks), but a
        900-line text diff names nothing; the per-command comparisons above it fail with the
        verb in the message."""
        want = harness.build_cli_reference(harness.build_argparser())
        got = json.loads(harness.CLI_JSON.read_text(encoding="utf-8"))
        fix = ("— `js/cli-table.json` is the owned document now, so edit it to match the "
               "parser (or, after `rituals/harness.py` is gone, edit it and delete this gate)")
        self.assertEqual(got.get("prog"), want["prog"], f"the table's `prog` moved {fix}")
        self.assertEqual([c["name"] for c in got.get("commands", [])],
                         [c["name"] for c in want["commands"]],
                         f"the table and the parser disagree on which commands exist {fix}")
        for w, g in zip(want["commands"], got["commands"]):
            with self.subTest(command=w["name"]):
                self.assertEqual(g, w, f"`{w['name']}` in the table is not what "
                                       f"`build_argparser()` describes {fix}")
        # The bytes, so the serialisation cannot drift even when every field agrees.
        self.assertEqual(harness.CLI_JSON.read_text(encoding="utf-8"),
                         harness.serialise_cli_reference(harness.build_argparser()),
                         f"the table's fields match but its BYTES do not {fix}")

    def test_the_file_carries_the_arguments_argparse_hides(self):
        """The FILE is the whole parser; the PAGE is a view of it. This is the direction the
        payload comparison cannot state, and the one the Node CLI breaks without.

        `help=argparse.SUPPRESS` arguments used to be dropped by the walk entirely. Each binds
        a real value, and `bin/geneseed-cli.mjs` mis-parses every one of these spellings
        without them: `upgrade v1 imperial`, `sync-self v1`, `bootstrap main imperial`,
        `web --daemon-internal` (which tests/web_golden.py passes 95 times a run).

        FIVE, NOT FOUR, AND THEREFORE AN EQUALITY. This suite asserted the four by CONTAINMENT
        from P10c until P1's recording, and containment could not see that `update` carries
        `upgrade`'s hidden `ref` as well — argparse's alias is a second command ROW with its
        own copy of both positionals, and a reader that dropped it would mis-parse
        `geneseed update v1 imperial` while `upgrade` stayed correct. The equality lived on
        the recording until P2 made the table the single document; it lives here now."""
        data = json.loads(harness.CLI_JSON.read_text(encoding="utf-8"))
        by_name = {c["name"]: c for c in data["commands"]}
        hidden = sorted((c["name"], a["dest"])
                        for c in data["commands"]
                        for a in c["positionals"] + c["options"] if a["hidden"])
        self.assertEqual(hidden, [("bootstrap", "extra"), ("sync-self", "ref"),
                                  ("update", "ref"), ("upgrade", "ref"),
                                  ("web", "daemon_internal")],
                         "a hidden argument was dropped from the table, or an unexpected "
                         "one appeared")
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

        wrapper = _Gh139065 if _PRE_GH139065 else textwrap.TextWrapper
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
    def test_the_whole_formatter_agrees_at_every_width(self):
        """THE SAME RULE, APPLIED ONE LEVEL UP — and it found a real divergence the moment it
        was written.

        The sweep above was built for `pyTextWrap` and scoped by its author to "a language
        primitive". The formatter that CALLS it was gated at exactly one width: all 26 fixtures
        are recorded at `COLUMNS=80`, so `tests/cli_help.test.mjs` replays 26 texts at one wrap
        column and `docs/declined.md`'s claim that "argparse's entire layout — usage assembly,
        the wrapped continuation indent, the two-column help position, the wrap column — is
        gated against the reference" was true of one number.

        WHAT IT CAUGHT. `formatHelp` emitted a mutually exclusive group as ONE atomic usage
        part; `_get_actions_usage_parts` decorates the members in place and returns TWO
        (`['[--solid-only |', '--transparent-only]']`), so argparse can break a line INSIDE the
        group and the port could not. `theme` diverged at 73 of these 181 widths — 64 of them in
        the `if` arm `_format_usage` takes for a short prog, i.e. the arm the corpus does
        exercise, just never at a width where the group straddles the wrap column.

        WIDTH IS THE AXIS, so the band is `COLUMNS` rather than the derived wrap column:
        `helpWidth()`/`get_terminal_size().columns - 2` is the conversion, and passing the
        terminal value in is what makes the two sides answer the same question. 20 is below
        every prog this parser ships (`_format_usage`'s narrow arm) and 200 is a wide terminal.

        The oracle is normalised the same way the line-breaker sweep normalises it — a pre-
        gh-139065 `textwrap` would otherwise make this measure the interpreter's patch digit,
        and `format_help` reaches `textwrap.wrap` through a fresh module lookup, so patching the
        module attribute is enough."""
        import record_help  # noqa: PLC0415 — the owner of the COLUMNS fence

        real_wrap = textwrap.wrap

        def _fixed_wrap(text, width=70, **kw):
            return _Gh139065(width=width, **kw).wrap(text)

        subs = record_help._subparsers(harness.build_argparser())
        names = sorted(subs)
        self.assertEqual(len(names), 26, "the verb set collapsed, so this measured nothing")
        widths = list(range(20, 201))
        was = os.environ.get("COLUMNS")
        want: "dict[str, list[str]]" = {}
        try:
            if _PRE_GH139065:
                textwrap.wrap = _fixed_wrap
            for name in names:
                rows = []
                for w in widths:
                    os.environ["COLUMNS"] = str(w)
                    rows.append(subs[name].format_help())
                want[name] = rows
        finally:
            textwrap.wrap = real_wrap
            if was is None:
                os.environ.pop("COLUMNS", None)
            else:
                os.environ["COLUMNS"] = was

        progs = {name: subs[name].prog for name in names}
        got = _node_json(
            "import {cliCommand, formatHelp} from './js/cli.mjs';"
            f"const names = {json.dumps(names)}, widths = {json.dumps(widths)},"
            f"  progs = {json.dumps(progs)};"
            "process.stdout.write(JSON.stringify(Object.fromEntries(names.map((n) =>"
            "  [n, widths.map((w) => formatHelp(cliCommand(n), progs[n], w - 2))]))));")
        for name in names:
            for j, w in enumerate(widths):
                self.assertEqual(
                    got[name][j], want[name][j],
                    f"`{name} --help` at COLUMNS={w}: the port's formatter disagrees with "
                    f"argparse\n--- argparse ---\n{want[name][j]}\n--- port ---\n{got[name][j]}")
        self.assertGreater(len(names) * len(widths), 4000)

    #: `$COLUMNS` values that separate `int()` from `Number.parseInt`, plus the ones that
    #: separate the ENV branch from the terminal fallback. Every row here is a value a shell
    #: can really export, and each one used to take a different path in the two
    #: implementations — `parseInt('80abc')` is 80 where `int` raises and Python falls through
    #: to the terminal, then to 80, at a DIFFERENT width. `''` and the unset case are the
    #: fallback itself; both sides see a pipe, so both answer 80 - 2.
    COLUMNS_CORPUS = ("80", " 80 ", "80abc", "0x50", "1_0", "٣", "0", "-5", "+90", "",
                      "  ", "9999", "1.5", "abc")

    @unittest.skipIf(NODE is None, "node is not on PATH")
    def test_the_ports_help_width_is_shutil_get_terminal_size(self):
        """`helpWidth()` against `shutil.get_terminal_size().columns - 2`, over the values that
        tell `int()` from `Number.parseInt`.

        THE THIRD CALLER `pyInt`'s DOCBLOCK DID NOT HAVE. It says "surrounding whitespace is
        Python's to strip and both callers have already done it" — `$COLUMNS` arrives however
        the shell set it, so this one strips first. And the port reached for `parseInt` in a
        tree that already owned `pyInt` for exactly this, which is the whole finding: every
        help assertion in `tests/cli_help.test.mjs` runs at `COLUMNS=80`, so both the env-parse
        branch and the fallback were exercised at one value each.

        BOTH SIDES ARE SPAWNED WITH A PIPE, which pins the fallback: `os.get_terminal_size` on
        a pipe raises OSError and `shutil` answers 80, and `process.stdout.columns` is
        undefined and this port answers 80. That is the same 80 for the same reason, not a
        coincidence to be tolerated."""
        env_base = {k: v for k, v in os.environ.items() if k != "COLUMNS"}
        for raw in self.COLUMNS_CORPUS:
            env = dict(env_base)
            if raw:
                env["COLUMNS"] = raw
            with self.subTest(columns=raw):
                py = subprocess.run(
                    [sys.executable, "-c",
                     "import shutil,sys; "
                     "sys.stdout.write(str(shutil.get_terminal_size().columns - 2))"],
                    cwd=str(ROOT), env=env, capture_output=True, text=True, encoding="utf-8")
                node = subprocess.run(
                    [NODE, "--input-type=module", "-e",
                     "import {helpWidth} from './js/cli.mjs';"
                     "process.stdout.write(String(helpWidth()));"],
                    cwd=str(ROOT), env=env, capture_output=True, text=True, encoding="utf-8")
                self.assertEqual((py.returncode, node.returncode), (0, 0),
                                 f"a probe failed:\n{py.stderr}\n{node.stderr}")
                self.assertEqual(node.stdout, py.stdout,
                                 f"COLUMNS={raw!r}: the port renders help at width "
                                 f"{node.stdout} where argparse would use {py.stdout}")
        # The vacuity guard: a corpus every row of which answered 78 would prove nothing about
        # the parse at all.
        self.assertGreater(len({
            subprocess.run([sys.executable, "-c",
                            "import shutil,sys; "
                            "sys.stdout.write(str(shutil.get_terminal_size().columns - 2))"],
                           cwd=str(ROOT),
                           env={**env_base, **({"COLUMNS": r} if r else {})},
                           capture_output=True, text=True, encoding="utf-8").stdout
            for r in self.COLUMNS_CORPUS}), 2,
            "every corpus row produced the same width — the parse branch is untested")


@unittest.skipIf(NODE is None, "node is not on PATH")
class BothImplementationsReadTheSameFile(unittest.TestCase):
    def test_both_sides_read_the_same_path(self):
        """The one thing a payload equality cannot state: that the two readers are looking at
        the SAME FILE. Both would agree on an empty reference if both had lost it, and P2 moved
        the path, so this is the assertion that says the move landed on both sides."""
        got = _node_json("import {cliReference} from './js/cli.mjs';"
                         "import {readFileSync} from 'node:fs';"
                         "import path from 'node:path';"
                         "import {ROOT} from './js/checkout.mjs';"
                         "const p = path.join(ROOT, 'js', 'cli-table.json');"
                         "process.stdout.write(JSON.stringify("
                         "  [JSON.parse(readFileSync(p, 'utf-8')).commands.length,"
                         "   cliReference().commands.length]));")
        self.assertEqual(harness.CLI_JSON, ROOT / "js" / "cli-table.json",
                         "the reference reads a different file from the port")
        self.assertEqual(got, [26, 26], "the port's table is not the 26-row document the "
                                        "reference reads")

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
        self.assertEqual(got, [], "js/cli-table.json describes no subcommand for these verbs")


def harness_golden_cli_verbs() -> set[str]:
    """`bin/geneseed-cli.mjs`'s table, through the scraper that already owns the regex."""
    import test_hook_cli_parity
    return test_hook_cli_parity.cli_verbs()


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheEntryRefusesWithoutIt(unittest.TestCase):
    """The divergence the port bought, asserted where a cell cannot reach it.

    The reference compiles its parser in; this entry reads it. So a tree with no
    `js/cli-table.json` is the one state where the two answer differently ON PURPOSE, and a
    `harness_golden` cell would only report the difference as a failure. What must hold is that
    the Node side REFUSES — loudly, with the fix in the message — rather than parsing with an
    empty spec, which would accept every token and bind none of them: `uninstall --target X`
    would run against the default target while the operator believes they named one.
    """

    def test_the_entry_refuses_when_the_parser_metadata_is_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "checkout"
            harness_golden._copy_checkout(copy, {"js/cli-table.json": None})
            self.assertFalse((copy / "js" / "cli-table.json").exists())
            r = subprocess.run(
                [NODE, str(copy / "bin" / "geneseed-cli.mjs"), "uninstall", "--target", "X"],
                cwd=str(copy), capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 2, f"expected a refusal, got {r.returncode}: "
                                              f"{r.stdout[-500:]}{r.stderr[-500:]}")
            self.assertIn("js/cli-table.json describes no subcommand 'uninstall'", r.stderr)
            self.assertIn("npm i -g geneseed@latest", r.stderr)
            # The absolute half: it refused rather than proceeding with no rules.
            self.assertNotIn("[uninstall]", r.stdout)

    def test_the_same_copy_with_the_file_present_runs(self):
        """The control this refusal needs, and the reason it is beside it: a copy that could
        not run ANY verb would produce the same exit code for a reason that has nothing to do
        with `js/cli-table.json`.

        ⚠ IT USED TO READ THE DEVELOPER'S MACHINE, and P7a found it. The verb was `exclude
        list`, which exits 0 when a global install exists and 1 with `[geneseed] no global
        install found.` when none does — so this control passed on a laptop with Geneseed
        installed and failed everywhere else, including under this suite's own home sandbox.
        A control whose answer depends on the machine is not a control.

        `version` replaces it because its exit code is a property of the COPY: it reads the
        copy's own `Harness/` and its source fingerprint, and answers 0 whether or not the
        machine has anything installed. What the control has to prove is that the entry
        PARSED a verb out of the table and dispatched it, and `version` proves that as well
        as any verb with side effects would — better, since it has none.
        """
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "checkout"
            harness_golden._copy_checkout(copy, {})
            r = subprocess.run([NODE, str(copy / "bin" / "geneseed-cli.mjs"), "version"],
                               cwd=str(copy), capture_output=True, text=True,
                               encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr[-800:])
            self.assertNotIn("describes no subcommand", r.stderr)
            # The absolute half: it ran the verb rather than exiting 0 without doing so.
            self.assertIn("[version]", r.stdout)


if __name__ == "__main__":
    unittest.main()
