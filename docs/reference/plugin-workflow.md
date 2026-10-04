---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 14
title: "geneseed-workflow"
description: "Adds a workflow tool that runs saved orchestration scripts."
---
One of the [OpenCode plugins](opencode-plugins.md). Its switches are also listed in [Environment variables](environment.md).

**What it does.** Registers one tool, `workflow`, that runs saved orchestration scripts. The script — not the model — drives the control flow: the deterministic counterpart of the `council` and `parallel-agents` skills.

- **Saved scripts only.** It loads `<name>.js` from the `workflows/` directory beside `plugins/`; nothing the model writes is evaluated. Shipped: `council`, `dispatch`, `research-plan-implement`, `review`.
- **Call shape:** `workflow({ name, args })`; with no name it lists what is available.
- **Isolation:** a script can run a child agent in its own git worktree on its own branch. A worktree with no change is removed; one with changes is kept, and the summary lists every kept branch and every file more than one agent changed. Nothing is merged or committed for you. Without git, such a child fails rather than falling back to the shared tree.

**When it runs.** When the agent calls the `workflow` tool — usually because you asked for one.

**What you see.** The tool's summary in the conversation. A phase-by-phase trace and the full result land in `.geneseed/workflow-runs/<runId>.log`.

**Switches.**
- `GENESEED_WORKFLOWS_DIR` — load scripts from another directory.
- `GENESEED_DEBUG=1` — log to stderr.

Ask the agent to *"list available workflows"* to check it loaded.
