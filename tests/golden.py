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
    python tests/golden.py --new "node bin/geneseed-gen.js"  # the P1 gate
    python tests/golden.py --new "python ../old/build.py"    # cross-revision regression

SAFETY: every cell runs with HOME/USERPROFILE/XDG_CONFIG_HOME/APPDATA/LOCALAPPDATA
redirected into a throwaway dir (the recipe tests/test_emit_smoke.py uses). Without
that, the ~126 *-global cells would render straight into the real config dirs and
overwrite the user's actual installs. Never remove the sandbox.
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
    compare two empty trees and call it a pass."""
    snap: dict[str, bytes] = {}
    for p in sorted(sandbox.rglob("*")):
        if not p.is_file() or "__pycache__" in p.parts or p.name.startswith(_SHIM_GLOB):
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


def run_cell(gen: list[str], cell: dict) -> "dict[str, bytes] | str":
    """Run one generator over one cell in a fresh sandbox. Returns the snapshot, or an
    error string — a generator that crashes is a finding, not an exception to raise."""
    with tempfile.TemporaryDirectory() as td:
        home, out = Path(td) / "home", Path(td) / "out"
        home.mkdir()
        env = dict(os.environ, HOME=str(home), USERPROFILE=str(home),
                   XDG_CONFIG_HOME=str(home / ".config"),
                   APPDATA=str(home / "AppData" / "Roaming"),
                   LOCALAPPDATA=str(home / "AppData" / "Local"),
                   GENESEED_HOME=str(home / ".geneseed"),
                   PYTHONUTF8="1")
        env.pop("GENESEED_HARNESS", None)
        proc = subprocess.run(gen + _argv(cell, out), cwd=str(ROOT), env=env,
                              capture_output=True, text=True)
        if proc.returncode != 0:
            return f"exit {proc.returncode}: {(proc.stderr or proc.stdout).strip()[:400]}"
        sick = _shim_health(Path(td))
        if sick:
            return sick
        # <REPO> matters only once the two sides run from different checkouts (the Node
        # port, or a cross-revision regression run); harmless when they share one.
        return _snapshot(Path(td), [("<HOME>", home), ("<OUT>", out), ("<REPO>", ROOT)])


def _diff(name: str, a: bytes, b: bytes) -> str:
    try:
        la, lb = a.decode("utf-8").splitlines(), b.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return f"    {name}: binary differs ({len(a)} vs {len(b)} bytes)"
    lines = list(difflib.unified_diff(la, lb, "ref/" + name, "new/" + name, lineterm="", n=1))
    return "\n".join("    " + x for x in lines[:14])


def compare(ref: list[str], new: list[str], quick: bool, limit: int) -> int:
    matrix = cells(quick)
    print(f"[golden] {len(matrix)} cells · ref={' '.join(ref)} · new={' '.join(new)}")
    failures: list[str] = []
    for i, cell in enumerate(matrix, 1):
        cid = f"{cell['theme']}/{cell['emit']}/{cell['footprint']}" + \
              (f"/{cell['posture']}" if cell.get("posture") else "") + \
              (f"/{cell['mode']}" if cell.get("mode") else "")
        a, b = run_cell(ref, cell), run_cell(new, cell)
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
    args = ap.parse_args(argv)
    ref = _split(args.ref) if args.ref else [sys.executable, "build.py"]
    new = _split(args.new) if args.new else ref
    return compare(ref, new, args.quick, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
