#!/usr/bin/env python3
"""Generate a token usage report for the current agent session — multi-host.

Supported hosts (auto-detected by most recent session activity):

  claude    Claude Code      ~/.claude/projects/<slug>/<session>.jsonl   exact usage
  bob       IBM Bob          ~/.bob/projects/<slug>/<session>.jsonl      exact usage
                             (Claude-Code-shaped; $BOB_CONFIG_DIR honoured)
  opencode  OpenCode         ~/.local/share/opencode/opencode.db         exact usage
                             (SQLite, v1.2+: session/message/part tables,
                             JSON `data` columns; falls back to the pre-1.2
                             storage/ JSON files when no DB exists)
  copilot   GitHub Copilot   ~/.copilot/history-session-state/           best effort
                             (schema undocumented; token fields harvested
                             generically, estimates otherwise)

The report distinguishes two kinds of numbers:

  * exact      — recorded by the host per request (API usage fields)
  * estimated  — attribution of content by character count (~4 chars/token)

Estimates are labeled as such and never presented as exact.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

CHARS_PER_TOKEN = 4.0
USAGE_FIELDS = ("input_tokens", "output_tokens",
                "cache_read_input_tokens", "cache_creation_input_tokens")


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def text_len(content) -> int:
    """Total characters of text in a message content field (str or block list)."""
    if content is None:
        return 0
    if isinstance(content, str):
        return len(content)
    if isinstance(content, list):
        total = 0
        for block in content:
            if not isinstance(block, dict):
                total += len(str(block))
                continue
            btype = block.get("type")
            if btype == "text":
                total += len(block.get("text", ""))
            elif btype == "thinking":
                total += len(block.get("thinking", ""))
            elif btype == "tool_use":
                total += len(json.dumps(block.get("input", {})))
            elif btype == "tool_result":
                total += text_len(block.get("content"))
            else:
                total += len(json.dumps(block))
        return total
    return len(str(content))


def est_tokens(chars: int) -> int:
    return round(chars / CHARS_PER_TOKEN)


def fmt(n: float) -> str:
    return f"{round(n):,}"


def pct(part: float, whole: float) -> str:
    return f"{100 * part / whole:.1f}%" if whole else "–"


def bar(part: float, whole: float, width: int = 10) -> str:
    filled = round(width * part / whole) if whole else 0
    return "█" * min(filled, width) + "░" * max(width - filled, 0)


def context_size(usage: dict) -> int:
    """Input-side tokens of one request = context size at that moment."""
    return (usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0))


def newest(paths):
    paths = [p for p in paths if p.exists()]
    return max(paths, key=lambda p: p.stat().st_mtime) if paths else None


class SessionData:
    """Host-independent intermediate model the renderer consumes."""

    def __init__(self, host: str, label: str):
        self.host = host
        self.label = label                    # transcript file / session id
        self.main = defaultdict(float)        # aggregated exact usage, main thread
        self.side = defaultdict(float)        # aggregated exact usage, subagents
        self.models = defaultdict(int)        # output tokens per model
        self.requests_main = 0
        self.requests_side = 0
        self.first_context = None             # exact context size, first request
        self.last_context = None              # exact context size, last request
        self.peak_context = 0
        self.cats = defaultdict(int)          # estimated chars per category
        self.top = []                         # (chars, label) heaviest single items
        self.first_user_chars = None
        self.duration = None                  # seconds
        self.notes = []                       # host-specific caveats for the report

    @property
    def has_exact(self) -> bool:
        return self.requests_main > 0 or self.requests_side > 0

    def add_usage(self, usage: dict, model=None, side=False):
        bucket = self.side if side else self.main
        for f in USAGE_FIELDS:
            bucket[f] += usage.get(f, 0)
        if side:
            self.requests_side += 1
        else:
            self.requests_main += 1
            size = context_size(usage)
            if self.first_context is None:
                self.first_context = size
            self.last_context = size
            self.peak_context = max(self.peak_context, size)
        if model:
            self.models[model] += usage.get("output_tokens", 0)

    def span(self, first_ts, last_ts):
        if not (first_ts and last_ts) or first_ts == last_ts:
            return
        try:
            from datetime import datetime

            def parse(t):
                if isinstance(t, (int, float)):   # epoch millis or seconds
                    return datetime.fromtimestamp(t / 1000 if t > 1e12 else t)
                return datetime.fromisoformat(str(t).replace("Z", "+00:00"))

            self.duration = (parse(last_ts) - parse(first_ts)).total_seconds()
        except (ValueError, OSError, OverflowError):
            pass


# ---------------------------------------------------------------------------
# Host: Claude Code / IBM Bob (same transcript shape, different config root)
# ---------------------------------------------------------------------------

def _slugify(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def claude_shaped_root(host: str) -> Path | None:
    env = {"claude": "CLAUDE_CONFIG_DIR", "bob": "BOB_CONFIG_DIR"}[host]
    root = Path(os.environ.get(env) or Path.home() / f".{host}")
    return root if (root / "projects").is_dir() else None


def claude_shaped_find(host: str, explicit=None):
    if explicit:
        return Path(explicit)
    root = claude_shaped_root(host)
    if not root:
        return None
    projects = root / "projects"
    candidates = []
    exact = projects / _slugify(os.getcwd())
    dirs = [exact] if exact.is_dir() else sorted(
        (d for d in projects.iterdir() if d.is_dir()),
        key=lambda d: d.stat().st_mtime, reverse=True)
    for d in dirs:
        candidates.extend(d.glob("*.jsonl"))
        if candidates:
            break
    return newest(candidates)


def claude_shaped_parse(host: str, path: Path) -> SessionData:
    data = SessionData(host, path.name)
    tool_name_by_id = {}
    first_ts = last_ts = None

    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            rtype = rec.get("type")
            side = bool(rec.get("isSidechain"))
            ts = rec.get("timestamp")
            if ts:
                first_ts = first_ts or ts
                last_ts = ts

            if rtype == "assistant":
                msg = rec.get("message", {})
                usage = msg.get("usage") or {}
                if usage:
                    data.add_usage(usage, msg.get("model"), side)
                if side:
                    continue   # sidechain content never enters this context
                for block in msg.get("content") or []:
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type")
                    if btype == "text":
                        data.cats["Assistant replies"] += len(block.get("text", ""))
                    elif btype == "thinking":
                        data.cats["Assistant thinking"] += len(block.get("thinking", ""))
                    elif btype == "tool_use":
                        name = block.get("name", "unknown")
                        tool_name_by_id[block.get("id")] = name
                        data.cats[f"Tool call · {name}"] += len(json.dumps(block.get("input", {})))

            elif rtype == "user" and not side:
                # isMeta marks injected content (loaded skill bodies, slash-command
                # expansions) arriving as a user turn the user didn't type.
                user_cat = ("Injected skill/command content" if rec.get("isMeta")
                            else "User messages")
                content = rec.get("message", {}).get("content")
                blocks = content if isinstance(content, list) else [content]
                for block in blocks:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        name = tool_name_by_id.get(block.get("tool_use_id"), "unknown")
                        chars = text_len(block.get("content"))
                        data.cats[f"Tool result · {name}"] += chars
                        data.top.append((chars, f"{name} result"))
                    else:
                        chars = text_len(block if isinstance(block, str) else [block])
                        data.cats[user_cat] += chars
                        if user_cat == "User messages" and data.first_user_chars is None:
                            data.first_user_chars = chars

            elif rtype == "attachment" and not side:
                data.cats["System attachments (reminders, listings)"] += \
                    len(json.dumps(rec.get("attachment", {})))

    data.span(first_ts, last_ts)
    return data


# ---------------------------------------------------------------------------
# Host: OpenCode
# ---------------------------------------------------------------------------

def opencode_data_dir() -> Path | None:
    xdg = os.environ.get("XDG_DATA_HOME")
    candidates = ([Path(xdg) / "opencode"] if xdg else []) + \
        [Path.home() / ".local" / "share" / "opencode", Path.home() / ".opencode"]
    for c in candidates:
        if c.is_dir():
            return c
    return None


def opencode_root() -> Path | None:
    d = opencode_data_dir()
    return d / "storage" if d and (d / "storage").is_dir() else None


def opencode_find(explicit=None):
    """Locate the current OpenCode session.

    v1.2+ stores everything in SQLite (<data-dir>/opencode.db) — prefer that.
    Older installs keep JSON files under storage/; fall back to walking them.
    Returns ("db", (db_path, session_id_or_None)) or ("files", (sid, files))."""
    d = opencode_data_dir()
    if d:
        db = d / "opencode.db"
        if db.is_file():
            return "db", (db, explicit)
    return opencode_find_files(explicit)


def opencode_find_files(explicit=None):
    """Pre-SQLite fallback: (session_id, [message files]) for the most recently
    active session. Message files live under a `message/<sessionID>/` folder
    somewhere below storage/ (the nesting has moved between versions, so walk)."""
    storage = opencode_root()
    if not storage:
        return None
    sessions = {}
    for msgdir in storage.rglob("message"):
        if not msgdir.is_dir():
            continue
        for sdir in msgdir.iterdir():
            if sdir.is_dir():
                files = list(sdir.glob("*.json"))
                if files:
                    sessions.setdefault(sdir.name, []).extend(files)
    if not sessions:
        return None
    if explicit and explicit in sessions:
        return "files", (explicit, sessions[explicit])
    sid = max(sessions, key=lambda s: max(f.stat().st_mtime for f in sessions[s]))
    return "files", (sid, sessions[sid])


def _oc_usage_from_tokens(tok: dict) -> dict:
    """Map OpenCode's tokens shape onto the common usage fields."""
    cache = tok.get("cache") or {}
    return {
        "input_tokens": tok.get("input", 0),
        "output_tokens": tok.get("output", 0) + tok.get("reasoning", 0),
        "cache_read_input_tokens": cache.get("read", 0),
        "cache_creation_input_tokens": cache.get("write", 0),
    }


