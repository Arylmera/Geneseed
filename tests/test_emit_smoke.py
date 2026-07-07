"""Smoke matrix: every --emit mode must build clean into a sandboxed HOME.
Catches per-host emit regressions that mode-specific suites don't reach."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MODES = ["files", "opencode", "opencode-global", "claude", "claude-global",
         "bob", "bob-global", "copilot", "copilot-global"]


class EmitModeSmokeTests(unittest.TestCase):
    def test_every_emit_mode_builds_clean(self):
        for mode in MODES:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as td:
                home = Path(td) / "home"
                home.mkdir()
                out = Path(td) / "out"
                # redirect every config-dir root a host resolver might use
                env = dict(
                    os.environ,
                    HOME=str(home),
                    USERPROFILE=str(home),
                    XDG_CONFIG_HOME=str(home / ".config"),
                    APPDATA=str(home / "AppData" / "Roaming"),
                    LOCALAPPDATA=str(home / "AppData" / "Local"),
                )
                env.pop("GENESEED_HARNESS", None)
                argv = [sys.executable, str(ROOT / "build.py"), "--emit", mode]
                if not mode.endswith("-global"):
                    argv += ["--out", str(out)]
                r = subprocess.run(argv, capture_output=True, text=True,
                                   encoding="utf-8", cwd=str(ROOT), env=env)
                self.assertEqual(
                    r.returncode, 0,
                    f"--emit {mode} failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}",
                )
                emitted = (list(Path(td).rglob("AGENT*.md"))
                           + list(Path(td).rglob(".geneseed-manifest.json")))
                self.assertTrue(
                    emitted,
                    f"--emit {mode} wrote nothing inside the sandbox {td}",
                )


if __name__ == "__main__":
    unittest.main()
