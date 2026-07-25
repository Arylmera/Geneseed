---
group: plugins
order: 4
title: "geneseed-workflow"
kind: "concept"
---
Registers one custom tool, `workflow`, that runs saved, code-driven orchestration scripts — the deterministic counterpart to the model-driven [[council]] / [[parallel-agents]] skills: the script, not the model, drives the control flow.

- **Saved scripts only (v1):** the tool loads `<name>.js` from the sibling `workflows/` dir. No model-authored scripts are eval'd.
- **Call shape:** `workflow({ name, args })` — call with no name to list what's available. Shipped: `council`, `review`, `research-plan-implement`.
- **Runtime API:** scripts get `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `budget`, `args`. Child work runs as real OpenCode sessions; concurrency is capped at `min(16, cores − 2)`.

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup). The build copies the plugin **and** the sibling `workflows/` dir, so the saved scripts resolve out of the box; a manual `cp` only moves the `*.js`, so copy `adapters/opencode/workflows/` alongside it too.

### Configure

- `GENESEED_WORKFLOWS_DIR` — override the scripts dir (defaults to `.opencode/workflows/` per-repo, `<config>/workflows/` global).
- A phase-by-phase trace plus the full result land in `.geneseed/workflow-runs/<runId>.log`; `GENESEED_DEBUG=1` adds stderr logging.

### Verify

Ask the agent to *"list available workflows"* — it should call `workflow` with no name and return `council`, `review`, `research-plan-implement`.
