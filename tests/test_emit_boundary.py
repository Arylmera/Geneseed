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


def _rename_owned_dir(out: Path, home: Path) -> None:
    """A prior build recorded a DIFFERENT name for the laws dir, and that dir still
    exists. The next build must wipe it — the orphan branch `SRC_DIRS_MARKER` exists for
    and that no uniform matrix reaches, because DIR_* resolves the same in all 14 themes."""
    _marker(out, {"laws": "leges", "agents": "agents", "skills": "skills"})
    (out / "leges").mkdir(exist_ok=True)
    (out / "leges" / "stale.md").write_text("orphaned by a rename\n", encoding="utf-8")


def _suspicious_owned_dir(out: Path, home: Path) -> None:
    """The same record, holding a name that escapes the bundle. `build` must REFUSE it,
    warn naming the value, and leave the target alone — this is the only path in the
    render half where file content chooses the argument of a recursive delete.

    The name carries a non-ASCII character on purpose: the warning renders it through
    `ascii()`, so the cell also pins Python's `\\xNN` escaping against the port's."""
    _marker(out, {"laws": "../évil", "agents": "agents", "skills": "skills"})
    victim = out.parent / "évil"
    victim.mkdir(exist_ok=True)
    (victim / "precious.txt").write_text("not the build's to delete\n", encoding="utf-8")


def _user_edits_between_emits(out: Path, home: Path) -> None:
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


def _legacy_wiki_manifest(out: Path, home: Path) -> None:
    """An install seeded before the JSONC rename. `wiki.jsonc` must NOT be created beside
    it: seeding a second manifest would fork the user's declarations, and the consumers
    still honour the old name."""
    (out / "wiki.json").write_text('{"wikis": []}\n', encoding="utf-8")


def _install_is_newer_than_source(out: Path, home: Path) -> None:
    """A deployed install stamped with a release NEWER than the source tree's — the
    forgot-to-pull trap. Warns, never blocks, and warns on STDOUT while its neighbour in
    the same function warns on stderr; the split is exactly what this gate compares."""
    (out / ".geneseed-version").write_text(
        "deadbeefcafe (built 2099-01-01) [release 999.0.0]\n", encoding="utf-8")


def _non_string_owned_dirs(out: Path, home: Path) -> None:
    """The same record holding values that are not strings at all.

    Three disagreements in one cell: `ascii()` of a list and of an int (JS `String()`
    matches neither), and Python's truthiness of an EMPTY container — `if []` is false,
    where `if ([])` in JS is true, so a naive port warns about a value Python skips in
    silence and the divergence lands only on stderr, only from a hand-edited file."""
    _marker(out, {"laws": ["évil"], "agents": [], "skills": 123})


def _preexisting_user_dir(out: Path, home: Path) -> None:
    """`out` is NOT a Geneseed bundle and already holds an `agents/`. The build must keep
    it and say so — on stdout, which is the stream this gate exists to compare."""
    (out / "agents").mkdir(parents=True, exist_ok=True)
    (out / "agents" / "mine.md").write_text("the user's own\n", encoding="utf-8")


# ------------------------------------------------------------ the claude-shaped emits
# `--out` is not the target for these: `_emit_claude_core` writes into <cfg> (the config
# dir for a *-global emit, <root>/.claude|.bob|.github for a project one) and takes `out`
# only as the LEGACY BUNDLE to migrate a memory/notebook store from. That asymmetry is
# what the two migration cells below exercise.

