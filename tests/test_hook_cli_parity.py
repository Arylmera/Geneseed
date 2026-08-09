"""The Node entry points' own gates — the ones `tests/harness_golden.py` cannot give.

There are two of them since P5c, and the split is the file's first subject.
`bin/geneseed-hook.mjs` carries the four verbs an emitted `settings.json` invokes and is
kept minimal because the machine-wide shim execs it on every tool call;
`bin/geneseed-cli.mjs` carries the harness subcommands a hook never invokes, starting with
`exclude`. `rituals/harness.py` is one program answering both sets, so the reference side of
every comparison is one command and the candidate side is two.

That harness proves the CLIs BEHAVE the same across 125 cells. It cannot prove:

  * that the four verbs it compares are the four the emitted `settings.json` invokes — a
    fifth hook wired in `js/settings.mjs` would simply never be compared, and an absent
    row reads exactly like a forgotten one. **Load-bearing since P5b**, not merely tidy:
    the hook shim is machine-wide (`~/.geneseed/bin/geneseed-hook[.cmd]`, no per-install
    component) and last-writer-wins, so the two entry points answering the same verb set
    is what makes it safe for a Node emit to own the hooks of an install Python wrote;
  * that the two agree on the BYTES they print. Every cell reads stdout through a
    universal-newline decoder, which folds Python's Windows CRLF and Node's LF to the same
    string before any comparison happens — a property the harness's own transport erases
    rather than a gap in any cell;
  * that either entry is a second implementation rather than a shell around
    `python rituals/harness.py` — a passthrough would pass every cell perfectly, because
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
HARNESS_CLI = ROOT / "bin" / "geneseed-cli.mjs"
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


def run_cli(args: list[str], env: dict | None = None,
            cwd: Path | None = None) -> subprocess.CompletedProcess:
    """The NON-hook entry point, `bin/geneseed-cli.mjs`."""
    return subprocess.run([NODE, str(HARNESS_CLI), *args], input="", cwd=str(cwd or ROOT),
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


def _verbs_of(entry: Path) -> set[str]:
    """The verbs an entry point carries, read out of its `VERBS` table."""
    text = entry.read_text(encoding="utf-8")
    body = text[text.index("const VERBS = {"):]
    body = body[:body.index("\n};")]
    return set(re.findall(r"^\s{2}'?([a-z][a-z-]*)'?:\s*\{", body, re.M))


def entry_verbs() -> set[str]:
    """`bin/geneseed-hook.mjs`'s table — the verbs a HOOK invokes."""
    return _verbs_of(HOOK_CLI)


