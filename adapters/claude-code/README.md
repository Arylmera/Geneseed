# Claude Code adapter

Optional. Claude Code supports lifecycle **hooks**, so a team using it can make
parts of the harness fire automatically instead of relying on agent
self-discipline.

## Install

Merge [`settings.json`](settings.json) into your repo's `.claude/settings.json`
(or your user settings). It:

- on **SessionStart**, prints `AGENT.md` so the harness is in context from the
  first turn, then runs `harness context` to **inject** the `eager` entries of
  `context.json` directly into the session — so Rule XVIII is enforced by the
  hook, not left to the agent to remember (lazy entries are only listed);
- on **Stop**, runs `harness learn` over the session to capture durable memories.

Adjust the paths if your harness bundle is not at the repository root.

Why inject rather than instruct? Rule XVIII tells the agent to read
`context.json` at startup, but startup rituals are exactly what agents skip. The
`harness context` hook removes the choice: the eager files' contents land in
context before the first turn regardless of agent discipline. On tools without
hooks (or on OpenCode, which loads `context.json` itself), the AGENT.md prose
still carries the rule.

## Other tools

This adapter is Claude-Code-specific. On tools without hooks, the harness still
works fully via the instructions in `AGENT.md` — the hooks are a convenience, not
a requirement.
