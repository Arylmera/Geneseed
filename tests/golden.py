#!/usr/bin/env python3
"""Golden acceptance harness — prove two generators produce the SAME bundle.

This is the gate the Node port is measured against (spec: docs/specs/2026-08-06-npx-
distribution.md, phase P1): the Node generator is correct when its output is
byte-identical to Python's across the emit matrix. Empty diff == correct by
construction, which is a far stronger claim than any hand-written assertion about
rendered content.

It is useful BEFORE any Node exists, in two ways:

  * with no --new, it runs the reference generator against ITSELF, which proves the
    output is deterministic (no dict-order, no timestamp, no path leakage) — the
    property the whole gate rests on;
  * with --new pointing at a different checkout/revision of build.py, it is a plain
    generator-regression detector: "did this refactor change any of the 252 bundles?"

    python tests/golden.py                                   # determinism self-check
    python tests/golden.py --quick                           # neutral theme only, fast
    python tests/golden.py --idempotent                      # re-emit onto an existing tree
    python tests/golden.py --deletion                        # the prune's deletion path
    python tests/golden.py --new "node bin/geneseed-gen.js"  # the P2 gate
    python tests/golden.py --new "python ../old/build.py"    # cross-revision regression

DO NOT MISTAKE THE SELF-CHECK FOR A REGRESSION GATE. With no --new this compares the
generator against ITSELF: it proves the output is deterministic, and it stays green
through a refactor that changes every emitted byte, as long as it changes them
consistently. To gate a refactor you need a second, OLDER generator:

    git worktree add /tmp/pre <the-commit-before-your-change>
    python tests/golden.py --ref "<python> /tmp/pre/build.py" --new "<python> build.py"

Pass a literal interpreter path there — `which python` under Git Bash yields a
`;`-joined string `_split` cannot parse — and decode any redirected output as UTF-8,
since the `·`/`—` separators below make `tail` fail on a cp1252 console.

Each cell compares every file the generator wrote AND both of its output streams, which
appear in the snapshot as the pseudo-files `<stdout>` and `<stderr>`. The streams matter
because that is where the generator prints progress, where the Node handoff returns its
protocol document, and where the emitted hook gates signal a verdict — nothing compared
them until the render half started running in another process. They are dropped when the
two sides run a different number of times (`--idempotent`), since emit two legitimately
says different things from emit one.

That cross-revision form compares CONTENT too, so it is a refactor gate, not a content
gate: `.geneseed-version` records `source_fingerprint()` and today's date, so two
revisions whose `src/`or `themes/` differ at all will differ in every cell on that one
file (and a run spanning midnight will too). That is working as intended — the marker is
supposed to change when the source does — but read the diff before believing a
"regression".

SAFETY: every cell runs with HOME/USERPROFILE/XDG_CONFIG_HOME/APPDATA/LOCALAPPDATA
redirected into a throwaway dir (the recipe tests/test_emit_smoke.py uses), AND with
every host relocation variable cleared — see run_cell, where the reason is spelled out.
Without both halves the ~126 *-global cells render straight into the real config dirs and
overwrite the user's actual installs, twice per run. Never remove the sandbox.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import difflib
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import snapshot_io

ROOT = Path(__file__).resolve().parent.parent

# THE PROCESS'S TEMP BASE, CANONICALISED, FOR EVERY MODULE THAT IMPORTS THIS ONE.
#
# `golden.sandbox()` gives the three cell harnesses a canonical root, and its docstring
# explains why they need one. But the same requirement belongs to every test that hands a
# temp path to a child and then destamps the child's output — and that is most of
# `tests/`, spread across ~40 `tempfile` calls in twenty files rather than three. On
# GitHub's Windows runner `TEMP` names the 8.3 SHORT spelling, `mkdtemp()` inherits it, the
# generator resolves it, and the destamp holds a string that appears nowhere in the bytes:
# `test_node_cli_parity`'s stacking warning compared `<sandbox>\py\repo` against
# `<sandbox>\node\repo` with the shared prefix un-blanked, and reported the two halves of
# its own fixture as a port difference.
#
# One assignment fixes all of them, because `mkdtemp`/`TemporaryDirectory` read
# `tempfile.tempdir` at call time. It changes only WHICH SPELLING of the same directory
# they return — nothing about where the files go. Children still read `TEMP` for
# themselves and are deliberately left alone: making a child's temp canonical too would
# have hidden the `resolveOut` bug that this same runner found (`bin/geneseed.mjs`).
tempfile.tempdir = os.path.realpath(tempfile.gettempdir())

#: Cells run CONCURRENTLY by default. Every cell builds its own temp sandbox, derives its
#: own environment from `cell_env` and spawns its own children; nothing is shared and
#: nothing is ordered, so the pool changes how long the gate takes and nothing about what
#: it compares. Capped rather than `cpu_count()` because each worker is two generator
#: processes writing ~99 files, and past ~8 the disk answers before the CPU does.
#: `--jobs 1` is the old serial run, for a failure you want to watch happen.
DEFAULT_JOBS = min(8, os.cpu_count() or 1)

EMITS = ("files", "opencode", "opencode-global", "claude", "claude-global",
         "bob", "bob-global", "copilot", "copilot-global")
FOOTPRINTS = ("lean", "full")

# Placeholders substituted for the three machine-specific roots. Without this the two
# runs differ in exactly the places they SHOULD differ (each ran in its own sandbox),
# and the comparison would be noise. The surface is deliberately tiny — measured, not
# assumed: in a claude emit only .geneseed-manifest.json and settings.local.json carry
# an absolute path at all, and the plain `files` bundle carries none.
_PLACEHOLDERS = (("<HOME>", "home"), ("<OUT>", "out"))


def _themes() -> list[str]:
    """Theme names as the generator sees them. `_TEMPLATE.json` is skipped — leading
    underscore means authoring scaffold, not a theme, and a port that forgets that
    produces a 15th bundle nobody asked for."""
    return sorted(p.stem for p in (ROOT / "themes").glob("*.json")
                  if not p.stem.startswith("_"))


def cells(quick: bool = False, themes: "list[str] | None" = None) -> list[dict]:
    """The matrix. Themes x emits x footprints, plus one pass over each posture and
    mode — those two axes are independent of the rest, so sweeping them against every
    theme would multiply the runtime 10x to re-prove the same substitution."""
    ts = themes or (["neutral"] if quick else _themes())
    out = [{"theme": t, "emit": e, "footprint": f}
           for t in ts for e in EMITS for f in FOOTPRINTS]
    if not quick:
        sys.path.insert(0, str(ROOT))
        import build  # noqa: E402  (needs ROOT on the path first)
        out += [{"theme": "neutral", "emit": "files", "footprint": "lean", "posture": p}
                for p in build.posture_names()]
        out += [{"theme": "neutral", "emit": "files", "footprint": "lean", "mode": m}
                for m in build.mode_names()]
    return out


# The deletion matrix. `--idempotent` re-emits the SAME configuration, so `owned` is
# identical on both passes and the write-before-delete prune never has anything to
# delete: across five sessions nothing in this repo had ever executed its deletion path.
# These cells emit configuration A, then configuration B onto A's tree, and compare the
# result against a FRESH emit of B. A working prune makes those two byte-identical; a
# deleted prune leaves A's extra files behind, and a prune widened past
# `old_owned - owned` deletes files B owns and still wants.
#
# Both axes were MEASURED against the emitted manifests, not assumed, and each is here
# because the other does not cover it:
#
#   lean -> full   drops `laws/universal.md` — the single-file lean laws pointer — from
#                  every emit that ships laws. Not from the per-repo opencode one.
#   neutral -> imperial drops `themes/geneseed-<name>.json`, which is named after the
#                  theme and which only the two opencode emits own.
#
# `files` is in neither list and that is a finding, not an omission: `build()` writes no
# manifest, so the portable bundle has no `old_owned` and therefore no prune at all.
# `run_cell` refuses a cell where nothing disappeared, so a pair that stops deleting
# (a renamed file, a footprint that stops differing) fails loudly instead of quietly
# becoming a second copy of `--idempotent`.
_DELETION_AXES = (
    ("lean-to-full", {"footprint": "lean"}, {"footprint": "full"},
     ("opencode-global", "claude", "claude-global", "bob", "bob-global",
      "copilot", "copilot-global"), ()),
    ("theme-swap", {"theme": "neutral"}, {"theme": "imperial"},
     ("opencode", "opencode-global"), ("memory/README.md", "notebook/README.md")),
)


def deletion_cells(quick: bool = False) -> list[dict]:
    """One cell per (emit, axis) pair that really does shrink `owned`. Each cell is the
    AFTER configuration carrying the BEFORE one under `before`."""
    out = []
    for label, before, after, emits, sovereign in _DELETION_AXES:
        for emit in (emits[:1] if quick else emits):
            base = {"theme": "neutral", "emit": emit, "footprint": "full"}
            out.append(dict(base, **after, before=dict(base, **before),
                            label=f"{emit}/{label}", sovereign=sovereign))
    return out


def _argv(cell: dict, out: Path) -> list[str]:
    a = ["--theme", cell["theme"], "--emit", cell["emit"],
         "--footprint", cell["footprint"], "--out", str(out)]
    if cell.get("posture"):
        a += ["--posture", cell["posture"]]
    if cell.get("mode"):
        a += ["--mode", cell["mode"]]
    return a


def _normalise(data: bytes, roots: list[tuple[str, Path]]) -> bytes:
    """Blank out the sandbox roots so two runs in two different temp dirs compare equal.

    Each root is replaced in every spelling a generator might emit it in — native
    separators, forward slashes, and JSON-escaped backslashes — because settings.json and
    the manifest carry paths through json.dumps while markdown carries them raw.

    The `\\uXXXX` spellings are the fourth and fifth, and they were missing. `json.dumps`
    defaults to `ensure_ascii=True`, so a path containing any non-ASCII character reaches
    the file as `d\\u00e9p\\u00f4t` and NONE of the first three spellings match it — the
    sandbox root then survives normalisation and every such cell reports a difference that
    is only the temp dir. Nothing had noticed because every path in the matrix is ASCII;
    the cell that put an accent in `--out` is what found it. A gate is code, and so is its
    normaliser."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data  # binary: compare raw
    for tag, path in roots:
        s = str(path)
        slash = s.replace("\\", "/")
        spellings = [s, slash, s.replace("\\", "\\\\")]
        # json.dumps(...)[1:-1] is exactly what the path looks like INSIDE a JSON string:
        # backslashes doubled and every non-ASCII character escaped.
        spellings += [json.dumps(s)[1:-1], json.dumps(slash)[1:-1]]
        # Longest first: the escaped spelling of a path with no non-ASCII is identical to
        # the doubled-backslash one, and replacing a prefix form first would strand the rest.
        for spelling in sorted(set(spellings), key=len, reverse=True):
            text = text.replace(spelling, tag)
    return text.encode("utf-8")


