"""The golden harness's sandbox must actually contain the emits it runs.

tests/golden.py drives the real generator over 259 cells, ~126 of which are `*-global`
emits — emits whose whole job is to render into a host's global config dir. Its sandbox
is therefore not a tidiness measure: it is the only thing standing between an acceptance
run and the developer's own installed harness, overwritten twice per cell.

Redirecting HOME/XDG was not sufficient, and that gap went unnoticed because it only
opens for developers who set a documented knob. Every host resolver consults its own
relocation variable BEFORE the paths golden redirects (_build_core.py:84/104/116), so
`OPENCODE_CONFIG_DIR=~/geneseed-config` — the supported way to keep your harness in a
git-tracked folder — silently routed an opencode-global cell's 135 files into the real
target. These tests pin the fix, and deliberately assert on the environment rather than
on emitted output: a test that proved the leak by observing it would have to perform the
leak.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import contextlib
import io
import json
import os
import shutil
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT))
import golden  # noqa: E402
import harness_golden  # noqa: E402
import web_golden  # noqa: E402
import snapshot_io  # noqa: E402
import _build_core  # noqa: E402


class CellEnvIsolationTests(unittest.TestCase):
    def setUp(self):
        self.home = Path("sandbox-home")

    def test_relocation_vars_are_cleared_even_when_set(self):
        """The safety property, stated as the failure it prevents: with any of these
        inherited, the matching `*-global` cell renders outside the sandbox."""
        planted = {v: str(Path("definitely-not-the-sandbox") / v) for v in golden.RELOCATION_VARS}
        saved = {v: os.environ.get(v) for v in planted}
        os.environ.update(planted)
        try:
            env = golden.cell_env(self.home)
        finally:
            for v, old in saved.items():
                os.environ.pop(v, None)
                if old is not None:
                    os.environ[v] = old
        for var in golden.RELOCATION_VARS:
            self.assertNotIn(var, env, f"{var} survived into the cell environment")

    def test_every_relocation_var_the_generator_reads_is_listed(self):
        """`RELOCATION_VARS` is a hand-written list, so it can rot the moment a fifth
        host is added. Rather than trust it, re-derive the set from the resolvers'
        actual source and require the list to cover it."""
        source = Path(_build_core.__file__).read_text(encoding="utf-8")
        read = set(__import__("re").findall(
            r'environ\.get\(["\']([A-Z_]+_CONFIG_DIR)["\']\)', source))
        missing = read - set(golden.RELOCATION_VARS) - {"XDG_CONFIG_HOME"}
        self.assertEqual(missing, set(),
                         "_build_core reads a relocation variable golden does not clear")

    def test_geneseed_knobs_are_cleared_but_geneseed_home_is_kept(self):
        """The knobs that change WHAT is emitted must not vary per developer, or the
        matrix silently means something different on each machine. GENESEED_HOME is the
        one exception — golden sets it, pointing the hook shim inside the sandbox."""
        saved = {k: os.environ.get(k) for k in
                 ("GENESEED_PRIMARY", "GENESEED_COMMANDS", "GENESEED_STACK_GLOBAL",
                  "GENESEED_HARNESS")}
        os.environ.update({k: "1" for k in saved})
        try:
            env = golden.cell_env(self.home)
        finally:
            for k, old in saved.items():
                os.environ.pop(k, None)
                if old is not None:
                    os.environ[k] = old
        leaked = sorted(k for k in env if k.startswith("GENESEED_") and k != "GENESEED_HOME")
        self.assertEqual(leaked, [], f"knobs leaked into the cell environment: {leaked}")
        self.assertTrue(env["GENESEED_HOME"].startswith(str(self.home)))

    def test_home_and_xdg_point_inside_the_sandbox(self):
        env = golden.cell_env(self.home)
        for var in ("HOME", "USERPROFILE", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA",
                    "GENESEED_HOME"):
            self.assertTrue(env[var].startswith(str(self.home)),
                            f"{var}={env[var]!r} escapes the sandbox root")


class DeletionMatrixCoverageTests(unittest.TestCase):
    """A gate on the gate, in the shape `test_the_matrix_covers_every_theme_and_axis`
    already has: the deletion matrix is only worth its runtime if it reaches every prune
    there is. Free to run — it inspects the matrix, it does not emit."""

    def test_every_emit_that_prunes_has_a_deletion_cell(self):
        # Every emit but `files` writes a manifest, and a manifest is exactly what gives
        # an emit an `old_owned` to prune against. `files` has none, so `build()` has no
        # prune to exercise — that is the reason it is absent, and if it ever grows one
        # this test is where the omission surfaces.
        covered = {c["emit"] for c in golden.deletion_cells()}
        self.assertEqual(covered, set(golden.EMITS) - {"files"},
                         "an emit with a manifest has no cell that makes its prune delete")

    def test_every_cell_changes_exactly_one_axis(self):
        for cell in golden.deletion_cells():
            before = cell["before"]
            changed = [k for k in ("theme", "emit", "footprint")
                       if cell[k] != before[k]]
            self.assertEqual(len(changed), 1, f"{cell['label']}: changed {changed}")
            self.assertEqual(cell["emit"], before["emit"])


class FlagWiringTests(unittest.TestCase):
    """The narrowing flags have to REACH `compare`, and nothing else can tell you they did.

    `--repeat 2` degrades silently: if `main` stops threading it through, both sides simply
    run once each and the comparison still passes — it has quietly become the plain parity
    run while still printing a header that says otherwise. A mutation that dropped the
    wiring left the whole 63-cell gate green, which is why this exists.

    `--emits` has the same shape one step over: an unrecognised value that silently selected
    everything would report a far wider run as the narrow one it was asked for.

    Both are checked by intercepting `compare` rather than by emitting, so they cost nothing
    and cannot themselves be defeated by an emit that happens to look right.
    """

    def _capture(self, argv):
        seen = {}

        def fake_compare(ref, new, quick, limit, ref_repeat=1, new_repeat=1, matrix=None,
                         jobs=1, record=None, against=None, **kw):
            # `**kw` because a mock that mirrors a signature EXACTLY turns every new keyword
            # into a TypeError in seven unrelated tests — which is how this file greeted
            # `--record`/`--against` in Task 7 and `narrowed` here. The wiring assertions
            # below name the keys they care about; the rest are captured, not enumerated.
            seen.update(ref=ref, new=new, ref_repeat=ref_repeat, new_repeat=new_repeat,
                        matrix=matrix, jobs=jobs, record=record, against=against, **kw)
            return 0

        real, golden.compare = golden.compare, fake_compare
        try:
            rc = golden.main(argv)
        finally:
            golden.compare = real
        return rc, seen

    def test_repeat_reaches_both_sides_of_the_comparison(self):
        rc, seen = self._capture(["--quick", "--repeat", "2",
                                  "--new", "node bin/geneseed.mjs"])
        self.assertEqual(rc, 0)
        self.assertEqual((seen["ref_repeat"], seen["new_repeat"]), (2, 2),
                         "--repeat did not reach compare: the run silently degraded to a "
                         "single emit per side, which is the plain parity gate wearing the "
                         "re-emit gate's name")
        self.assertNotEqual(seen["ref"], seen["new"],
                            "--new did not reach compare either")

    def test_repeat_defaults_to_one_and_refuses_zero(self):
        _, seen = self._capture(["--quick"])
        self.assertEqual((seen["ref_repeat"], seen["new_repeat"]), (1, 1))
        rc, _ = self._capture(["--quick", "--repeat", "0"])
        self.assertEqual(rc, 2, "--repeat 0 would compare nothing and must be refused")

    def test_jobs_reaches_compare_on_every_path_and_refuses_zero(self):
        """`--jobs` degrades in the direction nobody notices: a run that silently fell back
        to one worker still compares every cell and still passes, so the only symptom is
        the clock — and nobody times a green gate. It is the same shape as `--repeat`'s
        wiring, which P4c measured going green with the wiring dropped.

        ALL THREE PATHS, because `main` has three `compare` calls and P4c's lesson was that
        a narrowing flag needs a wiring test per call site: the plain run, `--idempotent`
        and `--deletion` each thread it separately and each could stop."""
        for extra in ([], ["--idempotent"], ["--deletion"]):
            with self.subTest(mode=extra or ["plain"]):
                _, seen = self._capture(["--quick", "--jobs", "3", *extra])
                self.assertEqual(seen["jobs"], 3,
                                 "--jobs did not reach compare: the gate silently ran "
                                 "serially while its header said otherwise")
        _, seen = self._capture(["--quick"])
        self.assertEqual(seen["jobs"], golden.DEFAULT_JOBS,
                         "the default did not reach compare either")
        self.assertGreaterEqual(golden.DEFAULT_JOBS, 1)
        rc, _ = self._capture(["--quick", "--jobs", "0"])
        self.assertEqual(rc, 2, "--jobs 0 cannot build a pool and must be refused, not "
                                "clamped — a corrected typo reads as an accepted setting")

    def test_record_and_against_reach_compare_resolved_to_this_platform(self):
        """`--record`/`--against` were threaded into `compare` and the mock above was widened
        to accept them, but nothing asserted they arrive — and an unasserted wiring is how a
        flag stops being connected without anything going red. `--record` degrades in the
        worst available direction: `main` still exits 0, so a silent disconnection reads as a
        successful recording of the reference's answers right up until the reference is gone.

        The assertion is on the RESOLVED value, so it also pins the platform split. The corpus
        a Windows run records is not the corpus a Linux run replays — `pyfs.writeText` emits
        `os.linesep`, so every path's bytes differ — and `golden` picks the subdirectory
        itself rather than trusting each caller to remember."""
        expected = golden.PLATFORM_CORPUS
        self.assertIn(expected, ("crlf", "lf"))
        for flag in ("--record", "--against"):
            with self.subTest(flag=flag):
                _, seen = self._capture(["--quick", flag, "corpus-root",
                                         "--new", "node bin/geneseed.mjs"])
                key = flag.lstrip("-")
                self.assertEqual(seen[key], str(Path("corpus-root") / expected),
                                 f"{flag} did not reach compare, or did not resolve to this "
                                 "platform's corpus subdirectory")
                other = "against" if key == "record" else "record"
                self.assertIsNone(seen[other], f"{flag} also set --{other}")

    def test_emits_narrows_the_matrix_and_refuses_an_unknown_mode(self):
        _, seen = self._capture(["--emits", "files"])
        self.assertEqual({c["emit"] for c in seen["matrix"]}, {"files"})
        self.assertTrue(seen["matrix"], "--emits files selected nothing")
        rc, _ = self._capture(["--emits", "nosuchemit"])
        self.assertEqual(rc, 2, "an unknown --emits value must refuse, not select nothing")


class CorpusFlagWiringTests(unittest.TestCase):
    """The same wiring assertion as `FlagWiringTests`, for the two harnesses that grew
    `--record`/`--against` second — and it is the assertion those flags need most.

    `--record` degrades in the worst available direction: `main` still exits 0, so a silent
    disconnection reads as a successful recording of the reference's 318 CLI answers and 114
    web answers right up until `rituals/harness.py` is gone and nobody can record them again.
    `--against` degrades the other way and just as quietly — it becomes a plain live
    comparison, which passes for as long as the reference is still there to compare against.

    The assertion is on the RESOLVED value, so one test covers the wiring AND the platform
    split: a corpus recorded on Windows is not the corpus a Linux run replays (`pyfs.writeText`
    emits `os.linesep`, and `PLATFORM_ONLY` gives the two platforms different `link`/`unlink`
    cells), and each harness picks the subdirectory itself rather than trusting a caller.
    """

    def _capture(self, mod, argv, keys=("record", "against")):
        seen = {}

        def fake_compare(*args, **kw):
            seen.update({k: kw.get(k) for k in keys})
            return 0

        real, mod.compare = mod.compare, fake_compare
        try:
            rc = mod.main(argv)
        finally:
            mod.compare = real
        return rc, seen

    def test_record_and_against_reach_each_harnesses_compare(self):
        expected = golden.PLATFORM_CORPUS
        self.assertIn(expected, ("crlf", "lf"))
        # The candidate binaries every harness demands before it will replay anything. They
        # are never spawned here — `compare` is intercepted — but `main` refuses without them.
        # `golden` was ABSENT from this set until the refusal was back-ported into it, and the
        # sentence above was false while it was: the harness carrying the largest corpus was
        # the one with no such demand.
        candidate = {harness_golden: ["--new", "node bin/geneseed-hook.mjs",
                                      "--new-cli", "node bin/geneseed-cli.mjs"],
                     web_golden: ["--new", "node js/web/server.mjs"],
                     golden: ["--new", "node bin/geneseed.mjs"]}
        for mod in (harness_golden, web_golden, golden):
            for flag in ("--record", "--against"):
                with self.subTest(harness=mod.__name__, flag=flag):
                    _, seen = self._capture(mod, [flag, "corpus-root", *candidate[mod]])
                    key = flag.lstrip("-")
                    self.assertEqual(
                        seen[key], str(Path("corpus-root") / expected),
                        f"{mod.__name__}: {flag} did not reach compare, or did not resolve "
                        "to this platform's corpus subdirectory")
                    other = "against" if key == "record" else "record"
                    self.assertIsNone(seen[other],
                                      f"{mod.__name__}: {flag} also set --{other}")

    def test_the_two_flags_are_mutually_exclusive(self):
        for mod in (harness_golden, web_golden, golden):
            with self.subTest(harness=mod.__name__):
                rc, _ = self._capture(mod, ["--record", "a", "--against", "b"])
                self.assertEqual(rc, 2, f"{mod.__name__}: recording and replaying in one run "
                                        "has no meaning and must be refused")

    def test_against_without_a_candidate_is_refused(self):
        """With no candidate binary every harness falls back to the reference, and the run
        replays the REFERENCE against the reference's own recording — a determinism
        self-check wearing the regression gate's name, green by construction. `ci.yml` warns
        about the same shape for the live gate; this is the corpus half of it."""
        for mod in (harness_golden, web_golden, golden):
            with self.subTest(harness=mod.__name__):
                rc, _ = self._capture(mod, ["--against", "corpus-root"])
                self.assertEqual(rc, 2, f"{mod.__name__}: --against with no --new compares "
                                        "the reference against itself and always passes")

    def test_goldens_ref_is_a_candidate_slot_and_still_replays(self):
        """THE CORRECTION THE SIBLINGS DO NOT NEED. `tests/golden.py` differs from the other
        two: `new` falls back to `ref`, and `--ref` is a first-class flag CI already uses
        (`--ref "node bin/geneseed.mjs" --deletion`). A refusal spelt `not args.new` would
        reject a perfectly good replay of the PORT, so the guard is `not (new or ref)` — and
        this is the arm that proves the escape hatch is really open."""
        rc, seen = self._capture(golden, ["--against", "corpus-root",
                                          "--ref", "node bin/geneseed.mjs"])
        self.assertEqual(rc, 0, "--against --ref <candidate> is a valid replay of the port "
                                "and must not be refused")
        self.assertEqual(seen["against"],
                         str(Path("corpus-root") / golden.PLATFORM_CORPUS))


class ACellMissingFromTheCorpusIsAFailure(unittest.TestCase):
    """The property that makes a recorded corpus a GATE rather than a filter, asserted on
    the helper all three harnesses share.

    A cell added after the recording — a new verb, a new endpoint, a `link` cell on the
    platform whose corpus was recorded on the other one — has no entry. Skipping it silently
    is the failure this is here to refuse: the run still prints `ok`, the new cell is
    compared against nothing, and the corpus quietly stops covering the thing it was grown
    for."""

    def test_an_unrecorded_cell_fails_rather_than_being_skipped(self):
        failures = []
        golden._against_cell("no-such-corpus-dir", "verb/a-cell-nobody-recorded",
                             {"<stdout>": b"anything"}, failures)
        self.assertEqual(len(failures), 1)
        self.assertIn("NO RECORDED SNAPSHOT", failures[0])

    def test_a_recorded_cell_round_trips_and_a_changed_byte_is_reported(self):
        """The vacuity guard on the test above: "always fails" and "fails when it should"
        are the same output until something passes."""
        import tempfile
        snap = {"<stdout>": b"hello\n", "out/AGENT.md": b"body\n"}
        with tempfile.TemporaryDirectory() as td:
            golden._record_cell(td, "verb/a-cell", snap, failures := [])
            self.assertEqual(failures, [])
            golden._against_cell(td, "verb/a-cell", snap, failures)
            self.assertEqual(failures, [], "an identical replay must pass")
            golden._against_cell(td, "verb/a-cell", {**snap, "<stdout>": b"hellp\n"},
                                 failures)
            self.assertEqual(len(failures), 1, "a changed byte must be reported")
            self.assertIn("<stdout>", failures[0])
            # VERBATIM, not just a hash: the recorded text is what makes the diff reviewable
            # in a pull request, and it is the whole reason the pseudo-files are not hashed.
            self.assertIn("hello", failures[0])
            self.assertEqual(sorted(snapshot_io.read(Path(td), "verb/a-cell")["verbatim"]),
                             ["<stdout>"], "a real file must stay hashed, a pseudo-file must "
                                           "be recorded verbatim")


class ACorpusEntryNOBODYCONSUMEDIsAlsoAFailure(unittest.TestCase):
    """THE INVERSE, which no harness checked. `_against_cell` fails a cell with no snapshot;
    nothing failed a snapshot with no cell, so a matrix narrowed by an edit — or by
    `--only`/`--emits`/`--quick` on a command line — replayed green over fewer cells while the
    files it skipped stayed in git looking like proof.

    All three directions, because a check with only its positive arm tested is how a gate
    starts refusing legitimate runs and gets deleted."""

    def _corpus(self, *cell_ids):
        import tempfile
        td = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        for cid in cell_ids:
            golden._record_cell(td, cid, {"<stdout>": b"x"}, [])
        return td

    def test_a_full_run_is_clean(self):
        td = self._corpus("verb/one", "verb/two")
        self.assertIsNone(golden.orphan_check(td, {"verb/one", "verb/two"}, None))

    def test_a_narrowed_run_leaves_the_corpus_orphaned_and_says_so(self):
        td = self._corpus("verb/one", "verb/two")
        problem = golden.orphan_check(td, {"verb/one"}, None)
        self.assertIsNotNone(problem, "a replay that consumed 1 of 2 recorded cells reported "
                                      "nothing — the corpus can shrink away silently")
        self.assertIn("CORPUS ORPHANS", problem)
        self.assertIn(snapshot_io._safe("verb/two"), problem)
        self.assertNotIn(snapshot_io._safe("verb/one"), problem)

    def test_a_DELIBERATE_narrowing_skips_the_check_out_loud(self):
        """`--only`/`--emits`/`--quick` narrow on purpose, so the check would be a false red.
        Skipped, and ANNOUNCED — a gate that quietly stops running is the failure this whole
        file argues against."""
        td = self._corpus("verb/one", "verb/two")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertIsNone(golden.orphan_check(td, {"verb/one"}, "--only verb/one"))
        self.assertIn("orphan check SKIPPED", out.getvalue())
        self.assertIn("--only verb/one", out.getvalue())


class TheAbsoluteTierRunsInEveryMODE(unittest.TestCase):
    """`check_expectations` ran ONLY on the live pair — the one path that dies with
    `rituals/harness.py`.

    Two consequences, and the second is the worse one. `--against` degraded to a pure hash
    compare, so `web_golden`'s own named blind spot ("two servers that both stopped enforcing
    the CSRF token would agree in every guard cell") was answered only for as long as nobody
    re-recorded. And `--record` HAD the reference snapshot in hand and still did not check it,
    so every future regeneration — which after the reference is deleted must be made FROM THE
    PORT — was a blind blessing of whatever the cells happened to produce. Task 7 shipped
    exactly that once, banking six anchor cells with empty verbatim text.

    `run_cell` is stubbed rather than spawned: the claim is about the ADJUDICATION, and a real
    subprocess would make the same assertion cost a second and depend on a verb."""

    SNAP = {"<stdout>": b"hello world\n", "<stderr>": b"", "<exit>": b"0"}

    def _record(self, mod, cell, td, **kw):
        real, mod.run_cell = mod.run_cell, lambda *a, **k: dict(self.SNAP)
        try:
            return mod.compare(record=td, matrix=[cell], limit=5, **kw)
        finally:
            mod.run_cell = real

    def test_a_vacuous_cell_is_refused_by_record_and_nothing_is_written(self):
        import tempfile
        td = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        cell = {"id": "probe/a-cell-that-stopped-exercising-what-it-names",
                "bin": "cli", "expect": ["a sentence the reference never prints"]}
        rc = self._record(harness_golden, cell, td,
                          ref={"hook": ["x"], "cli": ["x"]}, new={"hook": ["y"], "cli": ["y"]})
        self.assertEqual(rc, 1, "--record banked a cell whose own `expect` no longer holds")
        self.assertEqual(list(Path(td).glob("*.json")), [],
                         "the corpus gained an entry for a cell that gates nothing")

    def test_a_sound_cell_still_records(self):
        """The vacuity guard: "refuses everything" and "refuses the right thing" are the same
        red until something is banked."""
        import tempfile
        td = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        cell = {"id": "probe/a-cell-that-still-says-what-it-names",
                "bin": "cli", "expect": ["hello world"]}
        rc = self._record(harness_golden, cell, td,
                          ref={"hook": ["x"], "cli": ["x"]}, new={"hook": ["y"], "cli": ["y"]})
        self.assertEqual(rc, 0)
        self.assertEqual(len(list(Path(td).glob("*.json"))), 1)

    def test_against_checks_the_CANDIDATE_side(self):
        """The expectations are ABSOLUTE — they say what an implementation must print, not that
        two agree — so they hold against the candidate as readily as the reference. That is
        what makes them the tier that survives the deletion."""
        import tempfile
        td = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        good = {"id": "probe/a-cell", "bin": "cli", "expect": ["hello world"]}
        self.assertEqual(self._record(harness_golden, good, td,
                                      ref={"hook": ["x"], "cli": ["x"]},
                                      new={"hook": ["y"], "cli": ["y"]}), 0)
        # Same recorded bytes, same candidate output — but the cell now declares something the
        # candidate does not say. A pure hash compare cannot see this; that is the whole point.
        bad = {**good, "expect": ["a sentence neither side prints"]}
        real, harness_golden.run_cell = harness_golden.run_cell, \
            lambda *a, **k: dict(self.SNAP)
        try:
            rc = harness_golden.compare(ref={"hook": ["x"], "cli": ["x"]},
                                        new={"hook": ["y"], "cli": ["y"]},
                                        matrix=[bad], limit=5, against=td)
        finally:
            harness_golden.run_cell = real
        self.assertEqual(rc, 1, "--against replayed byte-identical bytes and never asked "
                                "whether the cell still exercises what it names")


class TheNarrowingReasonIsActuallyWired(unittest.TestCase):
    """The lesson a previous phase paid for: a narrowing flag needs a WIRING test. The check
    above is correct and was, in its first draft, simply not connected — `orphan_check` cannot
    skip for a reason `main` never sends it, and an unsent reason turns every deliberate
    `--only` run into a false red."""

    def _narrowed(self, mod, argv):
        seen = {}

        def fake_compare(*a, **kw):
            seen.update(kw)
            return 0

        real, mod.compare = mod.compare, fake_compare
        try:
            mod.main(argv)
        finally:
            mod.compare = real
        return seen.get("narrowed")

    def test_only_reaches_the_two_cell_harnesses(self):
        self.assertEqual(
            self._narrowed(harness_golden, ["--only", "version", "--new", "node x",
                                            "--new-cli", "node y"]),
            "--only version")
        self.assertEqual(
            self._narrowed(web_golden, ["--only", "docs", "--new", "node z"]),
            "--only docs")

    def test_quick_and_emits_reach_golden_and_a_full_run_sends_none(self):
        self.assertEqual(
            self._narrowed(golden, ["--quick", "--emits", "files", "--new", "node x"]),
            "--quick, --emits files")
        self.assertIsNone(self._narrowed(golden, ["--new", "node x"]),
                          "an unnarrowed run must NOT claim a narrowing reason, or the "
                          "orphan check skips itself on every CI replay")


# The four web cells that recorded the RECORDER's own gitignored `Harness/` build, and the
# property that says the escape is closed. `_status_data`'s and `_installed_defaults`'
# candidate walks used to end at `ROOT / "Harness"` (and, in the second, `ROOT.parent /
# "Harness"` as well), which no sandbox can fence off; a cell that seeded no host dir
# therefore reported this developer's install. The two halves were recorded on different
# machines, so they disagreed on an axis that has nothing to do with line endings:
#
#   setup__an-undeployed-target-says-so   emit / installed_fp / version_target /
#                                         version_verdict — all four
#   themes__* (three cells)               emit
#
# WHY THE HALVES ARE THE GATE. crlf is recorded here and lf on the ubuntu runner, and no CI
# job replays crlf (ci.yml's `cells` is ubuntu-only). A committed half nothing executes is
# exactly what this branch exists to prevent, and the only cheap detector for "this cell
# recorded the recorder" is that the two machines agree. It runs on both platforms because
# both halves are committed — it reads the corpus, it never records one.
_ESCAPED_WEB_CELLS = (
    "setup__an-undeployed-target-says-so",
    "themes__a-json-body-over-the-threshold-is-gzipped",
    "themes__an-undeployed-host-still-reports-a-current-pair",
    "themes__every-theme-carries-its-accent-tagline-and-sigil",
)


class TheEscapedCellsAgreeAcrossTheHalves(unittest.TestCase):
    WEB = ROOT / "tests" / "__snapshots__" / "web"

    @staticmethod
    def _sep_free(text: str) -> str:
        """Modulo separators: a Windows path inside a recorded JSON body arrives as the
        two-character escape `\\\\`, its POSIX twin as one `/`. Every other backslash in
        these bodies is the head of a `\\uXXXX` escape, which this leaves alone (and which
        would in any case be rewritten identically on both sides)."""
        return text.replace("\\\\", "/").replace("\r\n", "\n")

    def _body(self, half: str, cid: str) -> str:
        path = self.WEB / half / f"{cid}.json"
        self.assertTrue(path.is_file(), f"{path} is missing — the cell was renamed or the "
                                        f"half was never recorded")
        doc = json.loads(path.read_text(encoding="utf-8"))
        body = doc.get("verbatim", {}).get("<r1 body>")
        self.assertTrue(body, f"{path} records no <r1 body>; this gate would pass vacuously")
        return body

    def test_the_bodies_agree_modulo_separators(self):
        for cid in _ESCAPED_WEB_CELLS:
            with self.subTest(cell=cid):
                crlf, lf = self._body("crlf", cid), self._body("lf", cid)
                self.assertEqual(self._sep_free(crlf), self._sep_free(lf),
                                 f"{cid}: the two halves disagree on something that is not "
                                 f"a path separator — a machine-state escape is back")

    def test_each_half_says_absolutely_that_nothing_is_deployed(self):
        """The absolute tier the comparison above owes: two halves recorded on two
        checkouts that BOTH carried a `Harness/` would agree with each other."""
        for half in ("crlf", "lf"):
            with self.subTest(half=half):
                setup = self._body(half, "setup__an-undeployed-target-says-so")
                self.assertIn('"installed_fp": null, "version_target": null', setup)
                self.assertIn('"version_verdict": "no Geneseed install detected to '
                              'compare"', setup)
                self.assertIn('"emit": "\\u2014"', setup)
                for cid in _ESCAPED_WEB_CELLS[1:]:
                    self.assertIn('"emit": "opencode-global"', self._body(half, cid))

    def test_the_separator_normalisation_is_load_bearing(self):
        """Vacuity guard. The three `themes` bodies carry no path and are byte-identical
        across the halves, so if `setup`'s were too this gate would prove nothing about
        separators and would silently stop covering the case it was written for."""
        cid = "setup__an-undeployed-target-says-so"
        self.assertNotEqual(self._body("crlf", cid), self._body("lf", cid),
                            "the two halves are byte-identical, so this class is no longer "
                            "comparing a Windows recording against a POSIX one")


if __name__ == "__main__":
    unittest.main()
