"""Every emitted non-gate hook must end with '|| exit 0' so a crashing hook
can never block the host session. git-gate is exempt: blocking is its job."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _build_emit as emit


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
            if "git-gate" in cmd:
                continue  # deliberately blocking
            with self.subTest(event=event, cmd=cmd):
                self.assertTrue(
                    cmd.rstrip().endswith("|| exit 0"),
                    f"{event} hook can block the host: {cmd!r}",
                )


if __name__ == "__main__":
    unittest.main()
