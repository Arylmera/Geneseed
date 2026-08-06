"""Every emitted non-gate hook must end with '|| exit 0' so a crashing hook
can never block the host session. The GATES are exempt: standing in the way is their
job, and '|| exit 0' would make a crashing gate fail OPEN — silently permissive on
exactly the acts (commit/push, writing a rule or a memory) that need the user's word."""
import contextlib
import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _build_emit as emit

# The harness.py subcommands whose whole purpose is to stand between the agent and an
# act needing the user's word. Everything else must fail open.
GATES = ("git-gate", "rule-gate")


class HookFormTests(unittest.TestCase):
    def _all_commands(self):
        with tempfile.TemporaryDirectory() as td:
            groups = emit._claude_hook_groups(Path(td))
            for event, gs in groups.items():
                for g in gs:
                    for h in g.get("hooks", []):
                        yield event, h.get("command", "")

    def test_groups_shape_is_claude_settings_hooks(self):
        cmds = list(self._all_commands())
        self.assertTrue(cmds, "no hook commands emitted — shape assumption broken")

    def test_non_gate_hooks_never_block(self):
        for event, cmd in self._all_commands():
            if any(f" {g} " in cmd for g in GATES):
                continue  # deliberately blocking
            with self.subTest(event=event, cmd=cmd):
                self.assertTrue(
                    cmd.rstrip().endswith("|| exit 0"),
                    f"{event} hook can block the host: {cmd!r}",
                )

    def test_every_gate_is_emitted(self):
        """The exemption above is a named list, not a wildcard — so a new hook cannot
        join it by accident. Assert each named gate actually ships, or the exemption
        is silently protecting nothing."""
        cmds = [c for _, c in self._all_commands()]
        for gate in GATES:
            with self.subTest(gate=gate):
                self.assertTrue(
                    any(f" {gate} " in c for c in cmds),
                    f"{gate} is exempt from the never-block rule but is not emitted",
                )


