"""The process boundary: `python build.py` renders the same bytes whichever runtime ran.

Every earlier parity gate compares the two implementations SIDE BY SIDE, in one process,
by calling both and diffing the results. None of them exercises the thing that actually
ships: `build.py` spawning `node js/emit.mjs`, handing it a job, and reading a protocol
document back. This gate runs the real generator twice over the same cell — once with Node
driving RENDER, once with `GENESEED_NO_JS=1` forcing the Python body — and compares
everything the two processes produced.

WHAT IT COMPARES THAT GOLDEN DOES NOT: **stdout and stderr, byte for byte**. That matters
more than it sounds. The generator prints its progress on stdout, and so does the
protocol — the same stream — so a port that let one stray byte escape onto it would
either corrupt the handoff or silently change what the user sees. It is also the stream
the emitted git-gate and rule-gate hooks signal on, where a stray byte turns a blocking
gate into a silently permissive one that still reports success (the P0 finding). The
capture in `js/emit.mjs` makes that structurally impossible; this is what proves it.

The cells deliberately reach the branches a plain first emit cannot: a re-emit over a
finished bundle, a renamed owned dir recorded in `.geneseed-srcdirs.json`, a SUSPICIOUS
name recorded there (the one file-driven path into a recursive delete), a non-bundle `out`
with a pre-existing `agents/`, and a truncated source tree. Those are the paths where the
two runtimes have the most room to disagree and where golden's uniform matrix has none.

Known weak spot, stated rather than discovered later: with no `node` on PATH this class
SKIPS, and a skipped suite still reports OK — the same shape `tests/test_render_parity.py`
documents. Worse here, because `_build_core.js_render_available()` also falls back
silently, so on such a machine BOTH sides of every comparison run the Python body and
every cell passes while proving nothing. CI must have Node.

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

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))

import golden  # noqa: E402  — the sandbox env and the snapshot/normalise pair, reused
import _build_core  # noqa: E402

NODE = shutil.which("node")

_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}

SRC_DIRS_MARKER = ".geneseed-srcdirs.json"


# --------------------------------------------------------------------------- cells

def _marker(out: Path, resolved: dict) -> None:
    """Rewrite `.geneseed-srcdirs.json` — the record a later build prunes against."""
    (out / SRC_DIRS_MARKER).write_text(json.dumps(resolved, indent=2) + "\n",
                                       encoding="utf-8")


def _rename_owned_dir(out: Path) -> None:
    """A prior build recorded a DIFFERENT name for the laws dir, and that dir still
    exists. The next build must wipe it — the orphan branch `SRC_DIRS_MARKER` exists for
    and that no uniform matrix reaches, because DIR_* resolves the same in all 14 themes."""
    _marker(out, {"laws": "leges", "agents": "agents", "skills": "skills"})
    (out / "leges").mkdir(exist_ok=True)
    (out / "leges" / "stale.md").write_text("orphaned by a rename\n", encoding="utf-8")


def _suspicious_owned_dir(out: Path) -> None:
    """The same record, holding a name that escapes the bundle. `build` must REFUSE it,
    warn naming the value, and leave the target alone — this is the only path in the
    render half where file content chooses the argument of a recursive delete.

    The name carries a non-ASCII character on purpose: the warning renders it through
    `ascii()`, so the cell also pins Python's `\\xNN` escaping against the port's."""
    _marker(out, {"laws": "../évil", "agents": "agents", "skills": "skills"})
    victim = out.parent / "évil"
    victim.mkdir(exist_ok=True)
    (victim / "precious.txt").write_text("not the build's to delete\n", encoding="utf-8")


def _user_edits_between_emits(out: Path) -> None:
    """Everything the bundle promises never to overwrite, CHANGED after the first build.

    Without this the write-once contracts are untestable by byte comparison: a second
    emit that rewrote them would produce the very same bytes the first one did, so
    deleting every `if not dest.exists()` guard is invisible. The notebook is the sharpest
    case — it is the agent's sovereign space, seeded once so the agent may rewrite its own
    rules, and only `.gitignore` is re-asserted."""
    (out / "notebook" / "README.md").write_text(
        "the agent rewrote its own charter\n", encoding="utf-8")
    (out / "memory" / "MEMORY.md").write_text(
        "# Memory Index\n\n- a fact the agent learned\n", encoding="utf-8")
    (out / "context.json").write_text('{"context": [{"path": "docs/"}]}\n', encoding="utf-8")
    (out / "user-rules.md").write_text("# User rules\n\n## R1 — mine\n", encoding="utf-8")
    (out / "PROFILE.md").write_text("# Your profile\n\nmine\n", encoding="utf-8")
    (out / ".gitignore").write_text("# customised by the host repo\n", encoding="utf-8")


def _legacy_wiki_manifest(out: Path) -> None:
    """An install seeded before the JSONC rename. `wiki.jsonc` must NOT be created beside
    it: seeding a second manifest would fork the user's declarations, and the consumers
    still honour the old name."""
    (out / "wiki.json").write_text('{"wikis": []}\n', encoding="utf-8")


def _install_is_newer_than_source(out: Path) -> None:
    """A deployed install stamped with a release NEWER than the source tree's — the
    forgot-to-pull trap. Warns, never blocks, and warns on STDOUT while its neighbour in
    the same function warns on stderr; the split is exactly what this gate compares."""
    (out / ".geneseed-version").write_text(
        "deadbeefcafe (built 2099-01-01) [release 999.0.0]\n", encoding="utf-8")


def _non_string_owned_dirs(out: Path) -> None:
    """The same record holding values that are not strings at all.

    Three disagreements in one cell: `ascii()` of a list and of an int (JS `String()`
    matches neither), and Python's truthiness of an EMPTY container — `if []` is false,
    where `if ([])` in JS is true, so a naive port warns about a value Python skips in
    silence and the divergence lands only on stderr, only from a hand-edited file."""
    _marker(out, {"laws": ["évil"], "agents": [], "skills": 123})


def _preexisting_user_dir(out: Path) -> None:
    """`out` is NOT a Geneseed bundle and already holds an `agents/`. The build must keep
    it and say so — on stdout, which is the stream this gate exists to compare."""
    (out / "agents").mkdir(parents=True, exist_ok=True)
    (out / "agents" / "mine.md").write_text("the user's own\n", encoding="utf-8")


CELLS = [
    {"id": "files/neutral/full", "emit": "files", "theme": "neutral", "footprint": "full"},
    {"id": "files/imperial/lean", "emit": "files", "theme": "imperial", "footprint": "lean"},
    {"id": "opencode/neutral/full", "emit": "opencode", "theme": "neutral",
     "footprint": "full"},
    {"id": "opencode/imperial/lean", "emit": "opencode", "theme": "imperial",
     "footprint": "lean"},
    # Re-emit: claim-on-create, the write-before-delete prune, the notebook's write-once
    # contract and every `ensure_*` stub's "already there" branch only run on emit two.
    {"id": "files/re-emit", "emit": "files", "theme": "neutral", "repeat": 2},
    {"id": "opencode/re-emit", "emit": "opencode", "theme": "neutral", "repeat": 2},
    # The env-gated writers. Off by default, so without this cell the primary agent and
    # the whole command layer are unreachable code as far as this gate is concerned.
    {"id": "opencode/primary+commands", "emit": "opencode", "theme": "neutral", "repeat": 2,
     "env": {"GENESEED_PRIMARY": "1", "GENESEED_COMMANDS": "1"}},
    {"id": "files/renamed-owned-dir", "emit": "files", "theme": "neutral", "repeat": 2,
     "prepare": {2: _rename_owned_dir}},
    {"id": "files/suspicious-owned-dir", "emit": "files", "theme": "neutral", "repeat": 2,
     "prepare": {2: _suspicious_owned_dir}},
    {"id": "files/non-string-owned-dirs", "emit": "files", "theme": "neutral", "repeat": 2,
     "prepare": {2: _non_string_owned_dirs}},
    {"id": "files/non-bundle-out", "emit": "files", "theme": "neutral",
     "prepare": {1: _preexisting_user_dir}},
    {"id": "files/user-edits", "emit": "files", "theme": "neutral", "repeat": 2,
     "prepare": {2: _user_edits_between_emits}},
    {"id": "files/legacy-wiki", "emit": "files", "theme": "neutral",
     "prepare": {1: _legacy_wiki_manifest}},
    {"id": "files/downgrade", "emit": "files", "theme": "neutral", "repeat": 2,
     "prepare": {2: _install_is_newer_than_source}},
]


def _run_side(cell: dict, js: bool) -> dict:
    """One cell, one runtime, one fresh sandbox. Returns exit code, both normalised
    streams, and the snapshot of every file produced."""
    with tempfile.TemporaryDirectory(prefix="geneseed-boundary-") as td_s:
        td = Path(td_s)
        home, out = td / "home", td / "out"
        home.mkdir()
        env = golden.cell_env(home)
        # cell_env clears GENESEED_* by prefix (a knob added later is neutralised by
        # default), so both this port switch and the emit's own flags go back in AFTER it.
        if not js:
            env["GENESEED_NO_JS"] = "1"
        env.update(cell.get("env", {}))

        argv = [sys.executable, "build.py", "--theme", cell["theme"],
                "--emit", cell["emit"], "--footprint", cell.get("footprint", "full"),
                "--out", str(out)]
        prepare = cell.get("prepare", {})
        proc = None
        for n in range(1, cell.get("repeat", 1) + 1):
            if n in prepare:
                out.mkdir(parents=True, exist_ok=True)
                prepare[n](out)
            proc = subprocess.run(argv, cwd=str(ROOT), env=env, capture_output=True,
                                  **_NO_WINDOW)
        roots = [("<HOME>", home), ("<OUT>", out), ("<TD>", td)]
        return {"exit": proc.returncode,
                "stdout": golden._normalise(proc.stdout, roots),
                "stderr": golden._normalise(proc.stderr, roots),
                "files": golden._snapshot(td, roots)}


@unittest.skipUnless(NODE, "node is not on PATH — the emit boundary cannot be exercised")
class EmitBoundaryTests(unittest.TestCase):

    def test_node_driven_and_python_emits_are_indistinguishable(self):
        for cell in CELLS:
            with self.subTest(cell=cell["id"]):
                py = _run_side(cell, js=False)
                node = _run_side(cell, js=True)
                self.assertEqual(py["exit"], node["exit"],
                                 f"{cell['id']}: exit codes differ\n"
                                 f"  python stderr: {py['stderr'][-400:]!r}\n"
                                 f"  node   stderr: {node['stderr'][-400:]!r}")
                self.assertEqual(py["stdout"], node["stdout"],
                                 f"{cell['id']}: STDOUT differs. Either the port changed a "
                                 f"progress line, or a byte escaped onto the stream the "
                                 f"protocol and the hook gates both signal on.")
                self.assertEqual(py["stderr"], node["stderr"],
                                 f"{cell['id']}: STDERR differs")
                self.assertEqual(sorted(py["files"]), sorted(node["files"]),
                                 f"{cell['id']}: different files written")
                differing = [k for k in sorted(py["files"])
                             if py["files"][k] != node["files"][k]]
                if differing:
                    k = differing[0]
                    a, b = py["files"][k], node["files"][k]
                    at = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y),
                              min(len(a), len(b)))
                    hint = ("  (they agree once newlines are folded — the writeText/"
                            "os.linesep wrapper, not the renderer)"
                            if a.replace(b"\r\n", b"\n") == b.replace(b"\r\n", b"\n") else "")
                    self.fail(f"{cell['id']}: {len(differing)} of {len(py['files'])} file(s) "
                              f"differ.{hint}\n  first: {k} at byte {at}\n"
                              f"  python: {a[max(0, at - 40):at + 40]!r}\n"
                              f"  node:   {b[max(0, at - 40):at + 40]!r}")

    def test_the_cells_reach_the_branches_they_name(self):
        """Guards the gate above from passing vacuously. Each of these cells exists for
        ONE hard-to-reach branch, and a cell that stopped reaching it would still compare
        two identical trees and report success — the exact shape that made an earlier
        parity assertion green against a configuration where its subject cannot occur."""
        got = {c["id"]: _run_side(c, js=True) for c in CELLS
               if c["id"] in ("files/renamed-owned-dir", "files/suspicious-owned-dir",
                              "files/non-bundle-out", "opencode/primary+commands",
                              "files/user-edits", "files/legacy-wiki", "files/downgrade",
                              "files/non-string-owned-dirs")}

        renamed = got["files/renamed-owned-dir"]
        self.assertEqual(renamed["exit"], 0)
        self.assertNotIn("out/leges/stale.md", renamed["files"],
                         "the orphaned themed dir survived — the rename-prune branch "
                         "never ran, so this cell proves nothing")

        suspicious = got["files/suspicious-owned-dir"]
        self.assertIn(b"suspicious prior dir name", suspicious["stderr"],
                      "the marker guard did not fire")
        self.assertIn(rb"'../\xe9vil'", suspicious["stderr"],
                      "the refused name is not rendered through ascii() — a raw "
                      "interpolation would put the file's own bytes on the terminal")
        self.assertIn("évil/precious.txt", suspicious["files"],
                      "the escaping dir was DELETED — the guard let a marker-supplied "
                      "path reach the recursive delete")

        nonstring = got["files/non-string-owned-dirs"]
        self.assertIn(rb"['\xe9vil']", nonstring["stderr"],
                      "a list value is not rendered the way ascii() renders one")
        self.assertIn(b"name 123 recorded", nonstring["stderr"],
                      "an int value is not rendered the way ascii() renders one")
        self.assertEqual(nonstring["stderr"].count(b"suspicious prior dir name"), 2,
                         "the EMPTY container warned (or one of the two others did not) — "
                         "Python's `if []` is false and JS's is true, and this count is "
                         "the only thing that can tell the difference")

        nonbundle = got["files/non-bundle-out"]
        self.assertIn(b"is not a Geneseed bundle", nonbundle["stdout"],
                      "the non-bundle warning is missing; it is the stdout branch this "
                      "cell exists for")
        self.assertIn("out/agents/mine.md", nonbundle["files"],
                      "the user's pre-existing agents/ was wiped")

        extras = got["opencode/primary+commands"]
        self.assertIn("out/.opencode/agents/orchestrator.md", extras["files"],
                      "GENESEED_PRIMARY did not reach the child — the env-gated writers "
                      "are unreachable and this cell tests nothing")
        self.assertIn("out/.opencode/command/ponytail.md", extras["files"])

        # The write-once contracts. Each of these is a file the second emit MUST have
        # left exactly as `_user_edits_between_emits` wrote it.
        edits = got["files/user-edits"]
        for rel, needle in (("out/notebook/README.md", b"rewrote its own charter"),
                            ("out/memory/MEMORY.md", b"a fact the agent learned"),
                            ("out/context.json", b'"docs/"'),
                            ("out/user-rules.md", b"R1"),
                            ("out/PROFILE.md", b"mine"),
                            ("out/.gitignore", b"customised by the host repo")):
            self.assertIn(needle, edits["files"].get(rel, b""),
                          f"{rel} was overwritten by the re-emit — it is seeded once and "
                          f"never re-emitted, and a cell that did not CHANGE it first "
                          f"could not tell the difference")

        legacy = got["files/legacy-wiki"]
        self.assertNotIn("out/wiki.jsonc", legacy["files"],
                         "a second wiki manifest was seeded beside the legacy one")

        downgrade = got["files/downgrade"]
        self.assertIn(b"installing older Geneseed", downgrade["stdout"],
                      "the downgrade notice did not fire — the cell's planted marker no "
                      "longer parses as newer than the source's release")
        self.assertNotIn(b"installing older Geneseed", downgrade["stderr"],
                         "the downgrade notice moved to stderr; its neighbour in the same "
                         "function warns there and this one deliberately does not")

    def test_the_protocol_owns_stdout(self):
        """The child's real stdout carries exactly one JSON document — no progress line,
        no stray library print, nothing before or after it.

        The second half is what keeps this honest: the progress the generator DID produce
        must come back inside the payload. A run that simply printed nothing would satisfy
        the first assertion and prove the opposite of what is claimed."""
        with tempfile.TemporaryDirectory(prefix="geneseed-protocol-") as td_s:
            td = Path(td_s)
            job = {"kind": "build", "cfg": _build_core.js_cfg(), "theme": "neutral",
                   "out": str(td / "out"), "footprint": "full", "nativeCatalog": False}
            job_file = td / "job.json"
            job_file.write_text(json.dumps(job), encoding="utf-8")
            proc = subprocess.run([NODE, str(ROOT / "js" / "emit.mjs"), str(job_file)],
                                  cwd=str(ROOT), capture_output=True, **_NO_WINDOW)

            self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
            self.assertEqual(proc.stderr, b"",
                             "the child wrote to the REAL stderr; every warning must be "
                             "buffered into the payload so Python re-emits it in Python's "
                             "encoding")
            raw = proc.stdout
            self.assertTrue(raw.startswith(b"{") and raw.endswith(b"}"),
                            f"stdout is not exactly one JSON document: {raw[:120]!r} "
                            f"... {raw[-40:]!r}")
            payload = json.loads(raw)          # rejects trailing bytes on its own
            self.assertTrue(payload["ok"], payload.get("error"))
            self.assertTrue(
                payload["stdout"].startswith("[geneseed] built theme 'neutral'"),
                f"the generator's progress line is not in the payload "
                f"({payload['stdout'][:120]!r}) — the capture is not actually running, so "
                f"the assertion above passed for the wrong reason")

    def test_an_incomplete_source_is_refused_identically(self):
        """`assert_source_complete` is the one refusal in the render half, and it must
        cross the seam intact: same stderr, same exit status. Driven against a fixture
        source tree with one referenced spec removed, because the real `src/` is complete
        and no bundle-emitting cell can construct this."""
        with tempfile.TemporaryDirectory(prefix="geneseed-incomplete-") as td_s:
            td = Path(td_s)
            src = td / "src"
            shutil.copytree(_build_core.SRC, src,
                            ignore=shutil.ignore_patterns("__pycache__"))
            victim = next(p for p in sorted((src / "agents").glob("*.md"))
                          if p.stem != "_template"
                          and f"{{{{DIR_AGENTS}}}}/{p.stem}.md"
                          in (src / "AGENT.md.tmpl").read_text(encoding="utf-8"))
            victim.unlink()

            from unittest import mock
            import build
            import io
            import contextlib
            err = io.StringIO()
            with mock.patch.object(_build_core, "SRC", src), \
                 contextlib.redirect_stderr(err), \
                 self.assertRaises(SystemExit) as py_exit:
                build.assert_source_complete(None, context="theme 'neutral'")

            job = {"kind": "build", "cfg": {**_build_core.js_cfg(), "src": str(src)},
                   "theme": "neutral", "out": str(td / "out"), "footprint": "full",
                   "nativeCatalog": False}
            job_file = td / "job.json"
            job_file.write_text(json.dumps(job), encoding="utf-8")
            proc = subprocess.run([NODE, str(ROOT / "js" / "emit.mjs"), str(job_file)],
                                  cwd=str(ROOT), capture_output=True, **_NO_WINDOW)
            payload = json.loads(proc.stdout)

            self.assertIn(f"agents/{victim.stem}.md", err.getvalue())   # the fixture bites
            self.assertFalse(payload["ok"])
            self.assertEqual(payload["exit"], py_exit.exception.code)
            self.assertEqual(payload["stderr"], err.getvalue())
            self.assertNotIn("error", payload,
                             "a deliberate refusal came back as a crash — Python would "
                             "raise RuntimeError instead of exiting 1")
            self.assertFalse((td / "out").exists(),
                             "the child wrote before refusing; the refusal must land "
                             "BEFORE any destructive write")


if __name__ == "__main__":
    unittest.main()