def _legacy_stores(out: Path, home: Path) -> None:
    """A sibling Harness bundle at `out` holding memory and notebook stores, with the
    global config dir still empty. `_global_memory`/`_global_notebook` must migrate them
    in — the one-time copy that keeps a host switch from losing learned facts.

    It copies ARBITRARY USER FILES, which is why the fixture plants a `__pycache__/`
    entry: `Path.rglob("*")` here does NOT filter it, unlike the walk behind
    `source_fingerprint`, so a port that reused the filtering one drops a file silently.
    A legacy bundle really can carry one — Geneseed ships a `.py` skill script."""
    for rel, body in (("memory/learned.md", "# a fact from the old host\n"),
                      ("memory/__pycache__/stale.pyc", "not source, still the user's\n"),
                      ("memory/sub/deep.md", "# nested\n"),
                      ("notebook/scratch.md", "# the agent's own scratch\n")):
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding="utf-8")


def _legacy_anamnesis(out: Path, home: Path) -> None:
    """The same migration, through the SECOND alias. `memory/` is present but EMPTY, so
    the loop must skip it and fall through to the themed `anamnesis/` name a
    differently-themed older install used.

    Empty rather than absent on purpose: `is_dir() and any(iterdir())` is two predicates,
    and an absent dir exercises only the first. A port that dropped the emptiness half
    would report `migrated memory/` having copied nothing, and the store would then be
    seeded by neither path."""
    (out / "memory").mkdir(parents=True, exist_ok=True)
    dest = out / "anamnesis" / "vault.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("# migrated from a themed store\n", encoding="utf-8")


def _legacy_in_subfolder(out: Path, home: Path) -> None:
    """The legacy store inside the BUNDLE, with the bundle in a subfolder of the repo.

    `emit_claude(theme, out, root)` writes into `root/.claude` and takes `out` — the
    sibling Harness bundle — only as the migration source. With the default `root == out`
    the two are the same directory, so every cell before this one would pass just as
    happily if the port had derived the legacy path from `<cfg>`'s parent instead of
    reading it from the job. This is the `opencode/bundle-in-subfolder` finding one level
    out: a gate written to catch degenerate fixtures can ship with one."""
    dest = out / "Harness" / "memory" / "carried-over.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("# a fact from the bundle's own store\n", encoding="utf-8")


def _user_owns_claude_files(out: Path, home: Path) -> None:
    """A project `.claude/` the user got to first. Three claims in one cell:

    * `agents/reviewer.md` collides with a Geneseed spec and is NOT in a prior manifest —
      claim-on-create must keep it, warn, and leave it out of `owned`;
    * `.gitignore` already exists, so the emit must neither rewrite it nor own it (the
      third of that branch's three arms — the other two are reached by any re-emit cell);
    * `excludes.json` is the sovereign-repo list, seeded once and never overwritten."""
    (out / ".claude" / "agents").mkdir(parents=True, exist_ok=True)
    (out / ".claude" / "agents" / "reviewer.md").write_text(
        "---\nname: reviewer\n---\n\nmy own reviewer\n", encoding="utf-8")
    (out / ".claude" / ".gitignore").write_text("# mine, not Geneseed's\n", encoding="utf-8")
    (out / ".claude" / "excludes.json").write_text(
        '{"excludes": ["C:/work/secret"]}\n', encoding="utf-8")


def _claude_user_edits(out: Path, home: Path) -> None:
    """Everything a Claude-shaped install promises never to overwrite, CHANGED between
    the two emits — plus prose around the CLAUDE.md managed block.

    Without the edit these are invisible to a byte comparison: emit two rewrites the same
    bytes emit one wrote, so deleting every `if not exists` guard produces an identical
    tree. `memory/README.md` and `notebook/README.md` are the sharp ones — they are
    SEEDED from src, so only an edit can tell "kept the store" from "re-seeded it"."""
    cfg = out / ".claude"
    (cfg / "memory" / "README.md").write_text("the agent rewrote the store's charter\n",
                                              encoding="utf-8")
    (cfg / "memory" / "MEMORY.md").write_text("# Memory Index\n\n- a learned fact\n",
                                              encoding="utf-8")
    (cfg / "notebook" / "README.md").write_text("the agent rewrote its own charter\n",
                                                encoding="utf-8")
    (cfg / "notebook" / "NOTEBOOK.md").write_text("# Notebook Index\n\n- a page\n",
                                                  encoding="utf-8")
    (cfg / "excludes.json").write_text('{"excludes": ["C:/work/secret"]}\n', encoding="utf-8")
    (cfg / "user-rules.md").write_text("# User rules\n\n## R1 — mine\n", encoding="utf-8")
    (cfg / "PROFILE.md").write_text("# Your profile\n\nmine\n", encoding="utf-8")
    (cfg / "wiki.jsonc").write_text('{"wikis": [{"name": "Brain"}]}\n', encoding="utf-8")
    # Prose on BOTH sides of the block: the merge must replace only what is between the
    # delimiters, and the replacement text is the render half's `claudeMdText`.
    cm = out / "CLAUDE.md"
    text = cm.read_text(encoding="utf-8")
    cm.write_text("# My own preamble\n\nkeep me above.\n\n" + text
                  + "\nand keep me below.\n", encoding="utf-8")


