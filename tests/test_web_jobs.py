"""P6g's corpus — the job runner's ARGVS, which no response body ever carries.

A cell runs the PROGRAM; a corpus runs the FUNCTION. `tests/web_golden.py` compares two web
servers on their responses, and the values this file gates never reach one:

  * `action_commands(action, …)` returns a list of argvs that `_post_routes` hands STRAIGHT to
    the job runner in the same process. `{"cmd": [...]}` from `api_install_cmd` and
    `api_deploy_cmd` does the same. Neither is serialised to a client, ever.
  * The one place an argv IS observable is `JobManager._run`'s `$ <argv>` echo line, and the
    two argvs cannot be byte-equal by construction: the reference starts
    `C:\\Python313\\python.exe …\\rituals\\harness.py doctor` and the twin starts
    `node …\\bin\\geneseed-cli.mjs doctor`. `tests/web_golden.py` normalises that line for
    exactly that reason.

So the harness is tolerant of the head and blind to the rest, and a tolerant comparison owes an
ABSOLUTE assertion on EVERY side it is tolerant of (P6b's rule, and P6f applied it to
`"python"`). This file is that debt paid for the argv: each side's head asserted absolutely
against its own runtime, and the TAIL — every argument after the head, which is where a real
port bug lives — compared literally.

AND THE PARTITION. `action_commands` has eight rows and two of them still name a verb that has
not crossed (`link`/`unlink` -> P10b). Spawning `python harness.py link` for those would be
exactly the passthrough this port exists to remove, so they are DECLARED in
`NOT_PORTED_ACTIONS` and answered 501. `update` was the third until P8c ported `upgrade` and
spent its declaration. That declaration is cross-checked against
`action_commands`' own keys with `ast` here — the third instance of the partition gate, after
the route table and the docs kinds — so a NINTH row added to the reference cannot quietly
answer "unknown action".

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import ast
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import web  # noqa: E402

NODE = shutil.which("node")

#: The five rows whose verb has crossed, and the three that have not. Written here as the
#: EXPECTED partition rather than imported from either implementation, because a test that read
#: its own answer out of the thing under test would agree with any drift.
PORTED = ["build", "build-all", "doctor", "export", "link", "uninstall", "unlink", "update"]
#: EMPTY SINCE P10b — every action the reference dispatches on is answered by the Node
#: runner. Kept declared, and kept asserted below, because this is the only place that says
#: so: `test_web_server.py`'s running 501 probe was RETIRED in the same phase (its last
#: target was `link`, and no remaining action can be probed without either starting a job in
#: the developer's checkout or editing the real user PATH). A gate on a declaration is
#: weaker than a probe; that trade is the honest cost of the set reaching zero.
NOT_PORTED: list[str] = []


def _node_json(src: str):
    r = subprocess.run([NODE, "--input-type=module", "-e", src], cwd=str(ROOT),
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise AssertionError(f"node failed: {r.stderr[-900:]}")
    return json.loads(r.stdout)


def _reference_actions() -> set:
    """`action_commands`' own dict keys, read with `ast`.

    THE TABLE HAS TO COME FROM THE THING UNDER TEST — the same reason `_reference_routes` reads
    `_web_server.py` rather than carrying a list of paths. A ninth action added to the reference
    and to neither Node set would answer `{"error": "unknown action <x>"}` at 404: a plausible
    response, on a real action, that nothing would fail on.
    """
    tree = ast.parse((ROOT / "rituals" / "_web_jobs.py").read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "action_commands")
    keys: set = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Dict):
            keys.update(k.value for k in node.keys
                        if isinstance(k, ast.Constant) and isinstance(k.value, str))
    return keys


def _reference_inline_actions() -> set:
    """Every `action == "..."` `_post_routes` dispatches on, which the table's keys do not
    cover: `restore` is synchronous and `install`/`deploy` resolve their argv from the body."""
    tree = ast.parse((ROOT / "rituals" / "_web_server.py").read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "_post_routes")
    out: set = set()
    for node in ast.walk(fn):
        if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                and node.left.id == "action"
                and all(isinstance(o, ast.Eq) for o in node.ops)):
            out.update(c.value for c in node.comparators
                       if isinstance(c, ast.Constant) and isinstance(c.value, str))
    return out


class TheActionPartitionMatchesTheReference(unittest.TestCase):
    def test_the_reference_still_has_the_eight_rows_this_phase_measured(self):
        """The control for both tests below. If the reference grew or lost a row, the two
        Node sets could still partition it perfectly while this phase's whole argument —
        five crossed, three blocked on P8 and P10b — had quietly stopped being true."""
        self.assertEqual(_reference_actions(), set(PORTED) | set(NOT_PORTED))

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_every_action_is_either_ported_or_declared_unported(self):
        js = _node_json(
            "import {NOT_PORTED_ACTIONS, PORTED_ACTIONS, INLINE_ACTIONS} from"
            " './js/web/jobs.mjs';"
            "process.stdout.write(JSON.stringify({ported: PORTED_ACTIONS,"
            " unported: [...NOT_PORTED_ACTIONS], inline: INLINE_ACTIONS}));")
        ref = _reference_actions()
        covered = set(js["ported"]) | set(js["unported"])
        self.assertEqual(ref - covered, set(),
                         "the reference names actions the Node runner neither ports nor "
                         "declares unported — each would answer `unknown action`, which is "
                         "what a TYPO gets and not what an unported verb deserves")
        self.assertEqual(covered - ref, set(),
                         "the Node runner claims actions the reference does not name")
        self.assertEqual(set(js["ported"]) & set(js["unported"]), set())
        self.assertEqual(set(js["unported"]), set(NOT_PORTED),
                         "`update` left this set in P8c and `link`/`unlink` in P10b, which "
                         "empties it. It stays DECLARED so the next unported action has a "
                         "place to be declared in rather than falling through to a 404")
        self.assertEqual(js["unported"], [],
                         "NOT_PORTED_ACTIONS is empty as of P10b: every action the reference "
                         "dispatches on is answered by the Node runner. A new row here is a "
                         "regression unless a new ACTION arrived with it")

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_the_actions_dispatched_outside_the_table_are_declared_too(self):
        """`restore`, `install` and `deploy` never reach `action_commands`, so the keys-based
        partition above is blind to them. A FOURTH inline action added to the reference would
        otherwise fall through to the table and answer `unknown action` on a real endpoint."""
        js = _node_json(
            "import {NOT_PORTED_ACTIONS, PORTED_ACTIONS, INLINE_ACTIONS} from"
            " './js/web/jobs.mjs';"
            "process.stdout.write(JSON.stringify({ported: PORTED_ACTIONS,"
            " unported: [...NOT_PORTED_ACTIONS], inline: INLINE_ACTIONS}));")
        inline = _reference_inline_actions()
        self.assertTrue(inline, "no `action ==` comparisons found — the ast reader is stale")
        self.assertEqual(inline - set(js["ported"]) - set(js["unported"]),
                         set(js["inline"]),
                         "the reference dispatches on an action the twin neither runs from "
                         "the table nor declares inline")


@unittest.skipUnless(NODE, "node is not on PATH")
class TheTwoRunnersResolveTheSameCommands(unittest.TestCase):
    """The absolute-per-side, literal-tail discipline, applied to five argvs.

    THE HEAD IS THE PORT and it is asserted as a positive claim on each side, not as "they
    differ": the reference must name its OWN interpreter and a `.py` file under `rituals/` or
    the checkout root, and the twin must name `process.execPath` and a `.mjs` under `bin/`.
    A twin that named `python` would satisfy a "the tails match" test perfectly — it would BE
    the reference — which is why the negative assertion is here as well.
    """

    HEADS = {
        "doctor": ("rituals/harness.py", "bin/geneseed-cli.mjs"),
        "build": ("build.py", "bin/geneseed.mjs"),
        "build-all": ("rituals/harness.py", "bin/geneseed-cli.mjs"),
        "export": ("rituals/harness.py", "bin/geneseed-cli.mjs"),
        "uninstall": ("rituals/harness.py", "bin/geneseed-cli.mjs"),
        # P10b's two. Nothing about the ARGV is special — which is the point of listing them:
        # the head/tail discipline is what proves the job runner spawns the Node CLI for these
        # rather than falling back to the reference the way a passthrough would.
        "link": ("rituals/harness.py", "bin/geneseed-cli.mjs"),
        "unlink": ("rituals/harness.py", "bin/geneseed-cli.mjs"),
        # P8c. The TAIL comparison below is what makes this row worth adding rather than
        # merely moving: the action is named `update` and the argv must name `upgrade`, which
        # is the subparser both runtimes actually carry. A twin that spelled the tail
        # `["update"]` would be relying on argparse's alias, which `bin/geneseed-cli.mjs`
        # reproduces as a table row of its own and could stop reproducing tomorrow.
        "update": ("rituals/harness.py", "bin/geneseed-cli.mjs"),
    }

    @classmethod
    def setUpClass(cls):
        # One non-default value per axis, so an argv that dropped a field or defaulted it
        # differs. `imperial`/`claude-global`/`lean`/`mentor`/`foreman` are all off the
        # generator's own defaults, which is what makes `_setup_build_args`' asymmetric
        # elision rules observable through the `build` row.
        cls.opts = dict(theme="imperial", emit="claude-global", footprint="lean",
                        posture="mentor", mode="foreman")
        cls.js = _node_json(
            "import {actionCommands, PORTED_ACTIONS} from './js/web/jobs.mjs';"
            "const o = {theme: 'imperial', emit: 'claude-global', footprint: 'lean',"
            " posture: 'mentor', mode: 'foreman'};"
            "process.stdout.write(JSON.stringify(Object.fromEntries("
            "  PORTED_ACTIONS.map((a) => [a, actionCommands(a, o)]))));")

    def test_the_reference_argv_head_is_python_and_a_py_file(self):
        for action, (pyfile, _mjs) in self.HEADS.items():
            with self.subTest(action=action):
                cmds = web.action_commands(action, **self.opts)
                self.assertEqual(len(cmds), 1, "every ported row is a single step")
                argv = cmds[0]
                self.assertEqual(argv[0], sys.executable)
                self.assertEqual(Path(argv[1]).relative_to(ROOT).as_posix(), pyfile)

    def test_the_twin_argv_head_is_node_and_an_mjs_entry_and_never_python(self):
        for action, (_py, mjs) in self.HEADS.items():
            with self.subTest(action=action):
                argv = self.js[action][0]
                self.assertEqual(len(self.js[action]), 1)
                # `process.execPath`, resolved by the child that answered — the running
                # interpreter by ABSOLUTE path, so stripping `node` off PATH cannot change
                # what starts and no PATH lookup can be redirected at a `python`.
                self.assertEqual(Path(argv[0]).suffix.lower(),
                                 ".exe" if sys.platform == "win32" else "")
                self.assertEqual(Path(argv[1]).relative_to(ROOT).as_posix(), mjs)
                joined = " ".join(argv).lower()
                self.assertNotIn("python", joined,
                                 "the Node job runner named python — that is the passthrough "
                                 "this port exists to remove, and it would put Python back "
                                 "into a 'no Python needed' install")
                self.assertNotIn("harness.py", joined)
                self.assertNotIn("build.py", joined)

    def test_the_argv_tails_are_identical(self):
        """Where a real port bug would live: `--yes`, `--out`, and the whole of
        `_setup_build_args`' output for the `build` row."""
        for action in self.HEADS:
            with self.subTest(action=action):
                ref = [str(c) for c in web.action_commands(action, **self.opts)[0][2:]]
                self.assertEqual(self.js[action][0][2:], ref)

    def test_the_build_row_threads_every_axis_it_is_given(self):
        """The control the tail comparison cannot be: two implementations that BOTH ignored
        `posture` would have identical tails and this phase's whole reason for threading five
        values through would be untested."""
        tail = self.js["build"][0][2:]
        for flag, value in [("--theme", "imperial"), ("--emit", "claude-global"),
                            ("--footprint", "lean"), ("--posture", "mentor"),
                            ("--mode", "foreman")]:
            self.assertIn(flag, tail)
            self.assertEqual(tail[tail.index(flag) + 1], value)


