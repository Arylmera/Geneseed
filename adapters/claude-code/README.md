# 🪝 Claude Code adapter

> [← Back to README](../../README.md) · [Install guide](../../docs/guides/install-claude-code.md) · [OpenCode adapter](../opencode/README.md)

Optional. Claude Code supports lifecycle **hooks**, so a team using it can make
parts of the harness fire automatically instead of relying on agent
self-discipline.

## Install

Merge [`settings.json`](settings.json) into your repo's `.claude/settings.json`.
(Not your *user* settings: the hook commands are repo-relative — `node
bin/geneseed-hook.mjs …` — so at user scope they would fire and fail in every
repo that doesn't vendor the harness. A generated global install wires
absolute-path hooks instead — `geneseed setup` does that for you.) It:

- on **PreToolUse** (matcher `Bash|PowerShell`), runs `geneseed-hook git-gate` — the tool-boundary
  half of Doctrine process 5 (*consent before every commit and push*) and of the
  destructive-git Rule. Drop the `process` pack (or exclude process 5) and the hook stays,
  wired with `--no-consent`: commits and pushes pass without asking, while the
  Law IV refusals (asked only on real data loss: a force-push to `main`, a `reset --hard`
  that abandons unpushed commits, an `rm` git cannot undo) stay in every build unless the install is
  built `--no-deletion-gate`, which appends that flag and stands the real-loss check down
  (`--no-secrets-gate` does the same for `rule-gate`'s credential scan, `--no-done-gate` for
  `learn`'s done check). The hook inspects
  command and, when it runs a `git commit` or `git push` (bare, flagged, `-C <path>`,
  or chained like `git add . && git commit … && git push`), returns
  `permissionDecision: "ask"` so Claude Code **prompts on every such call**. Crucially
  this is **not** suppressible by a one-time *"Yes, and don't ask again"*: the allow
  rule that choice writes is only consulted *after* the hook runs, so the hook re-asks
  next time regardless. Every other Bash command (and any unreadable payload) is
  deferred to the normal permission flow — the hook never blocks unrelated work.

  **Caveat — the GitHub MCP vector.** The hook matches the `Bash` and `PowerShell` tools
  only. If your session has the GitHub MCP server, an agent can commit/push via
  `push_files` / `create_or_update_file` / `merge_pull_request`, which bypass both. To
  gate those too, widen the matcher to `"Bash|PowerShell|mcp__github__.*"` —
  `git-gate` ignores any payload it doesn't recognise as a commit/push, so
  over-matching the tool surface is harmless.
- on **PreToolUse** (matcher `Write|Edit|NotebookEdit`), runs
  `geneseed-hook rule-gate` — refuses a write that would put a credential into a tracked
  file, and asks first on the first write to `user-rules.md` or a memory file (whether
  something you want kept is a rule or a fact is your call). Ordinary edits pass.
  (`MultiEdit` is not a Claude Code tool and is not in the matcher; the gate reads
  `edits[].new_string` as a cheap guard regardless.)
- on **SessionStart**, every source (`startup`, `resume`, `clear`, `compact`, `fork`), runs
  `geneseed-hook context` to **inject the project context** directly into the session — so
  the project-context load is by the hook, not left to the agent to remember (lazy entries
  are only listed). This is one matcher-less group, exactly as a generated install wires it:
  a matcher list is one more place to miss a source (`fork` once was). A second group,
  `startup`/`clear` only — a fresh context — prints `AGENT.md` so the vendored harness is in
  context from the first turn. A generated install has no such group: its root file is
  `CLAUDE.md`, which Claude Code loads by itself. A resumed or forked conversation already
  carries the harness, so re-printing the static file there is pure token waste;
- on **Stop**, runs `geneseed-hook learn` over the session to capture durable memories.
  Claude Code pipes the hook payload (with the session's `transcript_path`) to the
  command on stdin; `learn` reads that, flattens the transcript, distils new
  memories, and **writes them into the bundle's `memory/` while updating
  `MEMORY.md`** — deduping against what is already stored. No `< /dev/null` and no
  redirection: the stdin payload is the whole point.
- on **SubagentStop**, runs the *same* `geneseed-hook learn` command. `learn` reads the
  payload's `hook_event_name`, sees a subagent dispatch, and routes it to the
  per-agent lesson path instead of the shared store: it distils at most one durable
  lesson and appends it to `memory/agents/<agent-name>.md` (capped, newest kept). If
  the payload does not name the subagent, the step is a silent no-op — never a
  crash, never a wrong write. This is the parity twin of the OpenCode learn plugin's
  child-session branch.
- on **PreCompact**, runs the same `geneseed-hook learn` once more. `learn` distils the
  *tail* of the transcript, so per-turn Stop is a sliding window over the session —
  and auto-compaction is the moment that window is about to be summarised away.
  This captures memory *before* the summary; the SessionStart `context` hook (which
  also fires on the `compact` source) re-seeds context *after* it.
- on **UserPromptSubmit**, **SessionEnd** and **SubagentStart**, runs `geneseed-hook activity`, which decides
  nothing and prints nothing: it records the session for the web console's Activity view.
  Every other hook above feeds that view too, after it has decided. `GENESEED_ACTIVITY=off`
  (or the console's toggle) turns it off; see `docs/reference/plugin-activity.md`.

  This step is **opt-in on a model CLI**: set `GENESEED_LLM` (e.g. `claude -p`,
  `llm`, `ollama run …`) for `learn` to actually distil. With it unset the hook is
  a harmless no-op — it returns immediately rather than reading the transcript for
  nothing; running `learn` by hand with notes piped in still prints the prompt it
  would have sent. Geneseed never embeds an API key.
  If your bundle's `memory/` is not at `./memory` or `./Harness/memory`, point at
  it with `GENESEED_MEMORY=/abs/path/to/memory`.

Adjust the paths if your harness bundle is not at the repository root. On Windows
the commands are identical (`node bin/geneseed-hook.mjs …`).

Why inject rather than instruct? The constitution tells the agent to read the project
context at startup, but startup rituals are exactly what agents skip. The
`geneseed-hook context` hook removes the choice: the eager files' contents land in
context before the first turn regardless of agent discipline. On tools without
hooks or plugins, the AGENT.md prose still carries the rule.

> **Auto-discovery (parity with OpenCode).** `geneseed-hook context` no longer needs a
> hand-filled `context.json`: with no manifest (or just the empty stub) it
> **auto-discovers the repo's docs by convention** — root `AGENTS.md`/`AGENT.md`/
> `CLAUDE.md`/`README.md`/`CONTRIBUTING.md` injected eager, `docs/`/`adr/`/monorepo
> package READMEs listed lazy — using the same convention as the OpenCode context
> plugin. A `context.json` still overrides, and `"extend": true` layers a manifest
> on top of discovery.

## Other tools

This adapter is Claude-Code-specific. On tools without hooks, the harness still
works fully via the instructions in `AGENT.md` — the hooks are a convenience, not
a requirement.
