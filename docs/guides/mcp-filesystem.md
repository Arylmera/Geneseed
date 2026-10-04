---
group: guides
order: 19
title: "Filesystem (MCP)"
kind: "concept"
section: "Set up"
description: "File access limited to the folders you list, and the placeholder path to replace."
---
One of the [MCP server](mcp.md) presets. Where each host keeps the config, and how to check the server connected, are on that page.

[`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) gives the agent file access limited to the folders you list, through `npx`. **The allowed folders are command-line arguments.** The server refuses any path outside them, so grant the narrowest set that works, not `$HOME` or `/`.

<!--harness:opencode-->
*(OpenCode only)*

```json
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"],
      "enabled": true
    }
  }
}
```
<!--/harness-->

<!--harness:claude-->
*(Claude Code only)*

```json
{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"] } } }
```
<!--/harness-->

> **Replace the placeholder.** The preset ships with the literal path `/path/to/allowed/dir`. If you enable the server without changing it, the server runs but can reach nothing. This is the classic "the filesystem MCP sees nothing" problem.

---

**Next:** [Check the servers connected](mcp.md)