# `write_version` (`_build_render.py:757`) stamps `.geneseed-version` with
# `source_fingerprint()` + today's date + the release label:
# `f"{fp} (built {date}) [release {release}]\n"`. Both move for reasons that are not
# regressions — the date at midnight, the fingerprint on any src/ or themes/ edit — so a
# recorded corpus needs them blanked, same as `harness_golden._STAMPS` already blanks its
# clock-carrying fields.
#
# `\r?` at the end is not defensive, it is OBSERVED: `write_text`/`fs.writeFileSync` both
# write this file through a text-mode path, and on Windows that turns the trailing `\n`
# into `\r\n`. `_destamp` splits the body on `b"\n"` before matching, so on this platform
# every real line carries a `\r` as its last byte. Left out of the pattern, the assertion
# below would fire on cell 1 of 259 rather than on a corrupted one — the exact silent-gate
# failure mode this destamp exists to avoid, just inverted into a false positive instead
# of a false negative.
_VERSION_LINE = re.compile(
    rb"^(?P<fp>[0-9a-f]{6,64}) \(built (?P<date>\d{4}-\d{2}-\d{2})\)"
    rb"(?P<rel> \[release [^\]]+\])?(?P<cr>\r)?$")

# WHAT A NON-CANONICAL LINE IS ALLOWED TO CARRY — and the reason this is a property test
# rather than a third declared shape.
#
# dc00083 required every line of every `.geneseed-version` to match the canonical shape and
# raised otherwise. That was the wrong axis. These harnesses SEED synthetic markers as fixtures,
# each deliberately odd, and each new one bolted on another declared shape: `"   \n"` at
# `harness_golden.py:1182` (`an-empty-marker-is-not-a-version` — `cmd_version` reads the file as
# `txt.split()[0] if txt else None`, so a whitespace-only marker is DEFINED to read as absent and
# the host walk moves to the next candidate) forced shape two, and `web_golden.py:339`'s
# `_VERSION = "0000000000000000"` (a fingerprint no source render can produce, so the version
# verdict is the stable "differs" arm) would have forced shape three. Shape three implies shape
# four: the shape of a fixture is not a property this file can enumerate.
#
# The property that actually matters is much narrower. A recorded corpus only needs blanking for
# content that MOVES between runs. A synthetic fixture value is constant across both
# implementations and across days, so leaving it VERBATIM is strictly better than blanking it —
# the bytes stay under the byte comparison in full. So: canonical line → blanked; anything else →
# verbatim, after PROVING it holds nothing that can rot. That keeps dc00083's discipline (a
# normaliser must be able to complain) while pointing the complaint at the corpus's real threat.
_ROTS = (
    # A BUILD DATE. `write_version` stamps today's, so a `YYYY-MM-DD` anywhere outside the
    # canonical `(built ...)` bracket is a field that turns a recorded corpus stale at midnight.
    re.compile(rb"\d{4}-\d{2}-\d{2}"),
    # A LIVE SOURCE FINGERPRINT, tested by the exact length both implementations produce:
    # `source_fingerprint()` is `sha256(...).hexdigest()[:12]` (`_build_render.py:721`) and
    # `sourceFingerprint()` is `digest('hex').slice(0, 12)` (`js/emit.mjs:375`) — EXACTLY twelve
    # lowercase hex characters, never more, never fewer.
    #
    # The lookarounds demand a non-hex neighbour on BOTH sides, so the token has to BE twelve
    # long rather than merely contain twelve. That is what separates the two cases honestly:
    # `0000000000000000` is sixteen, every twelve-run inside it is flanked by another hex digit,
    # so the fixture passes — while a real fingerprint, which is always twelve, is caught the
    # moment it appears outside the canonical line (a legacy fingerprint-only marker, say). The
    # test is the length the code actually emits, not a guess about how random the digits look.
    re.compile(rb"(?<![0-9a-f])[0-9a-f]{12}(?![0-9a-f])"),
)


