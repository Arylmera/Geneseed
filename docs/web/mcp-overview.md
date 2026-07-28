---
group: mcp
order: 0
title: "MCP overview"
kind: "concept"
---
The Harness ships **three** ready-to-wire MCP servers as presets — **MarkItDown** (PDF/Office → Markdown), **GitLab** (shipped as two entries, one per instance), and **Filesystem** (scoped file access) — four config entries in all. Each is a *local* server the agent launches on demand: registering one only points the agent at a command — *you* install the tool (or let `npx`/`pipx` fetch it) and supply any credentials.

### Where they live

<!--harness:opencode-->
They sit under the `mcp` key of an `opencode.json` (global `~/.config/opencode/opencode.json` or per-repo), each entry shaped:

```json
"<name>": { "type": "local", "command": ["…"], "environment": {}, "enabled": true }
```
<!--/harness-->
<!--harness:claude-->
They live in `.mcp.json` under `mcpServers` — note the key is `env` (not `environment`) and the command and its args are split into `command` + `args`. See [Claude Code wiring](#/docs/mcp-claude-code).
<!--/harness-->

<!--harness:opencode-->
### Toggle them without hand-editing JSON

`./geneseed` → **Settings** → **MCP servers** toggles any of the presets into your project or global `opencode.json` — and enables, disables, or removes them — for you. The reference config ships MarkItDown enabled and the GitLab / Filesystem entries disabled, so a merge never activates a credential-less server: fill the blanks, then flip the one(s) you want on.
<!--/harness-->

> **Never commit a real token.** The presets ship with **empty** `GITLAB_PERSONAL_ACCESS_TOKEN` placeholders (and a sample filesystem path) — fill them in your own config, never in a tracked file (universal Law I — secrets).

---

**Wire one up:** [MarkItDown](#/docs/mcp-markitdown) · [GitLab](#/docs/mcp-gitlab) · [Filesystem](#/docs/mcp-filesystem) · [Verify](#/docs/mcp-verify) · [Won't connect?](#/docs/mcp-trouble)

> **Listed ≠ working.** A `local` server is just a command the agent runs — it appears in the list whether or not that command actually launches. The usual cause of "shown but not working" is the command not being on PATH (e.g. `markitdown-mcp` with no `uvx`/pipx install) or a filesystem entry left on its placeholder path. [Walk the fixes →](#/docs/mcp-trouble)
