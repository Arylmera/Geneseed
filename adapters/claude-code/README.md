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
  Claude Code pipes the hook payload (with the session's `transcript_path`) to the
  command on stdin; `learn` reads that, flattens the transcript, distils new
  memories, and **writes them into the bundle's `memory/` while updating
  `MEMORY.md`** — deduping against what is already stored. No `< /dev/null` and no
  redirection: the stdin payload is the whole point.

  This step is **opt-in on a model CLI**: set `GENESEED_LLM` (e.g. `claude -p`,
  `llm`, `ollama run …`) for `learn` to actually distil. With it unset the hook is
  a harmless no-op that just prints the prompt. Geneseed never embeds an API key.
  If your bundle's `memory/` is not at `./memory` or `./Harness/memory`, point at
  it with `GENESEED_MEMORY=/abs/path/to/memory`.

Adjust the paths if your harness bundle is not at the repository root. On Windows
the commands are identical (`python rituals/harness.py …`); see the **Windows /
PowerShell** section of the top-level README.

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
