"""Geneseed web — the live-activity surface (what the harness is DOING).

Part of the web API (see web.py). Imports the shared toolset from _web_core.

Reads the per-session JSON files the geneseed-activity OpenCode plugin writes into
<opencode-cfg>/activity/, prunes dead/stale ones, and returns the live list. Writer
and reader share only this directory — no RPC, crash-isolated, cross-tool by
construction (any adapter writing the schema lights up the same view)."""
from __future__ import annotations

from _web_core import *  # noqa: F401,F403  shared stdlib + primitives

# A session whose writer process is gone, or that hasn't been touched in this many
# seconds, is pruned. pid-liveness is the real signal; the staleness backstop covers
# a reused pid and platforms where signal 0 isn't available (Windows). Generous on
# purpose: streaming bumps updated_at constantly, so only a genuinely abandoned
# (process-still-alive) session ages out.
# ponytail: fixed 30-min backstop; make it env-configurable if it ever bites.
ACTIVITY_STALE_SECONDS = 1800


def _activity_dir(state: WebState) -> Path:
    """Where the writer drops per-session files: <target>/activity. state.target is
    already the OpenCode config dir, so this is <opencode-cfg>/activity — do NOT
    append 'opencode/' again (that double-join is the classic seam bug)."""
    return state.target / "activity"


def _activity_flag(state: WebState) -> Path:
    """The runtime on/off flag, written by the toggle and read by the plugin each
    event. Same path both sides resolve (plugin: configBase()/.geneseed-activity)."""
    return state.target / ".geneseed-activity"


def _activity_enabled(state: WebState) -> bool:
    """Enabled unless the flag file explicitly says off — mirrors the plugin's
    enabledFromFlag(). Absent file → on (the default)."""
    try:
        raw = _activity_flag(state).read_text(encoding="utf-8").strip().lower()
    except OSError:
        return True
    return raw not in ("off", "0", "false", "no")


def _pid_alive(pid) -> bool:
    """Best-effort liveness for the writer process. os.kill(pid, 0) raises
    ProcessLookupError if the pid is dead and nothing if it is alive (or
    PermissionError — alive but not ours). On Windows signal 0 isn't portable, so an
    'unknown' answer is treated as alive and the staleness backstop carries it."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        return True   # exists (or can't tell) — let staleness decide
    return True


def _normalize_entry(entry: dict, stem: str) -> dict:
    """One session snapshot → the stable shape the UI consumes. v1 writers omit the
    enrichment keys, so default to None/0 and let the UI hide what's absent."""
    return {
        "session_id": entry.get("session_id") or stem,
        "agent": entry.get("agent"),
        "title": entry.get("title"),
        "cwd": entry.get("cwd"),
        "status": entry.get("status") or "idle",
        "updated_at": entry.get("updated_at") or 0,
        "model": entry.get("model"),
        "phase": entry.get("phase"),
        "turn_started_at": entry.get("turn_started_at"),
        "cost": entry.get("cost") or 0,
        "tokens": entry.get("tokens") or 0,
        "files": entry.get("files"),
        "todos": entry.get("todos"),
        "blocked_on": entry.get("blocked_on"),
        "error": entry.get("error"),
    }


def _read_entry(p: Path) -> "dict | None":
    """Parse one snapshot file; None on a missing/garbage/non-dict file (never raises)."""
    try:
        entry = json.loads(p.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):   # ValueError covers json.JSONDecodeError
        return None
    return entry if isinstance(entry, dict) else None


def _is_live(entry: dict, now: float) -> bool:
    """A snapshot is live while its writer pid is alive and it's not stale."""
    updated = entry.get("updated_at") or 0
    return (now - updated) <= ACTIVITY_STALE_SECONDS and _pid_alive(entry.get("pid"))


def _activity_entries(state: WebState) -> list[dict]:
    """Every live session entry, dead/stale ones pruned (and their files removed so
    the dir self-cleans). Never raises: a missing dir → [], a garbage file → skipped,
    newest first. Detail files (*.detail.json) are skipped — they aren't snapshots."""
    d = _activity_dir(state)
    if not d.is_dir():
        return []
    now = time.time()
    out = []
    for p in sorted(d.glob("*.json")):
        if p.name.endswith(".detail.json"):
            continue
        entry = _read_entry(p)
        if entry is None:
            continue
        if not _is_live(entry, now):
            with contextlib.suppress(OSError):
                p.unlink()                                   # crashed / abandoned writer
                (p.parent / f"{p.stem}.detail.json").unlink()   # its detail file too
            continue
        out.append(_normalize_entry(entry, p.stem))
    out.sort(key=lambda e: e["updated_at"], reverse=True)
    return out


def api_activity(state: WebState) -> dict:
    enabled = _activity_enabled(state)
    return {"enabled": enabled, "activity": _activity_entries(state) if enabled else []}


def api_activity_detail(state: WebState, sid: str) -> dict:
    """One session's detail (v1.2): the snapshot plus its step timeline and the
    uncapped files/todos. 404 (NotFound) if the session is absent or pruned; a
    missing/garbage detail file degrades to an empty timeline, never a 500."""
    d = _activity_dir(state)
    # Resolve by the writer's safe-name scheme, but keep it inside the dir.
    stem = re.sub(r"[^A-Za-z0-9_.-]", "_", sid)
    snap = d / f"{stem}.json"
    entry = _read_entry(snap) if snap.is_file() else None
    if entry is None or not _is_live(entry, time.time()):
        raise NotFound(sid)
    session = _normalize_entry(entry, stem)
    timeline, full = [], {}
    det = _read_entry(d / f"{stem}.detail.json")
    if det:
        timeline = det.get("timeline") if isinstance(det.get("timeline"), list) else []
        full = det
    # The detail file carries the uncapped lists; fall back to the snapshot's capped ones.
    session["files"] = full.get("files") or session.get("files")
    session["todos"] = full.get("todos") or session.get("todos")
    return {"session": session, "timeline": timeline}


def api_activity_toggle(state: WebState, body: dict) -> dict:
    """Flip the runtime on/off flag. The plugin reads it each event, so the change
    takes effect without restarting opencode. Writing 'off' also makes the plugin
    clear its files on its next event; the reader gates output immediately."""
    enabled = bool(body.get("enabled", True))
    try:
        _activity_flag(state).parent.mkdir(parents=True, exist_ok=True)
        _activity_flag(state).write_text("on" if enabled else "off", encoding="utf-8")
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "enabled": enabled}


def api_activity_toggle(state: WebState, body: dict) -> dict:
    """Flip the runtime on/off flag. The plugin reads it each event, so the change
    takes effect without restarting opencode. Writing 'off' also makes the plugin
    clear its files on its next event; the reader gates output immediately."""
    enabled = bool(body.get("enabled", True))
    try:
        _activity_flag(state).parent.mkdir(parents=True, exist_ok=True)
        _activity_flag(state).write_text("on" if enabled else "off", encoding="utf-8")
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "enabled": enabled}