def _destamp(name: str, body: bytes) -> bytes:
    """Blank the fields in `.geneseed-version` that move for reasons that are not
    regressions: the source fingerprint and the build date.

    ASSERTS BEFORE PASSING ANYTHING THROUGH. A blind `re.sub` that is too aggressive silently
    blanks a real difference — the failure mode where a gate stays green because it stopped
    looking. Two rules, and neither is a fall-through:

      1. A line matching `_VERSION_LINE` is the stamp, and is blanked.
      2. Any other line is passed through VERBATIM — but only after `_ROTS` proves it carries
         no date and no live-shaped fingerprint. A line that does raises, naming the file, the
         offending token and the whole line, rather than letting a moving field into a corpus
         that is about to be recorded."""
    if not name.endswith(".geneseed-version"):
        return body
    out = []
    for line in body.split(b"\n"):
        m = _VERSION_LINE.match(line)
        if m:
            out.append(b"<FP> (built <DATE>)"
                       + (b" [release <REL>]" if m.group("rel") else b"")
                       + (m.group("cr") or b""))
            continue
        for rot in _ROTS:
            hit = rot.search(line)
            assert not hit, (
                f"{name}: a line outside the canonical stamp carries {hit.group()!r}, "
                f"which moves between runs and would rot a recorded corpus: {line!r}")
        out.append(line)  # nothing in it moves — keep the bytes, keep them compared
    return b"\n".join(out)


# The hook shim is deliberately NOT compared. It is install plumbing rather than
# generated output: its body bakes the interpreter and checkout of whichever generator
# wrote it, so a Node generator would differ from Python in every single cell and drown
# every real finding in noise. Excluding it would leave a hole, so `_shim_health` asserts
# it directly instead — the shim has to exist and name files that exist.
_SHIM_GLOB = "geneseed-hook"

# The shim's argv placeholder, which is NOT a path — and the first thing the first Linux run
# of this harness found. `_shim_health` reads every double-quoted token out of the body and
# requires it to name an existing file. On Windows that rule could not be wrong: the body is
# `"<runner>" "<entry>" %*` and `%*` is unquoted, so the only quoted tokens ARE the two baked
# paths. The POSIX body forwards argv as `"$@"` — quoted, because the quoting is what keeps
# an emitted `--root "<cfg>"` intact — so every hook-writing emit reported its own shim as
# naming a missing `$@`, on BOTH sides, in 112 of 259 cells. A defect both implementations
# "share" because it was never in either of them: the gate was the Windows-shaped thing.
# Named as a set rather than filtered inline so the check stays a check on the two BAKED
# values, and so `%*` is here too even though it can never match — the pair is the partition.
_SHIM_ARGV = frozenset({"$@", "%*"})


def _files(sandbox: Path) -> set[str]:
    """Every file a cell left behind, POSIX-relative to the sandbox, shim excluded.
    Shared with `_snapshot` so the deletion matrix and the byte comparison can never
    disagree about what "a file this cell produced" means."""
    return {p.relative_to(sandbox).as_posix() for p in sandbox.rglob("*")
            if p.is_file() and not p.name.startswith(_SHIM_GLOB)}


def _snapshot(sandbox: Path, roots: list[tuple[str, Path]]) -> dict[str, bytes]:
    """Every file produced by one cell, normalised, keyed by POSIX-relative path.

    Walks the whole sandbox, not just --out: the six *-global emits write into the
    redirected config dirs instead of --out, and hashing only --out would silently
    compare two empty trees and call it a pass.

    It used to skip `__pycache__` too, and that skip was blind exactly where it mattered.
    The source walk behind every render already drops those dirs
    ([`_build_render.py:673`](../_build_render.py)), so the ONLY way one can enter an
    emitted tree is the legacy-store migration in `_global_memory` — which copies whatever
    a user's old bundle holds, unfiltered. Filtering here meant the one path capable of
    producing a `__pycache__` was the one path this harness refused to look at. Nothing in
    a sandbox creates one (build.py runs with cwd=ROOT), so keeping them costs no cell."""
    snap: dict[str, bytes] = {}
    for rel in sorted(_files(sandbox)):
        try:
            snap[rel] = _destamp(rel, _normalise((sandbox / rel).read_bytes(), roots))
        except OSError:
            continue
    return snap


# The emits that wire settings.json hooks, and therefore MUST leave a shim behind. Named
# rather than derived: it is the contract `_shim_health` holds the generators to, and
# reading it out of either generator would let the gate drift along with the thing it gates.
_HOOK_EMITS = frozenset({"claude", "claude-global", "bob", "bob-global"})


def _shim_health(sandbox: Path, emit: str) -> "str | None":
    """The check that replaces comparing the shim. Emitted hooks are worthless if the
    shim they all name is missing or points at nothing, and no byte-diff of the emitted
    tree can reveal that — the shim lives outside it. Returns a problem, or None.

    `emit` is a parameter because "no shim" used to return None unconditionally, and that
    was a hole precisely where this function is the only gate. A generator that wired
    settings.json correctly — every hook command naming the shim path, so every byte of
    every compared file matches — but never WROTE the shim would pass: the comparison sees
    identical settings, and this function saw nothing to check. The install is then one
    where all six hook groups point at a file that does not exist. The four hook-writing
    emits must produce one; the other five legitimately produce none, and asserting that
    direction too is what stops this from becoming a check that only ever passes."""
    found = [p for p in sandbox.rglob("*") if p.is_file() and p.name.startswith(_SHIM_GLOB)]
    if not found:
        if emit in _HOOK_EMITS:
            return (f"--emit {emit} wires settings.json hooks but wrote no hook shim: "
                    "every emitted hook command names a file that does not exist")
        return None  # emits with no hooks (files, copilot, opencode) legitimately write none
    for p in found:
        try:
            body = p.read_text(encoding="utf-8")
        except OSError as e:
            return f"shim {p.name} unreadable: {e}"
        missing = [q for q in re.findall(r'"([^"]+)"', body)
                   if q not in _SHIM_ARGV and not Path(q).exists()]
        if missing:
            return f"shim {p.name} names missing {missing[0]}"
    return None


# Host relocation knobs. Each resolver checks its own variable FIRST and returns before
# ever consulting HOME/XDG (_build_core.py:84/104/116), so redirecting HOME alone does
# NOT sandbox the *-global emits. Measured, not theorised: with OPENCODE_CONFIG_DIR
# exported, one opencode-global cell wrote 135 files straight into the real target.
RELOCATION_VARS = ("OPENCODE_CONFIG_DIR", "BOB_CONFIG_DIR", "COPILOT_CONFIG_DIR")


#: Every variable that decides where "home" is, in the order a resolver reaches for one.
#: `GENESEED_HOME` is listed last because it is the strongest: `_build_settings._shim_home()`
#: prefers it over `Path.home()`, so an ambient `GENESEED_HOME` OVERRIDES a module's own
#: HOME/USERPROFILE sandbox — which is how the first measurement of this defect reported
#: three well-behaved modules as polluters.
HOME_VARS = ("HOME", "USERPROFILE", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA",
             "GENESEED_HOME")


