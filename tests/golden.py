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
import difflib
import hashlib
import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

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
    Each root is replaced in all three spellings a generator might emit it in — native
    separators, forward slashes, and JSON-escaped backslashes — because settings.json
    and the manifest carry paths through json.dumps while markdown carries them raw."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data  # binary: compare raw
    for tag, path in roots:
        s = str(path)
        for spelling in (s, s.replace("\\", "/"), s.replace("\\", "\\\\")):
            text = text.replace(spelling, tag)
    return text.encode("utf-8")


# The hook shim is deliberately NOT compared. It is install plumbing rather than
# generated output: its body bakes the interpreter and checkout of whichever generator
# wrote it, so a Node generator would differ from Python in every single cell and drown
# every real finding in noise. Excluding it would leave a hole, so `_shim_health` asserts
# it directly instead — the shim has to exist and name files that exist.
_SHIM_GLOB = "geneseed-hook"


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
    for p in sorted(sandbox.rglob("*")):
        if not p.is_file() or p.name.startswith(_SHIM_GLOB):
            continue
        try:
            snap[p.relative_to(sandbox).as_posix()] = _normalise(p.read_bytes(), roots)
        except OSError:
            continue
    return snap


def _shim_health(sandbox: Path) -> "str | None":
    """The check that replaces comparing the shim. Emitted hooks are worthless if the
    shim they all name is missing or points at nothing, and no byte-diff of the emitted
    tree can reveal that — the shim lives outside it. Returns a problem, or None."""
    found = [p for p in sandbox.rglob("*") if p.is_file() and p.name.startswith(_SHIM_GLOB)]
    if not found:
        return None  # emits with no hooks (files, copilot, opencode) legitimately write none
    for p in found:
        try:
            body = p.read_text(encoding="utf-8")
        except OSError as e:
            return f"shim {p.name} unreadable: {e}"
        missing = [q for q in re.findall(r'"([^"]+)"', body) if not Path(q).exists()]
        if missing:
            return f"shim {p.name} names missing {missing[0]}"
    return None


# Host relocation knobs. Each resolver checks its own variable FIRST and returns before
# ever consulting HOME/XDG (_build_core.py:84/104/116), so redirecting HOME alone does
# NOT sandbox the *-global emits. Measured, not theorised: with OPENCODE_CONFIG_DIR
# exported, one opencode-global cell wrote 135 files straight into the real target.
RELOCATION_VARS = ("OPENCODE_CONFIG_DIR", "BOB_CONFIG_DIR", "COPILOT_CONFIG_DIR")


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
    inherited set."""
    env = dict(os.environ, HOME=str(home), USERPROFILE=str(home),
               XDG_CONFIG_HOME=str(home / ".config"),
               APPDATA=str(home / "AppData" / "Roaming"),
               LOCALAPPDATA=str(home / "AppData" / "Local"),
               GENESEED_HOME=str(home / ".geneseed"),
               PYTHONUTF8="1")
    for var in RELOCATION_VARS:
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
    anything to do when the target already exists."""
    with tempfile.TemporaryDirectory() as td:
        home, out = Path(td) / "home", Path(td) / "out"
        home.mkdir()
        env = cell_env(home)
        for n in range(1, repeat + 1):
            proc = subprocess.run(gen + _argv(cell, out), cwd=str(ROOT), env=env,
                                  capture_output=True, text=True)
            if proc.returncode != 0:
                emit = f"emit {n} of {repeat}: " if repeat > 1 else ""
                return (f"{emit}exit {proc.returncode}: "
                        f"{(proc.stderr or proc.stdout).strip()[:400]}")
        sick = _shim_health(Path(td))
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
        snap["<stdout>"] = _normalise(proc.stdout.encode("utf-8", "replace"), roots)
        snap["<stderr>"] = _normalise(proc.stderr.encode("utf-8", "replace"), roots)
        return snap


def _diff(name: str, a: bytes, b: bytes) -> str:
    try:
        la, lb = a.decode("utf-8").splitlines(), b.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return f"    {name}: binary differs ({len(a)} vs {len(b)} bytes)"
    lines = list(difflib.unified_diff(la, lb, "ref/" + name, "new/" + name, lineterm="", n=1))
    return "\n".join("    " + x for x in lines[:14])


def compare(ref: list[str], new: list[str], quick: bool, limit: int,
            ref_repeat: int = 1, new_repeat: int = 1) -> int:
    matrix = cells(quick)
    times = {1: "", 2: " ×2"}
    print(f"[golden] {len(matrix)} cells · ref={' '.join(ref)}{times.get(ref_repeat, '')}"
          f" · new={' '.join(new)}{times.get(new_repeat, '')}")
    failures: list[str] = []
    for i, cell in enumerate(matrix, 1):
        cid = f"{cell['theme']}/{cell['emit']}/{cell['footprint']}" + \
              (f"/{cell['posture']}" if cell.get("posture") else "") + \
              (f"/{cell['mode']}" if cell.get("mode") else "")
        a, b = run_cell(ref, cell, ref_repeat), run_cell(new, cell, new_repeat)
        # The streams are only comparable when both sides ran the same number of times.
        # Emit two legitimately says different things from emit one — it warns about files
        # it now finds already there — so `--idempotent`, which compares a fresh emit
        # against a repeated one, drops them rather than reporting a difference that is
        # the point of the flag.
        if ref_repeat != new_repeat and not isinstance(a, str) and not isinstance(b, str):
            for snap in (a, b):
                snap.pop("<stdout>", None)
                snap.pop("<stderr>", None)
        if isinstance(a, str) or isinstance(b, str):
            failures.append(f"  {cid}: generator failed\n    ref: {a if isinstance(a, str) else 'ok'}"
                            f"\n    new: {b if isinstance(b, str) else 'ok'}")
        elif a != b:
            only_a, only_b = sorted(set(a) - set(b)), sorted(set(b) - set(a))
            differing = sorted(k for k in set(a) & set(b) if a[k] != b[k])
            parts = [f"  {cid}: {len(only_a)} missing, {len(only_b)} extra, "
                     f"{len(differing)} differing"]
            parts += [f"    - only in ref: {k}" for k in only_a[:5]]
            parts += [f"    + only in new: {k}" for k in only_b[:5]]
            parts += [_diff(k, a[k], b[k]) for k in differing[:2]]
            failures.append("\n".join(parts))
        if i % 25 == 0 or i == len(matrix):
            print(f"[golden]   {i}/{len(matrix)} ({len(failures)} failing)")
    if not failures:
        print(f"[golden] ok — {len(matrix)} cells byte-identical")
        return 0
    print(f"\n[golden] {len(failures)}/{len(matrix)} cells DIFFER:\n")
    for f in failures[:limit]:
        print(f + "\n")
    if len(failures) > limit:
        print(f"[golden] ... and {len(failures) - limit} more (raise --limit to see them)")
    return 1


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
    args = ap.parse_args(argv)
    ref = _split(args.ref) if args.ref else [sys.executable, "build.py"]
    new = _split(args.new) if args.new else ref
    if args.idempotent:
        # Both sides are the SAME generator; the variable is whether the target already
        # holds a previous emit. A difference here is a re-emit bug, not a port bug.
        return compare(ref, ref, args.quick, args.limit, ref_repeat=1, new_repeat=2)
    return compare(ref, new, args.quick, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
