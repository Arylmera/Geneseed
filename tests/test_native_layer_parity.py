"""The Node native layer produces the same bytes, the same return value and the same
warnings as the Python one.

`_write_native_layer` is where RENDER stops being a pure function of `src/`. Three things
make it so, and each is invisible to every gate that existed before this one:

  * the frontmatter reads the USER's `agent-overrides.json` out of the emit target;
  * claim-on-create decides which files are written AT ALL, from what is already on disk;
  * three host dialects diverge inside one loop, one of them renaming the output file.

`tests/golden.py` cannot reach any of them. It emits into a fresh sandbox, where the
overrides file is the empty stub the emit itself just wrote and nothing pre-exists — so
every override branch, every claim-on-create branch and the whole warning stream are dead
code as far as the acceptance suite is concerned. `tests/test_render_parity.py` cannot
reach them either: it compares `render_all`, which stops one call short.

WHAT IS HELD FIXED. Both sides are handed the SAME items — rendered once by Python and
dumped to disk — rather than each rendering its own. That is deliberate: `render_all`
already has a byte-parity gate over the full theme x axis matrix, and composing two
separately-proven functions keeps this gate pointed at the one under test. A divergence
here is a native-layer divergence, never a renderer one.

WHAT IS COMPARED. The written tree byte for byte (so Python's `\\n` -> `os.linesep`
translation is in scope, as is the vendored `copy2` path that must NOT be translated), the
returned `(n_agents, n_skills, written)` including the ORDER of `written` (it becomes the
ownership manifest the prune diffs against), and stderr. Node's stdout is asserted EMPTY:
the emitted hook gates signal by printing JSON on stdout and return 0 on every path, so a
byte written there by anything on that code path silently converts a blocking gate into a
permissive one — a security defect, not noise.

Known weak spot, stated rather than discovered later: with no `node` on PATH this class
SKIPS, and a skipped suite still reports OK. CI must have Node.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402
import _build_core  # noqa: E402

NODE = shutil.which("node")

# Mirrors _harness_core.NO_WINDOW: no console flash when the suite runs headless.
_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}

# One overrides file exercising every branch of the three frontmatter builders. Kept as
# TEXT, not a dict: `1.0` must reach the parser as the literal it was written as. Python's
# json makes that an `int`/`float` distinction and renders `1.0`; JSON.parse collapses it
# to the double 1 and `String()` renders `1`. Nothing that emits a bundle can catch that,
# because the emit always writes an empty stub.
RICH_OVERRIDES = """{
  "_comment": "every branch of the override rendering, once",
  "agents": {
    "architect":  {"model": "anthropic/claude-haiku-4-5"},
    "reviewer":   {"model": "x/y", "temperature": 1.0, "variant": "high", "steps": 20},
    "explorer":   {"temperature": 0.15},
    "security":   {"temperature": 0},
    "tester":     {"temperature": null, "steps": 0},
    "docs":       {"model": "", "variant": ""},
    "developer":  {"steps": 1e2},
    "nobody-has-this-name": {"model": "unused"}
  }
}
"""

# JSON number literals rendered through `pyStr`, compared against Python's own `str()` of
# `json.loads` of the same literal. The interesting ones are the integral floats (Python
# keeps the `.0`, JS drops it), the exponent thresholds (Python leaves positional notation
# outside [1e-4, 1e16), JS outside [1e-6, 1e21)), the exponent's zero padding, signed zero,
# and an integer wider than a double can hold exactly.
NUMBER_LITERALS = [
    "0", "1", "20", "-7", "-0", "0.0", "1.0", "-1.0", "0.1", "0.15", "1.5", "2.0",
    "0.30000000000000004", "1e2", "1E2", "1e+2", "1.0e2", "0.0001", "0.00001", "1e-5",
    "1.5e-7", "1e16", "1e15", "12345678901234567.0", "1e21", "1e100", "-1.5e-7",
    "123456789012345678901234567890", "-0.0", "100.0", "3.14159265358979",
]


def _theme(agent_colors="keep"):
    """A theme dict for the OpenCode colour path. `keep` means 'no theme at all' (None),
    which is what the claude/copilot emits pass."""
    if agent_colors == "keep":
        return None
    return {"AGENT_COLORS": agent_colors}


def _cells():
    """The matrix. Every branch of the layer appears at least once, and the axes that only
    a real user's machine can produce (overrides, pre-existing files) appear at all."""
    themes = [p.stem for p in build.theme_files()]
    cells = []

    # 1. Each host dialect, over the plainest configuration. `copilot` renames every agent
    #    file AND rewrites the sibling links inside it; `claude` emits a denylist where
    #    `copilot` emits an allowlist.
    for host in ("opencode", "claude", "copilot"):
        cells.append({"name": f"host-{host}", "host": host, "theme_name": "neutral"})

    # 2. Every shipped theme through the OpenCode dialect. The descriptions are rendered
    #    text, so each theme substitutes different prose into them — and 44-50 of those
    #    per theme carry an em dash, which is the whole of the `ensure_ascii` divergence.
    for t in themes:
        cells.append({"name": f"theme-{t}", "host": "opencode", "theme_name": t})

    # 3. Overrides, on every dialect that reads them.
    for host in ("opencode", "claude", "copilot"):
        cells.append({"name": f"overrides-{host}", "host": host, "theme_name": "neutral",
                      "overrides_text": RICH_OVERRIDES})
    # A malformed / absent overrides file must degrade to "no overrides", not raise.
    cells.append({"name": "overrides-corrupt", "host": "opencode", "theme_name": "neutral",
                  "overrides_text": "{ this is not json"})
    cells.append({"name": "overrides-not-a-dict", "host": "opencode",
                  "theme_name": "neutral", "overrides_text": '["a", "b"]'})
    cells.append({"name": "overrides-agents-missing", "host": "opencode",
                  "theme_name": "neutral", "overrides_text": '{"agents": 3}'})

    # 4. The AGENT_COLORS paths. All 14 shipped themes carry the SAME valid map, so the
    #    fallback, the validation warning and the `_default` backfill are unreachable
    #    without a synthetic theme — measured, not assumed.
    cells.append({"name": "colors-absent", "host": "opencode", "theme_name": "neutral",
                  "theme": _theme(None)})
    cells.append({"name": "colors-not-a-dict", "host": "opencode", "theme_name": "neutral",
                  "theme": _theme("chartreuse")})
    cells.append({"name": "colors-invalid-slot", "host": "opencode", "theme_name": "neutral",
                  "theme": _theme({"architect": "chartreuse", "reviewer": "primary",
                                   "tester": None, "docs": 7, "_default": "nope"})})
    cells.append({"name": "colors-no-default", "host": "opencode", "theme_name": "neutral",
                  "theme": _theme({"tester": "success"})})

    # 5. Claim-on-create. `plant` files exist on BOTH sides before the run.
    planted = {
        "agents/reviewer.md": "the user's own reviewer\n",
        "agents/architect.md": "the user's own architect\n",
        "skills/plan/SKILL.md": "the user's own plan skill\n",
        "skills/_template.md": "the user's own template\n",
        "skills/token-report/SKILL.md": "the user's own vendored skill file\n",
    }
    # 5a. No manifest at all: every pre-existing file reads as the user's, and ONE header
    #     line precedes the first skip.
    cells.append({"name": "claim-no-manifest", "host": "opencode", "theme_name": "neutral",
                  "old_owned": [], "manifest_existed": False, "plant": planted})
    # 5b. A manifest that claims two of them: those get overwritten, the rest are kept, and
    #     no header line is printed.
    cells.append({"name": "claim-partial", "host": "opencode", "theme_name": "neutral",
                  "old_owned": ["agents/reviewer.md", "skills/plan/SKILL.md"],
                  "manifest_existed": True, "plant": planted})
    # 5c. Claim-on-create disabled (the per-repo bundle emits): everything is overwritten
    #     unconditionally and nothing is warned about.
    cells.append({"name": "claim-off", "host": "opencode", "theme_name": "neutral",
                  "old_owned": None, "plant": planted})
    # 5d. The copilot dialect claims a DIFFERENT filename, so a planted `.md` is not the
    #     file it would write.
    cells.append({"name": "claim-copilot", "host": "copilot", "theme_name": "neutral",
                  "old_owned": [], "manifest_existed": False,
                  "plant": {**planted, "agents/reviewer.agent.md": "user's copilot agent\n"}})

    # 6. Overrides AND claim-on-create together, since an override changes the bytes of a
    #    file claim-on-create may decline to write.
    cells.append({"name": "overrides-and-claim", "host": "opencode", "theme_name": "imperial",
                  "overrides_text": RICH_OVERRIDES, "old_owned": ["agents/reviewer.md"],
                  "manifest_existed": True, "plant": planted})
    return cells


