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
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT))
import golden  # noqa: E402
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
                         jobs=1):
            seen.update(ref=ref, new=new, ref_repeat=ref_repeat,
                        new_repeat=new_repeat, matrix=matrix, jobs=jobs)
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

    def test_emits_narrows_the_matrix_and_refuses_an_unknown_mode(self):
        _, seen = self._capture(["--emits", "files"])
        self.assertEqual({c["emit"] for c in seen["matrix"]}, {"files"})
        self.assertTrue(seen["matrix"], "--emits files selected nothing")
        rc, _ = self._capture(["--emits", "nosuchemit"])
        self.assertEqual(rc, 2, "an unknown --emits value must refuse, not select nothing")


if __name__ == "__main__":
    unittest.main()
