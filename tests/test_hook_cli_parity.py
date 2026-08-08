"""The hook entry point's own gates — the ones `tests/harness_golden.py` cannot give.

That harness proves the two CLIs BEHAVE the same across 93 cells. It cannot prove:

  * that the four verbs it compares are the four the emitted `settings.json` invokes — a
    fifth hook wired in `js/settings.mjs` would simply never be compared, and an absent
    row reads exactly like a forgotten one;
  * that `bin/geneseed-hook.mjs` is a second implementation rather than a shell around
    `python rituals/harness.py` — a passthrough would pass all 93 cells perfectly, because
    it would BE the Python CLI (the same hole `test_node_cli_parity.py` refutes for the
    generator driver, one binary along);
  * that the gate documents it emits are the ones a HOST honours. Both implementations
    could agree on a typo'd `permissionDecison` key forever: a cross-implementation
    comparison is structurally blind to a defect both sides share, so the shape is asserted
    absolutely, against a literal;
  * that the harness's own cells are non-vacuous and cover every verb. A gate is code, and
    so is the thing that decides whether it fired.

The passthrough refutation here is a DIFFERENT shape from the driver's, and deliberately.
`bin/geneseed.mjs` is banned from importing a child-process module at all; this entry
cannot be, because `learn`'s whole purpose is to hand notes to whatever `$GENESEED_LLM`
names. So the static half asserts the narrower property that actually holds — the only
spawn is that one — and the dynamic half runs the three verbs that must never spawn with
every Python removed from PATH.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden          # noqa: E402  (needs tests/ on the path first)
import harness_golden  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HOOK_CLI = ROOT / "bin" / "geneseed-hook.mjs"
HOOK_JS = ROOT / "js" / "hooks.mjs"
DRIVER = ROOT / "bin" / "geneseed.mjs"
HARNESS_PY = ROOT / "rituals" / "harness.py"
SETTINGS_JS = ROOT / "js" / "settings.mjs"
NODE = shutil.which("node")


def run_hook(args: list[str], stdin: str = "", env: dict | None = None,
             cwd: Path | None = None) -> subprocess.CompletedProcess:
    # encoding="utf-8" and never a bare text=True — the child writes UTF-8 whatever the
    # console code page is.
    return subprocess.run([NODE, str(HOOK_CLI), *args], input=stdin, cwd=str(cwd or ROOT),
                          capture_output=True, text=True, encoding="utf-8", env=env)


def wired_hook_verbs() -> set[str]:
    """The verbs `js/settings.mjs` actually wires into an emitted settings.json.

    Read out of the emitter rather than listed here: this is the contract the entry point
    has to satisfy, and a copy of it in this file would drift alongside whatever it was
    supposed to catch.
    """
    text = SETTINGS_JS.read_text(encoding="utf-8")
    body = text[text.index("export function claudeHookGroups"):]
    body = body[:body.index("\n}\n")]
    return set(re.findall(r"\$\{run\}\s+([a-z][a-z-]*)", body))


def entry_verbs() -> set[str]:
    """The verbs `bin/geneseed-hook.mjs` carries, read out of its `VERBS` table."""
    text = HOOK_CLI.read_text(encoding="utf-8")
    body = text[text.index("const VERBS = {"):]
    body = body[:body.index("\n};")]
    return set(re.findall(r"^\s{2}'?([a-z][a-z-]*)'?:\s*\{", body, re.M))


def harness_py_subcommands() -> set[str]:
    return set(re.findall(r'sub\.add_parser\(\s*"([a-z][a-z-]*)"',
                          HARNESS_PY.read_text(encoding="utf-8")))


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheVerbSetIsATable(unittest.TestCase):
    """P4d/M30 and P4e both ended with the same correction: when a second instance of a
    hazard appears, the gate becomes a table cross-checked against the source of truth,
    because a hardcoded single value covers the new one with nothing at all."""

    def test_the_entry_carries_exactly_the_verbs_the_emitter_wires(self):
        wired = wired_hook_verbs()
        self.assertEqual(
            wired, {"context", "git-gate", "rule-gate", "learn"},
            "js/settings.mjs wires a different set of hook commands than this gate was "
            "written for — read the new one before deciding what it needs.")
        self.assertEqual(
            entry_verbs(), wired,
            "bin/geneseed-hook.mjs and the emitted settings.json disagree about which "
            "verbs are hooks. A wired verb the entry does not carry is a dead hook the "
            "day the shim names this file; a verb it carries that nothing wires is "
            "unreachable code that no cell can reach either.")

    def test_every_entry_verb_is_a_real_harness_subcommand(self):
        """The shim bakes ONE entry, and which one it bakes is a per-driver decision. So
        both entry points have to answer to the same verb names — a Node-emitted install
        and a Python-emitted one must be interchangeable from the host's side."""
        missing = sorted(entry_verbs() - harness_py_subcommands())
        self.assertFalse(missing, f"bin/geneseed-hook.mjs carries {missing}, which "
                                  f"rituals/harness.py has no subparser for")

    def test_the_matrix_covers_every_verb_it_claims(self):
        covered = {c["id"].split("/")[0] for c in harness_golden.cells()}
        self.assertEqual(covered, entry_verbs(),
                         "tests/harness_golden.py's cells and the entry point's verbs "
                         "have diverged: an uncovered verb is an unported one that "
                         "nothing would report.")


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheAcceptanceHarnessIsNotVacuous(unittest.TestCase):
    """The harness is code, its expectations are code, and five consecutive phases of this
    port ended with the gate's own body as the defect."""

    def test_every_cell_states_what_the_reference_must_do(self):
        """A cell with no absolute assertion is compared and nothing more — and these four
        verbs are SILENT on almost every path by design, so two implementations that both
        stopped working would agree in every such cell, forever."""
        naked = [c["id"] for c in harness_golden.cells()
                 if not (c.get("expect") or c.get("expect_absent")
                         or c.get("expect_silent") or c.get("expect_files"))]
        self.assertFalse(naked, f"cells with no expectation at all: {naked}")

    def test_cell_ids_are_unique(self):
        ids = [c["id"] for c in harness_golden.cells()]
        self.assertEqual(len(ids), len(set(ids)),
                         "two cells share an id, so one of them is invisible in the report")

    def test_the_vacuity_check_reports_each_kind_of_broken_expectation(self):
        """The checker is the gate's gate, and nothing else watches it.

        Deleting the `expect` loop from `check_expectations` leaves the whole matrix green
        (mutation M21): every cell still compares, every comparison still matches, and the
        one thing that would have noticed a cell no longer exercising what it names is
        gone. Declaring an expectation and RUNNING it are two properties, and the test
        above only covers the first — the same split as a narrowing flag needing a wiring
        test separate from a test of what it narrows.
        """
        snap = {"<stdout>": b"hello world", "<stderr>": b"", "<exit>": b"0",
                "made/it.md": b""}
        self.assertFalse(harness_golden.check_expectations(
            {"expect": ["hello"], "expect_absent": ["goodbye"],
             "expect_files": ["made/it.md"]}, snap))
        for kind, cell in (
                ("expect", {"expect": ["absent phrase"]}),
                ("expect_absent", {"expect_absent": ["hello"]}),
                ("expect_silent", {"expect_silent": True}),
                ("expect_files", {"expect_files": ["never/written.md"]})):
            with self.subTest(kind=kind):
                self.assertTrue(harness_golden.check_expectations(cell, snap),
                                f"{kind} was violated and the checker said nothing")

    def test_only_narrows_the_matrix_and_refuses_an_empty_selection(self):
        """A narrowing flag needs its own WIRING test, separate from any test of what it
        narrows — P4c shipped one whose gate was correct and simply not connected."""
        every = len(harness_golden.cells())
        narrowed = harness_golden.main(["--only", "git-gate", "--new",
                                        f"{sys.executable} {HARNESS_PY}"])
        self.assertEqual(narrowed, 0)
        self.assertEqual(
            harness_golden.main(["--only", "nosuchverb"]), 2,
            "a selection matching no cell must refuse: '0 cells, no differences' reads "
            "exactly like a green run")
        self.assertGreater(every, len([c for c in harness_golden.cells()
                                       if c["id"].startswith("git-gate")]),
                           "--only would narrow nothing here, so this proves nothing")


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheHookEntryIsNotAPassthrough(unittest.TestCase):

    def test_the_three_pure_verbs_run_with_no_python_on_path(self):
        """DYNAMIC. `context`, `git-gate` and `rule-gate` spawn nothing at all, so a
        passthrough's `spawn('python', ...)` dies with ENOENT where a real implementation
        never notices. `node` is invoked by absolute path, so stripping PATH cannot take
        the runtime out from under the test."""
        stripped, dropped = _path_without_python()
        self.assertTrue(dropped, "PATH held no python at all, so this run proves nothing "
                                 "about whether the entry point would have found one")
        with tempfile.TemporaryDirectory() as tmp_s:
            tmp = Path(tmp_s)
            (tmp / "README.md").write_text("# proof\n", encoding="utf-8")
            env = golden.cell_env(tmp / "home")
            (tmp / "home").mkdir(exist_ok=True)
            env["PATH"] = stripped

            r = run_hook(["context"], env=env, cwd=tmp)
            self.assertEqual(r.returncode, 0, f"context failed: {r.stderr[:300]}")
            self.assertIn("# proof", r.stdout,
                          "context produced nothing with python off PATH — it is driving "
                          "the Python CLI rather than being a second implementation")

            r = run_hook(["git-gate"], stdin=json.dumps(
                {"tool_input": {"command": "git commit -m x"}}), env=env, cwd=tmp)
            self.assertEqual(r.returncode, 0, r.stderr[:300])
            self.assertIn("permissionDecision", r.stdout,
                          "git-gate stopped gating with python off PATH")

    def test_the_only_spawn_is_the_model_cli(self):
        """STATIC, and narrower than the driver's ban because it has to be.

        `learn` genuinely spawns — `$GENESEED_LLM` is the whole verb — so "imports no
        child-process module" is not the property here. The property is that there is
        exactly ONE spawn site and it is the model CLI, which is what makes the dynamic
        half above meaningful: an absolute-path `spawn('C:/Python313/python.exe', ...)`
        never consults PATH and so would never notice that PATH lost anything.
        """
        text = HOOK_JS.read_text(encoding="utf-8")
        # The IMPORT, not a scan for call sites. A `\bexec\s*\(` scan matches every
        # `SOME_RE.exec(...)` in the file — it fired on three of them here — and worse, it
        # would still miss `cp.exec()` behind a namespace import. Naming the one binding
        # that may be imported closes both.
        imports = re.findall(r"import\s+(.+?)\s+from\s+'node:child_process'", text)
        self.assertEqual(
            imports, ["{ spawnSync }"],
            f"js/hooks.mjs imports {imports} from child_process; exactly one binding is "
            f"allowed, and it is the spawnSync that runs the `$GENESEED_LLM` model CLI")
        self.assertEqual(
            len(re.findall(r"(?<![.\w])spawnSync\s*\(", text)), 1,
            "js/hooks.mjs has more than one spawnSync call site; the model CLI is the "
            "only thing these verbs may start")
        self.assertIn("const argv = pyWords(llm);", text,
                      "the one spawn no longer takes its command from $GENESEED_LLM")
        # The entry point must not spawn either — and again the check is the IMPORT, not
        # the word. A `assertNotIn("child_process", …)` fired on the module docstring,
        # which explains at length why the DRIVER may not have one.
        self.assertFalse(
            re.search(r"^\s*import\s.*'node:child_process'", HOOK_CLI.read_text(
                encoding="utf-8"), re.M),
            f"{HOOK_CLI.name} imports child_process; only js/hooks.mjs' model CLI may")

    def test_the_generator_driver_still_reaches_no_child_process_module(self):
        """`test_node_cli_parity.test_the_driver_imports_no_child_process_module` greps
        `bin/geneseed.mjs`'s OWN source. Adding a module that legitimately spawns opens a
        door that check cannot see through: one `import` of `js/hooks.mjs` would put
        `child_process` in the driver's process with its source still clean.

        So this walks the driver's transitive relative imports instead. It is the same
        assertion one level out, and it exists because of this phase.
        """
        seen, queue = set(), [DRIVER]
        while queue:
            f = queue.pop()
            if f in seen or not f.is_file():
                continue
            seen.add(f)
            text = f.read_text(encoding="utf-8")
            for banned in ("node:child_process", "'child_process'", '"child_process"'):
                self.assertNotIn(
                    banned, text,
                    f"bin/geneseed.mjs reaches {banned} through {f.relative_to(ROOT)} — "
                    f"the Node generator must not be able to spawn an interpreter, and "
                    f"the source-grep on the driver alone cannot see this.")
            for spec in re.findall(r"from\s+'(\.[^']+)'", text):
                queue.append((f.parent / spec).resolve())
        self.assertGreater(len(seen), 1,
                           "the import walk found no modules, so it proves nothing")


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheGateDocumentIsWhatAHostHonours(unittest.TestCase):
    """Asserted absolutely, against a literal, because this is the shape a comparison is
    blind to: both implementations could carry the same typo'd key and agree forever while
    every gate in every install silently stopped gating."""

    EXPECTED = {"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
    }}

    def _decision(self, argv, payload):
        r = run_hook(argv, stdin=json.dumps(payload))
        self.assertEqual(r.returncode, 0,
                         "a PreToolUse hook must exit 0 on every path — a non-zero one "
                         f"breaks the tool call it was watching. stderr: {r.stderr[:200]}")
        return json.loads(r.stdout)

    def test_git_gate_emits_the_document_the_host_reads(self):
        got = self._decision(["git-gate"],
                             {"tool_name": "Bash",
                              "tool_input": {"command": "git commit -m x"}})
        self.assertEqual({k: {j: v for j, v in got["hookSpecificOutput"].items()
                              if j != "permissionDecisionReason"}
                          for k in ["hookSpecificOutput"]}, self.EXPECTED)
        self.assertIn("Law XX", got["hookSpecificOutput"]["permissionDecisionReason"])

    def test_rule_gate_emits_the_document_the_host_reads(self):
        got = self._decision(["rule-gate"],
                             {"tool_name": "Write",
                              "tool_input": {"file_path": "/x/user-rules.md"}})
        self.assertEqual({k: {j: v for j, v in got["hookSpecificOutput"].items()
                              if j != "permissionDecisionReason"}
                          for k in ["hookSpecificOutput"]}, self.EXPECTED)
        self.assertIn("Law VI", got["hookSpecificOutput"]["permissionDecisionReason"])


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheEntryRefusesRatherThanNoOps(unittest.TestCase):

    def test_an_unported_verb_refuses_loudly(self):
        """`harness.py` dispatches 25 subcommands and this entry carries four. Every
        Geneseed hook returns 0 and signals through stdout, so a silent no-op and a
        success are the SAME observation — the refusal is what makes the difference
        visible, and it names the command that does work."""
        for verb in ("doctor", "build", "status", "uninstall"):
            with self.subTest(verb=verb):
                r = run_hook([verb])
                self.assertEqual(r.returncode, 2,
                                 f"{verb} must refuse with exit 2, got {r.returncode}")
                self.assertIn("python rituals/harness.py", r.stderr,
                              "the refusal must name the command that does work")
                self.assertFalse(r.stdout,
                                 "a refusal must print nothing on stdout: that is the "
                                 "channel a host parses as a hook verdict")

    def test_no_verb_at_all_refuses(self):
        r = run_hook([])
        self.assertEqual(r.returncode, 2, r.stderr[:200])
        self.assertFalse(r.stdout)

    def test_an_emitted_hook_command_shape_runs_through_the_shell(self):
        """End-to-end, through `sh`/`cmd.exe`, with the `|| exit 0` a real emitted command
        carries — the one path that exercises the quoting rather than the argv list.

        cwd is the install, not a scratch dir: `context` stands down silently when cwd is
        not a project with docs, which is the exact shape of the disabled hook this cell
        exists to detect (the same correction `test_node_cli_parity` had to make).
        """
        with tempfile.TemporaryDirectory() as tmp_s:
            tmp = Path(tmp_s)
            (tmp / "home").mkdir()
            (tmp / "README.md").write_text("# through the shell\n", encoding="utf-8")
            command = f'"{NODE}" "{HOOK_CLI}" context --root "{tmp}" || exit 0'
            proc = subprocess.run(command, shell=True, cwd=str(tmp),
                                  env=golden.cell_env(tmp / "home"),
                                  capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(proc.returncode, 0,
                             f"the emitted-shape command failed:\n  {command}\n"
                             f"  stderr: {proc.stderr.strip()[:300]}")
            self.assertIn("# through the shell", proc.stdout,
                          "the hook ran but injected nothing — Geneseed's hooks signal "
                          "through stdout, so a silent one is a disabled one")


def _path_without_python() -> "tuple[str, list[str]]":
    """PATH with every directory holding an interpreter removed, and what was removed.

    The dropped list is the vacuity guard, exactly as in test_node_cli_parity: on a machine
    whose PATH never had a python, "it ran without one" is true and meaningless.
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


if __name__ == "__main__":
    unittest.main()