def _dump_items(theme_name, dest: Path) -> list:
    """Render once, in Python, and hand BOTH sides the identical item list."""
    _theme_dict, items = build.render_all(theme_name)
    payload = [[rel, text, str(src)] for rel, text, src in items]
    dest.write_text(json.dumps(payload), encoding="utf-8")
    return [(rel, text, Path(src)) for rel, text, src in payload]


def _plant(cfg: Path, files: dict) -> None:
    for rel, content in (files or {}).items():
        p = cfg / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")


def _tree(cfg: Path) -> dict:
    return {p.relative_to(cfg).as_posix(): p for p in cfg.rglob("*") if p.is_file()}


@unittest.skipUnless(NODE, "node is not on PATH — the native-layer parity gate cannot run")
class NativeLayerParityTests(unittest.TestCase):
    """Byte-identity between js/native.mjs and _build_emit._write_native_layer."""

    maxDiff = None

    def test_node_and_python_write_identical_native_layers(self):
        cells = _cells()
        with tempfile.TemporaryDirectory(prefix="geneseed-native-") as tmp_s:
            tmp = Path(tmp_s)
            jobs, expected = [], []

            for i, cell in enumerate(cells):
                items = _dump_items(cell["theme_name"], tmp / f"items{i}.json")
                py_cfg, js_cfg = tmp / f"py{i}", tmp / f"js{i}"
                for side in (py_cfg, js_cfg):
                    side.mkdir(parents=True)
                    _plant(side, cell.get("plant"))
                    if cell.get("overrides_text") is not None:
                        (side / "agent-overrides.json").write_text(
                            cell["overrides_text"], encoding="utf-8")

                # --- Python's half, with stderr captured in order.
                err = io.StringIO()
                with contextlib.redirect_stderr(err):
                    n_agents, n_skills, written = build._write_native_layer(
                        items, py_cfg / "agents", py_cfg / "skills",
                        build._load_agent_overrides(py_cfg),
                        host=cell["host"],
                        old_owned=cell.get("old_owned"),
                        cfg=py_cfg if "old_owned" in cell else None,
                        manifest_existed=cell.get("manifest_existed", True),
                        theme=cell.get("theme"))
                expected.append({
                    "result": {"nAgents": n_agents, "nSkills": n_skills,
                               "written": [p.relative_to(py_cfg).as_posix()
                                           for p in written]},
                    "stderr": err.getvalue(),
                })

                jobs.append({
                    "kind": "native", "itemsFile": str(tmp / f"items{i}.json"),
                    "agentsDir": str(js_cfg / "agents"), "skillsDir": str(js_cfg / "skills"),
                    "overridesBase": str(js_cfg), "relBase": str(js_cfg),
                    "host": cell["host"],
                    "oldOwned": cell.get("old_owned"),
                    "cfg": str(js_cfg) if "old_owned" in cell else None,
                    "manifestExisted": cell.get("manifest_existed", True),
                    "theme": cell.get("theme"),
                    "src": str(_build_core.SRC),
                    "resultFile": str(tmp / f"res{i}.json"),
                })

            r = self._run_node(tmp, jobs)

            for i, cell in enumerate(cells):
                with self.subTest(cell=cell["name"]):
                    py_cfg, js_cfg = tmp / f"py{i}", tmp / f"js{i}"
                    self.assertEqual(
                        expected[i]["result"],
                        json.loads((tmp / f"res{i}.json").read_text(encoding="utf-8")),
                        f"{cell['name']}: the return value differs. `written` order is "
                        f"part of it — it becomes the ownership manifest the prune diffs "
                        f"against.")

                    py_files, js_files = _tree(py_cfg), _tree(js_cfg)
                    # agent-overrides.json is an input, not an output of this function.
                    for d in (py_files, js_files):
                        d.pop("agent-overrides.json", None)
                    self.assertEqual(sorted(py_files), sorted(js_files),
                                     f"{cell['name']}: different files written")
                    differing = [rel for rel in sorted(py_files)
                                 if py_files[rel].read_bytes() != js_files[rel].read_bytes()]
                    if differing:
                        self.fail(self._diff_report(cell["name"], differing,
                                                    py_files, js_files))

            # stderr is compared as ONE stream over all cells, in order: the warnings are
            # the user-visible half of claim-on-create and of AGENT_COLORS validation, and
            # a port that emitted the right files with the wrong warnings would be wrong.
            self.assertEqual("".join(e["stderr"] for e in expected),
                             r.stderr.replace("\r\n", "\n"),
                             "the warning streams differ")

    def test_python_number_rendering_agrees(self):
        """`temperature:` and `steps:` are f-string interpolations of a value `json.loads`
        produced, so `str(1.0)` -> `1.0` and `String(1.0)` -> `1` is a live byte
        divergence on any machine whose agent-overrides.json carries an integral float.
        No gate that works by emitting a bundle can see it: the emit writes an EMPTY
        overrides stub, so no golden cell has ever had an override to render."""
        with tempfile.TemporaryDirectory(prefix="geneseed-pynum-") as tmp_s:
            tmp = Path(tmp_s)
            r = self._run_node(tmp, [{"kind": "pynum", "literals": NUMBER_LITERALS,
                                      "resultFile": str(tmp / "nums.json")}])
            self.assertEqual("", r.stdout)
            self.assertEqual(
                [str(json.loads(lit)) for lit in NUMBER_LITERALS],
                json.loads((tmp / "nums.json").read_text(encoding="utf-8")),
                "pyStr does not render a JSON number the way Python's str() does")

    def _run_node(self, tmp: Path, jobs: list):
        """Run the Node side, and assert it printed NOTHING on stdout.

        Here rather than in a test of its own, and that placement is the point: the first
        version was a standalone test running one job with no overrides, no prior manifest
        and no theme — so nothing warned, and a `console.log` planted in the warning path
        went undetected. Asserting it on every run puts the check on the cells that
        actually print. It matters because the emitted git-gate and rule-gate hooks return
        0 on every path and signal their verdict as JSON on stdout: one stray byte from
        anything on that code path turns a blocking gate into a silently permissive one
        that still reports success.
        """
        jobs_file = tmp / "jobs.json"
        jobs_file.write_text(json.dumps(jobs), encoding="utf-8")
        r = subprocess.run([NODE, str(ROOT / "tests" / "native_dump.mjs"), str(jobs_file)],
                           capture_output=True, text=True, encoding="utf-8",
                           cwd=ROOT, **_NO_WINDOW)
        self.assertEqual(r.returncode, 0,
                         f"node native_dump failed:\n{r.stdout}\n{r.stderr}")
        self.assertEqual("", r.stdout, "the native layer wrote to stdout")
        return r

    def _diff_report(self, name, differing, py_files, js_files):
        rel = differing[0]
        a, b = py_files[rel].read_bytes(), js_files[rel].read_bytes()
        hint = ""
        if a.replace(b"\r\n", b"\n") == b.replace(b"\r\n", b"\n"):
            hint = ("  (they agree once newlines are folded — this is the "
                    "writeText/copy2 choice, not the content)")
        at = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
        return (f"{name}: {len(differing)} of {len(py_files)} file(s) differ.{hint}\n"
                f"  first: {rel} at byte {at}\n"
                f"  python: {a[max(0, at - 60):at + 60]!r}\n"
                f"  node:   {b[max(0, at - 60):at + 60]!r}")


