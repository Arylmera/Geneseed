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
import re
import shutil
import subprocess
import sys
import tempfile
import contextlib
import io
import unittest
from unittest import mock
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


def _claude_stale_excludes(out: Path, home: Path) -> None:
    """Two prior `settings_excludes` claims, recorded OUT OF ORDER, before the re-emit.

    Every other cell leaves this list one entry long, because `want_excl` is always a
    single path and a fresh install has no prior — so `sorted(set(prior) | set(added))`
    and a plain concatenation produce the same bytes and the sort is invisible. That is
    P3a's one-element-array finding at a new call site: the entries land in the manifest,
    where their ORDER is byte-visible, and the sort only matters once a real install has
    accumulated a second claim. Recording them reversed is what makes the two spellings
    differ.

    The two are PREPENDED to what emit one recorded rather than replacing it — the first
    draft replaced it, and the resulting claim set came back two entries long instead of
    three because the live exclude, already present in settings.json, is not re-added by
    the second emit and so falls out of a prior that no longer names it. Correct
    behaviour ("claim only what Geneseed itself wired"), wrong fixture: it produced the
    same short list this cell exists to lengthen.

    Sorted order is deliberately not insertion order — `CLAUDE.md` sorts first on its
    capital C, and it is recorded last."""
    cfg = out / ".claude"
    manifest = cfg / ".geneseed-manifest.json"
    data = json.loads(manifest.read_text(encoding="utf-8"))
    managed = data.setdefault("managed", {})
    managed["settings_excludes"] = [
        (home / ".claude" / "zz-legacy.md").resolve().as_posix(),
        (home / ".claude" / "aa-legacy.md").resolve().as_posix(),
    ] + list(managed.get("settings_excludes") or [])
    manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _claude_commented_settings(out: Path, home: Path) -> None:
    """A `settings.local.json` the user has commented. The merge must REFUSE to rewrite it.

    Nothing else in this matrix drives that branch, and since P3b the refusal happens
    inside the Node child — so this cell is what compares the two runtimes' decision to
    leave a user's file alone, the warning they print about it, and the claim set they
    fall back to (the manifest's prior, never the canonical groups they did not write)."""
    cfg = out / ".claude"
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / "settings.local.json").write_text(
        '{\n  // my own settings, hand-annotated\n  "model": "opus"\n}\n', encoding="utf-8")


# ------------------------------------------------------------ the opencode-global emit
# The ninth emit, and the last to cross (P3c). Its target is neither `--out` nor a
# subdirectory of it: `_opencode_config_dir()` resolves $XDG_CONFIG_HOME/opencode, which
# `golden.cell_env` points into the sandbox's home. `--out` is passed to this emit ONLY as
# the legacy bundle a memory/notebook store is migrated from, and nothing is written there
# — so a fixture that plants nothing at `--out` cannot tell the two apart.

def _oc_cfg(home: Path) -> Path:
    """The dir `_build_core._opencode_config_dir()` resolves to inside a cell's sandbox.

    Spelled here rather than imported so a fixture cannot accidentally CALL the resolver:
    it is an `_OWNED` name, and the whole P3c boundary decision is that the child never
    learns how the target was derived."""
    return home / ".config" / "opencode"


def _oc_global_user_owns(out: Path, home: Path) -> None:
    """A global OpenCode config dir the user got to first — the claim-on-create arm no
    re-emit reaches, because a re-emit's collisions are all in the prior manifest.

    `agents/reviewer.md` collides with a Geneseed spec and is in no manifest, so it must
    be kept, warned about, and left out of `owned`; `wiki.jsonc` and `excludes.json` are
    seeded once and never overwritten. This is `claude/user-owns-files` at a different
    root, and the roots are the point: every path in this emit is built from `<cfg>`,
    which arrives in the job rather than being resolved on the far side."""
    cfg = _oc_cfg(home)
    (cfg / "agents").mkdir(parents=True, exist_ok=True)
    (cfg / "agents" / "reviewer.md").write_text(
        "---\ndescription: mine\n---\n\nmy own reviewer\n", encoding="utf-8")
    (cfg / "wiki.jsonc").write_text('{"wikis": [{"name": "Brain"}]}\n', encoding="utf-8")
    (cfg / "excludes.json").write_text('{"excludes": ["C:/work/secret"]}\n', encoding="utf-8")


