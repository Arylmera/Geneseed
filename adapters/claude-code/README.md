# Claude Code adapter

Optional. Claude Code supports lifecycle **hooks**, so a team using it can make
parts of the harness fire automatically instead of relying on agent
self-discipline.

## Install

Merge [`settings.json`](settings.json) into your repo's `.claude/settings.json`
(or your user settings). It:

- on **SessionStart**, prints `AGENT.md` so the harness is in context from the
  first turn;
- on **Stop**, runs `harness learn` over the session to capture durable memories.

Adjust the paths if your harness bundle is not at the repository root.

## Other tools

This adapter is Claude-Code-specific. On tools without hooks, the harness still
works fully via the instructions in `AGENT.md` — the hooks are a convenience, not
a requirement.
