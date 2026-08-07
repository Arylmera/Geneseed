"""The Node OpenCode extras produce the same bytes, returns and streams as the Python.

`js/opencode.mjs` ports everything `emit_opencode` writes beyond the agents and skills
`js/native.mjs` already owns: the branded and curated colour themes, the opt-in primary
agent, the opt-in slash-command layer plus the always-on `/ponytail` switch, the verbatim
plugin and workflow copies, and the `agent-overrides.json` stub with its staleness notice.

WHY THIS UNIT NEEDED ITS OWN GATE, beyond "everything does":

  * It is the first Node code that writes a JSON CONTAINER. `jsonDumps` shipped
    string-only on purpose because its container signature would have been a guess; this
    is the code that pins it. `test_json_container_rendering_agrees` compares both
    variants against Python directly, over shapes the emitted files do not contain.
  * Half of it is behind environment flags. `GENESEED_PRIMARY` and `GENESEED_COMMANDS`
    are OFF by default, so the primary agent and the whole command layer are unreachable
    from any default emit — golden has never rendered either.
  * The staleness notice goes to STDOUT, where every warning in the native layer goes to
    stderr. Both streams are compared, and the asymmetry is the Python's own.

WHAT IS HELD FIXED. Both sides get the SAME rendered items and the SAME theme dict,
produced once by Python. `render_all` has its own byte-parity gate; composing two
separately-proven functions keeps this one pointed at the writers under test.

Known weak spot: with no `node` on PATH this class SKIPS and a skipped suite still reports
OK. CI must have Node.

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
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402
import _build_core  # noqa: E402

NODE = shutil.which("node")
_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}

# Container shapes for the json.dumps(indent=2) comparison. The emitted themes are flat
# string/int maps, so the nesting, the empty containers, the escaping and the astral
# character are all shapes only this corpus reaches.
JSON_CORPUS = [
    {}, [], {"a": 1}, {"a": []}, {"a": {}}, {"a": [1, 2, 3]},
    {"a": "x", "b": "y"}, {"nested": {"deep": {"deeper": [1, {"k": "v"}]}}},
    {"key with space": "v"}, {"unicode": "a — b"}, {"emoji": "\U0001F600"},
    {"quote": 'he said "hi"'}, {"backslash": "a\\b"}, {"newline": "a\nb"},
    {"tab": "a\tb"}, {"del": "a\x7fb"}, {"sep": "a b"}, {"nbsp": "a b"},
    {"t": True, "f": False, "n": None}, {"neg": -1, "zero": 0, "big": 1000000},
    {"list": [[], {}, [[]]]}, {"": "empty key"},
    # FLOATS, and they are not decoration. The corpus travels to Node as a JSON file, so
    # Node re-parses the same literals — which means this is also the round-trip test for
    # the wrapper that keeps `1.0` apart from `1`. With integers alone the wrapper is
    # indistinguishable from returning the bare value, and a mutation that dropped it
    # stayed green until these existed.
    {"f": 1.0, "i": 20, "small": 0.1, "negzero": -0.0, "huge": 1e21, "tiny": 1e-5},
    {"$schema": "https://opencode.ai/theme.json", "theme": {"primary": 6, "text": "none"}},
]

_STALE_OVERRIDES = json.dumps(
    {"_version": "0.0.1-ancient", "agents": {"reviewer": {"model": "x/y"}}}, indent=2)
_NO_VERSION_OVERRIDES = json.dumps({"agents": {"reviewer": {"model": "x/y"}}}, indent=2)
_EMPTY_AGENTS = json.dumps({"_version": "0.0.1-ancient", "agents": {}}, indent=2)
# The integral float again: the primary agent takes the same override shape as a subagent,
# so `str(1.0)` vs `String(1.0)` is live on this path too.
_PRIMARY_OVERRIDES = """{
  "_version": "0.0.1-ancient",
  "agents": {
    "orchestrator": {"model": "x/y", "temperature": 1.0, "variant": "high", "steps": 20}
  }
}
"""


def _cells():
    themes = [p.stem for p in build.theme_files()]
    cells = [{"name": f"theme-{t}", "theme": t} for t in themes]
    on = {"GENESEED_PRIMARY": "1"}
    cmds = {"GENESEED_COMMANDS": "1"}
    cells += [
        # Both opt-in layers, alone and together. Off by default, so no default emit --
        # and therefore no golden cell -- has ever written either.
        {"name": "primary-on", "theme": "neutral", "env": on},
        {"name": "commands-on", "theme": "neutral", "env": cmds},
        {"name": "both-on", "theme": "neutral", "env": {**on, **cmds}},
        {"name": "primary-truthy-word", "theme": "neutral",
         "env": {"GENESEED_PRIMARY": "YES"}},
        {"name": "primary-falsy", "theme": "neutral", "env": {"GENESEED_PRIMARY": "0"}},
        # The primary agent renders per-agent overrides, integral float included.
        {"name": "primary-with-overrides", "theme": "neutral", "env": on,
         "overrides_text": _PRIMARY_OVERRIDES},
        # The staleness notice: fires, stays silent, and its two "no version" shapes.
        {"name": "overrides-stale", "theme": "neutral", "overrides_text": _STALE_OVERRIDES},
        {"name": "overrides-no-version", "theme": "neutral",
         "overrides_text": _NO_VERSION_OVERRIDES},
        {"name": "overrides-empty-agents", "theme": "neutral",
         "overrides_text": _EMPTY_AGENTS},
        {"name": "overrides-current-version", "theme": "neutral", "current_version": True},
        {"name": "overrides-corrupt", "theme": "neutral",
         "overrides_text": "{ not json at all"},
        # ACCENT drives the branded theme's whole palette, and all 14 shipped themes give
        # it a valid ANSI colour name — so the unknown-name fallback, the `.lower()` and
        # the "cyan" default are unreachable without a synthetic theme. Measured, not
        # assumed: mutating the fallback left the gate green until these existed.
        {"name": "accent-unknown", "theme": "neutral",
         "theme_patch": {"ACCENT": "chartreuse"}},
        # "RED", not "CYAN": cyan is ANSI 6, which is ALSO the unknown-name fallback, so an
        # uppercase cyan cell cannot tell a missing `.lower()` from a working one. It was
        # written as "CYAN" first and a mutation proved it vacuous.
        {"name": "accent-uppercase", "theme": "neutral", "theme_patch": {"ACCENT": "RED"}},
        {"name": "accent-absent", "theme": "neutral", "theme_del": ["ACCENT"]},
        # A non-string ACCENT goes through Python's `str()` and JS's `String()`, which is
        # the wrapped-number path: `String(PyNumber)` must render what `str(int)` does.
        {"name": "accent-numeric", "theme": "neutral", "theme_patch_raw": '{"ACCENT": 7}'},
    ]
    return cells


def _dump_inputs(theme_name, items_file: Path, theme_file: Path) -> list:
    theme, items = build.render_all(theme_name)
    payload = [[rel, text, str(src)] for rel, text, src in items]
    items_file.write_text(json.dumps(payload), encoding="utf-8")
    theme_file.write_text(json.dumps(theme), encoding="utf-8")
    return [(rel, text, Path(src)) for rel, text, src in payload]


def _run_python(oc: Path, base: Path, theme_name: str, theme: dict, items: list) -> dict:
    """The Python writers, in the order `emit_opencode` runs them."""
    def rel(p):
        return None if p is None else p.relative_to(oc).as_posix()

    build.ensure_agent_overrides_stub(base)
    overrides = build._load_agent_overrides(base)
    primary = build._write_primary_agent(oc / "agents", overrides)
    commands = build._write_command_layer(items, oc / "command")
    commands.append(build._write_ponytail_command(oc / "command"))
    theme_file = build._write_theme(oc / "themes", theme_name, theme)
    color = build._write_color_themes(oc / "themes")
    owned = []
    n_plugins = build._copy_plugins(oc / "plugins", owned)
    n_workflows = build._copy_workflows(oc / "workflows", owned)
    return {"primary": rel(primary), "commands": [rel(p) for p in commands],
            "themeFile": rel(theme_file), "colorThemes": [rel(p) for p in color],
            "nPlugins": n_plugins, "nWorkflows": n_workflows, "owned": owned}


def _tree(d: Path) -> dict:
    return {p.relative_to(d).as_posix(): p for p in d.rglob("*") if p.is_file()}


@unittest.skipUnless(NODE, "node is not on PATH — the extras parity gate cannot run")
class OpencodeExtrasParityTests(unittest.TestCase):
    maxDiff = None

    def test_node_and_python_write_identical_extras(self):
        cells = _cells()
        with tempfile.TemporaryDirectory(prefix="geneseed-extras-") as tmp_s:
            tmp = Path(tmp_s)
            jobs, expected = [], []
            for i, cell in enumerate(cells):
                items = _dump_inputs(cell["theme"], tmp / f"items{i}.json",
                                     tmp / f"theme{i}.json")
                theme = json.loads((tmp / f"theme{i}.json").read_text(encoding="utf-8"))
                theme.update(cell.get("theme_patch", {}))
                # Patched from raw JSON text so an integral literal keeps its type on the
                # way to Node, the way a real theme file would.
                theme.update(json.loads(cell.get("theme_patch_raw", "{}")))
                for k in cell.get("theme_del", []):
                    theme.pop(k, None)
                (tmp / f"theme{i}.json").write_text(json.dumps(theme), encoding="utf-8")
                text = cell.get("overrides_text")
                if cell.get("current_version"):
                    text = json.dumps({"_version": build.source_release_version(),
                                       "agents": {"reviewer": {"model": "x/y"}}}, indent=2)
                py, js = tmp / f"py{i}", tmp / f"js{i}"
                for side in (py, js):
                    side.mkdir(parents=True)
                    if text is not None:
                        (side / "agent-overrides.json").write_text(text, encoding="utf-8")

                env = cell.get("env", {})
                out, err = io.StringIO(), io.StringIO()
                with mock.patch.dict(os.environ, env, clear=False):
                    for k in ("GENESEED_PRIMARY", "GENESEED_COMMANDS"):
                        if k not in env:
                            os.environ.pop(k, None)
                    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                        result = _run_python(py, py, cell["theme"], theme, items)
                expected.append({"result": result, "stdout": out.getvalue(),
                                 "stderr": err.getvalue()})

                jobs.append({
                    "kind": "extras", "itemsFile": str(tmp / f"items{i}.json"),
                    "themeFile": str(tmp / f"theme{i}.json"), "themeName": cell["theme"],
                    "cfgDir": str(js), "base": str(js), "env": env,
                    "src": str(_build_core.SRC), "config": str(_build_core.CONFIG),
                    "colorThemes": str(_build_core.COLOR_THEMES),
                    "pluginSrc": str(_build_core.PLUGIN_SRC),
                    "workflowSrc": str(_build_core.WORKFLOW_SRC),
                    "primaryAgentSrc": str(build.PRIMARY_AGENT_SRC),
                    "resultFile": str(tmp / f"res{i}.json"),
                })

            r = self._run_node(tmp, jobs)

            for i, cell in enumerate(cells):
                with self.subTest(cell=cell["name"]):
                    py, js = tmp / f"py{i}", tmp / f"js{i}"
                    self.assertEqual(
                        expected[i]["result"],
                        json.loads((tmp / f"res{i}.json").read_text(encoding="utf-8")),
                        f"{cell['name']}: return value differs (order included — the "
                        f"`owned` list becomes the ownership manifest)")
                    py_files, js_files = _tree(py), _tree(js)
                    self.assertEqual(sorted(py_files), sorted(js_files),
                                     f"{cell['name']}: different files written")
                    differing = [rel for rel in sorted(py_files)
                                 if py_files[rel].read_bytes() != js_files[rel].read_bytes()]
                    if differing:
                        self.fail(self._report(cell["name"], differing, py_files, js_files))

            self.assertEqual("".join(e["stdout"] for e in expected),
                             r.stdout.replace("\r\n", "\n"),
                             "the stdout streams differ — the agent-overrides staleness "
                             "notice is printed there, not to stderr")
            self.assertEqual("".join(e["stderr"] for e in expected),
                             r.stderr.replace("\r\n", "\n"), "the stderr streams differ")

    def test_json_container_rendering_agrees(self):
        """`jsonDumps` shipped string-only because a container signature would have been a
        guess. This is the measurement that replaced the guess: passing an indent switches
        Python's separators from `(', ', ': ')` to `(',', ': ')`, which is what
        `JSON.stringify(v, null, 2)` already emits — so both variants reduce to one
        stringify plus, for `ensure_ascii=True`, an escape pass."""
        with tempfile.TemporaryDirectory(prefix="geneseed-jsondump-") as tmp_s:
            tmp = Path(tmp_s)
            (tmp / "corpus.json").write_text(json.dumps(JSON_CORPUS), encoding="utf-8")
            r = self._run_node(tmp, [{"kind": "jsondump",
                                      "corpusFile": str(tmp / "corpus.json"),
                                      "resultFile": str(tmp / "out.json")}])
            self.assertEqual("", r.stdout)
            got = json.loads((tmp / "out.json").read_text(encoding="utf-8"))
            self.assertEqual([json.dumps(o, indent=2) for o in JSON_CORPUS], got["ascii"],
                             "jsonDumpsIndent disagrees with json.dumps(obj, indent=2)")
            self.assertEqual([json.dumps(o, indent=2, ensure_ascii=False)
                              for o in JSON_CORPUS], got["raw"],
                             "jsonDumpsIndent({ensureAscii:false}) disagrees with "
                             "json.dumps(obj, indent=2, ensure_ascii=False)")

    def _run_node(self, tmp: Path, jobs: list):
        jobs_file = tmp / "jobs.json"
        jobs_file.write_text(json.dumps(jobs), encoding="utf-8")
        r = subprocess.run([NODE, str(ROOT / "tests" / "extras_dump.mjs"), str(jobs_file)],
                           capture_output=True, text=True, encoding="utf-8",
                           cwd=ROOT, **_NO_WINDOW)
        self.assertEqual(r.returncode, 0,
                         f"node extras_dump failed:\n{r.stdout}\n{r.stderr}")
        return r

    def _report(self, name, differing, py_files, js_files):
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


class OpencodeExtrasMatrixTests(unittest.TestCase):
    """A gate on the gate: these axes each cover something nothing else reaches."""

    def test_the_matrix_covers_every_branch(self):
        cells = _cells()
        names = {c["name"] for c in cells}
        themes = {p.stem for p in build.theme_files()}
        self.assertEqual({c["theme"] for c in cells} & themes, themes,
                         "not every shipped theme is written as a branded OpenCode theme")
        self.assertTrue(any(c.get("env", {}).get("GENESEED_PRIMARY") for c in cells),
                        "no GENESEED_PRIMARY cell — the primary agent is off by default, "
                        "so it is unreachable from any default emit")
        self.assertTrue(any(c.get("env", {}).get("GENESEED_COMMANDS") for c in cells),
                        "no GENESEED_COMMANDS cell — the whole command layer is off by "
                        "default")
        for required in ("overrides-stale", "overrides-empty-agents",
                         "overrides-current-version", "primary-with-overrides"):
            self.assertIn(required, names)

    def test_the_corpus_reaches_the_shapes_the_emitted_files_do_not(self):
        """The emitted themes are flat string/int maps. If the corpus decayed to that, the
        separator question it exists to answer would go untested."""
        flat = [o for o in JSON_CORPUS if isinstance(o, dict)
                and all(isinstance(v, (str, int, type(None), bool)) for v in o.values())]
        self.assertLess(len(flat), len(JSON_CORPUS), "the corpus is all flat maps")
        self.assertTrue(any(o == {} or o == [] for o in JSON_CORPUS), "no empty container")
        self.assertTrue(any(isinstance(o, dict) and any(isinstance(v, (dict, list))
                                                        for v in o.values())
                            for o in JSON_CORPUS), "no nested container")
        self.assertTrue(any(isinstance(o, dict)
                            and any(isinstance(v, str) and any(ord(c) > 126 for c in v)
                                    for v in o.values())
                            for o in JSON_CORPUS), "no non-ASCII string")


if __name__ == "__main__":
    unittest.main()
