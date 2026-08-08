"""Which emits actually cross the Node seam — measured, and pinned against prose.

The spec, DESIGN.md, CHANGELOG.md, `js/emit.mjs`'s header and `_build_emit.py`'s comments
all said "all nine emits cross that seam" for two phases while eight did.
`emit_opencode_global` spawned Node ZERO times: its render half was inline Python, there
was no matching job kind in `js/emit.mjs`'s `KINDS`, and `tests/test_emit_boundary.py` had
no cell for it — so the one gate that could have contradicted the sentence had nothing to
say about that mode at all.

Nothing observed the claim, so nothing caught it. This file is the observation, and P3c is
what it made expensive to fake: flipping `SEAM["opencode-global"]` to 1 fails four of the
five tests below until the port and its cells exist. The sentence is now true and now
measured, which are two different things.

Three distinct failures it refuses, each of which really can happen:

  * **Prose drifting from reality again.** `SEAM` below is the measured table; a mode that
    gains or loses a seam fails here until the table (and the docs quoting it) are updated.
  * **A ported emit with no boundary cell.** Crossing the seam without a cell means the two
    runtimes are never compared for that mode — exactly the hole `opencode-global` would
    have fallen into the day someone ported it, and the hole this gate made it fall out of
    instead. An emit may be uncrossed, or crossed and celled; crossed and uncelled is
    refused.
  * **A silent fallback.** `js_render_available()` returning False makes every emit run the
    Python body with no notice, by design — the whole claim of the port is that the two are
    indistinguishable. The cost, recorded in the spec, is that on such a machine both sides
    of every boundary comparison run the same Python and each cell passes while proving
    nothing. The dynamic half below is the one gate that fails instead of passing quietly.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import ast
import contextlib
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _build_core          # noqa: E402
import build                # noqa: E402
import test_emit_boundary   # noqa: E402  (its CELLS list is the coverage side of this gate)

NODE = shutil.which("node")

# The measured seam, mode -> number of `run_node` spawns per emit. Not a wish list: it was
# produced by spying on `_build_core.run_node` through one emit of each mode, and the
# dynamic test below re-measures a representative of every distinct value.
#
# `opencode-global` was the 0 and became a 1 at P3c. Flipping it is a two-line edit here
# and a required new cell in test_emit_boundary.CELLS — which was the point of writing the
# table down: the debt could not be paid quietly, and it could not be CLAIMED paid without
# the cells. Four of this file's five tests fail on the flip alone.
SEAM = {
    "files": 1,
    "opencode": 1,
    "opencode-global": 1,
    "claude": 1,
    "claude-global": 1,
    "bob": 1,
    "bob-global": 1,
    "copilot": 1,
    "copilot-global": 1,
}

# `--emit <mode>` -> the entry point build.py's main() dispatches to.
ENTRY = {
    "files": "build", "opencode": "emit_opencode",
    "opencode-global": "emit_opencode_global", "claude": "emit_claude",
    "claude-global": "emit_claude_global", "bob": "emit_bob",
    "bob-global": "emit_bob_global", "copilot": "emit_copilot",
    "copilot-global": "emit_copilot_global",
}

GENERATOR_MODULES = ("_build_core", "_build_settings", "_build_render", "_build_emit",
                     "_build_global")

# One mode per distinct spawn count, plus the mode whose count is the finding. Re-measuring
# all nine costs about a minute and proves nothing the static walk does not, except that
# the dispatcher is really reached — which one emit per job kind already shows.
DYNAMIC = ("files", "opencode", "opencode-global", "claude-global")


def _functions() -> dict:
    out = {}
    for mod in GENERATOR_MODULES:
        tree = ast.parse((ROOT / f"{mod}.py").read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                out[node.name] = node
    return out


FUNCS = _functions()


def _calls(node: ast.AST) -> set:
    """Called names inside `node`. `_build_core.f()` counts as `f` — build.py's splice
    makes the qualified and bare spellings the same function."""
    names = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            fn = sub.func
            if isinstance(fn, ast.Name):
                names.add(fn.id)
            elif isinstance(fn, ast.Attribute):
                names.add(fn.attr)
    return names


def _reaches_run_node(entry: str) -> bool:
    """Is `run_node` reachable from this emit entry point through the generator?"""
    seen, stack = set(), [entry]
    while stack:
        name = stack.pop()
        if name in seen or name not in FUNCS:
            continue
        seen.add(name)
        for called in _calls(FUNCS[name]):
            if called == "run_node":
                return True
            stack.append(called)
    return False


def _spawns(mode: str) -> list:
    """The job kinds one emit of `mode` actually spawns, in order."""
    kinds = []
    real = _build_core.run_node

    def spy(job, _real=real):
        kinds.append(job["kind"])
        return _real(job)

    td = Path(tempfile.mkdtemp())
    home = td / "home"
    home.mkdir()
    saved = dict(os.environ)
    _build_core.run_node = spy
    os.environ["GENESEED_HOME"] = str(home / ".geneseed")
    try:
        with contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            if mode == "files":
                build.build("neutral", td / "out")
            elif mode == "opencode":
                build.emit_opencode("neutral", out=td / "repo", root=td / "repo")
            elif mode == "opencode-global":
                build.emit_opencode_global("neutral", out=None, cfg=td / "cfg")
            elif mode == "claude-global":
                build.emit_claude_global("neutral", out=None, cfg=td / "cfg")
            else:                                     # pragma: no cover - guarded by test
                raise AssertionError(f"no driver for {mode!r}")
    finally:
        _build_core.run_node = real
        os.environ.clear()
        os.environ.update(saved)
        shutil.rmtree(td, ignore_errors=True)
    return kinds


class SeamCoverageTests(unittest.TestCase):
    def test_the_measured_seam_matches_the_recorded_table(self):
        """Static: is `run_node` reachable from each emit entry at all?"""
        for mode, count in sorted(SEAM.items()):
            with self.subTest(emit=mode):
                self.assertEqual(
                    _reaches_run_node(ENTRY[mode]), count > 0,
                    f"--emit {mode} routes through {ENTRY[mode]}, and whether that reaches "
                    f"`run_node` no longer matches SEAM[{mode!r}] == {count}. If an emit "
                    f"just gained or lost its Node seam, update the table here AND every "
                    f"sentence that counts the crossings (DESIGN.md, CHANGELOG.md, "
                    f"js/emit.mjs's header, _build_emit.emit_opencode's WIRE comment).")

    def test_every_emit_that_crosses_the_seam_has_a_boundary_cell(self):
        """An emit compared against nothing is an emit whose port is unproven."""
        celled = {c["emit"] for c in test_emit_boundary.CELLS}
        for mode, count in sorted(SEAM.items()):
            with self.subTest(emit=mode):
                if count:
                    self.assertIn(
                        mode, celled,
                        f"--emit {mode} spawns Node but tests/test_emit_boundary.py has no "
                        f"cell for it, so the two runtimes are never compared for this "
                        f"mode. This is the hole opencode-global would have fallen into.")
                else:
                    self.assertNotIn(
                        mode, celled,
                        f"--emit {mode} is recorded as having no seam, yet a boundary cell "
                        f"drives it — the cell would compare Python against Python and "
                        f"pass while proving nothing. Update SEAM if it was ported.")

    def test_no_emit_is_uncelled_and_unported_without_saying_so(self):
        """The debt is named in code, not only in a spec someone has to remember to read.

        It is empty since P3c, and the assertion is kept rather than deleted: an emit
        DROPPING back to zero is the failure it now guards. That is not hypothetical — a
        dispatcher whose `js_render_available()` branch was removed, or a new emit added
        without one, lands here and nowhere else, because the fallback to the Python body
        is silent by design and every parity gate for that mode would go on comparing
        Python against Python and passing."""
        unported = sorted(m for m, c in SEAM.items() if not c)
        self.assertEqual(
            unported, [],
            "the set of emits with no Node seam changed. That is either a phase landing "
            "(update this list, DESIGN.md and js/emit.mjs's header) or a dispatcher lost "
            "— which would silently move an emit back onto the Python body.")

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_the_seam_is_really_taken_at_runtime(self):
        """Dynamic: reachable is not the same as reached.

        `js_render_available()` guards every dispatcher, and when it answers False the
        Python body runs with NO notice — deliberately, because a banner would be noise on
        every build. The cost is that every boundary cell then compares Python against
        Python and passes. Static reachability cannot see that; a spawn count can."""
        for mode in DYNAMIC:
            with self.subTest(emit=mode):
                kinds = _spawns(mode)
                self.assertEqual(
                    len(kinds), SEAM[mode],
                    f"--emit {mode} spawned {kinds!r}; SEAM says {SEAM[mode]}. A count that "
                    f"dropped to 0 means the emit silently fell back to Python — every "
                    f"parity gate for it now compares Python against Python.")

    def test_every_job_kind_the_child_offers_is_driven(self):
        """A kind in `js/emit.mjs`'s KINDS that no emit sends is dead code the boundary
        gate cannot reach; a kind an emit sends that KINDS lacks is a crash at emit time.

        The key pattern is anchored and accepts a QUOTED key, which the first version did
        not: it took everything before the first `:` and kept it only if `.isidentifier()`
        answered True. `opencode-global` is not a Python identifier and cannot be a bare
        JS one either, so the P3c kind would have been read as offering nothing while the
        generator sent it — the gate failing for a reason that has nothing to do with what
        it measures. A gate is code, and so is its normaliser; this is the fourth phase
        that sentence has had to be written down."""
        src = (ROOT / "js" / "emit.mjs").read_text(encoding="utf-8")
        block = src.split("const KINDS = {", 1)[1].split("\n};", 1)[0]
        # `  key:` / `  'key':` / `  "key":` at the block's own indentation — never a
        # `foo: bar` pair inside a nested object literal, which is why it is anchored.
        key_re = re.compile(r"""^  (?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:""")
        offered = {next(g for g in m.groups() if g is not None)
                   for m in (key_re.match(line) for line in block.splitlines()) if m}

        sent = set()
        for mod in ("_build_render", "_build_emit", "_build_global"):
            tree = ast.parse((ROOT / f"{mod}.py").read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Dict):
                    for k, v in zip(node.keys, node.values):
                        if isinstance(k, ast.Constant) and k.value == "kind" \
                                and isinstance(v, ast.Constant):
                            sent.add(v.value)
        self.assertEqual(offered, sent,
                         f"js/emit.mjs offers {sorted(offered)}; the generator sends "
                         f"{sorted(sent)}")


if __name__ == "__main__":
    unittest.main()