def _oc_global_user_edits(out: Path, home: Path) -> None:
    """The seeded stores, CHANGED between the two emits.

    `memory/README.md` and `notebook/README.md` come FROM src, so emit two rewriting them
    produces the very bytes emit one wrote and deleting the store's "already populated"
    guard is invisible. Only an edit can tell "kept the store" from "re-seeded it"."""
    cfg = _oc_cfg(home)
    (cfg / "memory" / "README.md").write_text("the agent rewrote the store's charter\n",
                                              encoding="utf-8")
    (cfg / "notebook" / "README.md").write_text("the agent rewrote its own charter\n",
                                                encoding="utf-8")
    (cfg / "user-rules.md").write_text("# User rules\n\n## R1 — mine\n", encoding="utf-8")
    (cfg / "PROFILE.md").write_text("# Your profile\n\nmine\n", encoding="utf-8")


def _oc_global_commented_jsonc(out: Path, home: Path) -> None:
    """A commented `opencode.jsonc` in the GLOBAL config dir.

    `opencode/commented-jsonc` does not cover this and could not: that cell's target is
    `<root>/opencode.jsonc`, a different file under a different root, reached from a
    different wire half. What both cells exist for is the same hazard — `mergeOpencodeJson`
    is IDEMPOTENT, so an emit that wired twice (the child merging, then Python merging
    again because the payload lost its `cfgName` signal) leaves a byte-identical TREE. The
    refusal warning printed a second time is the only trace anywhere, and a commented file
    is the only fixture that makes it print at all — which is why this cell is load-bearing
    twice over: the count below names the double wire, and the run's stdout diverges from
    the `GENESEED_NO_JS` side that warns once, so the main comparison catches it too."""
    cfg = _oc_cfg(home)
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / "opencode.jsonc").write_text(
        '{\n  // hand-annotated, do not clobber\n  "$schema": '
        '"https://opencode.ai/config.json"\n}\n', encoding="utf-8")


