# {{SKILL}}: cmux

> {{DESC_CMUX}}

**Trigger:** you are about to run several subagents (see [parallel-agents](parallel-agents.md)) and want to watch each one live in its own pane — and you are working inside a cmux session (the macOS terminal built for running AI coding agents side by side).

## Procedure
1. Confirm the environment: you are inside cmux — the `CMUX_WORKSPACE_ID` env var is set (the integration self-disables without it). If not, this {{SKILL}} does not apply — fall back to plain [parallel-agents](parallel-agents.md).
2. Pick the path that matches the work:
   - **A team of orchestrated specialists → `cmux omo`.** To run oh-my-openagent's specialist agents in parallel, launch `cmux omo` (every argument after `omo` is forwarded to OpenCode, e.g. `cmux omo --continue`, `cmux omo --model claude-sonnet-4-6`). First run bootstraps a shadow config at `~/.cmuxterm/omo-config/` — installs `oh-my-opencode`, symlinks your OpenCode config, enables tmux mode — so nothing else needs wiring. A tmux shim then translates the orchestrator's session calls into cmux splits: each subagent gets its own pane in an auto-managed grid, idle panes are reaped after 3 idle polls, and overflow panes queue until space frees. Works over SSH via the cmux relay.
   - **Your own harness subagents → the `opencode-cmux` plugin.** To get ambient awareness of the {{AGENT}}s this harness dispatches, add the bridge plugin to `opencode.json`: `{ "plugin": ["@attamusc/opencode-cmux"] }` (needs `cmux` on `PATH`). It mirrors each OpenCode lifecycle event into the cmux sidebar and notifications via the cmux CLI, so you see primary-vs-subagent activity, questions, and permission waits without switching panes. Set `OPENCODE_CMUX_NOTIFY_SUBAGENTS=true` to be pinged when a subagent finishes. For live per-subagent `opencode attach` splits, run OpenCode's HTTP server (`opencode --port <n>`) so each split can connect.
3. Dispatch the work — through the `omo` orchestrator, or by dispatching {{AGENT}}s as usual ([parallel-agents](parallel-agents.md)). Each child surfaces in its own pane; let cmux open and reap them rather than managing panes by hand.
4. Don't babysit the panes — let cmux's notifications tell you when an agent goes idle or errors. Converge the distilled results in your main context, not the per-pane transcripts ({{LAW}} XV).

## Done when
- Each dispatched subagent ran in its own cmux pane, you monitored them concurrently, the panes opened and closed automatically, and the reconciled outcome is verified.
