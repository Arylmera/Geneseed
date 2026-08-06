"""The Node render core produces the same bytes as the Python one.

This is the acceptance gate for the first half of the port. `js/render.mjs` is a
translation of `_build_render.py`'s pure text pipeline; this test drives both over a
matrix of themes and render axes, writes each side's output to disk, and byte-compares
the trees. Byte-compares, not string-compares: the Python side goes through
`Path.write_text` and the Node side through `js/lib/pyfs.writeText`, so the comparison
covers Python's `\\n` -> `os.linesep` translation as well as the rendered characters. On
Windows that translation is the difference between 504 CRLF and 504 LF in a single
AGENT.md — get it wrong and every text file differs, which reads as a broken renderer.

Item ORDER is compared too, via each side's `index.json`. It is observable — the prompt
emitter embeds the items in sequence — and it comes from `sorted(SRC.rglob("*"))`, whose
key is case-folded on Windows and not on POSIX. A port that got the order wrong would
still produce identical files and pass a naive comparison.

Why this gate and not just the golden harness: golden compares two *emitters* end to end,
so it can only run once Node writes real bundles. This runs against the render core alone
and covers axes golden does not reach at all (`native_catalog`, `laws_prefix`, and every
posture and mode against a themed tree).

Matrix: every theme on the default axes, every axis combination on one theme, and every
posture and mode once. Set GENESEED_PARITY_FULL=1 for the full cartesian product.

Known weak spot, written down rather than discovered later: with no `node` on PATH this
whole class SKIPS, and a skipped suite still reports OK. That is the "gate that never
fires" shape P0 warned about, and the mitigation is procedural — CI must have Node, and
the port's own acceptance runs are worthless without it. Do not read a green suite on a
Node-less machine as evidence the port is intact.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
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

# Mirrors _harness_core.NO_WINDOW: no console flash when the suite runs headless.
_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}


def _cell(theme, footprint="lean", native_catalog=False, laws_prefix="",
          posture="peer", mode="direct"):
    return {"theme": theme, "footprint": footprint, "nativeCatalog": native_catalog,
            "lawsPrefix": laws_prefix, "posture": posture, "mode": mode}


def _matrix():
    """The cells to compare. Every axis value appears at least once, and every theme is
    rendered — a token that only one theme defines is exactly the kind of thing a port
    gets wrong."""
    themes = [p.stem for p in build.theme_files()]
    if os.environ.get("GENESEED_PARITY_FULL"):
        cells = [_cell(t, fp, nc, lp)
                 for t in themes for fp in ("lean", "full")
                 for nc in (False, True) for lp in ("", ".claude/")]
    else:
        cells = [_cell(t) for t in themes]
        # One theme carries every axis combination; `imperial` restyles the most prose.
        # It does NOT exercise themed_rel: effective_theme lays STRUCTURE over the theme,
        # so DIR_LAWS/DIR_AGENTS/... resolve to the neutral folder names in all 14 shipped
        # themes and themed_rel is a no-op everywhere. Mutating it away leaves this gate
        # green, and that is correct — there is no reachable behaviour to detect.
        cells += [_cell("imperial", fp, nc, lp)
                  for fp in ("lean", "full") for nc in (False, True)
                  for lp in ("", ".claude/")]
    # Appended to BOTH matrices, not just the quick one: posture and mode are separate
    # axes from the theme cartesian above, and the full run used to drop them — caught by
    # test_the_matrix_covers_every_theme_and_axis, which is the whole reason it exists.
    cells += [_cell("neutral", posture=p) for p in build.posture_names()]
    cells += [_cell("neutral", mode=m) for m in build.mode_names()]
    return cells


def _dump_python(out: Path, cell: dict) -> None:
    """Python's half of one cell, written exactly the way `build()` writes a bundle."""
    with mock.patch.object(_build_core, "POSTURE", cell["posture"]), \
         mock.patch.object(_build_core, "MODE", cell["mode"]):
        _theme, items = build.render_all(cell["theme"], cell["footprint"],
                                         cell["lawsPrefix"],
                                         native_catalog=cell["nativeCatalog"])
    index = []
    for rel, text, src in items:
        index.append([rel, text is not None,
                      src.relative_to(_build_core.SRC).as_posix()])
        if text is None:
            continue                       # binary: build() copies it, nothing to render
        dest = out / "tree" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.json").write_text(json.dumps(index), encoding="utf-8")


