---
group: guides
order: 16
title: "MCP servers"
kind: "concept"
section: "Set up"
description: "Where MCP config lives for each host, the three presets, and how to check a server connected."
---
MCP (Model Context Protocol) servers give your agent extra tools: converting a PDF, opening a merge request, reading files outside the repo. Geneseed ships three ready-made server **presets** (MarkItDown, GitLab and Filesystem) that you can switch on without writing JSON by hand.

> **You already know this:** an MCP entry is a line in a Procfile. It names a command the agent starts on demand. Writing the line does not install the program behind it.

Each preset is a *local* server, a command your agent launches when it needs the server. Registering a preset only points the agent at that command. **You** install the tool behind it (or let `uvx` or `npx` fetch it) and you supply any credentials.

> **Never commit a real token.** The presets ship with an empty `GITLAB_PERSONAL_ACCESS_TOKEN` and a sample filesystem path. Fill them in your own config, never in a tracked file.

## Where the config lives

Each host keeps its servers in its own file and in a slightly different shape:

| Host | Project | Global | Shape |
| --- | --- | --- | --- |
| OpenCode | `opencode.json` (or `opencode.jsonc`) | `~/.config/opencode/opencode.json` | key `mcp`; `command` is one list; `environment`; `enabled` |
| Claude Code | `.mcp.json` | `~/.claude.json` | key `mcpServers`; `command` + `args`; `env` |
| OpenClaude | `.mcp.json` | `~/.openclaude.json` (or inside `$OPENCLAUDE_CONFIG_DIR`) | as Claude Code |
| Bob | `.bob/mcp.json` | `~/.bob/settings/mcp.json` | as Claude Code |

The same MarkItDown server in both shapes:

```json
{ "mcp": { "markitdown": { "type": "local", "command": ["uvx", "markitdown-mcp"], "enabled": true } } }
```

```json
{ "mcpServers": { "markitdown": { "command": "uvx", "args": ["markitdown-mcp"] } } }
```

**Toggle instead of editing.** In the web console (`geneseed web`), **Settings → MCP servers** adds, enables, disables or removes any preset in the right file, already in the right shape. Not sure which file that is? The **Harnesses** page shows the config path for each install, and `geneseed mcp` prints the same paths and lists the servers each install has wired, without starting anything.

The reference OpenCode config ships MarkItDown enabled and the GitLab and Filesystem entries disabled, so a merge never switches on a server that has no credentials yet. Fill in the blanks, then switch the server on.

## The presets

- [MarkItDown](mcp-markitdown.md): converts PDF, Word, Excel, PowerPoint and HTML to markdown.
- [GitLab](mcp-gitlab.md): repository, merge request, issue and CI tools over the GitLab API.
- [Filesystem](mcp-filesystem.md): file access limited to the folders you list.

## Verify

Restart your agent, then list the servers:

<!--harness:opencode-->
*(OpenCode only)*

`opencode mcp` lists each server and whether it **connected**.
<!--/harness-->

<!--harness:claude-->
*(Claude Code only)*

`/mcp` in a session, or `claude mcp list` in a terminal, shows each server and whether it connected.
<!--/harness-->

Being listed is not the same as working. A local server appears in the list whether or not its command actually launches.

Listed but not connecting? See [Model, agent and MCP problems](../reference/troubleshoot-tools.md). To have the agent read PDFs and Office files, see [Reading non-markdown docs](read-non-markdown.md).
