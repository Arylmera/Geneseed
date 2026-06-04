# {{SKILL}}: cmux

> {{DESC_CMUX}}

**Trigger:** you are about to run several subagents (see [parallel-agents](parallel-agents.md)) and want to watch each one live, in its own pane — and you are working inside a cmux session (macOS).

## Procedure
1. Confirm the environment: you are inside cmux (the `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` env vars are set). If not, this {{SKILL}} does not apply — fall back to plain [parallel-agents](parallel-agents.md).
2. Enable the OpenCode HTTP server (off by default) so `opencode attach` can connect — add a `server` block with a port to `opencode.json`:
   ```json
   { "server": { "port": 4096 } }
   ```
3. Ensure the `opencode-cmux` plugins are installed (`CmuxSubagentViewer` + `CmuxPlugin`). They activate only inside cmux and need no manual wiring.
4. Dispatch the work as subagents via the Task tool. For each child session, `CmuxSubagentViewer` opens a split pane running `opencode attach` against that session — so you watch each agent live; the pane closes automatically when the agent completes or errors.
5. Let `CmuxPlugin` desktop-notify you on session idle/error rather than babysitting the panes; converge the distilled results in the main context, not the per-pane transcripts ({{LAW}} XV).

## Done when
- Each dispatched subagent opened its own cmux pane, you could monitor them concurrently, the panes closed on completion, and the reconciled outcome is verified.