def home_overrides(home: Path) -> dict:
    """The six assignments that move "home" into `home`. ONE definition, because a child's
    env (`cell_env`) and this process's env (`sandbox_process_home`) have to agree on what
    the word covers — a sandbox missing one row is a sandbox with a hole in it."""
    return {"HOME": str(home), "USERPROFILE": str(home),
            "XDG_CONFIG_HOME": str(home / ".config"),
            "APPDATA": str(home / "AppData" / "Roaming"),
            "LOCALAPPDATA": str(home / "AppData" / "Local"),
            "GENESEED_HOME": str(home / ".geneseed")}


@contextlib.contextmanager
def sandbox(prefix: "str | None" = None):
    """One cell's temp dir: CANONICAL, and with a teardown that cannot raise.

    Every harness in this repo used `tempfile.TemporaryDirectory()` directly. Both of the
    properties this adds were found by the first CI run — neither is reachable from a
    developer's machine, and neither is cosmetic.

    CANONICAL, because THE PATH A CHILD REPORTS IS NOT THE PATH WE HANDED IT. GitHub's
    Windows runner sets `TEMP` to the 8.3 SHORT spelling (`C:\\Users\\RUNNER~1\\...`), so
    `mkdtemp()` returns a short path, we pass it as `--out`, and the generator's
    `Path.resolve()` expands it to the long one (`C:\\Users\\runneradmin\\...`) before
    printing. `_normalise` is then holding a root that appears nowhere in the bytes it is
    normalising: the raw sandbox name survives into the comparison and every cell whose
    stdout names its own sandbox differs — 49 subtests on the first Windows run, all of
    them one bug. The same duality broke a CELL rather than a comparison:
    `git-gate/sovereign-bypass` seeds `excludes.json` with the sandbox path and the hook
    matches it against a RESOLVED cwd, so the bypass missed and the cell that exists to
    prove the gate stays silent watched it speak. Both go away if the root we hand out is
    the one a child will resolve to. POSIX has the same duality through symlinks
    (`/tmp -> /private/tmp`), which is why this is `realpath` and not a Windows branch.

    A TEARDOWN THAT CANNOT RAISE, because the run had already finished comparing by then.
    The Linux `cells` job died with `OSError: [Errno 39] Directory not empty` out of
    `TemporaryDirectory.cleanup()` at cell ~270 of 318 — a cell's own checkout copy being
    written to while `rmtree` walked it — and took the whole harness with it. The same
    commit passed on the next run, which is the definition of a flake, and losing 318
    green cells to a `/tmp` entry nobody reads is the wrong trade. `sandbox_process_home`
    already reached this conclusion for its own directory; this is the same rule for the
    cells, and it leaves at most one temp tree behind on a race.

    Yields a `str`, like the `TemporaryDirectory` it replaces, so call sites only change
    the constructor."""
    d = os.path.realpath(tempfile.mkdtemp(prefix=prefix))
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


#: The stack of live process-home sandboxes — a stack rather than a flag so a nested
#: `sandbox_process_home()` (the positive control in tests/test_home_sandbox.py runs one
#: inside a suite that may already have one) restores to what it displaced.
_PROCESS_HOMES: list = []


def sandbox_process_home() -> Path:
    """Move THIS PROCESS's home into a fresh temp dir, and return it. Call from a test
    module's `setUpModule`, and `restore_process_home()` from `tearDownModule`.

    WHY IT EXISTS, AND WHY A CHILD'S `cell_env` IS NOT ENOUGH. `_build_settings.
    _write_hook_shim()` runs on EVERY emit and writes `<home>/.geneseed/bin/geneseed-hook
    [.cmd]` — the machine-wide shim every installed hook execs — at a path that comes from
    the environment and NOT from the emit's own `--out` or `cfg=`. A test module that calls
    `build.emit_claude_global(...)` in-process therefore rewrites the DEVELOPER'S live shim,
    on every run of the suite.

    AND IT LEAVES NO TRACE, which is why it survived ten phases: a Python-driven emit
    reproduces the body the shim already had, so `_write_hook_shim`'s unchanged-content
    fast path takes and not even the mtime moves. Only a Node-driven emit — which bakes a
    different runner — makes the damage visible, and by then the machine's shim is wrong.
    """
    # ignore_cleanup_errors: a rendered tree on Windows can still be held by a virus
    # scanner when the module ends, and a teardown that can raise is not a teardown.
    td = tempfile.TemporaryDirectory(prefix="gs-home-", ignore_cleanup_errors=True)
    # Canonical for the same reason `sandbox()` is: this path goes into HOME/APPDATA and
    # comes back out of a child that has resolved it.
    home = Path(os.path.realpath(td.name))
    saved = {var: os.environ.get(var) for var in HOME_VARS}
    os.environ.update(home_overrides(home))
    _PROCESS_HOMES.append((td, saved))
    return home


def restore_process_home() -> None:
    """Undo the innermost `sandbox_process_home()`. Restores ABSENCE as absence — putting
    an empty string back where nothing was set would leave `Path.home()` reading `""`."""
    td, saved = _PROCESS_HOMES.pop()
    for var, val in saved.items():
        if val is None:
            os.environ.pop(var, None)
        else:
            os.environ[var] = val
    td.cleanup()


def cell_env(home: Path) -> dict:
    """The environment one cell runs in: every path the generator resolves redirected
    into `home`, and every knob that could redirect or alter output cleared.

    Two distinct reasons to clear. The relocation vars are a SAFETY matter — leaving one
    set renders into the developer's real install, ~126 global cells per run, and it is a
    documented knob people really do export (it is how you keep the harness in a
    git-tracked folder). The remaining GENESEED_* knobs are a MEANING matter: several
    change what gets emitted (GENESEED_PRIMARY and GENESEED_COMMANDS add files,
    GENESEED_STACK_GLOBAL takes a different excludes branch), so inheriting them makes
    the same matrix mean something different on each machine. Cleared by PREFIX, not by
    name, so a knob added later is neutralised by default rather than quietly joining the
    inherited set.

    NO_COLOR and TERM are cleared for a THIRD reason, and it is pre-emptive. Nothing reads
    them today: `_color_enabled()` is `sys.stdout.isatty() and NO_COLOR is None and TERM !=
    "dumb"`, every cell captures stdout through a pipe, and `and` short-circuits on the
    first term — so the two are never even looked up. They are cleared so that the day the
    ANSI branch is made reachable (a pty, a `--color` flag) the matrix does not silently
    become machine-dependent on the developer's own shell."""
    env = dict(os.environ, **home_overrides(home), PYTHONUTF8="1")
    for var in (*RELOCATION_VARS, "NO_COLOR", "TERM"):
        env.pop(var, None)
    for var in [k for k in env if k.startswith("GENESEED_") and k != "GENESEED_HOME"]:
        env.pop(var, None)
    return env