@unittest.skipUnless(NODE, "node is not on PATH")
class TheTwoResolversAgreeOnADeployCommand(unittest.TestCase):
    """P6f's owed corpus: `api_deploy_cmd`'s `{"cmd": [...]}` never reaches the wire either.

    `api_install_cmd`'s sibling is NOT gated here and the reason is worth stating: its (host,
    path) pair must be one of the DETECTED install targets, which means the corpus would have
    to fabricate a detected install in both runtimes — a second implementation of
    `_install_targets` inside the gate. `tests/web_golden.py`'s
    `actions/install-and-deploy-refuse-every-body-they-cannot-validate` drives it through the
    real detector instead, on both of its refusal arms. `api_deploy_cmd` takes a RAW path, so
    a temp directory is the whole fixture.
    """

    def test_the_two_deploy_argvs_share_a_tail_and_differ_only_in_the_head(self):
        with tempfile.TemporaryDirectory() as td:
            body = {"host": "opencode", "path": td, "theme": "imperial",
                    "footprint": "lean", "posture": "mentor", "mode": "foreman"}
            plan = web.api_deploy_cmd(web.WebState(theme="neutral", target=Path(td)), body)
            self.assertNotIn("error", plan, plan.get("error"))
            self.assertEqual(plan["cmd"][0], sys.executable)
            self.assertEqual(Path(plan["cmd"][1]).relative_to(ROOT).as_posix(), "build.py")

            js = _node_json(
                "import {apiDeployCmd} from './js/web/actions.mjs';"
                "import {webState} from './js/web/api.mjs';"
                f"const body = {json.dumps(body)};"
                f"const st = webState('neutral', {json.dumps(td)});"
                "process.stdout.write(JSON.stringify(apiDeployCmd(st, body)));")
            self.assertNotIn("error", js, js.get("error"))
            self.assertEqual(Path(js["cmd"][1]).relative_to(ROOT).as_posix(),
                             "bin/geneseed.mjs")
            self.assertNotIn("python", " ".join(js["cmd"]).lower())
            self.assertEqual(js["cmd"][2:], [str(c) for c in plan["cmd"][2:]])


if __name__ == "__main__":
    unittest.main()
