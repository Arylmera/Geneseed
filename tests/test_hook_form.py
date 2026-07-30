"""Every emitted non-gate hook must end with '|| exit 0' so a crashing hook
can never block the host session. The GATES are exempt: standing in the way is their
job, and '|| exit 0' would make a crashing gate fail OPEN — silently permissive on
exactly the acts (commit/push, writing a rule or a memory) that need the user's word."""
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


if __name__ == "__main__":
    unittest.main()
