# Claude Code adapter

Optional. Claude Code supports lifecycle **hooks**, so a team using it can make
parts of the harness fire automatically instead of relying on agent
self-discipline.

## Install

Merge [`settings.json`](settings.json) into your repo's `.claude/settings.json`
(or your user settings). It:

- on **PreToolUse** (matcher `Bash`), runs `harness git-gate` — a tool-boundary
  backstop for Rule XX (*consent before every commit and push*). The hook inspects the
  command and, when it runs a `git commit` or `git push` (bare, flagged, `-C <path>`,
  or chained like `git add . && git commit … && git push`), returns
  `permissionDecision: "ask"` so Claude Code **prompts on every such call**. Crucially
  this is **not** suppressible by a one-time *"Yes, and don't ask again"*: the allow
  rule that choice writes is only consulted *after* the hook runs, so the hook re-asks
  next time regardless. Every other Bash command (and any unreadable payload) is
  deferred to the normal permission flow — the hook never blocks unrelated work.

  **Caveat — the GitHub MCP vector.** The hook matches the `Bash` tool only. If your
  session has the GitHub MCP server, an agent can commit/push via `push_files` /
  `create_or_update_file` / `merge_pull_request`, which bypass Bash. To gate those too,
  widen the matcher to `"Bash|mcp__github__.*"` — `git-gate` ignores any payload it
  doesn't recognise as a commit/push, so over-matching the tool surface is harmless.
- on **SessionStart** (`startup`/`clear` only — a fresh context), prints `AGENT.md`
  so the harness is in context from the first turn, then runs `harness context` to
  **inject the project context** directly into the session — so Rule XVIII is enforced
  by the hook, not left to the agent to remember (lazy entries are only listed). On
  **`resume`** it runs `harness context` *without* re-`cat`ting `AGENT.md`: the resumed
  conversation already carries the harness, so re-injecting the static file each resume
  is pure token waste — only the (possibly changed) project context is refreshed;
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
the commands are identical (`python rituals/harness.py …`).

Why inject rather than instruct? Rule XVIII tells the agent to read the project
context at startup, but startup rituals are exactly what agents skip. The
`harness context` hook removes the choice: the eager files' contents land in
context before the first turn regardless of agent discipline. On tools without
hooks or plugins, the AGENT.md prose still carries the rule.

> **Auto-discovery (parity with OpenCode).** `harness context` no longer needs a
> hand-filled `context.json`: with no manifest (or just the empty stub) it
> **auto-discovers the repo's docs by convention** — root `AGENTS.md`/`AGENT.md`/
> `CLAUDE.md`/`README.md`/`CONTRIBUTING.md` injected eager, `docs/`/`adr/`/monorepo
> package READMEs listed lazy — using the same convention as the OpenCode context
> plugin. A `context.json` still overrides, and `"extend": true` layers a manifest
> on top of discovery.

## Bundled skill — `herdr`

The canonical herdr skill lives in the Geneseed source tree at
[`src/skills/herdr.md`](../../src/skills/herdr.md). The build renders it into
every emit — `.opencode/skills/herdr/SKILL.md` for OpenCode hosts, the
portable bundle for everyone else — so a deployed harness picks it up
automatically alongside every other Geneseed skill.

A copy is also kept at
[`.claude/skills/herdr/SKILL.md`](../../.claude/skills/herdr/SKILL.md) so Claude
Code running **inside this repo** (i.e. people working on Geneseed itself)
discovers it directly, since the build doesn't write into `.claude/`. The two
copies share content; keep them in sync when you edit either.

Either way, you only need:

- the **`herdr` binary** on your `PATH` (install via [herdr.dev](https://herdr.dev)),
- the agent launched **inside a herdr pane** — the skill self-gates on
  `HERDR_ENV=1` and stays silent everywhere else, so shipping it is harmless
  for users who don't run herdr.

## Other tools

This adapter is Claude-Code-specific. On tools without hooks, the harness still
works fully via the instructions in `AGENT.md` — the hooks are a convenience, not
a requirement.