def _legacy_wiki_claude(out: Path, home: Path) -> None:
    """A `.claude/` seeded before the JSONC rename. No second manifest may appear."""
    (out / ".claude").mkdir(parents=True, exist_ok=True)
    (out / ".claude" / "wiki.json").write_text('{"wikis": []}\n', encoding="utf-8")


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
    # `root` != `out`: the bundle in a subfolder of the project. Node uses BOTH paths —
    # the bundle goes to `out`, `.opencode/` to `root` — and no golden cell passes
    # `--root` at all, so without this the two runtimes are never compared on the
    # arrangement every repo-with-a-Harness-folder install actually uses.
    {"id": "opencode/bundle-in-subfolder", "emit": "opencode", "theme": "neutral",
     "subfolder": True, "repeat": 2},
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
    # The six Claude-shaped emits. Until they crossed the seam their golden cells
    # compared Python against Python, so `settings(.local).json`, the CLAUDE.md managed
    # block, the memory/notebook stores and the lean laws under <cfg> had never been
    # byte-compared between the two runtimes at all.
    {"id": "claude/project", "emit": "claude", "theme": "neutral", "repeat": 2},
    {"id": "claude/project-lean", "emit": "claude", "theme": "imperial",
     "footprint": "lean"},
    # Global + lean: the one arrangement where `laws_prefix` must come out EMPTY. The
    # relative path from the carrier's dir to <cfg> is the same dir, which Python spells
    # '.' and `path.relative` spells '' — get that wrong and every lean pointer in the
    # preamble becomes an absolute `/laws/universal.md`.
    {"id": "claude/global-lean", "emit": "claude-global", "theme": "neutral",
     "footprint": "lean", "repeat": 2},
    {"id": "claude/legacy-stores", "emit": "claude-global", "theme": "neutral",
     "prepare": {1: _legacy_stores}},
    {"id": "claude/legacy-anamnesis", "emit": "claude-global", "theme": "neutral",
     "prepare": {1: _legacy_anamnesis}},
    {"id": "claude/bundle-in-subfolder", "emit": "claude", "theme": "neutral",
     "subfolder": True, "prepare": {1: _legacy_in_subfolder}},
    {"id": "claude/user-owns-files", "emit": "claude", "theme": "neutral", "repeat": 2,
     "prepare": {1: _user_owns_claude_files}},
    {"id": "claude/user-edits", "emit": "claude", "theme": "neutral", "repeat": 2,
     "prepare": {2: _claude_user_edits}},
    {"id": "claude/legacy-wiki", "emit": "claude", "theme": "neutral",
     "prepare": {1: _legacy_wiki_claude}},
    {"id": "bob/project", "emit": "bob", "theme": "neutral", "repeat": 2},
    # Bob GLOBAL is the emit with no managed block at all: rules/geneseed.md carries the
    # preamble, re-rendered with a `../` prefix, and `claudeMdText` must come back null
    # or Python would write an ~/.bob/AGENTS.md that Bob never loads.
    {"id": "bob/global-lean", "emit": "bob-global", "theme": "imperial",
     "footprint": "lean", "repeat": 2},
    {"id": "copilot/project-lean", "emit": "copilot", "theme": "neutral",
     "footprint": "lean", "repeat": 2},
    {"id": "copilot/global", "emit": "copilot-global", "theme": "neutral"},
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
        if cell.get("subfolder"):
            # The bundle lives UNDER the project root: `out` and `root` diverge, and the
            # child uses both — `.opencode/` goes to root while AGENT.md stays in out.
            argv[argv.index("--out") + 1] = str(out / "Harness")
            argv += ["--root", str(out)]
        prepare = cell.get("prepare", {})
        proc = None
        for n in range(1, cell.get("repeat", 1) + 1):
            if n in prepare:
                out.mkdir(parents=True, exist_ok=True)
                prepare[n](out, home)
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
                              "files/non-string-owned-dirs",
                              "opencode/bundle-in-subfolder")}

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

        sub = got["opencode/bundle-in-subfolder"]
        self.assertIn("out/.opencode/agents/reviewer.md", sub["files"],
                      "the native layer did not land in `root` — the cell collapsed back "
                      "to root == out and compares nothing new")
        self.assertIn("out/Harness/AGENT.md", sub["files"],
                      "the bundle did not land in the subfolder")
        self.assertIn(b'"Harness/AGENT.md"',
                      sub["files"].get("out/opencode.json", b""),
                      "the instruction path is not prefixed with the bundle's location, "
                      "so it would not resolve from the project root")

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

    def test_the_claude_cells_reach_the_branches_they_name(self):
        """The same guard, for the six Claude-shaped emits. Every cell above compares two
        trees and passes when they match — including when they match because the branch
        it was written for never ran. These assertions are what make the difference
        between "the two runtimes agree" and "the two runtimes agree about something".

        Two shapes are guarded here that no earlier cell could express: a write-once file
        the second emit must NOT rewrite (only detectable because the fixture CHANGED it
        first), and a render whose product never lands in the child's own tree — the
        CLAUDE.md managed block, which Python writes from the text Node computed."""
        got = {c["id"]: _run_side(c, js=True) for c in CELLS
               if c["id"].startswith(("claude/", "bob/", "copilot/"))}

        proj = got["claude/project"]
        self.assertIn(b"<!-- BEGIN GENESEED -->", proj["files"].get("out/CLAUDE.md", b""),
                      "no managed block in CLAUDE.md — the render half's `claudeMdText` "
                      "never reached the merge")
        self.assertIn(b"claudeMdExcludes",
                      proj["files"].get("out/.claude/settings.local.json", b""),
                      "no project-bypasses-global exclude — `hasAgentText` did not cross "
                      "the seam, and it is a DIFFERENT predicate from `claudeMdText`")
        self.assertIn(b'".gitignore"',
                      proj["files"].get("out/.claude/.geneseed-manifest.json", b""),
                      "a .gitignore Geneseed created on emit one stopped being owned on "
                      "emit two — the prune would then delete it")
        self.assertIn(b"settings.local.json", proj["files"].get("out/.claude/.gitignore", b""),
                      "the Claude-only .gitignore line is missing")

        lean = got["claude/project-lean"]
        self.assertIn("out/.claude/laws/universal.md", lean["files"],
                      "the lean footprint shipped no standalone laws file — "
                      "_ship_lean_laws never ran, and it is the render that used to sit "
                      "on the far side of a wiring stage")
        self.assertIn(b"`.claude/laws/universal.md`", lean["files"].get("out/CLAUDE.md", b""),
                      "the lean pointer is not prefixed with the marker dir, so it does "
                      "not resolve from the repo-root carrier")
        self.assertIn(b'"laws/universal.md"',
                      lean["files"].get("out/.claude/.geneseed-manifest.json", b""),
                      "the lean laws were written but not CLAIMED — a later switch back "
                      "to full would leave them behind as dead weight, and writing them "
                      "is only half of what _ship_lean_laws does")

        glob = got["claude/global-lean"]
        self.assertIn(b"`laws/universal.md`", glob["files"].get("home/.claude/CLAUDE.md", b""),
                      "the global lean pointer is not bare — `os.path.relpath` answers "
                      "'.' for an identical pair where `path.relative` answers '', and "
                      "an unguarded port turns the prefix into a leading slash")

        stores = got["claude/legacy-stores"]
        self.assertIn(b"migrated memory/ -> memory/", stores["stdout"])
        self.assertIn(b"migrated notebook/", stores["stdout"])
        self.assertIn("home/.claude/memory/__pycache__/stale.pyc", stores["files"],
                      "the migration dropped a __pycache__ entry — this walk keeps "
                      "everything, unlike the one behind source_fingerprint")
        self.assertIn("home/.claude/memory/sub/deep.md", stores["files"])
        self.assertNotIn("home/.claude/memory/README.md", stores["files"],
                         "the store was SEEDED as well as migrated — the two are "
                         "exclusive, and only a populated legacy bundle can tell")

        anam = got["claude/legacy-anamnesis"]
        self.assertIn(b"migrated anamnesis/ -> memory/", anam["stdout"],
                      "the second store alias was never tried — either the empty "
                      "`memory/` beside it was treated as a store, or the alias is gone")
        self.assertIn("home/.claude/memory/vault.md", anam["files"])

        sub = got["claude/bundle-in-subfolder"]
        self.assertIn("out/.claude/memory/carried-over.md", sub["files"],
                      "the migration source is not `--out` — with root == out the two "
                      "are the same directory and every other cell would still pass")
        self.assertIn("out/CLAUDE.md", sub["files"],
                      "the carrier did not land at the project ROOT")

        mine = got["claude/user-owns-files"]
        self.assertIn(b"kept your existing agents/reviewer.md", mine["stderr"],
                      "claim-on-create did not fire for a colliding user agent")
        self.assertIn(b"my own reviewer", mine["files"].get("out/.claude/agents/reviewer.md", b""),
                      "the user's own agent was clobbered")
        self.assertNotIn(b'".gitignore"',
                         mine["files"].get("out/.claude/.geneseed-manifest.json", b""),
                         "Geneseed claimed a .gitignore it found already there — "
                         "uninstall would then delete the user's file")
        self.assertIn(b"mine, not Geneseed's", mine["files"].get("out/.claude/.gitignore", b""))
        self.assertIn(b"C:/work/secret", mine["files"].get("out/.claude/excludes.json", b""),
                      "the sovereign-repo list was overwritten by its stub")

        edits = got["claude/user-edits"]
        for rel, needle in ((".claude/memory/README.md", b"rewrote the store's charter"),
                            (".claude/memory/MEMORY.md", b"a learned fact"),
                            (".claude/notebook/README.md", b"rewrote its own charter"),
                            (".claude/notebook/NOTEBOOK.md", b"- a page"),
                            (".claude/excludes.json", b"C:/work/secret"),
                            (".claude/user-rules.md", b"R1"),
                            (".claude/PROFILE.md", b"mine"),
                            (".claude/wiki.jsonc", b"Brain")):
            self.assertIn(needle, edits["files"].get(f"out/{rel}", b""),
                          f"{rel} was rewritten by the re-emit — it is written once and "
                          f"never re-emitted, and a cell that did not CHANGE it first "
                          f"could not tell the difference")
        carrier = edits["files"].get("out/CLAUDE.md", b"")
        self.assertIn(b"keep me above", carrier)
        self.assertIn(b"and keep me below", carrier)
        self.assertEqual(carrier.count(b"<!-- BEGIN GENESEED -->"), 1,
                         "the managed block stacked instead of being replaced")

        self.assertNotIn("out/.claude/wiki.jsonc", got["claude/legacy-wiki"]["files"],
                         "a second wiki manifest was seeded beside the legacy one")

        bob = got["bob/project"]
        self.assertIn(b"workspace shadow stub",
                      bob["files"].get("out/.bob/rules/geneseed.md", b""),
                      "the project Bob rules file is not the slim stub — a full second "
                      "preamble copy doubles the per-turn token cost")
        self.assertIn(b"<!-- BEGIN GENESEED -->", bob["files"].get("out/AGENTS.md", b""))
        self.assertIn("out/.bob/settings.json", bob["files"],
                      "Bob documents no settings.local.json variant")

        bobg = got["bob/global-lean"]
        rules = bobg["files"].get("home/.bob/rules/geneseed.md", b"")
        self.assertNotIn(b"workspace shadow stub", rules,
                         "the GLOBAL Bob rules file is the stub — at global scope it IS "
                         "the preamble, the sole carrier of the harness voice")
        self.assertIn(b"`../laws/universal.md`", rules,
                      "the global Bob preamble's pointers are not `../`-prefixed, so "
                      "they resolve under rules/ where nothing exists")
        self.assertNotIn("home/.bob/AGENTS.md", bobg["files"],
                         "a global ~/.bob/AGENTS.md was written — Bob never auto-loads "
                         "one, and `claudeMdText` must come back null to prevent it")

        cop = got["copilot/project-lean"]
        self.assertIn("out/.github/agents/reviewer.agent.md", cop["files"],
                      "the Copilot agent dialect did not run")
        self.assertNotIn("out/.github/settings.json", cop["files"],
                         "Copilot has no settings.json and no hook mechanism")
        self.assertIn(b"<!-- BEGIN GENESEED -->",
                      got["copilot/global"]["files"]
                      .get("home/.copilot/copilot-instructions.md", b""))

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
        and no bundle-emitting cell can construct this.

        Both job kinds are checked, because the message carries a `context=` the CALLER
        chooses — `theme '<name>'` for the bundle, `claude-<scope>` for the six
        Claude-shaped emits. A port that hardcoded one of them would diverge on a path no
        cell can reach, since every cell renders a complete source."""
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

            # The same refusal through the claude job, whose `context=` is built from the
            # SCOPE rather than the theme — and whose <cfg> must also stay untouched.
            err2 = io.StringIO()
            with mock.patch.object(_build_core, "SRC", src), \
                 contextlib.redirect_stderr(err2), \
                 self.assertRaises(SystemExit) as py_exit2:
                build.assert_source_complete(None, context="claude-global")

            cfg_dir = td / "cfg"
            job2 = {"kind": "claude", "cfg": {**_build_core.js_cfg(), "src": str(src)},
                    "theme": "neutral", "cfgDir": str(cfg_dir),
                    "claudeMd": str(cfg_dir / "CLAUDE.md"), "scope": "global",
                    "out": None, "footprint": "full", "host": "claude",
                    "nativeCatalog": True, "oldOwned": []}
            job_file.write_text(json.dumps(job2), encoding="utf-8")
            proc2 = subprocess.run([NODE, str(ROOT / "js" / "emit.mjs"), str(job_file)],
                                   cwd=str(ROOT), capture_output=True, **_NO_WINDOW)
            payload2 = json.loads(proc2.stdout)

            self.assertIn("claude-global", err2.getvalue())              # the fixture bites
            self.assertFalse(payload2["ok"])
            self.assertEqual(payload2["exit"], py_exit2.exception.code)
            self.assertEqual(payload2["stderr"], err2.getvalue())
            self.assertNotIn("error", payload2)
            self.assertFalse(cfg_dir.exists(),
                             "the claude job created <cfg> before refusing")


if __name__ == "__main__":
    unittest.main()