def _opencode_commented_jsonc(out: Path, home: Path) -> None:
    """A commented `opencode.jsonc`, which `_opencode_target` prefers over the `.json`.

    This is the only cell that reaches `_warn_commented_jsonc` — the ONE routine in the
    wiring layer that prints to STDOUT rather than stderr. That asymmetry is the Python's
    own and is reproduced rather than tidied, and since P3b the print happens inside the
    Node child, where stdout is the protocol's. So the cell proves three things at once:
    the child's buffer captured the line instead of corrupting the handoff, Python
    re-emitted it on its own stdout, and the two runtimes said the same thing in the same
    place. It is also the only cell in which wiring twice would be visible — a second
    merge prints the warning a second time."""
    (out / "opencode.jsonc").write_text(
        '{\n  // hand-annotated, do not clobber\n  "$schema": '
        '"https://opencode.ai/config.json"\n}\n', encoding="utf-8")


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
    # WIRE joined the child at P3b. These three drive the wiring branches nothing else
    # reaches — the excludes union with a real prior, the two comment bail-outs, and the
    # unit's one stdout writer.
    {"id": "claude/stale-excludes", "emit": "claude", "theme": "neutral", "repeat": 2,
     "prepare": {2: _claude_stale_excludes}},
    {"id": "claude/commented-settings", "emit": "claude", "theme": "neutral", "repeat": 2,
     "prepare": {1: _claude_commented_settings}},
    {"id": "opencode/commented-jsonc", "emit": "opencode", "theme": "neutral", "repeat": 2,
     "prepare": {1: _opencode_commented_jsonc}},
    # The NINTH emit, which had no cell at all until P3c and therefore no comparison: its
    # golden cells ran Python against Python and proved determinism, not parity. Six cells,
    # because six of its branches are unreachable from the eight modes already here — the
    # config dir as target, `--out` as a pure migration source, the lean laws beside
    # AGENT.md rather than under a marker dir, claim-on-create in a dir the user co-owns
    # wholesale, and its own commented-`.jsonc`.
    {"id": "opencode-global/neutral/full", "emit": "opencode-global", "theme": "neutral",
     "repeat": 2},
    # Lean, under a second theme. `_ship_lean_laws` writes the standalone laws file under
    # <cfg> with NO marker-dir prefix — this is the emit where the lean pointer resolves
    # bare because AGENT.md and the laws dir are siblings (`laws_prefix=''`, passed by
    # omission, where `_claude_render_py` computes one). The theme also renames the
    # branded theme FILE (themes/geneseed-<name>.json), which is `owned` and therefore in
    # the byte-compared manifest.
    {"id": "opencode-global/imperial/lean", "emit": "opencode-global", "theme": "imperial",
     "footprint": "lean"},
    # The env-gated writers, whose `owned` entries are computed `relative_to(<cfg>)` — a
    # base this emit builds from the job rather than from a repo root.
    {"id": "opencode-global/primary+commands", "emit": "opencode-global", "theme": "neutral",
     "env": {"GENESEED_PRIMARY": "1", "GENESEED_COMMANDS": "1"}},
    # `--out` is the LEGACY BUNDLE, not the target. Reuses the claude fixture: it plants
    # stores at `--out`, which for this emit is a directory nothing is ever written into,
    # so a port that derived the migration source from <cfg> (where it would find the
    # empty destination and fall through to seeding) passes every other cell.
    {"id": "opencode-global/legacy-stores", "emit": "opencode-global", "theme": "neutral",
     "prepare": {1: _legacy_stores}},
    {"id": "opencode-global/user-owns-files", "emit": "opencode-global", "theme": "neutral",
     "repeat": 2, "prepare": {1: _oc_global_user_owns, 2: _oc_global_user_edits}},
    {"id": "opencode-global/commented-jsonc", "emit": "opencode-global", "theme": "neutral",
     "repeat": 2, "prepare": {1: _oc_global_commented_jsonc}},
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
        # The hook shim, read back explicitly because `golden._snapshot` drops it by name.
        # Golden is right to: across REVISIONS the body bakes whichever interpreter and
        # checkout wrote it, so it would differ in every cell and drown the real findings.
        # Here both sides are the same revision on the same machine, so the two bodies must
        # be IDENTICAL — and since P3b it is the Node child that writes this file, through
        # `hookPrefix`, which is the one place a Node driver could plausibly start baking
        # `process.execPath` instead of the Python that actually runs the hooks. Without
        # this line that substitution passes every gate in the repo: golden filters the
        # file out, and `_shim_problems` only fires once the baked path stops existing.
        shim = sorted(p for p in home.rglob("geneseed-hook*") if p.is_file())
        return {"exit": proc.returncode,
                "stdout": golden._normalise(proc.stdout, roots),
                "stderr": golden._normalise(proc.stderr, roots),
                "files": golden._snapshot(td, roots),
                "shim": {p.name: golden._normalise(p.read_bytes(), roots) for p in shim}}


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
                self.assertEqual(py["shim"], node["shim"],
                                 f"{cell['id']}: the hook shim differs between the two "
                                 f"runtimes. Both must bake the interpreter and entry "
                                 f"point that actually run the hooks — which are Python's "
                                 f"for as long as the hooks are Python, whichever process "
                                 f"wrote the file.")
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

    def test_python_verifies_what_node_wired(self):
        """The VERIFY stage is the phase's load-bearing claim, and nothing observed it.

        WIRE moved into the Node child; `_settings_integrity_check` did not, because it runs
        after MANIFEST and MANIFEST is Python. The argument for letting two implementations
        of the wiring layer coexist rests on that: every Claude-shaped emit ends with PYTHON
        re-reading the settings file NODE wrote and checking it against the claims NODE
        returned. A mutation deleting the call proved the argument was unwatched — the whole
        suite stayed green. Three reasons it could: the return value is discarded, the
        function only speaks when file and manifest disagree, and the boundary comparison
        runs this stage in Python on BOTH sides so anything it printed would cancel out.

        So this test does not compare runtimes. It asserts the crossing itself:

        1. the emit really calls it, with `expect='present'` and the file WIRE chose;
        2. on a healthy Node-wired install it finds NOTHING — which is the real content of
           "Python can verify Node's work". Python matches a recorded claim against the file
           by whole-dict equality, so if Node's `managed.settings_hooks` differed from what
           Node actually wrote in any way at all — a key order, a nesting, a retyped value
           surviving the JSON round trip — every group would report as missing;
        3. and it is not silent by construction: excise one wired group from the file and
           it names exactly that group.

        The `claude/commented-settings` cell is why (3) needs its own arrangement rather
        than a fixture: when the merge bails on a commented file it lowers the CLAIM as well
        as skipping the write, so claim and file stay trivially consistent and the checker
        says nothing even in the state it exists to catch."""
        import build
        td = Path(tempfile.mkdtemp(prefix="geneseed-verify-"))
        self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        home, repo = td / "home", td / "repo"
        repo.mkdir(parents=True)
        saved = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(saved)))
        os.environ["GENESEED_HOME"] = str(home / ".geneseed")

        seen = []
        real = build._settings_integrity_check

        def spy(path, managed, expect="present"):
            seen.append((Path(path).name, expect))
            return real(path, managed, expect)

        cfg = repo / ".claude"
        # `_build_global`'s binding, not `_build_settings`'s: build.py's splice copies the
        # function object into each submodule's namespace, so patching the definition site
        # would leave the call site pointing at the original and the spy would see nothing.
        with mock.patch.object(build._build_global, "_settings_integrity_check", spy), \
                contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            build.emit_claude("neutral", out=repo, root=repo)

        self.assertEqual(
            seen, [("settings.local.json", "present")],
            "the emit did not run its VERIFY stage exactly once against the file WIRE "
            "chose. Deleting that call is invisible to every other test in the suite.")

        managed = json.loads(
            (cfg / build.GLOBAL_MANIFEST).read_text(encoding="utf-8"))["managed"]
        settings_path = cfg / managed["settings_file"]
        self.assertTrue(managed.get("settings_hooks"),
                        "no hook groups were claimed — (2) below would be vacuous")

        clean = real(settings_path, managed, expect="present")
        self.assertEqual(
            clean, [],
            f"Python cannot verify what Node wired: {clean}. The claims came back over "
            f"JSON and are matched against the file by whole-dict equality, so this fails "
            f"the moment the two implementations disagree about the SHAPE of a hook group, "
            f"not just its content.")

        # (3) The checker is not silent by construction.
        loaded = json.loads(settings_path.read_text(encoding="utf-8"))
        victim = managed["settings_hooks"][0]
        loaded["hooks"][victim["event"]] = [
            g for g in loaded["hooks"][victim["event"]] if g != victim["group"]]
        settings_path.write_text(json.dumps(loaded, indent=2), encoding="utf-8")
        # The checker prints every finding as a loud `[geneseed] WARN:` line; here that is
        # the expected outcome, so it is captured rather than left on the test's stderr.
        with contextlib.redirect_stderr(io.StringIO()) as warned:
            problems = real(settings_path, managed, expect="present")
        self.assertIn("WARN", warned.getvalue(),
                      "the finding was returned but never printed — the emit discards the "
                      "return value, so a silent checker is a checker nobody hears")
        self.assertTrue(
            any("recorded hook group missing" in p for p in problems),
            f"excising a wired group produced {problems!r} — the check that is supposed to "
            f"catch a divergence between the two implementations cannot see one at all")

    def test_the_wire_cells_reach_the_branches_they_name(self):
        """The three P3b cells, each of which exists for one wiring branch.

        Same guard as its two siblings and the same reason: a cell whose fixture stopped
        constructing the state it names still compares two identical trees and reports
        success. These three are the ones whose subject is a file the USER co-owns, so a
        cell going quiet here means the port's most dangerous code is unwatched."""
        got = {cid: _run_side(next(c for c in CELLS if c["id"] == cid), js=True)
               for cid in ("claude/stale-excludes", "claude/commented-settings",
                           "opencode/commented-jsonc")}

        stale = got["claude/stale-excludes"]
        manifest = json.loads(stale["files"]["out/.claude/.geneseed-manifest.json"])
        excl = manifest["managed"]["settings_excludes"]
        self.assertGreaterEqual(
            len(excl), 3,
            f"settings_excludes is {excl} — the seeded prior claims did not survive the "
            f"union, so this cell is back to the one-element list every other cell has "
            f"and the sort it exists to observe is invisible again")
        self.assertEqual(excl, sorted(excl),
                         "the recorded excludes are not sorted — a plain concatenation "
                         "of prior + added would look exactly like this")
        # And the sort must have actually REORDERED something. `_claude_stale_excludes`
        # records the live CLAUDE.md exclude LAST; seeing it first is the only proof that
        # sorted order and the manifest's recorded order are different lists here. (The
        # first draft of this assertion compared `excl` against `sorted(excl, key=...)`
        # with a constant key — a stable sort by a constant is the identity, so it could
        # never fail. A gate is code, and so is its assertion.)
        self.assertTrue(
            excl[0].endswith("/CLAUDE.md"),
            f"expected the capital-C entry first, got {excl[0]!r}. The fixture records it "
            f"last, so if it is not first the list was never reordered and this cell "
            f"cannot tell `sorted(set(prior) | set(added))` from a concatenation.")

        commented = got["claude/commented-settings"]
        self.assertIn(b"has comments", commented["stderr"],
                      "the settings merge did not hit its comment bail-out — the user's "
                      "annotated file was parsed as plain JSON, or rewritten")
        self.assertIn(b"// my own settings", commented["files"][
            "out/.claude/settings.local.json"],
            "the user's comment was destroyed; the whole point of the branch is that this "
            "file is left exactly as it was")

        # The SAME hazard at the ninth emit's own call site (P3c). Two cells rather than
        # one because the two wire halves target different files under different roots:
        # `<root>/opencode.jsonc` for the per-repo emit, `<cfg>/opencode.jsonc` for the
        # global one. A single cell would leave the other half's double-wire invisible,
        # which is exactly what idempotence guarantees.
        oc_global = _run_side(next(c for c in CELLS
                                   if c["id"] == "opencode-global/commented-jsonc"), js=True)
        self.assertEqual(
            oc_global["stdout"].count(b"has comments \xe2\x80\x94 not rewriting it"), 1,
            "expected exactly one commented-jsonc warning from the global emit. TWO means "
            "opencode.json was merged twice in one run — the child wiring it and Python "
            "wiring it again, which is what a `cfgName` missing from the payload produces "
            "and the only place in the matrix where that leaves a trace at all.")
        self.assertIn(b"// hand-annotated",
                      oc_global["files"]["home/.config/opencode/opencode.jsonc"],
                      "the user's annotated global opencode.jsonc was rewritten")
        self.assertNotIn("home/.config/opencode/opencode.json", oc_global["files"],
                         "a second config file was created beside the .jsonc the merge "
                         "chose — `_opencode_target` prefers the .jsonc when it exists")

        jsonc = got["opencode/commented-jsonc"]
        self.assertIn(b"comments", jsonc["stdout"],
                      "the commented-jsonc warning is not on STDOUT. It is the one message "
                      "in the wiring layer that goes there rather than to stderr, and "
                      "since P3b it is printed inside the Node child — so this assertion "
                      "is what proves the child's buffer carried it across the protocol "
                      "instead of corrupting it.")
        # `_run_side` keeps the LAST emit's streams, so one is the whole expectation: the
        # merge refuses to rewrite the file, so emit two still has a real change to make
        # and warns again. TWO would mean the file was merged twice in a single run — the
        # child wiring it and Python wiring it again, which is exactly what a `cfgName`
        # missing from the payload produces, and the only place in the matrix where that
        # double-wire leaves a trace instead of being idempotent and invisible.
        self.assertEqual(
            jsonc["stdout"].count(b"has comments \xe2\x80\x94 not rewriting it"), 1,
            "expected exactly one commented-jsonc warning in the run")
        self.assertIn(b"// hand-annotated", jsonc["files"]["out/opencode.jsonc"])

    def test_the_shim_comparison_is_not_vacuous(self):
        """`shim` is `{}` for every cell that wires no hooks — files, opencode and copilot
        all legitimately produce none — so the equality above would hold trivially if the
        Node child had stopped writing one at all.

        What must be true: a Claude-shaped cell produces exactly ONE shim, its name is the
        platform's, and its body names the interpreter that runs the hooks. That last check
        is the point of the whole comparison — it is what makes `process.execPath` an
        observable substitution instead of a silent one."""
        wired = _run_side(next(c for c in CELLS if c["id"] == "claude/project"), js=True)
        self.assertEqual(len(wired["shim"]), 1,
                         f"expected exactly one hook shim, got {sorted(wired['shim'])} — "
                         f"the comparison in the gate above is comparing nothing")
        name, body = next(iter(wired["shim"].items()))
        self.assertEqual(name, "geneseed-hook.cmd" if sys.platform == "win32"
                         else "geneseed-hook")
        self.assertIn(Path(sys.executable).name.encode(), body,
                      "the shim written by the NODE child does not name the Python "
                      "interpreter. The hooks it launches are harness.py; a shim baking "
                      "node's own execPath makes every hook in the install dead, and the "
                      "hooks report success on every path.")
        self.assertIn(b"harness.py", body)
        self.assertNotIn(b"undefined", body,
                         "`hookOpts` did not reach `hookPrefix` — the shim baked the "
                         "literal string 'undefined' as its interpreter")

        unwired = _run_side(next(c for c in CELLS if c["id"] == "copilot/global"), js=True)
        self.assertEqual(unwired["shim"], {},
                         "Copilot has no hook mechanism at all, so an emit that wrote a "
                         "shim for it wired something it should not have")

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

    def test_the_opencode_global_cells_reach_the_branches_they_name(self):
        """The same guard, for the ninth emit — the one that had no cells at all.

        Two claims here that no other mode can express. The first is that `--out` is not
        the target: this emit writes exclusively into `<cfg>`, and `--out` is only the
        legacy bundle a store is migrated from. The second is the manifest's SHAPE — this
        is the one emit whose manifest carries no `managed` key and no `scope`, which is
        why its payload needs `cfgName` and nothing else. If it ever grows a `managed` the
        wire contract changes, and this is where that shows up."""
        got = {c["id"]: _run_side(c, js=True) for c in CELLS
               if c["id"].startswith("opencode-global/")}
        CFG = "home/.config/opencode"

        base = got["opencode-global/neutral/full"]
        self.assertEqual(base["exit"], 0, base["stderr"][-400:].decode("utf-8", "replace"))
        self.assertIn(f"{CFG}/AGENT.md", base["files"],
                      "nothing landed in the resolved config dir — `cfgDir` did not reach "
                      "the child, or the child resolved its own and wrote elsewhere")
        # `--out` is passed on every invocation and is never written to. Stated as an
        # absence because that is the whole asymmetry: with the two coincident (the shape
        # every other opencode cell has) a port that confused them would pass.
        stray = sorted(k for k in base["files"] if k.startswith("out/"))
        self.assertEqual(stray, [],
                         f"the emit wrote {stray} under --out. `out` is the legacy "
                         f"migration source for this emit, never a target.")
        manifest = json.loads(base["files"][f"{CFG}/.geneseed-manifest.json"])
        self.assertNotIn("managed", manifest,
                         "the opencode-global manifest grew a `managed` claim set. It is "
                         "the one manifest without one, which is why the wire half returns "
                         "only `cfgName` — a claim to record would have to travel too.")
        self.assertNotIn("scope", manifest)
        self.assertIn("themes/geneseed-neutral.json", manifest["owned"])
        self.assertIn("command/ponytail.md", manifest["owned"],
                      "the always-on /ponytail command is not owned — its `owned` entry "
                      "is computed relative to <cfg>, the base this emit gets from the job")
        # `agentPath` crossed the seam decided, and it is ABSOLUTE: the global emit points
        # `instructions` at <cfg>/AGENT.md, not at a repo-relative path.
        self.assertIn(b"<HOME>/.config/opencode/AGENT.md",
                      base["files"][f"{CFG}/opencode.json"],
                      "opencode.json does not point at the absolute <cfg>/AGENT.md")
        # The capability de-link, in both directions. `CAPABILITY_LINK_RE` is surgical: it
        # takes `[name](agents/x.md)` down to `name` and leaves the FOLDER pointers
        # `](agents/)` and `](skills/)` alone. Asserting only the first half would pass
        # just as well for a blanket removal of every `agents/` mention, which would gut
        # the preamble; the second is what says the strip stopped where it was told to.
        agent_md = base["files"][f"{CFG}/AGENT.md"]
        survived = re.findall(rb"\]\((?:[A-Za-z0-9_.-]+/)*(?:agents|skills)/"
                              rb"[A-Za-z0-9_-]+\.md\)", agent_md)
        self.assertEqual(survived[:3], [],
                         f"{len(survived)} capability link(s) survived the de-link — "
                         f"OpenCode catalogues agents and skills natively, so the per-row "
                         f"spec links go (the portable bundle keeps all 74)")
        self.assertIn(b"](skills/)", agent_md,
                      "the folder pointers went too — the de-link over-reached, and the "
                      "regex it uses is `_OWNED` precisely so a doctor test can redirect "
                      "it to the pre-fix form and watch this")

        lean = got["opencode-global/imperial/lean"]
        self.assertIn(f"{CFG}/laws/universal.md", lean["files"],
                      "the lean footprint shipped no standalone laws file under <cfg>")
        self.assertIn(b"`laws/universal.md`", lean["files"][f"{CFG}/AGENT.md"],
                      "the lean pointer is not BARE. AGENT.md and the laws dir are "
                      "siblings here, so this emit passes no laws_prefix at all — the one "
                      "arrangement where a prefix would break every pointer")
        self.assertIn("laws/universal.md",
                      json.loads(lean["files"][f"{CFG}/.geneseed-manifest.json"])["owned"],
                      "the lean laws were written but not CLAIMED — a switch back to full "
                      "would leave them behind, and claiming them is half of what "
                      "_ship_lean_laws does")
        self.assertIn(f"{CFG}/themes/geneseed-imperial.json", lean["files"])

        extras = got["opencode-global/primary+commands"]
        self.assertIn(f"{CFG}/agents/orchestrator.md", extras["files"],
                      "GENESEED_PRIMARY did not reach the child — the env-gated writers "
                      "are unreachable and this cell tests nothing")
        self.assertIn("agents/orchestrator.md",
                      json.loads(extras["files"][f"{CFG}/.geneseed-manifest.json"])["owned"],
                      "the primary agent was written but not owned relative to <cfg>")

        stores = got["opencode-global/legacy-stores"]
        self.assertIn(b"migrated memory/ -> memory/", stores["stdout"],
                      "the memory store was not migrated from --out. Deriving the legacy "
                      "source from <cfg> instead finds the empty destination, falls "
                      "through to seeding, and passes every other cell in this file.")
        self.assertIn(b"migrated notebook/", stores["stdout"])
        self.assertIn(f"{CFG}/memory/__pycache__/stale.pyc", stores["files"],
                      "the migration dropped a __pycache__ entry — this walk keeps "
                      "everything, unlike the one behind source_fingerprint")
        self.assertNotIn(f"{CFG}/memory/README.md", stores["files"],
                         "the store was SEEDED as well as migrated — the two are "
                         "exclusive, and only a populated legacy bundle can tell")

        mine = got["opencode-global/user-owns-files"]
        self.assertIn(b"kept your existing agents/reviewer.md", mine["stderr"],
                      "claim-on-create did not fire for a colliding user agent")
        self.assertIn(b"my own reviewer", mine["files"][f"{CFG}/agents/reviewer.md"])
        owned = json.loads(mine["files"][f"{CFG}/.geneseed-manifest.json"])["owned"]
        self.assertNotIn("agents/reviewer.md", owned,
                         "Geneseed claimed an agent it found already there — uninstall "
                         "would then delete the user's file")
        for rel, needle in (("wiki.jsonc", b"Brain"),
                            ("excludes.json", b"C:/work/secret"),
                            ("memory/README.md", b"rewrote the store's charter"),
                            ("notebook/README.md", b"rewrote its own charter"),
                            ("user-rules.md", b"R1"),
                            ("PROFILE.md", b"mine")):
            self.assertIn(needle, mine["files"].get(f"{CFG}/{rel}", b""),
                          f"{rel} was overwritten by the re-emit — it is seeded once and "
                          f"never re-emitted, and a cell that did not CHANGE it first "
                          f"could not tell the difference")

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

        All three job kinds are checked, because the message carries a `context=` the
        CALLER chooses — `theme '<name>'` for the bundle, `claude-<scope>` for the six
        Claude-shaped emits, and the literal `opencode-global` for the ninth. A port that
        hardcoded one of them would diverge on a path no cell can reach, since every cell
        renders a complete source. Three spellings is also why hardcoding LOOKS safe: two
        are computed from an argument and the third is a constant."""
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

            # And through the ninth job kind, whose `context=` is a literal rather than
            # anything derived from the call — and whose <cfg> must also stay untouched,
            # because this emit renders into a dir it SHARES with the user's own OpenCode
            # config. A refusal that had already mkdir'd it would be leaving debris in
            # somebody's real config dir.
            err3 = io.StringIO()
            with mock.patch.object(_build_core, "SRC", src), \
                 contextlib.redirect_stderr(err3), \
                 self.assertRaises(SystemExit) as py_exit3:
                build.assert_source_complete(None, context="opencode-global")

            oc_dir = td / "oc"
            job3 = {"kind": "opencode-global",
                    "cfg": {**_build_core.js_cfg(), "src": str(src),
                            "primaryAgentSrc": str(build.PRIMARY_AGENT_SRC)},
                    "theme": "neutral", "cfgDir": str(oc_dir), "out": None,
                    "footprint": "full", "nativeCatalog": True, "oldOwned": [],
                    "agentPath": (oc_dir / "AGENT.md").as_posix()}
            job_file.write_text(json.dumps(job3), encoding="utf-8")
            proc3 = subprocess.run([NODE, str(ROOT / "js" / "emit.mjs"), str(job_file)],
                                   cwd=str(ROOT), capture_output=True, **_NO_WINDOW)
            payload3 = json.loads(proc3.stdout)

            self.assertIn("opencode-global", err3.getvalue())         # the fixture bites
            self.assertFalse(payload3["ok"])
            self.assertEqual(payload3["exit"], py_exit3.exception.code)
            self.assertEqual(payload3["stderr"], err3.getvalue())
            self.assertNotIn("error", payload3)
            self.assertFalse(oc_dir.exists(),
                             "the opencode-global job created <cfg> before refusing")


if __name__ == "__main__":
    unittest.main()
