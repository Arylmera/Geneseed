"""Persistent record of folders a harness was deployed into, so the web console can
list installs it cannot otherwise rediscover. `harness._install_targets()` only ever
re-derives the cwd + the two global config dirs each load, so a harness deployed into
an arbitrary folder vanishes the moment that folder isn't the daemon's cwd. Every
deploy writes its root here (build.py choke point); the console merges these roots back
into the install list.

Design: ONE file, just a list of absolute paths. host/scope/theme/state are NEVER
stored — they are re-derived live from each root's own `.geneseed-emit` /
`.geneseed-theme` markers, so the registry can't go stale on them. Self-healing: roots
that no longer exist or lost their `.geneseed-emit` marker are pruned on read.

Pure stdlib, depends on nothing in this repo — so both build.py (repo root) and the
rituals/ modules can import it without an import cycle.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_MARKER = ".geneseed-emit"  # the per-deploy marker build.py drops; presence == live root


def _path() -> Path:
    """User-global registry file, XDG-conventional (mirrors ~/.config/opencode)."""
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return Path(base).expanduser() / "geneseed" / "installs.json"


def _load() -> list[str]:
    try:
        data = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [str(x) for x in data] if isinstance(data, list) else []


def _save(items: list[str]) -> None:
    # Atomic write (temp + os.replace, same dir == same filesystem), mirroring
    # _harness_mcp._mcp_save: the daemon's ThreadingHTTPServer reads this file
    # concurrently with a deploy subprocess's record(), and a plain truncating write
    # would let a reader see an empty/torn file — which _load() swallows as [] and could
    # then save back, wiping the registry. os.replace never exposes a torn state.
    p = _path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tmp")
        tmp.write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, p)
    except OSError:
        pass  # best-effort: a registry hiccup must never break a deploy


def record(path) -> None:
    """Add a deploy root (idempotent, best-effort). Called from the build choke point —
    must NEVER raise into a build, so everything is swallowed."""
    try:
        root = str(Path(str(path)).expanduser().resolve())
    except Exception:
        return
    cur = _load()
    if root not in cur:
        _save(cur + [root])


def roots() -> "list[Path]":
    """Live registered deploy roots: existing dirs that still carry a `.geneseed-emit`
    marker, de-duplicated. Prunes the file when dead/duplicate entries are found, so a
    folder the user deleted by hand simply drops off the list."""
    out: "list[Path]" = []
    kept: list[str] = []
    seen: set[str] = set()
    original = _load()  # snapshot once: comparing kept against a SECOND read could clobber
    for s in original:  # a root a concurrent record() appended between the two reads
        root = Path(s).expanduser()
        key = str(root.resolve()) if root.exists() else str(root)
        if key in seen:
            continue
        if root.is_dir() and (root / _MARKER).is_file():
            seen.add(key)
            kept.append(str(root))
            out.append(root)
    if kept != original:
        _save(kept)
    return out


def demo() -> None:
    """Self-check: record is idempotent, roots() prunes a vanished entry. Uses a temp
    XDG_CONFIG_HOME + temp deploy dir so it touches nothing real."""
    import tempfile

    with tempfile.TemporaryDirectory() as cfg, tempfile.TemporaryDirectory() as live:
        os.environ["XDG_CONFIG_HOME"] = cfg
        (Path(live) / _MARKER).write_text("opencode\n", encoding="utf-8")
        gone = os.path.join(cfg, "gone")  # never created -> must be pruned
        record(live)
        record(live)  # idempotent
        record(gone)
        rs = [str(r.resolve()) for r in roots()]
        assert rs == [str(Path(live).resolve())], rs
        assert _load() == [str(Path(live).resolve())], _load()  # pruned to live only
    print("ok")


if __name__ == "__main__":
    demo()