def _oc_take_message(data: SessionData, msg: dict, side=False):
    """Fold one OpenCode message record (the MessageV2 Info shape — identical in
    the old JSON files and the SQLite `message.data` column) into the model.
    Returns (message_id, role, had_tokens)."""
    role = msg.get("role")
    tok = msg.get("tokens") or {}
    if role == "assistant" and tok:
        data.add_usage(_oc_usage_from_tokens(tok), msg.get("modelID"), side)
    return msg.get("id"), role, bool(role == "assistant" and tok)


def _oc_take_part(data: SessionData, role, part: dict):
    """Categorise one OpenCode content part (same shape in files and DB).
    Returns the part's `tokens` dict for step-finish parts, else None."""
    ptype = part.get("type")
    if ptype == "text":
        cat = "Assistant replies" if role == "assistant" else "User messages"
        chars = len(part.get("text", ""))
        data.cats[cat] += chars
        if cat == "User messages" and data.first_user_chars is None:
            data.first_user_chars = chars
    elif ptype == "reasoning":
        data.cats["Assistant thinking"] += len(part.get("text", ""))
    elif ptype == "tool":
        name = part.get("tool", "unknown")
        state = part.get("state") or {}
        data.cats[f"Tool call · {name}"] += len(json.dumps(state.get("input", {})))
        out_chars = text_len(state.get("output"))
        data.cats[f"Tool result · {name}"] += out_chars
        data.top.append((out_chars, f"{name} result"))
    elif ptype == "step-finish":
        return part.get("tokens")
    return None


