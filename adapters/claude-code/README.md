# 🪝 Claude Code adapter

> [← Back to README](../../README.md) · [Install guide](../../docs/guides/install-claude-code.md) · [OpenCode adapter](../opencode/README.md)

Optional. Claude Code supports lifecycle **hooks**, so a team using it can make
parts of the harness fire automatically instead of relying on agent
self-discipline.

## Install

`geneseed setup` (or a `--emit claude` build) merges the hooks into the install's settings
file: `.claude/settings.local.json` for a project install, `~/.claude/settings.json` for a
global one. There is no sample file to copy: each command carries this machine's shim path, the
install's own `--root` and the gate flags the build chose, so only the emit can write it. When
the settings file has comments the emit does not rewrite it, and prints the exact `hooks` object
to merge by hand instead.

A re-emit recognises its own handlers by that signature (the shim, a hook verb, this install's
`--root`), replaces them where they sit and leaves everything else as found: your own hooks, a
hook you added inside one of these groups, and a field you set on one of ours, such as
`timeout`. Uninstall removes the same handlers and nothing else. A hook you write yourself that
runs the shim with this install's `--root` counts as Geneseed's.

The wiring:

- on **PreToolUse** (matcher `Bash|PowerShell|Monitor`, the three tools that run a shell
  command), runs `geneseed-hook git-gate` — the tool-boundary
  half of Doctrine process 5 (*consent before every commit and push*) and of the
  destructive-git Rule. Drop the `process` pack (or exclude process 5) and the hook stays,
  wired with `--no-consent`: commits and pushes pass without asking (excluding process 1 or ops 2,
  or their pack, adds `--no-rule-store` / `--no-root-scan` the same way), while the
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

  **Caveat — the GitHub MCP vector.** The hook matches the `Bash`, `PowerShell` and `Monitor`
  tools only. If your session has the GitHub MCP server, an agent can commit/push via
  `push_files` / `create_or_update_file` / `merge_pull_request`, which bypass all three. To
  gate those too, widen the matcher to `"Bash|PowerShell|Monitor|mcp__github__.*"` —
  `git-gate` ignores any payload it doesn't recognise as a commit/push, so
  over-matching the tool surface is harmless. A re-emit puts the matcher back as it
  wrote it, so widen it again after a rebuild.
- on **PreToolUse** (matcher `Write|Edit|NotebookEdit`), runs
  `geneseed-hook rule-gate` — asks first on a write that would put a credential into a tracked
  file, and on a write to `user-rules.md` or the rule draft (a standing rule is
  your call; memory is written freely, and you see it afterwards in the web console). In an application repo (a git
  root holding a build manifest) whose root `AGENTS.md` has no `## Ownership` section, it also
  denies the session's first write once, with a reason addressed to the agent: propose the
  ownership setup now, skip this session, or skip in this repo until asked; the next write
  passes, and sub-agents defer. Off per repo with `mode: off` in that section, for one developer
  in one repo with `Setup: declined <YYYY-MM-DD>` in their personal `.geneseed/ownership.md`,
  per install with `--no-ownership-gate`. `--no-external-gate` and `--no-test-note` stop the protected-check and
  gate-configuration asks and the weakened-test note. Ordinary edits pass.
  (`MultiEdit` is not a Claude Code tool and is not in the matcher; the gate reads
  `edits[].new_string` as a cheap guard regardless.)
- on **SessionStart**, every source (`startup`, `resume`, `clear`, `compact`, `fork`), runs
  `geneseed-hook context` to **inject the project context** directly into the session — so
  the project-context load is by the hook, not left to the agent to remember (lazy entries
  are only listed). This is one matcher-less group: a matcher list is one more place to miss
  a source (`fork` once was). The harness itself is not printed here: the install's root file
  is `CLAUDE.md`, which Claude Code loads by itself;
- on **Stop**, runs `geneseed-hook learn` over the session to capture durable memories.
  Claude Code pipes the hook payload (with the session's `transcript_path`) to the
  command on stdin; `learn` reads that, flattens the transcript, distils new
  memories, and **writes them into the memory store while updating
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
- on **SubagentStart**, runs `geneseed-hook context`, which reads the event name and hands the
  sub-agent your `user-rules.md` layers (tier, install, project root) as one JSON
  `hookSpecificOutput.additionalContext`. No sub-agent receives the SessionStart output, so this
  is the only way your rules reach one.
- on **UserPromptSubmit** and **SessionEnd**, runs `geneseed-hook activity`, which decides
  nothing and prints nothing: it records the session for the web console's Activity view.
  Every other hook above feeds that view too, after it has decided. `GENESEED_ACTIVITY=off`
  (or the console's toggle) turns it off; see `docs/reference/plugin-activity.md`.

  This step is **opt-in on a model CLI**: set `GENESEED_LLM` (e.g. `claude -p`,
  `llm`, `ollama run …`) for `learn` to actually distil. With it unset the hook is
  a harmless no-op — it returns immediately rather than reading the transcript for
  nothing; running `learn` by hand with notes piped in still prints the prompt it
  would have sent. Geneseed never embeds an API key.
  A global install writes to the shared store, `~/.config/geneseed/memory/`. A hand-run
  `learn` finds a project install or bundle in the cwd or `./Harness`. Any other `memory/` is not a store until it is named:
  `--memory <dir>` or `GENESEED_MEMORY=/abs/path/to/memory`.

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
