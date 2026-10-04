---
group: reference
order: 8
title: "Model, agent and MCP problems"
kind: "concept"
section: "Troubleshooting"
description: "No model for learn, a read-only agent, ignored PDFs, an MCP server that will not connect."
---
Each entry gives the likely cause, the fix, and how to confirm it worked. Hooks, project context and memory are on [Hook, context and memory problems](troubleshoot-hooks.md).

## `could not determine a model`

**Cause.** The learn step could not read which model the session used.

**Fix.** Give it a fallback:

```bash
export GENESEED_MODEL=provider/model
```

**Confirm.** The next session end writes memory instead of logging the message.

## A read-only agent won't run a command

**Cause.** By design: read-only agents are denied the shell. The few that must run read-only commands (the reviewer, security) are allowed it in their own spec.

**Fix.** Hand the task to an agent that can run commands, or run it yourself. See [Agents](../concepts/agents.md).

## PDFs and Office documents are ignored

**Cause.** Agents read text. Binary documents need converting first.

**Fix.** Use the `ingest` skill with a converter installed (MarkItDown, Pandoc or Docling), or wire MarkItDown as an MCP server. See [Reading non-markdown docs](../guides/read-non-markdown.md).

## An MCP server is listed but won't connect

Work through these in order:

1. **Does the command resolve?** Run the exact command in a fresh terminal: `uvx markitdown-mcp --help`, or `npx -y @modelcontextprotocol/server-filesystem --help`. "command not found" means the binary is not on the `PATH` your agent starts from. Use the `uvx` or `npx` form, which needs only uv or Node, or point at the absolute path of the binary. This is the most common cause for MarkItDown.
2. **Filesystem sees nothing?** The allowed folder is still the placeholder, or it points at a path that does not exist.
3. **GitLab will not connect?** Almost always a missing or under-scoped token, or a wrong `GITLAB_API_URL`. Keep the `/api/v4` suffix.
4. **Right file?** Editing a file the host does not read fails silently.

<!--harness:opencode-->
*(OpenCode only)*

OpenCode reads `opencode.jsonc` if it exists, otherwise `opencode.json`, both in the project root and in `~/.config/opencode/`. The console toggle always writes the file OpenCode actually reads.
<!--/harness-->

<!--harness:claude-->
*(Claude Code only)*

Claude Code reads `.mcp.json` in the project and the `mcpServers` block in `~/.claude.json`. `claude mcp list` shows which servers actually loaded.
<!--/harness-->

Where each host keeps the file: [MCP servers](../guides/mcp.md).