def opencode_db_parse(db_path: Path, explicit=None) -> SessionData:
    """Parse OpenCode's SQLite store (v1.2+): `session`, `message`, `part` tables
    with the structured payloads in JSON `data` columns. Read-only; defensive
    about columns, since the schema is young and may evolve."""
    import sqlite3
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        def rows(sql, args=()):
            try:
                return con.execute(sql, args).fetchall()
            except sqlite3.Error:
                return []

        sid = explicit
        if not sid:
            # Prefer top-level sessions (parent_id NULL = not a subagent child),
            # in the current project dir when recorded, newest activity first.
            cwd = os.getcwd()
            cands = rows("SELECT id, directory, time_updated FROM session "
                         "WHERE parent_id IS NULL ORDER BY time_updated DESC")
            if not cands:
                cands = rows("SELECT id, NULL, time_updated FROM session "
                             "ORDER BY time_updated DESC")
            if not cands:
                sys.exit("error: opencode.db contains no sessions")
            sid = next((r[0] for r in cands if r[1] == cwd), cands[0][0])

        data = SessionData("opencode", sid)
        first_ts = last_ts = None
        role_by_msg = {}
        untokened = {}   # assistant messages with no tokens in message.data -> modelID

        for mid, ts, raw in rows("SELECT id, time_created, data FROM message "
                                 "WHERE session_id=? ORDER BY time_created, id", (sid,)):
            try:
                msg = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except json.JSONDecodeError:
                continue
            if ts:
                first_ts = first_ts or ts
                last_ts = ts
            _, role, had = _oc_take_message(data, msg)
            role_by_msg[mid] = role
            if role == "assistant" and not had:
                untokened[mid] = msg.get("modelID")

        step_tokens = defaultdict(list)   # message_id -> [tokens dicts]
        for mid, raw in rows("SELECT p.message_id, p.data FROM part p "
                             "JOIN message m ON p.message_id = m.id "
                             "WHERE m.session_id=? ORDER BY p.time_created, p.id", (sid,)):
            try:
                part = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except json.JSONDecodeError:
                continue
            tok = _oc_take_part(data, role_by_msg.get(mid), part)
            if tok:
                step_tokens[mid].append(tok)
        # step-finish parts also carry usage — use them only for assistant
        # messages whose own record had none, so nothing is double-counted.
        for mid, model in untokened.items():
            for tok in step_tokens.get(mid, ()):
                data.add_usage(_oc_usage_from_tokens(tok), model)

        # Child sessions are subagent runs: aggregate their usage separately —
        # their content never enters this session's context window.
        for (child,) in rows("SELECT id FROM session WHERE parent_id=?", (sid,)):
            for (raw,) in rows("SELECT data FROM message WHERE session_id=?", (child,)):
                try:
                    msg = json.loads(raw) if isinstance(raw, str) else (raw or {})
                except json.JSONDecodeError:
                    continue
                _oc_take_message(data, msg, side=True)

        data.span(first_ts, last_ts)
        data.notes.append("Source: opencode.db (SQLite, OpenCode v1.2+). Subagent "
                          "totals aggregate this session's child sessions.")
        return data
    finally:
        con.close()


