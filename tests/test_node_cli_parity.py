"""The Node driver's own gates — the ones a byte comparison structurally cannot give.

`python tests/golden.py --new "node bin/geneseed.mjs" --emits files` proves the two CLIs
emit the same bytes. It cannot prove they are two implementations: a `bin/geneseed.mjs`
whose entire body was `spawnSync('python', ['build.py', ...args])` would pass all 35 cells
perfectly, because it would BE the Python CLI. That is the P3b hole one level up — a mode
with no cell to contradict the prose — and this file is what refuses it.

The refutation is two-sided ON PURPOSE, because each side is blind where the other sees:

  * The DYNAMIC half runs the driver with every Python REMOVED from PATH. It catches a
    spawn that a static read would miss inside a disabled branch or behind an alias —
    P3c's lesson that "a static reachability walk cannot see a disabled branch, only a
    spawn count can".
  * The STATIC half asserts the driver's source imports no child-process module at all.
    It catches the spawn the dynamic half is blind to: an ABSOLUTE interpreter path, which
    never consults PATH and so never notices that PATH lost anything.

Neither alone is a proof. Together they close both doors, and each is the ONLY one that
catches its own mutation — which is why they are two tests and not one.

The dynamic half removes PATH entries rather than shadowing them with a stub, and that is
a correction rather than a preference. The first version of it dropped a `python.cmd`
sentinel trap at the front of PATH and asserted the sentinel was never written. It was
VACUOUS on Windows: since the batch-file argument-injection fix, Node refuses to run a
`.cmd`/`.bat` through `spawn` without `shell: true`, so a passthrough driver spawning a
bare `python` never reached the trap and the gate passed a mutation built to break it.
Removal has no such hole — an absent interpreter is absent to every spawn mechanism — and
the mutation that motivated the rewrite now fires here.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402  (needs tests/ on the path first)

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "bin" / "geneseed.mjs"
NODE = shutil.which("node")

# build.py:337-338's nine --emit choices, in order. Duplicated deliberately rather than
# imported from build: this file's whole job is to check the NODE driver against the
# contract, and reading the contract out of the Python driver would let both drift
# together. `test_the_node_driver_classifies_every_emit` is what re-joins them.
EMITS = ("files", "opencode", "opencode-global", "claude", "claude-global",
         "bob", "bob-global", "copilot", "copilot-global")


def ported() -> set[str]:
    """The `PORTED` set, read out of the driver's source.

    Parsed rather than hardcoded so this file cannot claim an emit has crossed when the
    driver still refuses it — the list has to come from the thing under test.
    """
    text = CLI.read_text(encoding="utf-8")
    marker = "const PORTED = new Set(["
    i = text.index(marker) + len(marker)
    body = text[i:text.index("])", i)]
    return {tok.strip().strip("'\"") for tok in body.split(",") if tok.strip()}


def _path_without_python() -> "tuple[str, list[str]]":
    """PATH with every directory holding an interpreter removed, and what was removed.

    Returning the dropped list is the vacuity guard: on a machine whose PATH never had a
    python, "the driver ran without one" is true and meaningless, and the caller fails
    instead of banking a green it did not earn.
    """
    names = (["python.exe", "python3.exe", "py.exe"] if sys.platform == "win32"
             else ["python", "python3"])
    kept, dropped = [], []
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry and any((Path(entry) / n).exists() for n in names):
            dropped.append(entry)
        else:
            kept.append(entry)
    return os.pathsep.join(kept), dropped


def run_cli(args: list[str], env: dict | None = None) -> subprocess.CompletedProcess:
    # encoding="utf-8" (never bare text=True): the child writes UTF-8 whatever the console
    # is, and this repo's one unpinned capture is a bug it already carries.
    return subprocess.run([NODE, str(CLI), *args], cwd=str(ROOT), capture_output=True,
                          text=True, encoding="utf-8", env=env)


@unittest.skipIf(NODE is None, "node is not on PATH")
class NodeDriverIsNotAPassthrough(unittest.TestCase):
    """The two halves of the refutation. See the module docstring for why both exist."""

    def test_it_builds_with_no_python_reachable_on_path(self):
        """DYNAMIC. Emit with every interpreter removed from PATH.

        A passthrough driver's `spawn('python', ...)` fails with ENOENT and the emit dies;
        a real Node driver never notices. `node` itself is invoked by absolute path, so
        stripping PATH cannot take the runtime out from under the test.
        """
        stripped, dropped = _path_without_python()
        self.assertTrue(
            dropped,
            "PATH held no python at all, so this run proves nothing about whether the "
            "driver would have found one — the gate needs a python to remove.")

        with tempfile.TemporaryDirectory() as tmp_s:
            tmp = Path(tmp_s)
            out = tmp / "out"
            env = golden.cell_env(tmp / "home")
            env["PATH"] = stripped
            r = run_cli(["--theme", "neutral", "--emit", "files", "--footprint", "lean",
                         "--out", str(out)], env=env)

            self.assertEqual(
                r.returncode, 0,
                "bin/geneseed.mjs failed with no python on PATH — it is driving the "
                f"Python CLI rather than being a second implementation of it. "
                f"stderr: {(r.stderr or r.stdout).strip()[:300]}")
            self.assertTrue((out / "AGENT.md").is_file(),
                            "no bundle was produced with python off PATH")

    def test_the_driver_imports_no_child_process_module(self):
        """STATIC. The door the PATH stub cannot watch: an absolute interpreter path.

        Deliberately a source check and not a spawn count — an absolute-path spawn never
        consults PATH, so no amount of shadowing can observe it.
        """
        text = CLI.read_text(encoding="utf-8")
        for banned in ("node:child_process", "'child_process'", '"child_process"'):
            self.assertNotIn(
                banned, text,
                f"bin/geneseed.mjs imports {banned}: the Node driver must not spawn an "
                f"interpreter. If a future phase genuinely needs one (a Node -> Python "
                f"--validate-only), this gate is the place to record that decision.")


@unittest.skipIf(NODE is None, "node is not on PATH")
class NodeDriverSurface(unittest.TestCase):
    def test_the_node_driver_classifies_every_emit(self):
        """Every one of the nine is either PORTED or refused — never silently mishandled.

        The vacuity risk here is an emit that is in neither list: it would fall through to
        whatever the argument parser did with it. Asserting the partition, rather than
        asserting the refusals alone, is what makes adding a tenth emit visible.
        """
        self.assertTrue(ported() <= set(EMITS),
                        f"PORTED names an emit that is not a --emit choice: "
                        f"{sorted(ported() - set(EMITS))}")
        with tempfile.TemporaryDirectory() as tmp_s:
            for emit in EMITS:
                if emit in ported():
                    continue
                out = Path(tmp_s) / emit
                r = run_cli(["--emit", emit, "--out", str(out)])
                self.assertEqual(
                    r.returncode, 3,
                    f"--emit {emit} has not crossed, so it must refuse with exit 3; "
                    f"got {r.returncode}. stderr: {r.stderr.strip()[:200]}")
                self.assertFalse(out.exists(),
                                 f"--emit {emit} refused but still wrote to {out}")

    def test_the_two_maintainer_flags_refuse_rather_than_run(self):
        """--sync-themes rewrites the CHECKOUT's themes/*.json; --validate-only needs a
        Python doctor. Both must say so instead of doing something adjacent."""
        for flag in ("--sync-themes", "--validate-only"):
            r = run_cli([flag])
            self.assertEqual(r.returncode, 2, f"{flag} should exit 2, got {r.returncode}")
            self.assertIn("python build.py", r.stderr,
                          f"{flag}'s refusal must name the command that does work")

    def test_the_footprint_default_is_the_flags_not_the_functions(self):
        """build.py:354's flag defaults to `lean`; every emit SIGNATURE defaults to `full`.

        A driver that reproduced the signature default emits a different harness in every
        cell, and every gate that calls the emit functions directly stays green — so the
        marker is read back here rather than trusted to the byte comparison alone.
        """
        with tempfile.TemporaryDirectory() as tmp_s:
            out = Path(tmp_s) / "out"
            r = run_cli(["--theme", "neutral", "--out", str(out)])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual((out / ".geneseed-footprint").read_text(encoding="utf-8").strip(),
                             "lean")


if __name__ == "__main__":
    unittest.main()
