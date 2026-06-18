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


def _activity_entries(state: WebState) -> list[dict]:
    """Every live session entry, dead/stale ones pruned (and their files removed so
    the dir self-cleans). Never raises: a missing dir → [], a garbage file → skipped,
    newest first."""
    d = _activity_dir(state)
    if not d.is_dir():
        return []
    now = time.time()
    out = []
    for p in sorted(d.glob("*.json")):
        try:
            entry = json.loads(p.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):   # ValueError covers json.JSONDecodeError
            continue
        if not isinstance(entry, dict):
            continue
        updated = entry.get("updated_at") or 0
        stale = (now - updated) > ACTIVITY_STALE_SECONDS
        if stale or not _pid_alive(entry.get("pid")):
            with contextlib.suppress(OSError):
                p.unlink()   # crashed / abandoned writer: drop the file
            continue
        out.append({
            "session_id": entry.get("session_id") or p.stem,
            "agent": entry.get("agent"),
            "title": entry.get("title"),
            "cwd": entry.get("cwd"),
            "status": entry.get("status") or "idle",
            "updated_at": updated,
        })
    out.sort(key=lambda e: e["updated_at"], reverse=True)
    return out


def api_activity(state: WebState) -> dict:
    enabled = _activity_enabled(state)
    return {"enabled": enabled, "activity": _activity_entries(state) if enabled else []}


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
