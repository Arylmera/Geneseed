---
name: token-report
description: "Generate a token usage report for the current Claude Code session — a markdown table breakdown of context window usage: the session-start baseline (harness, system prompt, tools, skills), everything processed since (user messages, replies, thinking, tool calls and results per tool), exact API totals, and the heaviest single items. Use this whenever the user asks about token usage, context usage, context window size, session cost in tokens, 'how full is the context', 'what is eating my context', a usage breakdown or usage report — even if they don't say the word 'token'."
---

# Token usage report

Produce a token usage report for the current session by running the bundled
script, then present its markdown output to the user.

## How to run

```bash
python3 .claude/skills/token-report/scripts/token_report.py
```

The script auto-detects the current session's transcript
(`~/.claude/projects/<project-slug>/<most-recent>.jsonl`) and prints a
markdown report. Useful flags:

- `--transcript <path>` — report on a specific session file instead
- `--limit <tokens>` — context window limit for the % columns (default 200000)
- `--top <n>` — how many heaviest single items to list (default 5)

## What the report contains, and where the numbers come from

Two kinds of numbers — be precise about the distinction when presenting:

1. **Exact numbers** come from the API `usage` field recorded with every
   request in the transcript: session totals (output tokens, fresh input,
   cache reads/writes), the session-start baseline, and the current/peak
   context size. These are ground truth — never contradict them.
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

If the script errors (no transcript found — e.g. an environment that stores
transcripts elsewhere), say so plainly and fall back to reporting what you
know: rough context size from any usage information available to you, and
the qualitative breakdown of what has happened this session. Do not invent
exact numbers.
