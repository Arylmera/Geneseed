#!/usr/bin/env python3
"""Generate a token usage report for a Claude Code session.

Parses the session transcript (~/.claude/projects/<project-slug>/<session>.jsonl)
and prints a markdown report:

  1. Session totals   — exact, from the API `usage` field of every request
  2. Context window   — exact size right now, vs the model's context limit
  3. Start baseline   — what the session cost before any work happened
  4. Content breakdown — estimated attribution (chars/4) of what fills the context
  5. Top consumers    — the individual heaviest items (big file reads, tool dumps)

Exact numbers come from the API and are trustworthy. The attribution tables are
character-count estimates (~4 chars/token) and are labeled as such.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

CHARS_PER_TOKEN = 4.0


# ---------------------------------------------------------------------------
# Transcript discovery
# ---------------------------------------------------------------------------

def slugify(path: str) -> str:
    """Claude Code turns /home/user/Repo into -home-user-Repo."""
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def find_transcript(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit).expanduser()
        if not p.exists():
            sys.exit(f"error: transcript not found: {p}")
        return p

    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        sys.exit("error: no ~/.claude/projects directory found")

    # Prefer the project dir matching the cwd; fall back to the most recent one.
    candidates = []
    slug = slugify(os.getcwd())
    exact = projects / slug
    dirs = [exact] if exact.is_dir() else sorted(
        (d for d in projects.iterdir() if d.is_dir()),
        key=lambda d: d.stat().st_mtime, reverse=True)
    for d in dirs:
        candidates.extend(d.glob("*.jsonl"))
        if candidates:
            break
    if not candidates:
        sys.exit("error: no session transcript (*.jsonl) found under ~/.claude/projects")
    return max(candidates, key=lambda p: p.stat().st_mtime)


# ---------------------------------------------------------------------------
# Helpers
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
    return "█" * filled + "░" * (width - filled)


def usage_context_size(usage: dict) -> int:
    """Total input-side tokens of one request = context size at that moment."""
    return (usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0))


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse(path: Path):
    records = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def analyze(records):
    exact = {
        "main": defaultdict(float),       # aggregated usage, main thread
        "side": defaultdict(float),       # aggregated usage, subagent sidechains
        "models": defaultdict(int),       # output tokens per model
        "requests_main": 0,
        "requests_side": 0,
        "first_context": None,            # context size of first main request
        "last_context": None,             # context size of last main request
        "peak_context": 0,
    }
    # estimated character counts per category
    cats = defaultdict(int)
    top = []                              # (chars, label) of individual items
    tool_name_by_id = {}
    first_user_chars = None
    first_ts = last_ts = None

    for rec in records:
        rtype = rec.get("type")
        side = bool(rec.get("isSidechain"))
        ts = rec.get("timestamp")
        if ts:
            first_ts = first_ts or ts
            last_ts = ts

        if rtype == "assistant":
            msg = rec.get("message", {})
            usage = msg.get("usage") or {}
            bucket = exact["side"] if side else exact["main"]
            key = "requests_side" if side else "requests_main"
            if usage:
                exact[key] += 1
                for field in ("input_tokens", "output_tokens",
                              "cache_read_input_tokens",
                              "cache_creation_input_tokens"):
                    bucket[field] += usage.get(field, 0)
                if not side:
                    size = usage_context_size(usage)
                    if exact["first_context"] is None:
                        exact["first_context"] = size
                    exact["last_context"] = size
                    exact["peak_context"] = max(exact["peak_context"], size)
                model = msg.get("model")
                if model:
                    exact["models"][model] += usage.get("output_tokens", 0)
            if side:
                continue  # sidechain content lives in the subagent's context
            for block in msg.get("content") or []:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    cats["Assistant replies"] += len(block.get("text", ""))
                elif btype == "thinking":
                    cats["Assistant thinking"] += len(block.get("thinking", ""))
                elif btype == "tool_use":
                    name = block.get("name", "unknown")
                    tool_name_by_id[block.get("id")] = name
                    chars = len(json.dumps(block.get("input", {})))
                    cats[f"Tool call · {name}"] += chars

        elif rtype == "user" and not side:
            # isMeta marks injected content (loaded skill bodies, slash-command
            # expansions) that arrives as a user turn but wasn't typed by the user.
            user_cat = ("Injected skill/command content" if rec.get("isMeta")
                        else "User messages")
            content = rec.get("message", {}).get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        name = tool_name_by_id.get(block.get("tool_use_id"), "unknown")
                        chars = text_len(block.get("content"))
                        cats[f"Tool result · {name}"] += chars
                        top.append((chars, f"{name} result"))
                    else:
                        chars = text_len([block])
                        cats[user_cat] += chars
                        if user_cat == "User messages" and first_user_chars is None:
                            first_user_chars = chars
            else:
                chars = text_len(content)
                cats[user_cat] += chars
                if user_cat == "User messages" and first_user_chars is None:
                    first_user_chars = chars

        elif rtype == "attachment" and not side:
            att = rec.get("attachment", {})
            chars = len(json.dumps(att))
            cats["System attachments (reminders, listings)"] += chars

    duration = None
    if first_ts and last_ts and first_ts != last_ts:
        try:
            from datetime import datetime
            f = datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            l = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
            duration = (l - f).total_seconds()
        except ValueError:
            pass

    return exact, cats, top, first_user_chars, duration


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def report(path: Path, limit: int, top_n: int):
    records = parse(path)
    exact, cats, top, first_user_chars, duration = analyze(records)

    main = exact["main"]
    side = exact["side"]
    out = []
    out.append("# Token usage report")
    out.append("")
    out.append(f"Session transcript: `{path.name}`"
               + (f" · duration {duration/60:.0f} min" if duration else ""))
    out.append("")

    # -- 1. exact session totals ------------------------------------------
    out.append("## Session totals (exact, from API usage)")
    out.append("")
    out.append("| Metric | Main thread | Subagents | Total |")
    out.append("|---|---:|---:|---:|")
    rows = [
        ("Requests", exact["requests_main"], exact["requests_side"]),
        ("Output tokens", main["output_tokens"], side["output_tokens"]),
        ("Fresh input tokens", main["input_tokens"], side["input_tokens"]),
        ("Cache writes", main["cache_creation_input_tokens"], side["cache_creation_input_tokens"]),
        ("Cache reads", main["cache_read_input_tokens"], side["cache_read_input_tokens"]),
    ]
    for label, m, s in rows:
        out.append(f"| {label} | {fmt(m)} | {fmt(s)} | {fmt(m + s)} |")
    out.append("")
    if exact["models"]:
        models = ", ".join(f"`{m}` ({fmt(t)} out)" for m, t in
                           sorted(exact["models"].items(), key=lambda kv: -kv[1]))
        out.append(f"Models used: {models}")
        out.append("")

    # -- 2. context window now --------------------------------------------
    last = exact["last_context"] or 0
    first = exact["first_context"] or 0
    out.append("## Context window")
    out.append("")
    out.append("| | Tokens | % of limit | |")
    out.append("|---|---:|---:|---|")
    out.append(f"| Session start (harness + context) | {fmt(first)} | {pct(first, limit)} | {bar(first, limit)} |")
    out.append(f"| Current context size | {fmt(last)} | {pct(last, limit)} | {bar(last, limit)} |")
    if exact["peak_context"] > last:
        out.append(f"| Peak context size | {fmt(exact['peak_context'])} | {pct(exact['peak_context'], limit)} | {bar(exact['peak_context'], limit)} |")
    out.append(f"| Context limit | {fmt(limit)} | 100% | {bar(limit, limit)} |")
    out.append("")
    if first:
        first_prompt = est_tokens(first_user_chars or 0)
        harness = max(first - first_prompt, 0)
        out.append(f"The session-start baseline is exact: **{fmt(first)}** tokens were "
                   f"in context before any work happened — roughly {fmt(harness)} of "
                   "harness (system prompt, tool schemas, skill and agent listings, memory) "
                   f"plus ~{fmt(first_prompt)} for the first user message.")
        out.append("")
        grown = max(last - first, 0)
        out.append(f"Since then the persistent context grew by **{fmt(grown)}** tokens, "
                   f"and the session generated **{fmt(main['output_tokens'])}** output tokens. "
                   "The breakdown below attributes everything the session processed — "
                   "including ephemeral thinking, which is generated and paid for but "
                   "dropped from context after each turn.")
        out.append("")

    # -- 3. estimated content breakdown -----------------------------------
    # Thinking text is usually not persisted in the transcript (signature
    # only), but it IS counted in the exact output totals. When absent,
    # derive it: exact output minus the visible output we can measure.
    if cats.get("Assistant thinking", 0) == 0 and main["output_tokens"]:
        visible_out = sum(chars for name, chars in cats.items()
                          if name == "Assistant replies" or name.startswith("Tool call"))
        derived = main["output_tokens"] - est_tokens(visible_out)
        if derived > 0:
            cats["Assistant thinking (derived)"] = round(derived * CHARS_PER_TOKEN)

    total_chars = sum(cats.values())
    if total_chars:
        out.append("## Content breakdown (estimated, ~4 chars/token)")
        out.append("")
        out.append("| Category | Est. tokens | Share | |")
        out.append("|---|---:|---:|---|")
        for name, chars in sorted(cats.items(), key=lambda kv: -kv[1]):
            t = est_tokens(chars)
            if t == 0:
                continue
            out.append(f"| {name} | {fmt(t)} | {pct(chars, total_chars)} | {bar(chars, total_chars)} |")
        out.append(f"| **Total conversation content** | **{fmt(est_tokens(total_chars))}** | 100% | |")
        out.append("")
        out.append("*Estimates cover conversation content only — the harness baseline "
                   "(system prompt, tool schemas) is not re-counted here. Sidechain "
                   "(subagent) content is excluded: it never enters this context window. "
                   "Thinking is ephemeral — it is dropped from context after each turn, "
                   "so it counts as processed output, not as persistent context growth.*")
        out.append("")

    # -- 4. top consumers --------------------------------------------------
    heavy = sorted(top, reverse=True)[:top_n]
    if heavy and heavy[0][0] > 0:
        out.append(f"## Top {len(heavy)} heaviest single items")
        out.append("")
        out.append("| Item | Est. tokens |")
        out.append("|---|---:|")
        for chars, label in heavy:
            out.append(f"| {label} | {fmt(est_tokens(chars))} |")
        out.append("")

    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--transcript", help="path to a session .jsonl (default: auto-detect current session)")
    ap.add_argument("--limit", type=int, default=200_000, help="context window limit in tokens (default 200000)")
    ap.add_argument("--top", type=int, default=5, help="how many heaviest items to list (default 5)")
    args = ap.parse_args()

    path = find_transcript(args.transcript)
    print(report(path, args.limit, args.top))


if __name__ == "__main__":
    main()