def cli_verbs() -> set[str]:
    """`bin/geneseed-cli.mjs`'s table — the harness subcommands a hook never invokes."""
    return _verbs_of(HARNESS_CLI)


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
        and a Python-emitted one must be interchangeable from the host's side.

        Both Node entries are checked, not just the hook one: `bin/geneseed-cli.mjs` is
        equally a twin of `rituals/harness.py`, and a verb it spelled differently would be
        a command that works on one runtime and not the other.
        """
        for name, entry, verbs in (("bin/geneseed-hook.mjs", HOOK_CLI, entry_verbs()),
                                   ("bin/geneseed-cli.mjs", HARNESS_CLI, cli_verbs())):
            with self.subTest(entry=name):
                missing = sorted(verbs - harness_py_subcommands())
                self.assertFalse(missing, f"{name} carries {missing}, which "
                                          f"rituals/harness.py has no subparser for")

    def test_the_two_entry_points_carry_disjoint_verb_sets(self):
        """P5c split the Node side in two where `rituals/harness.py` is one program, so a
        verb now has to belong to exactly one of them.

        A verb in BOTH tables would be two implementations of one command, and nothing would
        say which one a user reaches: the shim bakes `bin/geneseed-hook.mjs` and a person
        types `bin/geneseed-cli.mjs`. It would also make the equality gate above meaningless
        in the direction that matters — the hook entry could grow `exclude` and stay 'equal'
        to the wired set only by the CLI entry dropping it.
        """
        both = sorted(entry_verbs() & cli_verbs())
        self.assertFalse(both, f"{both} is carried by BOTH Node entry points; a verb "
                               f"belongs to exactly one of them")
        self.assertTrue(cli_verbs(), "bin/geneseed-cli.mjs's VERBS table parsed as empty, "
                                     "so the disjointness above is vacuous")

    def test_the_matrix_covers_every_verb_it_claims(self):
        """Per BINARY, and that is the shape change P5c forced.

        Before this phase there was one candidate command and one verb set. Now a cell
        declares which entry answers it, so the partition has two sides and each is checked
        against the table it belongs to. Collapsing the two — asserting only that the union
        matches — would let a cell be filed under the wrong binary and still pass.
        """
        covered = {"hook": set(), "cli": set()}
        for c in harness_golden.cells():
            covered[c.get("bin", "hook")].add(c["id"].split("/")[0])
        self.assertEqual(covered["hook"], entry_verbs(),
                         "tests/harness_golden.py's hook cells and the hook entry point's "
                         "verbs have diverged: an uncovered verb is an unported one that "
                         "nothing would report.")
        self.assertEqual(covered["cli"], cli_verbs(),
                         "tests/harness_golden.py's cli cells and bin/geneseed-cli.mjs's "
                         "verbs have diverged.")

    def test_every_cell_declares_a_binary_that_exists(self):
        """A typo'd `bin` would send a cell to the reference on both sides — which always
        passes, the same silent-green the `--new-cli` refusal exists to prevent."""
        bad = sorted({c["id"] for c in harness_golden.cells()
                      if c.get("bin", "hook") not in ("hook", "cli")})
        self.assertFalse(bad, f"cells with an unknown `bin`: {bad}")


@unittest.skipIf(NODE is None, "node is not on PATH")
class TheAcceptanceHarnessIsNotVacuous(unittest.TestCase):
    """The harness is code, its expectations are code, and five consecutive phases of this
    port ended with the gate's own body as the defect."""

    def test_every_cell_states_what_the_reference_must_do(self):
        """A cell with no absolute assertion is compared and nothing more — and these four
        verbs are SILENT on almost every path by design, so two implementations that both
        stopped working would agree in every such cell, forever."""
        kinds = ("expect", "expect_absent", "expect_re", "expect_silent", "expect_files")
        naked = [c["id"] for c in harness_golden.cells()
                 if not any(c.get(k) for k in kinds)]
        self.assertFalse(naked, f"cells with no expectation at all: {naked}")
        # Second instance of this list, so it stops being prose: the checker must run every
        # kind the cells are allowed to declare. A kind added to `cells()` and forgotten in
        # `check_expectations` would be a silently ignored assertion.
        import inspect
        body = inspect.getsource(harness_golden.check_expectations)
        for kind in kinds:
            self.assertIn(f'"{kind}"', body,
                          f"cells may declare {kind} but the vacuity checker never reads it")

    def test_no_cell_hardcodes_a_source_fingerprint(self):
        """`build.source_fingerprint()` hashes the whole source tree, so it changes with
        every commit. A cell may compare it — both sides compute it from the same tree at
        the same instant — but a cell that NAMES one is green until the next commit and
        then reports a port regression that is nothing of the kind. The seeded stamps are
        `deadbeef1234` / `0123456789ab`, which are 12 hex digits by design: this refuses a
        fingerprint the harness did not itself write."""
        seeded = {"deadbeef1234", "0123456789ab"}
        pat = re.compile(r"\b[0-9a-f]{12}\b")
        for c in harness_golden.cells():
            for field in ("expect", "expect_absent", "expect_re"):
                for s in c.get(field, ()):
                    bad = set(pat.findall(s)) - seeded
                    self.assertFalse(bad, f"{c['id']} names {bad}, which looks like a live "
                                          f"source fingerprint rather than a seeded one")

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
             "expect_re": [r"hello \w+"], "expect_files": ["made/it.md"]}, snap))
        for kind, cell in (
                ("expect", {"expect": ["absent phrase"]}),
                ("expect_absent", {"expect_absent": ["hello"]}),
                ("expect_re", {"expect_re": [r"hello \d+ world"]}),
                ("expect_silent", {"expect_silent": True}),
                ("expect_files", {"expect_files": ["never/written.md"]})):
            with self.subTest(kind=kind):
                self.assertTrue(harness_golden.check_expectations(cell, snap),
                                f"{kind} was violated and the checker said nothing")

    def test_a_missing_candidate_binary_refuses_rather_than_comparing_ref_to_itself(self):
        """DECLARING the two-binary split and WIRING it are two properties.

        P4c shipped a narrowing flag whose gate was correct and simply not connected, and
        P5a's M21 was the same split for `check_expectations`. Here the silent failure is
        specific: `--new` without `--new-cli` would send every non-hook cell to the
        REFERENCE on both sides, and a cell compared against itself always passes — an
        unported verb would read as a ported one, which is the exact thing this harness
        exists to make impossible.
        """
        ref = f"{sys.executable} {HARNESS_PY}"
        self.assertEqual(
            harness_golden.main(["--only", "exclude", "--new", ref]), 2,
            "--new without --new-cli silently compared the non-hook cells against the "
            "reference itself")
        self.assertEqual(
            harness_golden.main(["--only", "exclude/list-with-no-global-install",
                                 "--new", ref, "--new-cli", ref]), 0,
            "supplying both candidate binaries must run the cell rather than refuse")
        self.assertEqual(
            harness_golden.main(["--only", "git-gate/commit", "--new", ref]), 0,
            "--new alone must still work when no SELECTED cell needs the other binary — "
            "the refusal is about the selection, not about the matrix")

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
class TheHarnessCliIsNotAPassthrough(unittest.TestCase):
    """`bin/geneseed-cli.mjs`, and the ban here is the STRONG one.

    The hook entry could only assert the narrow property — exactly one child-process binding,
    because `learn`'s whole purpose is handing notes to `$GENESEED_LLM`. Nothing this entry
    carries has any reason to start a process, so it gets the driver's ban verbatim: no
    child-process module anywhere in its transitive imports. The day a verb that genuinely
    spawns lands here (`web`, `upgrade`), this gate is where that decision gets recorded.
    """

    def test_the_cli_reaches_no_child_process_module(self):
        """STATIC, and transitive — a source grep on the entry alone cannot see an import
        one module deep, which is the hole P5a had to close for the generator driver."""
        seen, queue = set(), [HARNESS_CLI]
        while queue:
            f = queue.pop()
            if f in seen or not f.is_file():
                continue
            seen.add(f)
            text = f.read_text(encoding="utf-8")
            for banned in ("node:child_process", "'child_process'", '"child_process"'):
                self.assertNotIn(
                    banned, text,
                    f"bin/geneseed-cli.mjs reaches {banned} through {f.relative_to(ROOT)}")
            for spec in re.findall(r"from\s+'(\.[^']+)'", text):
                queue.append((f.parent / spec).resolve())
        self.assertGreater(len(seen), 2,
                           "the import walk found almost nothing, so it proves nothing")

    def test_exclude_reads_a_real_install_with_no_python_on_path(self):
        """DYNAMIC. A passthrough's `spawn('python', ...)` dies with ENOENT here; a second
        implementation never notices. `node` is invoked by absolute path, so stripping PATH
        cannot take the runtime out from under the test."""
        stripped, dropped = _path_without_python()
        self.assertTrue(dropped, "PATH held no python at all, so this run proves nothing")
        with tempfile.TemporaryDirectory() as tmp_s:
            tmp = Path(tmp_s)
            home, repo = tmp / "home", tmp / "repo"
            (home / ".claude").mkdir(parents=True)
            repo.mkdir()
            (home / ".claude" / ".geneseed-manifest.json").write_text(
                '{"owned": []}\n', encoding="utf-8")
            (home / ".claude" / "excludes.json").write_text(
                json.dumps({"excludes": [{"path": repo.as_posix()}]}), encoding="utf-8")
            env = golden.cell_env(home)
            env["PATH"] = stripped

            r = run_cli(["exclude", "list"], env=env, cwd=repo)
            self.assertEqual(r.returncode, 0, f"exclude list failed: {r.stderr[:300]}")
            self.assertIn("[claude]", r.stdout,
                          "exclude list produced no install row with python off PATH — it "
                          "is driving the Python CLI rather than being a second "
                          "implementation")