def run_cell(gen: list[str], cell: dict, repeat: int = 1) -> "dict[str, bytes] | str":
    """Run one generator over one cell in a fresh sandbox. Returns the snapshot, or an
    error string — a generator that crashes is a finding, not an exception to raise.

    `repeat > 1` runs the generator that many times into the SAME sandbox and snapshots
    the end state. That is the re-emit path — the one real users are on from their second
    build onwards, and the one this harness could not see at all until now: idempotence,
    the write-before-delete prune, claim-on-create and the managed-block merge only have
    anything to do when the target already exists.

    `cell["before"]` runs a DIFFERENT configuration first, into the same sandbox. That is
    the one thing `repeat` cannot do: with the configuration held fixed, `owned` is
    identical on both passes and the prune's `old_owned - owned` is always empty. A cell
    with a `before` whose tree loses nothing is rejected rather than run — see
    `_DELETION_AXES`."""
    with sandbox() as td:
        home, out = Path(td) / "home", Path(td) / "out"
        home.mkdir()
        env = cell_env(home)
        steps = ([cell["before"]] if cell.get("before") else []) + [cell] * repeat
        seeded: "set[str] | None" = None
        for n, step in enumerate(steps, 1):
            proc = subprocess.run(gen + _argv(step, out), cwd=str(ROOT), env=env,
                                  capture_output=True, text=True)
            if proc.returncode != 0:
                emit = f"emit {n} of {len(steps)}: " if len(steps) > 1 else ""
                return (f"{emit}exit {proc.returncode}: "
                        f"{(proc.stderr or proc.stdout).strip()[:400]}")
            if n == 1 and cell.get("before"):
                seeded = _files(Path(td))
        if seeded is not None and not seeded - _files(Path(td)):
            return ("nothing was removed between the two configurations: either the "
                    "write-before-delete prune ran and deleted nothing, or this cell no "
                    "longer changes `owned` and has become a second `--idempotent`")
        sick = _shim_health(Path(td), cell["emit"])
        if sick:
            return sick
        # <REPO> matters only once the two sides run from different checkouts (the Node
        # port, or a cross-revision regression run); harmless when they share one.
        roots = [("<HOME>", home), ("<OUT>", out), ("<REPO>", ROOT)]
        snap = _snapshot(Path(td), roots)
        # The two STREAMS, as pseudo-files. The emit's stdout used to be compared by
        # nothing at all, which left the port free to add a byte to it — the stream the
        # generator prints progress on, the Node handoff returns its protocol document on,
        # and the emitted git-gate and rule-gate hooks signal their verdict on. Only the
        # LAST run's streams are kept, matching the snapshot, which is why they are
        # compared only when both sides ran the same number of times (see `compare`).
        snap["<stdout>"] = _destamp("<stdout>", _normalise(proc.stdout.encode("utf-8", "replace"), roots))
        snap["<stderr>"] = _destamp("<stderr>", _normalise(proc.stderr.encode("utf-8", "replace"), roots))
        return snap


# Six anchor cells keep their carrier file VERBATIM — one per --emit target that produces
# one. Everything else is hashes. A corpus that can only say "a path moved" makes every
# regeneration a blind blessing.
#
# CORRECTED FROM THE BRIEF, TWICE OVER. The brief's draft named the cell ids "claude/neutral"
# etc. — reversed and missing the footprint segment; the real id, as `_cell_id` builds it, is
# "{theme}/{emit}/{footprint}". It also named the carrier FILES as bare filenames
# ("CLAUDE.md", "AGENT.md", "opencode.jsonc", ".github/copilot-instructions.md") — but a
# snapshot's keys are sandbox-relative ("out/...", "home/.../cfg/..."), so a bare name never
# intersects `set(snap)` and the verbatim text silently recorded empty for all six. Reading
# the actual recorded snapshots (`tests/__snapshots__/emit/neutral__*__lean.json`) turned up
# three more wrong names, not just the missing prefix: opencode's root file is `AGENT.md`
# (singular) and its config is `opencode.json`, not `AGENTS.md`/`opencode.jsonc`; bob's and
# copilot's root file is `AGENTS.md` (plural), not `AGENT.md`; copilot never writes
# `.github/copilot-instructions.md` at all — its one root carrier is `out/AGENTS.md`, same
# name as bob's for a different emit. Verified by running `golden.cells()` and reading each
# cell's actual `paths` keys back (see task-7-report.md).
VERBATIM_CELLS = {
    "neutral/claude/lean": {"out/CLAUDE.md", "out/.claude/settings.local.json"},
    "neutral/opencode/lean": {"out/AGENT.md", "out/opencode.json"},
    "neutral/opencode-global/lean": {"home/.config/opencode/AGENT.md"},
    "neutral/files/lean": {"out/AGENT.md"},
    "neutral/bob/lean": {"out/AGENTS.md"},
    "neutral/copilot/lean": {"out/AGENTS.md"},
}


# A RECORDED CORPUS IS PER-PLATFORM, and that is a property of the thing under test rather
# than a convenience. `js/lib/pyfs.mjs`'s `writeText` translates "\n" to `os.linesep` — the
# generator really does write CRLF on Windows and LF everywhere else — so every path in a
# snapshot differs in sha256 AND in size between the two. A corpus recorded on Windows
# replayed on Linux fails all 259 cells, which is exactly what `--record`/`--against` looked
# like until this split existed: committed, never run by CI, and unusable on the platform CI
# runs on.
#
# NOT NORMALISED AWAY. Blanking line endings inside the recorder would make one corpus serve
# both platforms, and would also make the port's single most platform-specific behaviour
# unobservable to the only gate that watches it — the same shape of hole that hid a live
# CRLF/LF split from all 103 cells in P5b. `--record DIR` and `--against DIR` therefore
# resolve to `DIR/<crlf|lf>`, and each platform replays what that platform recorded.
PLATFORM_CORPUS = "crlf" if os.linesep == "\r\n" else "lf"


