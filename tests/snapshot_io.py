"""One owner for writing and reading a recorded cell snapshot.

FORMAT. One JSON document per cell: {"paths": {"<posix-relpath>": "<sha256>"},
"sizes": {...}, "verbatim": {"<name>": "<text>"}}. Hashes for the tree, because the emit
matrix is 122 MB raw; VERBATIM text for the streams and for a declared handful of carrier
files, because "a path moved" without "what moved" is a diff nobody can review.

WHY NOT `git diff` ON RAW BLOBS: the reviewable artifact must be readable in a pull request.
A hash line changing tells you a file moved; the verbatim set is what tells you how."""
import hashlib
import json
from pathlib import Path

_SHA = lambda b: hashlib.sha256(b).hexdigest()  # noqa: E731


def write(dirpath: Path, cell_id: str, snap: "dict[str, bytes]", *,
          verbatim: "set[str]") -> None:
    dirpath.mkdir(parents=True, exist_ok=True)
    doc = {
        "paths": {k: _SHA(v) for k, v in sorted(snap.items())},
        "sizes": {k: len(v) for k, v in sorted(snap.items())},
        "verbatim": {k: snap[k].decode("utf-8", "replace")
                     for k in sorted(verbatim & set(snap))},
    }
    (dirpath / f"{_safe(cell_id)}.json").write_text(
        json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8")


def read(dirpath: Path, cell_id: str) -> "dict | None":
    f = dirpath / f"{_safe(cell_id)}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def compare(recorded: dict, live: "dict[str, bytes]") -> "list[str]":
    out = []
    rec_paths, live_paths = recorded["paths"], {k: _SHA(v) for k, v in live.items()}
    for k in sorted(set(rec_paths) - set(live_paths)):
        out.append(f"    MISSING {k} (recorded, not produced)")
    for k in sorted(set(live_paths) - set(rec_paths)):
        out.append(f"    EXTRA   {k} (produced, not recorded)")
    for k in sorted(set(rec_paths) & set(live_paths)):
        if rec_paths[k] != live_paths[k]:
            detail = ""
            if k in recorded.get("verbatim", {}):
                detail = (f"\n      recorded: {recorded['verbatim'][k]!r}"
                          f"\n      live:     {live[k].decode('utf-8', 'replace')!r}")
            out.append(f"    CHANGED {k} "
                       f"({recorded['sizes'].get(k)} -> {len(live[k])} bytes){detail}")
    return out


def _safe(cell_id: str) -> str:
    """A cell id carries `/` and `:`. One flat file per cell, name reversible by eye."""
    return cell_id.replace("/", "__").replace(":", "-")
