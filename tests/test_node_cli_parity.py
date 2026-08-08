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

import json
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

    def test_a_bundle_in_a_subfolder_matches_python(self):
        """The `--root` axis, which the acceptance matrix cannot reach.

        `golden._argv` builds `--theme/--emit/--footprint/--out` plus an optional
        `--posture`/`--mode` and NOTHING else, so `out == root` in all 259 cells and
        `_rel_under` returns `''` every time. The instruction-path prefix that
        `opencode.json` records — the whole reason the flag exists — is therefore
        INDISTINGUISHABLE to the gate that is otherwise this port's acceptance test.

        This is P2e's `--out is not the target` finding in its general form: a fixture that
        omits `--root` passes even when the port derived one value from the other. Written
        by hand because the alternative is a fourth axis on a 259-cell matrix to prove one
        string.
        """
        with tempfile.TemporaryDirectory() as tmp_s:
            snaps = {}
            for side, gen in (("py", [sys.executable, "build.py"]),
                              ("node", [NODE, str(CLI)])):
                sb = Path(tmp_s) / side
                home, repo = sb / "home", sb / "repo"
                home.mkdir(parents=True)
                out = repo / "Harness"
                r = subprocess.run(
                    gen + ["--theme", "neutral", "--emit", "opencode", "--footprint", "lean",
                           "--out", str(out), "--root", str(repo)],
                    cwd=str(ROOT), env=golden.cell_env(home), capture_output=True,
                    text=True, encoding="utf-8")
                self.assertEqual(r.returncode, 0,
                                 f"{side} generator failed: {(r.stderr or r.stdout)[:400]}")
                roots = [("<HOME>", home), ("<OUT>", out), ("<REPO>", ROOT)]
                snap = golden._snapshot(sb, roots)
                snap["<stdout>"] = golden._normalise(r.stdout.encode("utf-8", "replace"), roots)
                snaps[side] = snap

            a, b = snaps["py"], snaps["node"]
            self.assertEqual(sorted(a), sorted(b),
                             f"only in python: {sorted(set(a) - set(b))[:8]} · "
                             f"only in node: {sorted(set(b) - set(a))[:8]}")
            differing = sorted(k for k in a if a[k] != b[k])
            self.assertEqual(differing, [], f"differing under --root: {differing[:8]}")
            # The guard: if this cell ever stops exercising the prefix, it has silently
            # become a duplicate of a golden cell and proves nothing.
            self.assertIn(b"Harness/AGENT.md", b["<stdout>"],
                          "the emit no longer reports a prefixed instruction path, so this "
                          "cell is no longer testing --root")

    def test_a_non_ascii_target_path_matches_python(self):
        """`json.dumps` defaults to `ensure_ascii=True`; `JSON.stringify` does not.

        Every JSON document this driver writes has to escape non-ASCII the way Python does.
        The manifest writer got this wrong for a whole phase and no cell could tell: the
        only manifest being written was the per-repo OpenCode one, whose `_comment` is pure
        ASCII. It surfaced only when `opencode-global` — whose comment carries an em dash —
        crossed.

        `installs.json` is the same hazard still unexercised: it holds absolute PATHS, which
        are ASCII in every golden cell and are not ASCII on a machine whose user name has an
        accent. So this cell puts a non-ASCII character in the target path and compares the
        registry, rather than waiting for the next emit to make it observable by accident.
        """
        with tempfile.TemporaryDirectory() as tmp_s:
            snaps, raw = {}, {}
            for side, gen in (("py", [sys.executable, "build.py"]),
                              ("node", [NODE, str(CLI)])):
                sb = Path(tmp_s) / side
                home, repo = sb / "home", sb / "dépôt-café"
                home.mkdir(parents=True)
                r = subprocess.run(
                    gen + ["--theme", "neutral", "--emit", "opencode", "--footprint", "lean",
                           "--out", str(repo)],
                    cwd=str(ROOT), env=golden.cell_env(home), capture_output=True,
                    text=True, encoding="utf-8")
                self.assertEqual(r.returncode, 0,
                                 f"{side} generator failed: {(r.stderr or r.stdout)[:400]}")
                # The RAW registry, kept before normalisation: `_normalise` blanks the
                # sandbox root in its escaped spelling too (that is the fix this cell
                # prompted), so the escaping is invisible in the snapshot by design.
                reg = home / ".config" / "geneseed" / "installs.json"
                raw[side] = reg.read_bytes() if reg.is_file() else None
                snaps[side] = golden._snapshot(
                    sb, [("<HOME>", home), ("<OUT>", repo), ("<REPO>", ROOT)])

            self.assertIsNotNone(raw["py"], "no install registry was written, so this cell "
                                            "proves nothing about how one is encoded")
            self.assertIn(b"d\\u00e9p\\u00f4t", raw["py"],
                          "python stopped escaping non-ASCII in the registry — the "
                          "behaviour this cell exists to hold the port against has changed")
            self.assertIn(b"d\\u00e9p\\u00f4t", raw["node"] or b"",
                          "the node driver wrote the path unescaped where python escapes it")

            a, b = snaps["py"], snaps["node"]
            self.assertEqual(sorted(a), sorted(b),
                             f"only in python: {sorted(set(a) - set(b))[:8]} · "
                             f"only in node: {sorted(set(b) - set(a))[:8]}")
            differing = sorted(k for k in a if a[k] != b[k])
            self.assertEqual(differing, [], f"differing under a non-ASCII path: {differing[:8]}")

    def test_every_relocation_var_moves_its_global_target(self):
        """Each `*_CONFIG_DIR` must relocate its own config dir on this driver too.

        No golden cell can check this, and the reason is a safety measure: `cell_env`
        deliberately CLEARS every relocation variable, because leaving one set would send
        ~126 global cells into the developer's real install. So the matrix runs with the
        vars unset, and a driver that ignored one would be byte-identical in all 259 cells
        while writing into the user's real config dir on every machine that exports it —
        which is the documented way to keep a harness in a git-tracked folder.

        Parameterised over the hosts rather than written once, because it was written once:
        the first version covered `$OPENCODE_CONFIG_DIR` alone, and when the Copilot pair
        crossed, a mutation that ignored `$COPILOT_CONFIG_DIR` passed every gate in the
        repo. The prose describing the hazard had been generalised to the new host; the
        test had not. A per-host table is what makes the next host's omission a failure
        instead of an oversight.

        Asserted on the TARGET rather than by observing a leak: a test that proved the bug
        by performing it would perform it.
        """
        # (env var, emit, the marker file the emit writes into its config dir, default dir)
        hosts = [
            ("OPENCODE_CONFIG_DIR", "opencode-global", "AGENT.md",
             Path(".config") / "opencode"),
            ("COPILOT_CONFIG_DIR", "copilot-global", "copilot-instructions.md",
             Path(".copilot")),
        ]
        covered = {e for e in ported() if e.endswith("-global")}
        self.assertEqual(
            {h[1] for h in hosts}, covered,
            "a global emit crossed without a relocation-var cell (or this table names one "
            "that has not crossed) — that is exactly the omission this table exists to make "
            "visible")

        for var, emit, marker, default_rel in hosts:
            with self.subTest(var=var):
                with tempfile.TemporaryDirectory() as tmp_s:
                    tmp = Path(tmp_s)
                    home, relocated = tmp / "home", tmp / "relocated-config"
                    home.mkdir()
                    env = golden.cell_env(home)
                    env[var] = str(relocated)
                    r = run_cli(["--theme", "neutral", "--emit", emit,
                                 "--footprint", "lean", "--out", str(tmp / "legacy")],
                                env=env)
                    self.assertEqual(r.returncode, 0,
                                     f"{emit} failed: {(r.stderr or r.stdout)[:300]}")
                    self.assertTrue(
                        (relocated / marker).is_file(),
                        f"the node driver ignored ${var} — it would render into the user's "
                        f"real ~/{default_rel.as_posix()} on every machine that sets it")
                    self.assertFalse(
                        (home / default_rel / marker).is_file(),
                        f"the node driver wrote to the DEFAULT config dir as well as the "
                        f"one ${var} names")

    def test_a_global_copilot_emit_warns_about_registered_project_installs(self):
        """A two-step sequence the matrix cannot express, and therefore never runs.

        `_warn_copilot_global_over_project` reads the install registry, so it only speaks
        when a PROJECT copilot install is already on record. Every golden cell emits into a
        fresh sandbox whose registry is empty, so `_project_survivors` returns `[]` and the
        warning is UNREACHABLE in all 259 of them — including its whole
        `registryRoots`/`projectSurvivors` read path, which is where the prune-on-read that
        rewrites `installs.json` lives.

        So this drives the real sequence: register a project install, then emit globally,
        and require the two CLIs to agree on what they say about it.

        The registry it reads is seeded with THREE rows on purpose, and each one is there
        because a mutation survived without it:

          * a `copilot` project install — the row the warning is about;
          * an `opencode` project install — a live row with a DIFFERENT marker. With only
            the copilot row present, a `_project_survivors` that ignored the marker entirely
            returned the same single root and said the same thing;
          * a row pointing at a directory that no longer exists — without it `kept` equals
            the original list, the prune-on-read never writes, and dropping the write is
            invisible.

        So the comparison covers `installs.json` as well as the warning: the prune is a
        WRITE to a file the acceptance matrix compares byte-for-byte, and it is the part of
        this read path most likely to be wrong.
        """
        with tempfile.TemporaryDirectory() as tmp_s:
            said, registry = {}, {}
            for side, gen in (("py", [sys.executable, "build.py"]),
                              ("node", [NODE, str(CLI)])):
                sb = Path(tmp_s) / side
                home, repo, oc_repo = sb / "home", sb / "repo", sb / "oc-repo"
                cfgdir = sb / "copilot-cfg"
                home.mkdir(parents=True)
                env = golden.cell_env(home)
                env["COPILOT_CONFIG_DIR"] = str(cfgdir)

                def emit(argv, side=side, gen=gen, env=env):
                    r = subprocess.run(
                        gen + ["--theme", "neutral", "--footprint", "lean", *argv],
                        cwd=str(ROOT), env=env, capture_output=True, text=True,
                        encoding="utf-8")
                    self.assertEqual(r.returncode, 0,
                                     f"{side} {argv[1]} failed: {(r.stderr or r.stdout)[:300]}")
                    return r

                emit(["--emit", "copilot", "--out", str(repo)])
                emit(["--emit", "opencode", "--out", str(oc_repo)])

                # The dead row, added after the live ones so the prune has something to do.
                reg = home / ".config" / "geneseed" / "installs.json"
                rows = json.loads(reg.read_text(encoding="utf-8"))
                reg.write_text(json.dumps(rows + [str(sb / "deleted-install")], indent=2)
                               + "\n", encoding="utf-8")

                r = emit(["--emit", "copilot-global", "--out", str(sb / "legacy")])
                roots = [("<HOME>", home), ("<OUT>", repo), ("<OC>", oc_repo),
                         ("<SB>", sb), ("<REPO>", ROOT)]
                said[side] = golden._normalise(r.stderr.encode("utf-8", "replace"), roots)
                registry[side] = golden._normalise(reg.read_bytes(), roots)

            self.assertIn(b"project Copilot install(s) already exist", said["py"],
                          "the project emit did not register, so the global emit had "
                          "nothing to warn about and this cell tested nothing")
            self.assertIn(b"1 project Copilot install(s)", said["py"],
                          "the warning counted something other than the single copilot "
                          "root — the opencode row is supposed to be filtered out by its "
                          "marker, and if it is not this cell cannot see that it is not")
            self.assertNotIn(b"deleted-install", registry["py"],
                             "python did not prune the dead row, so this cell cannot tell "
                             "whether the node driver does")
            self.assertEqual(said["py"], said["node"],
                             "the two drivers disagree about the stacking warning:\n"
                             f"  python: {said['py'][:300]!r}\n"
                             f"  node:   {said['node'][:300]!r}")
            self.assertEqual(registry["py"], registry["node"],
                             "the two drivers disagree about the registry after a "
                             "prune-on-read:\n"
                             f"  python: {registry['py'][:300]!r}\n"
                             f"  node:   {registry['node'][:300]!r}")

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