# WHAT A RECORDED CORPUS CANNOT KEEP — and the reason this is not `_destamp`.
#
# Every stamp in the three harnesses so far exists because the two SIDES of a cell disagree.
# These exist because two RUNS do, which is a threat that did not exist until `--record` did.
# A live pair shares one clock and one checkout: the build date and the source fingerprint are
# equal on both sides and are compared in full, including the cross-implementation claim that
# `sourceFingerprint()` answers exactly what `source_fingerprint()` does. A corpus is compared
# against a run made on ANOTHER DAY from ANOTHER TREE. Recorded raw, ten `status/*` cells and
# six `version/*` cells redden on any edit to `src/` or `themes/`, and the `build`, `learn` and
# `promote` cells redden at midnight — for reasons that are not the port. A gate that reddens
# for reasons that are not the thing it gates is a gate that gets switched off.
#
# APPLIED ONLY IN `_record_cell` AND `_against_cell`, symmetrically, so the live byte
# comparison keeps every one of these fields and owes no debt for them. It is the corpus that
# is tolerant, and only about values that provably move.
#
# EACH PATTERN IS ANCHORED ON THE MESSAGE THAT EMITS IT, never on the shape of the value
# alone: `installed: deadbeef1234` and `"installed_fp": "0000000000000000"` are seeded
# fixtures, constant across days and implementations, and stay byte-compared. That a pattern
# written against the reference's bytes also matches the port's is not an assumption — the
# live gate above proves the two are byte-identical, which is what licenses recording either.
#
# FOUND BY SCANNING A RECORDING, not by reading for them. The first draft of this table
# covered `.geneseed-version` and `[version] source:`; a scan of the resulting 318-cell corpus
# for the live fingerprint turned up ten more `status/*` cells (the TUI panel is a second
# caller of `source_fingerprint()`) and the web scan turned up the `promote` dates and the
# `"source_fp"` field. A destamp table is a claim about every caller, and only a corpus can
# check it.
CORPUS_STAMPS = (
    # `_build_render.write_version`: `<fp> (built <date>) [release <rel>]`. The release LABEL
    # is left verbatim — it moves only when a human bumps it, which is a real output change a
    # corpus SHOULD redden on. Un-anchored, because this line is also quoted inside a `diff`
    # response body (`"-c81317fdc842 (built 2026-08-11) [release 1.0.0]"`), where it is not at
    # the start of a line at all.
    (re.compile(rb"[0-9a-f]{6,64} \(built \d{4}-\d{2}-\d{2}\)"), b"<FP> (built <DATE>)"),
    # `cmd_version`'s first line — `_harness_status.py:40`, `js/status.mjs:100`.
    (re.compile(rb"(\[version\] source: +)[0-9a-f]{6,64}"), rb"\1<FP>"),
    # The `status` panel's version row, `<installed>  ·  source <fp>` —
    # `_harness_status.py:80`, `js/status.mjs:241`. EXACTLY twelve hex digits, because
    # `source_fingerprint()` is `hexdigest()[:12]`, so the `installed` fingerprint beside it
    # (a fixture) is out of reach. The tag is shorter than the value, so this row's box-drawing
    # right edge is ragged in the recorded text; the row's PADDING is computed before the
    # normalisation and is still compared, so a port that padded the panel differently is
    # still caught.
    (re.compile(rb"(\bsource )[0-9a-f]{12}(?![0-9a-f])"), rb"\1<FP>"),
    # `_status_data()`'s JSON, which the web console's Settings page serves verbatim.
    (re.compile(rb'("source_fp": ")[0-9a-f]{6,64}(?=")'), rb"\1<FP>"),
    # `api_rules_promote`'s two dates (`_web_actions.py:207-215`, `js/web/actions.mjs:424`),
    # in the JSON body and in the `user-rules.md` block it writes. `web_golden._clock_repl`
    # deliberately does NOT destamp these — they are the one rule that endpoint owns (a month
    # of probation, not a week and not none) and each cell asserts them absolutely against its
    # own `now`. Both of those properties are untouched: this runs after the cells have been
    # adjudicated, on the way into the corpus.
    (re.compile(rb"(, promoted )\d{4}-\d{2}-\d{2}"), rb"\1<DATE>"),
    (re.compile(rb'("trial_until": ")\d{4}-\d{2}-\d{2}'), rb"\1<DATE>"),
    (re.compile(rb"(trial until: )\d{4}-\d{2}-\d{2}"), rb"\1<DATE>"),
    # `_update.py:319-323`'s pulled-commit echo, `  <short-sha> <subject>`, and it is the one
    # entry here that a corpus needs for a reason no clock and no checkout explains.
    #
    # `_GIT_FIXTURE_ENV` pins the fixture's author, committer AND both dates precisely so
    # these ids hold still between runs — but a commit id is a hash of its TREE, and
    # `_tracked_files()` builds that tree from `git ls-files --cached --others
    # --exclude-standard`, the WORKING tree. So the id moves when any file in the checkout
    # does, including an untracked one, including THIS CORPUS: recording 318 cells creates
    # 318 untracked files, which land in the fixture's commit, which changes the id that the
    # recording just wrote down. A snapshot that changes its own value cannot be replayed
    # even once — the first replay after this table was written found exactly these three
    # `upgrade/*` cells differing, `974835a` against `070e84e`, same length, nothing else.
    #
    # MEASURED, NOT GUESSED. Swept over the verbatim text of all three recorded corpora —
    # 691 cells — it fires exactly twice, on the two `upgrade/*` stdouts that carry a
    # `[geneseed] pulled:` block, and nowhere in the emit or web matrices. (The third cell's
    # copy lives in `home/.geneseed-install.log`, which is a hashed file rather than verbatim
    # text; the replay is what confirms that one.) Both sides of a live cell clone ONE
    # template, so the live gate still compares these ids byte for byte and a port that
    # echoed the wrong commit is still caught there.
    (re.compile(rb"^ {2}[0-9a-f]{7,40} (?=\S)", re.M), b"  <SHA> "),
)

# `learn`'s bullet, `- <today>: <lesson>` (`_harness_learn.py:44`) — the one stamp that needs
# the FILE it sits in and not just the line it is on. `src/memory/README.md:93` DOCUMENTS this
# format with a fixed example (`- 2026-07-04: this repo's tests double as docs...`), that line
# is rendered into the memory store of every emit, and it is a CONSTANT: blanking it costs
# four bytes of comparison in every cell that emits a bundle and buys nothing. It also made
# the 259 already-committed emit snapshots stale on sight, which is how it was found — a
# re-record of the untouched emit matrix came back differing in one file, `out/.bob/memory/
# README.md`, 5264 bytes against 5260.
#
# The lessons file always opens with the header `_harness_learn.py:47` writes, so that header
# is the anchor and the README can never match it.
_LESSONS_FILE = re.compile("^# .+ — lessons".encode("utf-8"))
_LESSON_BULLET = re.compile(rb"^- \d{4}-\d{2}-\d{2}: ", re.M)


def corpus_normalise(snap):
    """One snapshot, with the values that move between RUNS tagged. See `CORPUS_STAMPS`.

    Values only. A KEY that carried a moving value would make the same cell report MISSING
    and EXTRA for one file, which is louder rather than quieter — and the harnesses already
    destamp the two filenames that move (`improvements-<STAMP>.md`,
    `archived-memory/<STAMP>`) because the live comparison needed it first. Re-checked by
    scanning a full recording of both matrices, keys included: nothing else moves.

    An error string passes through, so the callers' `isinstance` checks still see it."""
    if isinstance(snap, str):
        return snap
    out = {}
    for k, v in snap.items():
        for pat, repl in CORPUS_STAMPS:
            v = pat.sub(repl, v)
        if _LESSONS_FILE.match(v):
            v = _LESSON_BULLET.sub(b"- <DATE>: ", v)
        out[k] = v
    return out


def _cell_id(cell: dict) -> str:
    """The human label for one cell — shared by the byte comparison, `--record` and
    `--against`, so a recorded corpus and a live run can never disagree about a cell's
    name."""
    return cell.get("label") or (
        f"{cell['theme']}/{cell['emit']}/{cell['footprint']}"
        + (f"/{cell['posture']}" if cell.get("posture") else "")
        + (f"/{cell['mode']}" if cell.get("mode") else ""))


def _diff(name: str, a: bytes, b: bytes) -> str:
    try:
        la, lb = a.decode("utf-8").splitlines(), b.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return f"    {name}: binary differs ({len(a)} vs {len(b)} bytes)"
    lines = list(difflib.unified_diff(la, lb, "ref/" + name, "new/" + name, lineterm="", n=1))
    return "\n".join("    " + x for x in lines[:14])


