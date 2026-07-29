---
name: token-report
description: "Generate a token usage report for the current session — a markdown table breakdown of context window usage: the session-start baseline (harness, system prompt, tools, skills), everything processed since (user messages, replies, thinking, tool calls and results per tool), exact recorded totals, and the heaviest single items. Use this whenever the user asks about token usage, context usage, context window size, session cost in tokens, 'how full is the context', 'what is eating my context', a usage breakdown or usage report — even if they don't say the word 'token'."
---

# Token usage report

> Generate the session's token usage breakdown — exact recorded totals, context
> window occupancy, and an estimated attribution of what filled it — as markdown
> tables, on any supported host.

Produce a token usage report for the current session by running the bundled
script, then present its markdown output to the user.

## How to run

Run the script that sits next to this SKILL.md:

```bash
python3 <this-skill-directory>/scripts/token_report.py
```

It auto-detects the host you are running on by locating session data and
picking the most recently active source:

| Host | Session data | Fidelity |
|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/*.jsonl` | exact usage per request |
| IBM Bob | `~/.bob/projects/<slug>/*.jsonl` (Claude-shaped, `$BOB_CONFIG_DIR` honoured) | exact usage per request |
| OpenCode | `~/.local/share/opencode/opencode.db` (SQLite, v1.2+; pre-1.2 falls back to `storage/` JSON files) | exact `tokens` per request; child sessions attributed as subagents |
| GitHub Copilot | `~/.copilot/history-session-state/` | best effort — undocumented schema; token-like fields harvested, else estimates only |

Useful flags: `--host claude|bob|opencode|copilot` to force a host,
`--transcript <path>` / `--session <id>` for a specific session,
`--limit <tokens>` for the context-window limit used in the % columns
(default 200000), `--top <n>` for the heaviest-items list.

## What the report contains, and where the numbers come from

Two kinds of numbers — keep the distinction explicit when presenting:

1. **Exact numbers** come from the usage the host records with every request:
   session totals (output tokens, fresh input, cache reads/writes), the
   session-start baseline, and the current/peak context size. These are ground
   truth — never contradict them.
2. **Estimated attribution** (~4 characters per token) explains *what* fills
   the context: user messages, assistant replies, thinking, tool calls, and
   tool results grouped per tool. These are labeled estimates; keep them
   labeled that way.

The session-start baseline is the input-side token count of the very first
request — that is the harness (system prompt, tool schemas, skill/agent
listings, memory files) plus the user's first message. At the start of a
fresh session that is the whole story; later, the delta between current and
start context is the work processed since.

## Presenting the result

Relay the script's markdown tables directly — they are the deliverable.
After the tables, add a short interpretation in your own words: what is
consuming the most context, and one concrete suggestion if something stands
out (e.g. a single huge file read dominating, or heavy tool results that a
subagent could have absorbed instead). Do not pad the report with generic
advice when nothing stands out.

If the script errors or reports degraded fidelity (a host that stores its
sessions elsewhere, or records no usage), say so plainly and fall back to
reporting what you know: rough context size from any usage information
available to you, and a qualitative breakdown of what has happened this
session. Do not invent exact numbers.

## Self-improvement

If the script failed to find this host's session data, or a host changed its
storage schema, note the observed layout and fix `scripts/token_report.py`
(or record the finding in memory for the next run) before closing out.
