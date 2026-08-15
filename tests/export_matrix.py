"""Export the three cell matrices to JSON, while the reference still owns them.

WHY THIS EXISTS, AND WHY IT HAS A DEADLINE. The three cell harnesses are ~9,600 lines, but
~6,700 of that is cell DECLARATIONS — and they are data, not code: `golden.cells()`,
`golden.deletion_cells()`, `harness_golden.cells()` and `web_golden.cells()` all serialise
cleanly (only web's request bodies are `bytes`, and base64 crosses those). So the Node
replayers do not need those 6,700 lines re-expressed in another language. They need them
EXPORTED, once, from the functions that already own them.

RE-AUTHORING THE MATRIX IN NODE WOULD BE THE WRONG DIRECTION and not merely a slower one. The
cells would be re-derived by the same person porting the code they gate, which is exactly how
a fixture comes to make the defect it should catch indistinguishable. An export is a `git mv`
in spirit: the same move P2 made when `cli.json` became `js/cli-table.json`, byte for byte.

THE DEADLINE IS P4. After the reference is deleted these functions do not exist, and a matrix
re-derived from the port proves nothing the port did not already believe.

PER-PLATFORM, AND THAT IS A MEASUREMENT RATHER THAN A PRECAUTION. Three sites bake the host
into cell DATA, and none of them can be faked from the other side:

  * `harness_golden._link_cells()` dispatches to a win32 or a posix arm — `link` and `unlink`
    are two different programs, declared as a union in `PLATFORM_ONLY`.
  * `harness_golden`'s `exclude/remove-a-case-differing-entry` expects "re-included." on
    Windows and "was not excluded" elsewhere.
  * `web_golden._MEM_CASE_FOLDED` orders a catalog by the host's case-folding rule.

And one that defeats monkeypatching outright: `harness_golden._np()` is `str(Path(rel))`, the
platform's OWN separator, and `pathlib` picks its flavour from `os.name`, which no assignment
to `sys.platform` changes. So each half is recorded by the host that can produce it — the same
arrangement the `lf`/`crlf` corpora already have, for the same reason.

THE TWO HALVES ARE THEN DIFFABLE, which is the point of writing both rather than merging them
here. `tests/test_matrix_export.py` requires the residual difference between the win32 and
posix files to be EXACTLY the declared set. Anything else is host state leaking into the
matrix — Task 8c's method (the residual diff between two machines IS the detector) aimed at a
matrix instead of at a corpus.

NO CLOCK, NO TEMP NAME, NO INTERPRETER VERSION in the output. The emit corpus's platform diff
once aborted on a `python: 3.13.5` against `3.13.15` that nothing read; provenance that varies
between two machines makes a cross-platform diff report the recorder instead of the recording.

USAGE:  python tests/export_matrix.py            # writes this host's three halves
        python tests/export_matrix.py --out DIR  # somewhere else, for a diff
"""
import argparse
import base64
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import golden  # noqa: E402
import harness_golden  # noqa: E402
import web_golden  # noqa: E402

DEFAULT_OUT = HERE / "helpers" / "matrix"


#: THE ONE PER-PROCESS VALUE IN ANY OF THE THREE MATRICES, put back where its siblings
#: already are. `web_golden._activity_world` seeds six sessions whose `pid` is the
#: placeholder `{pid}` and ONE — `s-live.detail.json` — that writes `os.getpid()` literally,
#: because that file is built through `json.dumps` and the others are built as TEXT (which is
#: exactly what the comment above them says the placeholders require). At run time the two
#: spellings are the same value: `_clock_repl` seeds `{pid}` from `os.getpid()` in the same
#: process. In an EXPORT they are not the same thing at all — one is data and one is a
#: recording of whichever process happened to run the exporter.
#:
#: SUBSTITUTED HERE RATHER THAN FIXED THERE, deliberately. The correct-looking fix is to
#: rewrite that one seed as text so it can carry `{pid}` like its siblings — but the file is
#: a world seeded into a sandbox a recorded web cell then drives, the corpus can never be
#: re-recorded, and rebuilding a `json.dumps` document by hand to be byte-identical is a real
#: chance to move one. A transformation here cannot: the reference is not touched, and
#: `tests/test_matrix_export.py` proves the round trip is lossless by substituting the pid
#: back in and requiring the live cells exactly.
_PID_LITERAL = f'"pid": {os.getpid()}'
_PID_PLACEHOLDER = '"pid": {pid}'


def _encode(o, *, depid=True):
    """`bytes` is the only value in any of the three matrices JSON cannot carry — 114 web
    request bodies. Tagged rather than decoded, because a body that is not valid UTF-8 is a
    case the web cells deliberately contain and `.decode()` would lose it.

    `depid=False` is for the gate, which needs the untransformed matrix to compare against."""
    if isinstance(o, bytes):
        return {"__b64__": base64.b64encode(o).decode("ascii")}
    if isinstance(o, dict):
        return {k: _encode(v, depid=depid) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_encode(v, depid=depid) for v in o]
    if isinstance(o, set):
        # Sorted, so two recordings of one host agree. No matrix uses one today; refusing
        # silently would be worse than the two lines.
        return sorted(_encode(v, depid=depid) for v in o)
    if isinstance(o, str) and depid:
        return o.replace(_PID_LITERAL, _PID_PLACEHOLDER)
    return o


def repid(o):
    """The inverse, for the gate. Substituting this process's pid back into an exported
    matrix must reproduce the live one exactly — which is what makes the transformation
    above a spelling change rather than a loss."""
    if isinstance(o, dict):
        return {k: repid(v) for k, v in o.items()}
    if isinstance(o, list):
        return [repid(v) for v in o]
    if isinstance(o, str):
        return o.replace(_PID_PLACEHOLDER, _PID_LITERAL)
    return o


def documents(*, depid=True) -> "dict[str, dict]":
    """The three matrices as this host declares them."""
    def enc(v):
        return _encode(v, depid=depid)
    return {
        "emit": {
            "cells": enc(golden.cells()),
            "deletion_cells": enc(golden.deletion_cells()),
        },
        "cli": {
            "cells": enc(harness_golden.cells()),
            # The table travels WITH the matrix. `ThePlatformDeclaredCellsAreDeclared` asserts
            # the two against each other, and a declaration in one file gating cells in
            # another is how the union stopped being checkable the first time.
            "platform_only": dict(harness_golden.PLATFORM_ONLY),
        },
        "web": {"cells": enc(web_golden.cells())},
    }


def write(out: Path) -> "list[Path]":
    out.mkdir(parents=True, exist_ok=True)
    plat = harness_golden.this_platform()
    written = []
    for name, doc in documents().items():
        f = out / f"{name}.{plat}.json"
        f.write_text(
            json.dumps(dict(doc, platform=plat), indent=2, ensure_ascii=False,
                       sort_keys=True) + "\n",
            encoding="utf-8", newline="\n")
        written.append(f)
    return written


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args(argv)
    for f in write(Path(args.out)):
        print(f"[export] {f.relative_to(Path.cwd()) if f.is_relative_to(Path.cwd()) else f}"
              f"  ({f.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