def compare(ref: list[str], new: list[str], quick: bool, limit: int,
            ref_repeat: int = 1, new_repeat: int = 1,
            matrix: "list[dict] | None" = None, jobs: int = 1,
            record: "str | None" = None, against: "str | None" = None) -> int:
    """The three things this file can do to a matrix, sharing one runner.

    Plain (record and against both None): run BOTH generators, byte-compare — the
    original gate.
    `record`: run ONLY `ref`, write each cell's snapshot to `record` instead of
    comparing. This is how the reference's answer outlives the reference.
    `against`: run ONLY `new`, and compare it against a corpus recorded earlier
    instead of a live `ref`. A cell the corpus has no entry for is a FAILURE, not a
    skip — a silently-ignored new cell is not a gate."""
    matrix = cells(quick) if matrix is None else matrix
    times = {1: "", 2: " ×2"}
    if record:
        print(f"[golden] {len(matrix)} cells · recording ref={' '.join(ref)} -> {record}")
        # One flat file per cell, named `snapshot_io._safe(_cell_id(cell))`. Two cells whose
        # IDS differ but whose FILENAMES collide would record 258 answers for 259 cells, and
        # `--against` would then pass over a corpus quietly missing one. Asserted before the
        # first write rather than after the last: a collision then costs no emit and leaves
        # no half-written corpus behind.
        names = {snapshot_io._safe(_cell_id(c)) for c in matrix}
        assert len(names) == len(matrix), (
            f"{len(matrix)} cells collapse onto {len(names)} corpus filenames — two distinct "
            "cell ids map to one file, so the recorded corpus would be silently short")
    elif against:
        print(f"[golden] {len(matrix)} cells · new={' '.join(new)}{times.get(new_repeat, '')}"
              f" · against corpus {against} · jobs={jobs}")
    else:
        print(f"[golden] {len(matrix)} cells · ref={' '.join(ref)}{times.get(ref_repeat, '')}"
              f" · new={' '.join(new)}{times.get(new_repeat, '')} · jobs={jobs}")
    failures: list[str] = []

    def _pair(cell: dict) -> tuple:
        """Both sides of ONE cell — or just the one side `record`/`against` needs. The
        reference side of a deletion cell is the AFTER configuration emitted into a
        clean sandbox — the tree the prune is supposed to reproduce."""
        ref_cell = {k: v for k, v in cell.items() if k != "before"}
        if record:
            return run_cell(ref, ref_cell, ref_repeat), None
        if against:
            return None, run_cell(new, cell, new_repeat)
        return run_cell(ref, ref_cell, ref_repeat), run_cell(new, cell, new_repeat)

    # `pool.map` yields in SUBMISSION order, so the failure list, the `--limit` cut and the
    # progress counter all read exactly as they did serially. An exception inside a worker
    # is re-raised here rather than swallowed, so a crashed cell ends the run loudly instead
    # of shortening the matrix silently.
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=jobs)
    with pool:
        for i, (cell, (a, b)) in enumerate(zip(matrix, pool.map(_pair, matrix)), 1):
            cid = _cell_id(cell)
            if record:
                _record_cell(record, cid, a, failures, VERBATIM_CELLS.get(cid, set()))
            elif against:
                _against_cell(against, cid, b, failures)
            else:
                _compare_cell(cid, cell, a, b, ref_repeat, new_repeat, failures)
            if i % 25 == 0 or i == len(matrix):
                print(f"[golden]   {i}/{len(matrix)} ({len(failures)} failing)")
    if not failures:
        if record:
            print(f"[golden] recorded {len(matrix)} cells to {record}")
        else:
            print(f"[golden] ok — {len(matrix)} cells byte-identical")
        return 0
    print(f"\n[golden] {len(failures)}/{len(matrix)} cells DIFFER:\n")
    for f in failures[:limit]:
        print(f + "\n")
    if len(failures) > limit:
        print(f"[golden] ... and {len(failures) - limit} more (raise --limit to see them)")
    return 1


def _record_cell(record_dir: str, cid: str, snap, failures: list[str],
                 extra: "set[str]" = frozenset()) -> None:
    """One cell's half of `--record`: write its snapshot down, or fail loudly if the
    reference generator itself crashed — a corpus entry silently missing its own cell
    is worse than no corpus at all.

    SHARED BY ALL THREE HARNESSES, which is why the verbatim rule lives here rather than
    at each call site. Every key a harness invents for something that is not a file is
    spelled `<...>` — `<stdout>`, `<stderr>`, `<exit>`, `<dirs>`, `<daemon-record>`,
    `<r3 body>` — and a filename can never begin with `<` on Windows, which is the
    platform half of the corpus this rule is recorded on. Those keys ARE the payload of a
    CLI or web cell, and a corpus that can only say "the body changed" without saying how
    makes every regeneration a blind blessing. Real files stay hashed, because the emit
    matrix is 122 MB raw; `extra` is how the emit matrix names the handful of carrier
    files it keeps verbatim anyway (see `VERBATIM_CELLS`).
    """
    if isinstance(snap, str):
        failures.append(f"  {cid}: reference run failed, nothing recorded: {snap}")
        return
    snap = corpus_normalise(snap)
    snapshot_io.write(Path(record_dir), cid, snap,
                      verbatim={k for k in snap if k.startswith("<")} | set(extra))


def _against_cell(against_dir: str, cid: str, snap, failures: list[str]) -> None:
    """One cell's half of `--against`: replay the live (`new`) side against the corpus
    recorded earlier. A cell present in this run but absent from the corpus is a
    FAILURE — see the module docstring on why a silent skip is not acceptable here."""
    if isinstance(snap, str):
        failures.append(f"  {cid}: candidate run failed: {snap}")
        return
    recorded = snapshot_io.read(Path(against_dir), cid)
    if recorded is None:
        failures.append(f"  {cid}: NO RECORDED SNAPSHOT in {against_dir} — a cell present "
                        "in this run but absent from the corpus is a failure, not a skip")
        return
    problems = snapshot_io.compare(recorded, corpus_normalise(snap))
    if problems:
        failures.append(f"  {cid}: {len(problems)} differ from the recorded corpus:\n"
                        + "\n".join(problems[:10]))


def _compare_cell(cid: str, cell: dict, a, b, ref_repeat: int, new_repeat: int,
                  failures: list[str]) -> None:
    """Adjudicate one already-run cell. Split out of `compare` when the runs became
    concurrent: everything here reads two finished snapshots and appends to `failures`,
    and it stays on the main thread so the ordering and the reporting are unchanged."""
    # The streams are only comparable when both sides ran the same number of times.
    # Emit two legitimately says different things from emit one — it warns about files
    # it now finds already there — so `--idempotent` and `--deletion`, which compare a
    # fresh emit against a tree that already held one, drop them rather than reporting
    # a difference that is the point of the flag.
    runs = (ref_repeat, new_repeat + (1 if cell.get("before") else 0))
    if runs[0] != runs[1] and not isinstance(a, str) and not isinstance(b, str):
        for snap in (a, b):
            snap.pop("<stdout>", None)
            snap.pop("<stderr>", None)
    if isinstance(a, str) or isinstance(b, str):
        failures.append(f"  {cid}: generator failed\n    ref: {a if isinstance(a, str) else 'ok'}"
                        f"\n    new: {b if isinstance(b, str) else 'ok'}")
        return
    only_a, only_b = sorted(set(a) - set(b)), sorted(set(b) - set(a))
    differing = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    # The sovereign write-once seeds. A deletion cell switches the theme under a tree
    # that already has one, and the agent's own spaces are seeded ONCE and never
    # re-rendered by design (`_build_render.py:880` for the bundle's notebook,
    # `_global_memory`/`_global_notebook` for the config dirs) — so they keep the
    # pre-switch vocabulary while a fresh emit renders the new one. That is the
    # contract, not a prune failure. Named per cell rather than filtered globally, and
    # a cell whose carve-out catches NOTHING fails: a normaliser that has stopped
    # excusing anything is hiding whatever it would excuse next.
    stale = {k for k in differing if any(k.endswith(s) for s in cell.get("sovereign", ()))}
    differing = [k for k in differing if k not in stale]
    if cell.get("sovereign") and not stale:
        failures.append(f"  {cid}: no file kept its pre-switch text — the sovereign "
                        f"carve-out {list(cell['sovereign'])} excuses nothing here "
                        f"and must be removed")
    elif only_a or only_b or differing:
        parts = [f"  {cid}: {len(only_a)} missing, {len(only_b)} extra, "
                 f"{len(differing)} differing"]
        parts += [f"    - only in ref: {k}" for k in only_a[:5]]
        parts += [f"    + only in new: {k}" for k in only_b[:5]]
        parts += [_diff(k, a[k], b[k]) for k in differing[:2]]
        failures.append("\n".join(parts))


