---
group: reference
order: 3
title: "Troubleshooting"
kind: "concept"
---
MCP server issues have their own page: [MCP — won't connect?](#/docs/mcp-trouble).

### `geneseed: command not found`
Run `./geneseed link` (macOS/Linux) or `.\geneseed.cmd link` (Windows) from the cloned repo. On Windows, open a new terminal after `link` — the PATH update only applies to fresh shells.

<!--harness:opencode-->
### The agent doesn't load my project docs
On OpenCode the `geneseed-context` plugin must be installed. Re-run `geneseed setup` or `geneseed build --emit opencode-global`. Verify with `geneseed doctor`.
<!--/harness-->

### `doctor` reports unresolved theme tokens
A theme JSON is missing a key the templates reference. Compare with `themes/neutral.json` — every key there must exist in your theme. Re-render: `geneseed build --theme <yours>`.

### `doctor` reports drift between bundle and src
A committed `Harness/` snapshot fell behind. Re-render and commit: `geneseed build && git add Harness`. If the drift is intentional local edits, use the **Changes** page to export them as an improvements file and back-port.

### Web UI shows 'no deployed harness'
Run `geneseed setup` to install. The UI works read-only without a deployment but most actions are disabled.

### Windows PATH didn't update
`geneseed.cmd link` writes to `%LOCALAPPDATA%\Geneseed\bin` and adds it to user PATH — but only new shells see it. Close and reopen your terminal.

<!--harness:opencode-->
### Plugin not registering on OpenCode
Plugins ship in `~/.config/opencode/plugin/` for the global emit. Confirm with `ls ~/.config/opencode/plugin/` — you should see `geneseed-*.js`. If empty, re-run the build with `--emit opencode-global`.

### Full `PROJECT CONTEXT` block visible in the terminal
Either `GENESEED_CONTEXT_VISIBLE=1` (or legacy `GENESEED_CONTEXT_TRANSFORM=0/off`) is set, or your OpenCode build lacks the experimental transform hook and the plugin fell back to visible delivery — run with `GENESEED_DEBUG=1` to see which.
<!--/harness-->

### `could not determine a model`
Set `GENESEED_MODEL=provider/model` in your environment.