@unittest.skipIf(NODE is None, "node is not on PATH")
class ExcludeWiringIsOwnershipTracked(unittest.TestCase):
    """Asserted ABSOLUTELY, against both implementations, because a comparison is blind here.

    `exclude add` writes a `claudeMdExcludes` entry into the excluded repo's
    `settings.local.json` and records that it did. `exclude remove` strips only what that
    record claims. Two writers that both claimed wiring they found rather than created would
    agree in every cell of the matrix while both deleted a line out of a user's own settings
    file — the same shape as P4e/M43 and as the gate-document assertion below.
    """

    def _run(self, cmd, argv, home, repo):
        r = subprocess.run(cmd + argv, cwd=str(repo), env=golden.cell_env(home),
                           capture_output=True, text=True, encoding="utf-8")
        self.assertIn(r.returncode, (0, 1), f"{argv} crashed: {r.stderr[:300]}")
        return r

    def _excludes_of(self, repo):
        p = repo / ".claude" / "settings.local.json"
        if not p.is_file():
            return None
        return json.loads(p.read_text(encoding="utf-8")).get("claudeMdExcludes")

    def _world(self, tmp):
        home, repo = tmp / "home", tmp / "repo"
        (home / ".claude").mkdir(parents=True)
        repo.mkdir()
        (home / ".claude" / ".geneseed-manifest.json").write_text(
            '{"owned": []}\n', encoding="utf-8")
        return home, repo

    def _implementations(self):
        return (("python", [sys.executable, str(HARNESS_PY)]),
                ("node", [NODE, str(HARNESS_CLI)]))

    def test_remove_unwires_what_add_wired(self):
        """The positive control, and it is not optional: without it the test below passes
        on an implementation that never unwires anything at all."""
        for label, cmd in self._implementations():
            with self.subTest(impl=label), tempfile.TemporaryDirectory() as tmp_s:
                home, repo = self._world(Path(tmp_s))
                self._run(cmd, ["exclude", "add", str(repo)], home, repo)
                self.assertTrue(self._excludes_of(repo),
                                "add wired nothing, so the removal below proves nothing")
                self._run(cmd, ["exclude", "remove", str(repo)], home, repo)
                self.assertFalse(self._excludes_of(repo),
                                 "remove left behind the claudeMdExcludes entry add wrote")

    def test_add_does_not_claim_wiring_it_found_rather_than_created(self):
        """The entry is present and OUR record of it is not — a project install's own
        project-bypasses-global wiring, or a hand edit. Fabricating ownership there makes
        the next `remove` delete a line Geneseed never wrote.

        The precondition is reached behaviourally rather than by guessing the entry string:
        one `add` creates both, then the install's `excludes.json` is deleted, which erases
        the record while leaving the wiring in the repo exactly as another writer would.
        """
        for label, cmd in self._implementations():
            with self.subTest(impl=label), tempfile.TemporaryDirectory() as tmp_s:
                home, repo = self._world(Path(tmp_s))
                self._run(cmd, ["exclude", "add", str(repo)], home, repo)
                before = self._excludes_of(repo)
                self.assertTrue(before, "add wired nothing, so this cell has no precondition")
                (home / ".claude" / "excludes.json").unlink()

                self._run(cmd, ["exclude", "add", str(repo)], home, repo)
                self._run(cmd, ["exclude", "remove", str(repo)], home, repo)
                self.assertEqual(
                    self._excludes_of(repo), before,
                    f"{label}: exclude add claimed ownership of a claudeMdExcludes entry it "
                    f"found rather than created, and the following remove deleted it")


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
        # `exclude` is in this list since P5c and is the interesting one: it is a verb the
        # SIBLING Node binary answers, so "some Node entry point handles it" is now true
        # while "this one does" must stay false. The shim bakes exactly one of the two.
        for verb in ("doctor", "build", "status", "uninstall", "exclude"):
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

    def test_two_mutually_exclusive_theme_flags_refuse_on_both_sides(self):
        """`add_mutually_exclusive_group()` is behaviour, even though its WORDING is not
        reproduced — and the two are separable, which is why this is a hand-written gate
        rather than a cell.

        A cell would compare argparse's usage block against `bin/geneseed-cli.mjs`'s one
        line and fail on text neither side promises. What both sides DO promise is the
        refusal itself: `harness theme x --solid-only --transparent-only` is an error, not a
        silent pick of whichever flag the parser saw first. Asserted absolutely against BOTH
        implementations, with the reference as its own positive control — without that half
        it would pass on a parser that rejects every theme invocation.
        """
        argv = ["theme", "mine", "--from", "tokyonight",
                "--solid-only", "--transparent-only"]
        for label, cmd in (("python", [sys.executable, str(HARNESS_PY)]),
                           ("node", [NODE, str(HARNESS_CLI)])):
            with self.subTest(side=label):
                r = subprocess.run(cmd + argv, capture_output=True, text=True,
                                   encoding="utf-8", cwd=str(ROOT),
                                   env=golden.cell_env(Path(tempfile.gettempdir())))
                self.assertEqual(r.returncode, 2,
                                 f"{label} accepted both flavour flags: {r.stdout[:200]}")
                self.assertFalse(r.stdout, f"{label} printed on stdout while refusing")

        # The positive control: ONE of the flags is accepted, so the refusal above is about
        # the pair and not about the verb.
        with tempfile.TemporaryDirectory() as td:
            r = subprocess.run([NODE, str(HARNESS_CLI), "theme", "mine", "--from",
                                "tokyonight", "--solid-only", "--dir", td],
                               capture_output=True, text=True, encoding="utf-8",
                               cwd=str(ROOT), env=golden.cell_env(Path(td)))
            self.assertEqual(r.returncode, 0, r.stderr[:300])
            self.assertTrue((Path(td) / "geneseed-mine.json").is_file())

    def test_the_two_entry_points_agree_on_stdout_BYTES(self):
        """The one difference the 103-cell matrix structurally cannot see.

        Every cell in `harness_golden.py` compares stdout through `subprocess` with
        `text=True`, which decodes with universal newlines — so a hook printing `\\r\\n` and
        a hook printing `\\n` are folded to the same string before any cell looks. That is
        the same shape as the shim's exclusion from `golden.py`: not a gap in a cell, a
        property the harness's own plumbing erases. **A cross-implementation gate cannot see
        what its transport normalises**, so this one reads raw bytes.

        The difference was real and measured, not hypothetical: `sys.stdout` is a
        TextIOWrapper with `newline=None`, so Python's hooks emit CRLF on Windows, and
        `harness.py`'s `reconfigure(encoding="utf-8")` changes only the encoding.
        `process.stdout` translates nothing — 176 bytes against 171 for one `context` run
        before `js/hooks.mjs` grew its translating funnels.

        It went unobservable and harmless while nothing baked the Node entry into a shim.
        P5b's flip makes it the bytes a real host reads on a real user's machine, which is
        why it is fixed and gated here rather than carried on the known-differences list.

        A TABLE over both candidate binaries since P5e, not one `context` run, and the
        second row is the one that needed adding rather than generalising. The CLI's verbs
        were covered only TRANSITIVELY — `js/excludes.mjs` and `js/status.mjs` call the same
        `pyPrint` the hooks do, so a mutation of the shared helper fails this test through
        the hook row (P5c/M11). What that cannot see is a CLI module reaching for
        `process.stdout.write` directly, which leaves the hook row green. `prompt` is the
        verb that makes it matter: its stdout is the entire rendered tree, ~400 KB with
        thousands of newlines, against a Python side that writes it through `sys.stdout` and
        translates every one. Prose generalises for free and gates do not — the second
        instance is where this becomes a table.
        """
        with tempfile.TemporaryDirectory() as tmp_s:
            tmp = Path(tmp_s)
            (tmp / "home").mkdir()
            (tmp / "README.md").write_text("# bytes\n", encoding="utf-8")
            env = golden.cell_env(tmp / "home")
            for entry, argv in ((HOOK_CLI, ["context", "--root", str(tmp)]),
                                (HARNESS_CLI, ["prompt"])):
                with self.subTest(entry=entry.name, verb=argv[0]):
                    raw = {}
                    for side, cmd in (("py", [sys.executable, str(HARNESS_PY)]),
                                      ("node", [NODE, str(entry)])):
                        # No text=, no encoding=: bytes, so the decoder cannot fold it.
                        raw[side] = subprocess.run(cmd + argv, cwd=str(tmp), env=env,
                                                   capture_output=True).stdout

                    self.assertTrue(raw["py"],
                                    "the python reference printed nothing, so this row "
                                    "would pass on two silent implementations")
                    self.assertEqual(
                        raw["py"].count(b"\n"), raw["node"].count(b"\n"),
                        "the two entry points printed a different number of lines, so the "
                        "byte comparison below would be about content, not newlines")
                    self.assertEqual(
                        raw["py"], raw["node"],
                        f"{entry.name} hands its caller different BYTES than the python:\n"
                        f"  python: {len(raw['py'])} bytes, "
                        f"{raw['py'].count(chr(13).encode() + chr(10).encode())} CRLF\n"
                        f"  node:   {len(raw['node'])} bytes, "
                        f"{raw['node'].count(chr(13).encode() + chr(10).encode())} CRLF\n"
                        f"  python tail: {raw['py'][-80:]!r}\n"
                        f"  node tail:   {raw['node'][-80:]!r}")

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