def _split(cmd: str) -> list[str]:
    """Split a command string into argv. posix=False so a Windows path's backslashes
    survive (posix mode eats them as escapes), then strip the quote pairs posix=False
    leaves attached to each token — CreateProcess takes the quotes literally and fails
    with a bare "cannot find the file specified"."""
    out = []
    for tok in shlex.split(cmd, posix=False):
        if len(tok) > 1 and tok[0] == tok[-1] and tok[0] in "\"'":
            tok = tok[1:-1]
        out.append(tok)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ref", default=None,
                    help="reference generator command (default: this repo's build.py)")
    ap.add_argument("--new", default=None,
                    help="candidate generator. Omitted: compare ref against itself, "
                         "which self-checks determinism.")
    ap.add_argument("--quick", action="store_true",
                    help="neutral theme only (18 cells) — for fast iteration")
    ap.add_argument("--limit", type=int, default=5, help="failing cells to detail")
    ap.add_argument("--idempotent", action="store_true",
                    help="re-emit gate: compare a FRESH emit against a second emit onto "
                         "the tree the first one left. Everything else here emits into a "
                         "clean sandbox, so idempotence, the write-before-delete prune, "
                         "claim-on-create and the managed-block merge are otherwise never "
                         "exercised — and that is the path every user is on from their "
                         "second build onwards. Uses --ref alone; --new is ignored.")
    ap.add_argument("--deletion", action="store_true",
                    help="prune gate: emit configuration A, then B onto A's tree, and "
                         "compare against a fresh emit of B. --idempotent cannot reach "
                         "the write-before-delete prune's deletion path, because both of "
                         "its emits share one configuration and `old_owned - owned` is "
                         "therefore always empty. Uses --ref alone; --new is ignored.")
    ap.add_argument("--repeat", type=int, default=1, metavar="N",
                    help="emit N times into the same sandbox on BOTH sides before "
                         "comparing. `--idempotent` compares a generator against ITSELF, so "
                         "it can only prove a re-emit is self-consistent — the re-emit path "
                         "is otherwise never compared ACROSS implementations, and it is the "
                         "path that reads the previous manifest, claims on create, and "
                         "merges into files that already exist. It does NOT reach the "
                         "prune's deletion path: the configuration is fixed, so `owned` is "
                         "the same on every pass and `old_owned - owned` is always empty — "
                         "that is `--deletion`'s job and measured to be only its job.")
    ap.add_argument("--emits", default=None,
                    help="comma-separated --emit modes to keep (default: all nine). For a "
                         "PARTIAL port: the Node driver crosses one emit at a time, so "
                         "`--new 'node bin/geneseed.mjs' --emits files` gates exactly what "
                         "has crossed instead of reporting eight refusals as failures. "
                         "Drop the flag once all nine cross — it narrows the matrix and "
                         "narrowing it is the thing to stop doing.")
    ap.add_argument("--jobs", type=int, default=DEFAULT_JOBS, metavar="N",
                    help="cells to run CONCURRENTLY (default: %(default)s on this machine). "
                         "A cell is a self-contained sandbox and two child processes, so "
                         "this changes only how long the gate takes, never what it "
                         "compares — `--jobs 1` is the old serial run and reports "
                         "identically.")
    ap.add_argument("--record", metavar="DIR", default=None,
                    help="write each cell's snapshot to DIR/<crlf|lf> instead of comparing. "
                         "Uses --ref alone; --new is ignored. This is how the reference's "
                         "answer outlives the reference. The subdirectory is this platform's "
                         "line ending, which the generator really does emit.")
    ap.add_argument("--against", metavar="DIR", default=None,
                    help="compare --new's live output against a corpus recorded earlier "
                         "with --record into DIR/<crlf|lf>, instead of a live --ref. A cell "
                         "with no recorded snapshot is a FAILURE, not a skip.")
    args = ap.parse_args(argv)
    if args.record and args.against:
        print("[golden] --record and --against are mutually exclusive")
        return 2
    # Both flags name the corpus ROOT; the platform subdirectory is chosen here rather than
    # by the caller, so a recording and a replay on the same machine can never land in
    # different places. See PLATFORM_CORPUS for why the split is not a normalisation.
    if args.record:
        args.record = str(Path(args.record) / PLATFORM_CORPUS)
    if args.against:
        args.against = str(Path(args.against) / PLATFORM_CORPUS)
    # Refused rather than clamped, for `--repeat 0`'s reason: `ThreadPoolExecutor(0)` raises
    # and a negative one would too, but a flag that silently corrected itself would let a
    # typo'd `--jobs` read as an accepted setting.
    if args.jobs < 1:
        print(f"[golden] --jobs must be at least 1, got {args.jobs}")
        return 2
    ref = _split(args.ref) if args.ref else [sys.executable, "build.py"]
    new = _split(args.new) if args.new else ref
    keep = None
    if args.emits:
        keep = [e.strip() for e in args.emits.split(",") if e.strip()]
        unknown = sorted(set(keep) - set(EMITS))
        if unknown:
            print(f"[golden] unknown --emits value(s): {', '.join(unknown)} "
                  f"(choose from {', '.join(EMITS)})")
            return 2
    def _keep(matrix: list[dict]) -> "list[dict] | None":
        """Apply --emits, refusing an EMPTY result rather than reporting 0/0 as a pass.
        A filter that matches nothing is the silent-cap failure mode this file exists to
        avoid: `--emits files` against the deletion matrix selects no cell at all, and
        "0 cells, no differences" reads exactly like a green run."""
        if keep is None:
            return matrix
        kept = [c for c in matrix if c["emit"] in keep]
        if not kept:
            print(f"[golden] --emits {','.join(keep)} selected 0 of {len(matrix)} cells "
                  f"— nothing would be compared, which is not a pass.")
            return None
        return kept

    if args.deletion:
        # Both sides are the SAME generator; the variable is what the target held before.
        m = _keep(deletion_cells(args.quick))
        return 2 if m is None else compare(ref, ref, args.quick, args.limit, matrix=m,
                                           jobs=args.jobs)
    if args.idempotent:
        # Both sides are the SAME generator; the variable is whether the target already
        # holds a previous emit. A difference here is a re-emit bug, not a port bug.
        m = _keep(cells(args.quick))
        return 2 if m is None else compare(ref, ref, args.quick, args.limit,
                                           ref_repeat=1, new_repeat=2, matrix=m,
                                           jobs=args.jobs)
    if args.repeat < 1:
        print(f"[golden] --repeat must be at least 1, got {args.repeat}")
        return 2
    m = _keep(cells(args.quick))
    return 2 if m is None else compare(ref, new, args.quick, args.limit, matrix=m,
                                       ref_repeat=args.repeat, new_repeat=args.repeat,
                                       jobs=args.jobs, record=args.record,
                                       against=args.against)


if __name__ == "__main__":
    raise SystemExit(main())