class NativeLayerMatrixTests(unittest.TestCase):
    """A gate on the gate: the matrix above must not shrink into a smoke test. Every one
    of these axes was added because it covers a branch nothing else in the suite reaches,
    and a matrix that quietly lost one would still report green."""

    def test_the_matrix_covers_every_branch(self):
        cells = _cells()
        names = {c["name"] for c in cells}
        themes = {p.stem for p in build.theme_files()}
        self.assertEqual({c["theme_name"] for c in cells} & themes, themes,
                         "not every shipped theme is rendered into the native layer")
        self.assertEqual({c["host"] for c in cells}, {"opencode", "claude", "copilot"})
        self.assertTrue(any(c.get("overrides_text") for c in cells), "no overrides cell")
        self.assertTrue(any(c.get("plant") for c in cells), "no claim-on-create cell")
        self.assertTrue(any("old_owned" in c and c["old_owned"] is None for c in cells),
                        "no cell with claim-on-create disabled")
        self.assertTrue(any(c.get("manifest_existed") is False for c in cells),
                        "no pre-manifest cell — the header-line branch is unreachable")
        self.assertTrue(any(c.get("theme") is not None for c in cells),
                        "no synthetic AGENT_COLORS cell — all 14 shipped themes carry the "
                        "same valid map, so the validation branch needs one")
        for required in ("colors-invalid-slot", "colors-no-default", "claim-partial"):
            self.assertIn(required, names)

    def test_the_overrides_fixture_exercises_every_frontmatter_branch(self):
        """RICH_OVERRIDES is the only input that reaches the override branches at all, so
        it is worth asserting it still does — a fixture edited down to `{"agents": {}}`
        would leave four `if` statements untested and everything green."""
        agents = json.loads(RICH_OVERRIDES)["agents"]
        vals = list(agents.values())
        self.assertTrue(any(v.get("model") for v in vals), "no model override")
        self.assertTrue(any(v.get("variant") for v in vals), "no variant override")
        self.assertTrue(any(isinstance(v.get("temperature"), float)
                            and v["temperature"] == int(v["temperature"])
                            for v in vals),
                        "no INTEGRAL float temperature — that is the one value whose "
                        "rendering differs between Python and JS")
        self.assertTrue(any(v.get("temperature") == 0 for v in vals),
                        "no zero temperature — it must survive `is not None`")
        self.assertTrue(any("temperature" in v and v["temperature"] is None for v in vals),
                        "no null temperature — it must NOT be emitted")
        self.assertTrue(any(v.get("model") == "" for v in vals),
                        "no empty model — it must NOT be emitted")
        self.assertTrue(any(n not in {p.stem for p in (_build_core.SRC / "agents").glob("*.md")}
                            for n in agents),
                        "no override for a non-existent agent")


if __name__ == "__main__":
    unittest.main()