def _tree_files(root: Path) -> dict:
    base = root / "tree"
    if not base.is_dir():
        return {}
    return {p.relative_to(base).as_posix(): p for p in base.rglob("*") if p.is_file()}


@unittest.skipUnless(NODE, "node is not on PATH — the render parity gate cannot run")
class RenderParityTests(unittest.TestCase):
    """Byte-identity between js/render.mjs and _build_render.render_all."""

    def test_node_and_python_render_identical_trees(self):
        cells = _matrix()
        with tempfile.TemporaryDirectory(prefix="geneseed-parity-") as tmp_s:
            tmp = Path(tmp_s)
            jobs = []
            for i, cell in enumerate(cells):
                py_out, js_out = tmp / f"py{i}", tmp / f"js{i}"
                _dump_python(py_out, cell)
                jobs.append({**cell, "src": str(_build_core.SRC),
                             "themes": str(_build_core.THEMES), "out": str(js_out)})
            jobs_file = tmp / "jobs.json"
            jobs_file.write_text(json.dumps(jobs), encoding="utf-8")

            r = subprocess.run([NODE, str(ROOT / "tests" / "render_dump.mjs"),
                                str(jobs_file)],
                               capture_output=True, text=True, encoding="utf-8",
                               cwd=ROOT, **_NO_WINDOW)
            self.assertEqual(r.returncode, 0,
                             f"node render_dump failed:\n{r.stdout}\n{r.stderr}")

            for i, cell in enumerate(cells):
                label = (f"theme={cell['theme']} footprint={cell['footprint']} "
                         f"catalog={cell['nativeCatalog']} prefix={cell['lawsPrefix']!r} "
                         f"posture={cell['posture']} mode={cell['mode']}")
                with self.subTest(cell=label):
                    py_out, js_out = tmp / f"py{i}", tmp / f"js{i}"

                    self.assertEqual(
                        json.loads((py_out / "index.json").read_text(encoding="utf-8")),
                        json.loads((js_out / "index.json").read_text(encoding="utf-8")),
                        f"{label}: the item list differs. Either a file was rendered "
                        f"that should not have been (or vice versa), or the order "
                        f"differs — order comes from sorted(SRC.rglob('*')), whose sort "
                        f"key is case-folded on Windows and case-sensitive elsewhere.")

                    py_files, js_files = _tree_files(py_out), _tree_files(js_out)
                    self.assertEqual(sorted(py_files), sorted(js_files),
                                     f"{label}: different files written")
                    differing = [rel for rel in sorted(py_files)
                                 if py_files[rel].read_bytes() != js_files[rel].read_bytes()]
                    if differing:
                        rel = differing[0]
                        a = py_files[rel].read_bytes()
                        b = js_files[rel].read_bytes()
                        hint = ""
                        if a.replace(b"\r\n", b"\n") == b.replace(b"\r\n", b"\n"):
                            hint = ("  (the two agree once newlines are folded — this is "
                                    "the writeText/os.linesep wrapper, not the renderer)")
                        at = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y),
                                  min(len(a), len(b)))
                        self.fail(
                            f"{label}: {len(differing)} of {len(py_files)} file(s) differ."
                            f"{hint}\n  first: {rel} at byte {at}\n"
                            f"  python: {a[max(0, at - 40):at + 40]!r}\n"
                            f"  node:   {b[max(0, at - 40):at + 40]!r}")

    def test_the_matrix_covers_every_theme_and_axis(self):
        """Guards the gate above from shrinking into a smoke test: a matrix that lost its
        themes, or an axis value, would still pass and prove much less."""
        cells = _matrix()
        themes = {p.stem for p in build.theme_files()}
        self.assertEqual({c["theme"] for c in cells} & themes, themes,
                         "not every shipped theme is rendered by the parity matrix")
        self.assertEqual({c["footprint"] for c in cells}, {"lean", "full"})
        self.assertEqual({c["nativeCatalog"] for c in cells}, {False, True})
        self.assertEqual({c["lawsPrefix"] for c in cells}, {"", ".claude/"})
        self.assertTrue({c["posture"] for c in cells} >= set(build.posture_names()))
        self.assertTrue({c["mode"] for c in cells} >= set(build.mode_names()))


if __name__ == "__main__":
    unittest.main()
