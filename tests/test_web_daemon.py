"""P6h's gates — the `web` verb's parts that neither a cell nor a corpus can reach.

Three harnesses already cover most of this phase and each stops somewhere specific:

  * `tests/harness_golden.py`'s `web` group compares the actions that TERMINATE — `status`
    and `stop` over the whole stale-record protocol, and the two `_build_plan` arms that
    refuse before a socket is bound. It cannot run `start` or `restart`: both leave a
    detached daemon behind, and `run_cell`'s teardown is a `TemporaryDirectory` whose
    `rmtree` RAISES when a surviving child holds the log file open.
  * `tests/web_golden.py` runs a real server for all 95 of its cells and, since P6h, runs
    it through `node bin/geneseed-cli.mjs web` as well as through the module — which is
    what licenses the MOVE.
  * `tests/test_pure_function_parity.py` compares `_build_plan`, `_daemon_args` and
    `_restart_args` across implementations on inputs no cell can supply.

WHAT IS LEFT IS THIS FILE, and it is four things:

  1. THE VERB TABLE. `bin/geneseed-cli.mjs` reproduces `harness.py`'s `web` subparser by
     hand — an optional positional with `choices`, two options, two flags, one `type=int`.
     A copy of a value under test, so it is cross-checked against the parser it copies.
  2. `/api/restart`, WHICH NO PROBE MAY REACH. It spawns a detached `web restart` that
     stops the daemon the record names and starts a replacement outliving its caller.
     `web_golden` would lose its own server and orphan a second one into a sandbox about
     to be deleted; `test_web_server.py`'s dispatcher probe runs in the DEVELOPER's
     environment, where the replacement would bind 4747 and serve the checkout forever.
     Rule 7 says a declaration is not a dispatcher — this is the one route where probing
     the dispatcher costs more than the assurance, and saying so out loud beats a silently
     missing probe. So both implementations are read instead.
  3. THE LAUNCHER'S ARGV HEAD, which is the passthrough question. `_daemon_args` is
     compared by the corpus; the BINARY it is passed to differs per side by construction,
     so each side's head is asserted absolutely against its own runtime — the same debt
     `tests/test_web_jobs.py` pays for the job runner.
  4. `_npm_build`'s DECLARED UNREACHABILITY, re-derived from `git ls-files` rather than
     trusted as a comment.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import ast
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))

import golden  # noqa: E402

NODE = shutil.which("node")
HARNESS_CLI = ROOT / "bin" / "geneseed-cli.mjs"
SERVER_JS = ROOT / "js" / "web" / "server.mjs"
WEB_SERVER_PY = ROOT / "rituals" / "_web_server.py"


def _cli_web_row() -> str:
    """The `web: { … }` entry of `bin/geneseed-cli.mjs`'s VERBS table, as source.

    A brace-counting slice rather than a regex: the row contains nested objects and arrays,
    and a lazy match would stop at the first `}` inside `positionals`.
    """
    text = HARNESS_CLI.read_text(encoding="utf-8")
    start = text.index("\n  web: {")
    depth, i = 0, text.index("{", start)
    for j in range(i, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[start:j + 1]
    raise AssertionError("bin/geneseed-cli.mjs's web row is unbalanced")


def _reference_web_parser() -> dict:
    """`harness.py`'s `web` subparser, read with `ast`.

    THE SOURCE OF TRUTH HAS TO BE THE PARSER. The Node table is a hand-written copy of it,
    and every earlier phase of this port learnt the same lesson about copies: `--theme`
    added to the reference and not here would be accepted by one binary and rejected by the
    other, and `tests/harness_golden.py` compares only the argvs its cells happen to name.
    """
    tree = ast.parse((ROOT / "rituals" / "harness.py").read_text(encoding="utf-8"))
    out: dict = {"choices": [], "options": [], "flags": [], "ints": []}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_argument"
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "wb"):
            continue
        name = node.args[0].value
        kw = {k.arg: k.value for k in node.keywords}
        action = kw.get("action")
        if not name.startswith("-"):
            out["choices"] = [c.value for c in kw["choices"].elts]
            continue
        if isinstance(action, ast.Constant) and action.value == "store_true":
            out["flags"].append(name)
        else:
            out["options"].append(name)
            typ = kw.get("type")
            if isinstance(typ, ast.Name) and typ.id == "int":
                out["ints"].append(name)
    for k in out:
        out[k] = sorted(out[k]) if k != "choices" else out[k]
    return out


class TheWebVerbTableMatchesTheSubparserItCopies(unittest.TestCase):

    def test_the_reference_still_declares_the_web_subparser_this_phase_measured(self):
        """The control. Every assertion below reads the parser; a `wb = sub.add_parser`
        that got renamed would make `_reference_web_parser` return four empty lists and
        every equality would hold against an equally empty copy."""
        ref = _reference_web_parser()
        self.assertEqual(ref["choices"], ["start", "stop", "restart", "status"])
        self.assertEqual(ref["options"], ["--port", "--theme"])
        self.assertEqual(ref["flags"], ["--daemon-internal", "--no-browser"])
        self.assertEqual(ref["ints"], ["--port"])

    def test_the_node_row_carries_every_argument_the_reference_declares(self):
        ref, row = _reference_web_parser(), _cli_web_row()
        for choice in ref["choices"]:
            self.assertIn(f"'{choice}'", row,
                          f"bin/geneseed-cli.mjs's web row does not accept `{choice}` — "
                          f"the reference's subparser does, and the two binaries have to "
                          f"answer to the same argv")
        for flag in ref["options"] + ref["flags"]:
            self.assertIn(f"'{flag}'", row,
                          f"bin/geneseed-cli.mjs's web row does not name {flag}")
        for flag in ref["ints"]:
            self.assertRegex(row, r"ints:\s*\[[^\]]*'" + re.escape(flag) + r"'",
                             f"{flag} is `type=int` on the reference and untyped here — a "
                             f"non-integer would silently fall back to the default port")
        # The optional positional, which is `nargs=\"?\"` there. Named because an entry that
        # made `action` REQUIRED would refuse the foreground server, which is the shape
        # `geneseed web` alone has.
        self.assertIn("optional: true", row,
                      "the web row's `action` is not optional; `geneseed web` with no "
                      "action is the foreground server on the reference")

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_a_non_integer_port_is_refused_rather_than_defaulted(self):
        """The `ints` column, driven. Its whole reason is that the alternative is SILENT:
        `pyInt('abc')` is null and a `?? 4747` would bind the default while the operator
        believes they asked for another port. argparse exits 2; so does this.

        The reference's WORDING is not compared — it prints a usage block computed from the
        whole parser tree, which P5a put out of scope for every verb here — but the refusal
        and its exit code are, and this is the only assertion of them.
        """
        r = subprocess.run([NODE, str(HARNESS_CLI), "web", "status", "--port", "abc"],
                           input="", cwd=str(ROOT), capture_output=True, text=True,
                           encoding="utf-8", env=golden.cell_env(ROOT / "nowhere"))
        self.assertEqual(r.returncode, 2, f"a non-integer --port was accepted: {r.stdout}")
        self.assertIn("invalid int value", r.stderr)
        self.assertNotIn("[web]", r.stdout,
                         "the verb ran before its arguments were validated")


class TheRestartRouteIsDeclaredBecauseItCannotBeProbed(unittest.TestCase):

    def test_the_reference_dispatches_restart_to_a_detached_web_restart(self):
        """The control for the twin's assertion below: this is what is being matched."""
        text = WEB_SERVER_PY.read_text(encoding="utf-8")
        self.assertIn('if path == "/api/restart":', text)
        self.assertIn("request_restart(state.theme)", text)
        self.assertIn('return self._send_json({"restarting": True})', text)
        # And `request_restart` really is a detached spawn rather than an in-process call.
        self.assertRegex(text, r"def request_restart\([\s\S]{0,600}?_spawn_detached\(")

    def test_the_twin_dispatches_the_same_path_to_the_same_call(self):
        text = SERVER_JS.read_text(encoding="utf-8")
        self.assertIn("if (path === '/api/restart') {", text)
        self.assertIn("requestRestart(state.theme);", text)
        self.assertIn("{ restarting: true }", text)
        self.assertRegex(text, r"export function requestRestart\([\s\S]{0,400}?"
                               r"spawnDetached\(restartArgs\(theme\)")

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_the_route_left_the_unported_set_and_joined_the_dispatched_one(self):
        """The partition half, which `tests/test_web_server.py` checks as a UNION and so
        cannot see: a route moved out of `NOT_PORTED_POST` and into nothing at all would
        keep the union intact and start answering `{"error": "not found"}` at 404."""
        r = subprocess.run(
            [NODE, "--input-type=module", "-e",
             "import {NOT_PORTED_POST, PORTED_POST_INLINE} from './js/web/server.mjs';"
             "process.stdout.write(JSON.stringify({unported: [...NOT_PORTED_POST],"
             " inline: PORTED_POST_INLINE}));"],
            cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        js = json.loads(r.stdout)
        self.assertNotIn("/api/restart", js["unported"])
        self.assertIn("/api/restart", js["inline"],
                      "/api/restart is neither declared unported nor declared as an inline "
                      "dispatch — it would fall through to the shell's own 404")
        self.assertEqual(js["unported"], ["/api/install"],
                         "the unported POST list is not the one P6h left behind; "
                         "`/api/install` is P6i's and nothing else should be there")


class TheDaemonLauncherReExecutesItselfAndNeverPython(unittest.TestCase):
    """The passthrough question, asked of the one spawn `web` adds.

    `_spawn_detached` starts a process that RUNS THIS PROGRAM, which is the shape the whole
    port exists to remove everywhere else — so the argument (in `_ALLOWED_SPAWNS`' docblock:
    the daemon must outlive its launcher, and no in-process construct does) is backed by an
    assertion that what it re-executes is ITSELF.
    """

    def test_the_reference_launches_its_own_interpreter_and_its_own_harness(self):
        text = WEB_SERVER_PY.read_text(encoding="utf-8")
        self.assertRegex(text, r'cmd = \[sys\.executable, str\(Path\(__file__\)'
                               r'[\s\S]{0,200}?"harness\.py"\),\s*\n\s*"web", \*web_args\]')

    def test_the_twin_launches_its_own_runtime_and_names_no_interpreter(self):
        text = SERVER_JS.read_text(encoding="utf-8")
        self.assertIn(
            "const cmd = [process.execPath, join(ROOT, 'bin', 'geneseed-cli.mjs'), 'web',",
            text,
            "the detached launcher no longer names `process.execPath` and this repo's own "
            "CLI — a spawn taking its command from anywhere else would be the passthrough")
        # The whole function, not the file: `js/web/jobs.mjs`'s argv is declared elsewhere
        # and `python` appears in this file's prose. `spawnDetached` may name no interpreter
        # but the one it is already running.
        body = text[text.index("function spawnDetached("):]
        body = body[:body.index("\n}\n")]
        for banned in ("python", "harness.py", "build.py", "sys.executable"):
            self.assertNotIn(banned, body,
                             f"spawnDetached names {banned}; the daemon must be a second "
                             f"implementation and not a launcher for the first")

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_web_status_answers_with_no_python_on_path(self):
        """DYNAMIC, and the verb's cheapest honest refutation.

        A passthrough's `spawn('python', 'harness.py', 'web', 'status')` dies with ENOENT
        here; a second implementation never notices. `status` is the arm chosen because it
        TERMINATES and starts nothing — `start` would leave a daemon on this machine, which
        the `web` cell group's banner explains at length.
        """
        stripped, dropped = [], []
        names = (["python.exe", "python3.exe", "py.exe"] if sys.platform == "win32"
                 else ["python", "python3"])
        for entry in os.environ.get("PATH", "").split(os.pathsep):
            if entry and any((Path(entry) / n).exists() for n in names):
                dropped.append(entry)
            else:
                stripped.append(entry)
        self.assertTrue(dropped, "PATH held no python at all, so this run proves nothing")
        with tempfile.TemporaryDirectory() as tmp_s:
            home = Path(tmp_s) / "home"
            home.mkdir(parents=True)
            env = golden.cell_env(home)
            env["PATH"] = os.pathsep.join(stripped)
            r = subprocess.run([NODE, str(HARNESS_CLI), "web", "status"], input="",
                               cwd=str(tmp_s), capture_output=True, text=True,
                               encoding="utf-8", env=env)
            self.assertEqual(r.returncode, 1,
                             f"web status did not report 'not running' with python off "
                             f"PATH:\n{r.stdout[-800:]}\n{r.stderr[-800:]}")
            self.assertIn("[web] not running.", r.stdout)


class TheNpmBuildPathIsUnreachableByConstruction(unittest.TestCase):

    def test_the_committed_dist_is_what_makes_the_ask_arm_unreachable(self):
        """`js/web/server.mjs` declares that no test reaches `npmBuild` because
        `web/dist/index.html` is TRACKED, so `buildPlan` answers `serve` in every checkout a
        cell can build. That is a claim about the REPOSITORY, not about the code, and a
        docblock's claim about another file goes stale silently — so it is re-derived.

        The day `web/dist` stops being committed, this fails and says that the `ask` arm has
        become reachable, which is when it needs a gate rather than a declaration.
        """
        r = subprocess.run(["git", "ls-files", "--", "web/dist/index.html"], cwd=str(ROOT),
                           capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        self.assertEqual(r.stdout.strip(), "web/dist/index.html",
                         "web/dist/index.html is no longer tracked — `_npm_build` and the "
                         "interactive `ask` prompt are now reachable from a fresh checkout "
                         "and are declared as if they were not")

    def test_the_prompt_is_word_for_word_the_reference_s(self):
        """The wording of an unreachable prompt, which nothing else can compare.

        `promptLine`'s BEHAVIOUR is gated by a stdin-seeded corpus in
        `tests/test_pure_function_parity.py` — including the EOF arm, which is the one that
        would otherwise answer YES to this question on every non-interactive run. What the
        corpus cannot see is the string `serve()` passes it, because the `ask` arm needs a
        TTY and a checkout with no `web/dist`. Two literals, matched against each other.
        """
        prompt = "[web] UI not built — run npm install && npm run build now? [Y/n] "
        py = WEB_SERVER_PY.read_text(encoding="utf-8")
        js = SERVER_JS.read_text(encoding="utf-8")
        self.assertIn(f'input("{prompt}")', py)
        self.assertIn(f"promptLine('{prompt}')", js)
        # And what each does with EOF, which is the dangerous half: `""` is in the accepted
        # set, so reading EOF as an empty line answers YES to this question.
        self.assertIn('except (EOFError, KeyboardInterrupt):\n            answer = "n"', py)
        self.assertIn("const answer = line === null ? 'n' : line;", js)

    def test_the_browser_open_is_wired_to_the_flag_on_all_three_arms(self):
        """The one branch no harness may drive, asserted as source on both sides.

        `--no-browser` is passed by every cell that reaches `serve` — `web_golden` hardcodes
        it, and no `harness_golden` cell gets past `_build_plan`'s refusals — because a gate
        that popped a browser window on the developer's screen would be worse than the bug
        it caught. So the flag's three consumers (`serve`, and `start_daemon`'s
        already-running and came-up arms) are counted instead: a port that dropped one would
        open no window on a `web start`, and nothing else in this repo would notice.
        """
        py = len(re.findall(r"if open_browser:", WEB_SERVER_PY.read_text(encoding="utf-8")))
        js = len(re.findall(r"if \(openBrowser\) openUrl\(", SERVER_JS.read_text(
            encoding="utf-8")))
        self.assertEqual(py, 3, "the reference no longer has three `if open_browser:` arms "
                                "— this count is what the twin's is matched against")
        self.assertEqual(js, py, "the twin consults `openBrowser` on a different number of "
                                 "arms than the reference consults `open_browser`")

    def test_the_npm_step_pair_is_the_reference_pair(self):
        """The two steps, in order, on both sides. `npm run build` without `npm install` on
        a fresh checkout fails on a missing vite; the reverse order is the same failure."""
        self.assertIn('for step in (("install",), ("run", "build")):',
                      WEB_SERVER_PY.read_text(encoding="utf-8"))
        self.assertIn("for (const step of [['install'], ['run', 'build']]) {",
                      SERVER_JS.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