def opencode_parse(sid: str, files) -> SessionData:
    """Pre-SQLite fallback: parse the per-message JSON files under storage/."""
    data = SessionData("opencode", sid)
    storage = opencode_root()
    role_by_msg = {}
    first_ts = last_ts = None

    for f in sorted(files, key=lambda p: p.name):
        try:
            msg = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        mid, role, _ = _oc_take_message(data, msg)
        role_by_msg[mid] = role
        t = (msg.get("time") or {})
        ts = t.get("created") or t.get("completed")
        if ts:
            first_ts = first_ts or ts
            last_ts = ts

    # Content parts live under part/<messageID>/ folders (walk for the same
    # version-drift reason as messages).
    if storage:
        for partdir in storage.rglob("part"):
            if not partdir.is_dir():
                continue
            for mdir in partdir.iterdir():
                role = role_by_msg.get(mdir.name)
                if role is None or not mdir.is_dir():
                    continue
                for pf in mdir.glob("*.json"):
                    try:
                        part = json.loads(pf.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        continue
                    _oc_take_part(data, role, part)

    data.span(first_ts, last_ts)
    data.notes.append("Source: OpenCode JSON storage (pre-v1.2). Exact per-request "
                      "tokens from message records.")
    return data


# ---------------------------------------------------------------------------
# Host: GitHub Copilot CLI (best effort — schema undocumented)
# ---------------------------------------------------------------------------

def copilot_root() -> Path | None:
    root = Path(os.environ.get("COPILOT_CONFIG_DIR") or Path.home() / ".copilot")
    for sub in ("history-session-state", "session-state", "sessions"):
        if (root / sub).is_dir():
            return root / sub
    return None


def _harvest_tokens(obj, sink):
    """Recursively collect numeric fields whose key mentions tokens."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = k.lower()
            if isinstance(v, (int, float)) and "token" in lk:
                sink[lk] += v
            else:
                _harvest_tokens(v, sink)
    elif isinstance(obj, list):
        for v in obj:
            _harvest_tokens(v, sink)


def _harvest_text(obj, sink, depth=0):
    """Recursively estimate message-ish content by role."""
    if depth > 12:
        return
    if isinstance(obj, dict):
        role = obj.get("role") if isinstance(obj.get("role"), str) else None
        body = obj.get("content") if role else None
        if role and body is not None:
            cat = {"user": "User messages", "assistant": "Assistant replies",
                   "tool": "Tool result · (unattributed)"}.get(role, f"{role} messages")
            sink[cat] += text_len(body)
            return
        for v in obj.values():
            _harvest_text(v, sink, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            _harvest_text(v, sink, depth + 1)


def copilot_find(explicit=None):
    root = copilot_root()
    if not root:
        return None
    if explicit:
        p = Path(explicit)
        return p if p.exists() else None
    entries = list(root.iterdir())
    latest = newest(entries)
    return latest


def copilot_parse(target: Path) -> SessionData:
    data = SessionData("copilot", target.name)
    files = sorted(target.rglob("*.json*")) if target.is_dir() else [target]
    tokens = defaultdict(float)
    for f in files[:500]:
        try:
            text = f.read_text(encoding="utf-8")
        except OSError:
            continue
        docs = []
        if f.suffix == ".jsonl":
            for line in text.splitlines():
                try:
                    docs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        else:
            try:
                docs.append(json.loads(text))
            except json.JSONDecodeError:
                pass
        for doc in docs:
            _harvest_tokens(doc, tokens)
            _harvest_text(doc, data.cats)
    if tokens:
        data.notes.append("Copilot session state is undocumented; token-like fields "
                          "found (summed, field names as stored): "
                          + ", ".join(f"{k}={fmt(v)}" for k, v in sorted(tokens.items())))
    else:
        data.notes.append("Copilot records no recognisable token counts in its session "
                          "state — the report below is character-count estimates only.")
    return data


# ---------------------------------------------------------------------------
# Detection and rendering
# ---------------------------------------------------------------------------

def detect(host_arg, transcript, session):
    """Pick the host: explicit --host wins, else the most recently active."""
    finders = {
        "claude": lambda: claude_shaped_find("claude", transcript),
        "bob": lambda: claude_shaped_find("bob", transcript),
        "opencode": lambda: opencode_find(session),
        "copilot": lambda: copilot_find(transcript),
    }
    if host_arg:
        found = finders[host_arg]()
        if not found:
            sys.exit(f"error: no session data found for host '{host_arg}'")
        return host_arg, found

    best = None
    for host, finder in finders.items():
        found = finder()
        if not found:
            continue
        if host == "opencode":     # ("db", (db_path, sid)) or ("files", (sid, files))
            kind, payload = found
            probe = payload[0] if kind == "db" else payload[1][0]
        else:
            probe = found
        mtime = probe.stat().st_mtime if probe.exists() else 0
        if best is None or mtime > best[2]:
            best = (host, found, mtime)
    if not best:
        sys.exit("error: no session data found for any supported host "
                 "(claude, bob, opencode, copilot)")
    return best[0], best[1]


def load(host, found) -> SessionData:
    if host in ("claude", "bob"):
        return claude_shaped_parse(host, found)
    if host == "opencode":
        kind, payload = found
        if kind == "db":
            return opencode_db_parse(*payload)
        return opencode_parse(*payload)
    return copilot_parse(found)


HOST_NAMES = {"claude": "Claude Code", "bob": "IBM Bob",
              "opencode": "OpenCode", "copilot": "GitHub Copilot"}


def render(d: SessionData, limit: int, top_n: int) -> str:
    out = [f"# Token usage report — {HOST_NAMES.get(d.host, d.host)}", ""]
    out.append(f"Session: `{d.label}`"
               + (f" · duration {d.duration/60:.0f} min" if d.duration else ""))
    out.append("")

    if d.has_exact:
        out.append("## Session totals (exact, from recorded usage)")
        out.append("")
        out.append("| Metric | Main thread | Subagents | Total |")
        out.append("|---|---:|---:|---:|")
        rows = [("Requests", d.requests_main, d.requests_side)] + [
            (label, d.main[f], d.side[f]) for label, f in (
                ("Output tokens", "output_tokens"),
                ("Fresh input tokens", "input_tokens"),
                ("Cache writes", "cache_creation_input_tokens"),
                ("Cache reads", "cache_read_input_tokens"))]
        for label, m, s in rows:
            out.append(f"| {label} | {fmt(m)} | {fmt(s)} | {fmt(m + s)} |")
        out.append("")
        if d.models:
            out.append("Models used: " + ", ".join(
                f"`{m}` ({fmt(t)} out)" for m, t in
                sorted(d.models.items(), key=lambda kv: -kv[1])))
            out.append("")

        first, last = d.first_context or 0, d.last_context or 0
        out.append("## Context window")
        out.append("")
        out.append("| | Tokens | % of limit | |")
        out.append("|---|---:|---:|---|")
        out.append(f"| Session start (harness + context) | {fmt(first)} | {pct(first, limit)} | {bar(first, limit)} |")
        out.append(f"| Current context size | {fmt(last)} | {pct(last, limit)} | {bar(last, limit)} |")
        if d.peak_context > last:
            out.append(f"| Peak context size | {fmt(d.peak_context)} | {pct(d.peak_context, limit)} | {bar(d.peak_context, limit)} |")
        out.append(f"| Context limit | {fmt(limit)} | 100% | {bar(limit, limit)} |")
        out.append("")
        if first:
            first_prompt = est_tokens(d.first_user_chars or 0)
            harness = max(first - first_prompt, 0)
            out.append(f"The session-start baseline is exact: **{fmt(first)}** tokens were "
                       f"in context before any work happened — roughly {fmt(harness)} of "
                       "harness (system prompt, tool schemas, skill and agent listings, "
                       f"memory) plus ~{fmt(first_prompt)} for the first user message.")
            out.append("")
            grown = max(last - first, 0)
            out.append(f"Since then the persistent context grew by **{fmt(grown)}** tokens, "
                       f"and the session generated **{fmt(d.main['output_tokens'])}** output "
                       "tokens. The breakdown below attributes everything the session "
                       "processed — including ephemeral thinking, which is generated and "
                       "paid for but dropped from context after each turn.")
            out.append("")
    else:
        out.append("*(This host recorded no exact per-request usage — everything below "
                   "is a character-count estimate.)*")
        out.append("")

    # Thinking text is often not persisted (signature only) even though it IS
    # counted in the exact output totals. When absent, derive it: exact output
    # minus the visible output we can measure.
    if d.cats.get("Assistant thinking", 0) == 0 and d.main["output_tokens"]:
        visible = sum(chars for name, chars in d.cats.items()
                      if name == "Assistant replies" or name.startswith("Tool call"))
        derived = d.main["output_tokens"] - est_tokens(visible)
        if derived > 0:
            d.cats["Assistant thinking (derived)"] = round(derived * CHARS_PER_TOKEN)

    total_chars = sum(d.cats.values())
    if total_chars:
        out.append("## Content breakdown (estimated, ~4 chars/token)")
        out.append("")
        out.append("| Category | Est. tokens | Share | |")
        out.append("|---|---:|---:|---|")
        for name, chars in sorted(d.cats.items(), key=lambda kv: -kv[1]):
            t = est_tokens(chars)
            if t == 0:
                continue
            out.append(f"| {name} | {fmt(t)} | {pct(chars, total_chars)} | {bar(chars, total_chars)} |")
        out.append(f"| **Total conversation content** | **{fmt(est_tokens(total_chars))}** | 100% | |")
        out.append("")
        out.append("*Estimates cover conversation content only — the harness baseline "
                   "(system prompt, tool schemas) is not re-counted here. Subagent "
                   "content is excluded: it never enters this context window. Thinking "
                   "is ephemeral — dropped from context after each turn — so it counts "
                   "as processed output, not persistent context growth.*")
        out.append("")

    heavy = sorted(d.top, reverse=True)[:top_n]
    if heavy and heavy[0][0] > 0:
        out.append(f"## Top {len(heavy)} heaviest single items")
        out.append("")
        out.append("| Item | Est. tokens |")
        out.append("|---|---:|")
        for chars, label in heavy:
            out.append(f"| {label} | {fmt(est_tokens(chars))} |")
        out.append("")

    for note in d.notes:
        out.append(f"> {note}")
        out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(
        description="Token usage report for the current agent session")
    ap.add_argument("--host", choices=("claude", "bob", "opencode", "copilot"),
                    help="force a host instead of auto-detecting by recency")
    ap.add_argument("--transcript", help="explicit transcript path (claude/bob/copilot)")
    ap.add_argument("--session", help="explicit session id (opencode)")
    ap.add_argument("--limit", type=int, default=200_000,
                    help="context window limit for %% columns (default 200000)")
    ap.add_argument("--top", type=int, default=5,
                    help="how many heaviest single items to list (default 5)")
    args = ap.parse_args()

    host, found = detect(args.host, args.transcript, args.session)
    print(render(load(host, found), args.limit, args.top))


if __name__ == "__main__":
    main()
