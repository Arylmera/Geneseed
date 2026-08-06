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


if __name__ == "__main__":
    unittest.main()