class HookShimTests(unittest.TestCase):
    """The shim is the one path every emitted hook goes through, so its failure modes are
    all silent-and-global: a hook that prints something corrupts the gate's JSON verdict,
    a hook naming a file that isn't there kills every gate in every install at once."""

    def setUp(self):
        self._home = os.environ.get("GENESEED_HOME")
        self.tmp = tempfile.mkdtemp()
        os.environ["GENESEED_HOME"] = self.tmp

    def tearDown(self):
        if self._home is None:
            os.environ.pop("GENESEED_HOME", None)
        else:
            os.environ["GENESEED_HOME"] = self._home
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_shim_is_written_and_runs_the_harness(self):
        p = emit._write_hook_shim()
        self.assertIsNotNone(p, "shim could not be written into a fresh temp home")
        self.assertTrue(p.is_file())
        body = p.read_text(encoding="utf-8")
        self.assertIn(str(emit.ROOT / "rituals" / "harness.py"), body)
        self.assertIn(sys.executable, body)

    def test_shim_forwards_argv_and_stays_silent(self):
        """stdout is the DECISION channel — git-gate and rule-gate return 0 on every
        path and signal by printing JSON. A shim that echoes anything of its own turns
        a blocking gate into a silently permissive one, so `@echo off` and the absence
        of any print are load-bearing, not cosmetic."""
        body = emit._write_hook_shim().read_text(encoding="utf-8")
        if sys.platform == "win32":
            self.assertTrue(body.startswith("@echo off"), body)
            self.assertIn("setlocal", body)   # must not leak vars into the agent's env
            self.assertIn("%*", body)         # forwards --root "..." with quotes intact
            # Bare `exit /b` propagates the live errorlevel; plain `exit` would kill the
            # parent cmd.exe before the emitted `|| exit 0` could evaluate.
            self.assertRegex(body, r"(?m)^exit /b\s*$")
        else:
            self.assertTrue(body.startswith("#!/bin/sh"), body)
            self.assertIn('"$@"', body)
            self.assertIn("exec ", body)      # exec: no extra process per tool call
        self.assertNotIn("echo ", body.replace("@echo off", ""))

    def test_rewrite_is_a_noop_when_unchanged(self):
        """Windows cannot replace a file that a firing hook is executing right now, so an
        unchanged shim must never be rewritten — otherwise a rebuild during a live
        session raises a sharing violation into the build."""
        p = emit._write_hook_shim()
        before = p.stat().st_mtime_ns
        again = emit._write_hook_shim()
        self.assertEqual(p, again)
        self.assertEqual(before, again.stat().st_mtime_ns, "unchanged shim was rewritten")

    def test_stale_shim_is_refreshed(self):
        """The shim body carries the checkout path, and refreshing it on every emit is
        what replaces the self-heal the old checkout-in-the-command form gave for free."""
        p = emit._write_hook_shim()
        p.write_text("#!/bin/sh\nexec /gone/python /gone/harness.py \"$@\"\n", encoding="utf-8")
        emit._write_hook_shim()
        self.assertIn(str(emit.ROOT / "rituals" / "harness.py"),
                      p.read_text(encoding="utf-8"))

    def test_emitted_commands_name_the_shim_not_the_checkout(self):
        with tempfile.TemporaryDirectory() as td:
            groups = emit._claude_hook_groups(Path(td))
        cmds = [h["command"] for gs in groups.values() for g in gs for h in g["hooks"]]
        shim = str(emit._hook_shim_path())
        for c in cmds:
            with self.subTest(cmd=c):
                self.assertIn(shim, c)
                self.assertNotIn(str(emit.ROOT / "rituals"), c)

    def test_falls_back_to_the_direct_form_when_the_shim_cannot_be_written(self):
        """Emitting a command that names a shim which does not exist would fail on EVERY
        hook (9009 under cmd.exe, 127 under sh) and take both gates down with it. The
        pre-shim direct form is strictly no worse than the old behaviour, so that is the
        fallback."""
        boom = lambda: None                       # noqa: E731 — stand-in for a failed write
        real = emit._write_hook_shim
        emit._write_hook_shim = lambda: None
        try:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                prefix = emit._hook_prefix()
        finally:
            emit._write_hook_shim = real
        del boom
        self.assertIn(sys.executable, prefix)
        self.assertIn("harness.py", prefix)
        self.assertIn("WARN", err.getvalue())

    def test_doctor_gate_reports_a_shim_pointing_at_nothing(self):
        """Regression: this gate was first written to run AFTER doctor's emit loop, which
        rewrites the shim — so it could only ever observe the freshly repaired file and
        reported clean no matter how broken things were. It now samples before the loop;
        this test pins the detection itself."""
        sys.path.insert(0, str(emit.ROOT / "rituals"))
        import _harness_build  # noqa: E402  (local: keeps the module list minimal)
        p = emit._write_hook_shim()
        self.assertEqual(_harness_build._shim_problems(), [], "healthy shim flagged")
        p.write_text('#!/bin/sh\nexec "/gone/python" "/gone/harness.py" "$@"\n',
                     encoding="utf-8")
        probs = _harness_build._shim_problems()
        self.assertTrue(probs, "a shim pointing at a missing interpreter went unreported")
        self.assertTrue(all("[shim]" in x for x in probs), probs)

    def test_doctor_gate_is_silent_when_no_shim_exists(self):
        """A source checkout that has never emitted owns no shim, and `_hook_prefix`
        falls back to the direct form when it cannot write one. Neither is a defect."""
        sys.path.insert(0, str(emit.ROOT / "rituals"))
        import _harness_build  # noqa: E402
        self.assertFalse(emit._hook_shim_path().exists())
        self.assertEqual(_harness_build._shim_problems(), [])

    def test_sniff_recognises_both_the_legacy_and_the_shim_shape(self):
        """During migration both shapes are in the wild. Dropping the legacy marker would
        make every not-yet-migrated install invisible to the orphan scan."""
        legacy = f'"{sys.executable}" "{emit.ROOT / "rituals" / "harness.py"}" git-gate'
        shim = f'"{emit._hook_shim_path()}" git-gate'
        for cmd in (legacy, shim):
            with self.subTest(cmd=cmd):
                self.assertTrue(any(m in cmd for m in emit._GENESEED_HOOK_SNIFF))
        self.assertFalse(any(m in "echo hi" for m in emit._GENESEED_HOOK_SNIFF),
                         "a plain user hook must never be mistaken for Geneseed's")


if __name__ == "__main__":
    unittest.main()
