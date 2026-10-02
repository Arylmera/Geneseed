---
group: guides
order: 8
title: "MCP servers"
kind: "concept"
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

## MarkItDown

[MarkItDown](https://github.com/microsoft/markitdown) (Microsoft) converts PDF, Word, Excel, PowerPoint and HTML to markdown. It exposes one tool, `convert_to_markdown(uri)`, which accepts `file:`, `http:`, `https:` and `data:` URIs.

**1. Make the command resolve.**

- **`uvx` (recommended, nothing to install).** If you have [uv](https://docs.astral.sh/uv/), `uvx markitdown-mcp` fetches and caches the server on first use. This is the command the preset uses.
- **`pipx`.** Without uv, run `pipx install markitdown-mcp`, then use `markitdown-mcp` alone as the command (OpenCode: `["markitdown-mcp"]`; Claude: `"command": "markitdown-mcp"`, no args).

```
uvx markitdown-mcp --help                       # uv route: confirm it resolves
pipx install markitdown-mcp && markitdown-mcp --help   # pipx route
```

For scanned or image-only PDFs, which otherwise come back empty, add the OCR extras: `uvx --with "markitdown[all]" markitdown-mcp`, or `pipx inject markitdown-mcp "markitdown[all]"`.

**2. Corporate TLS (only behind an SSL-inspecting proxy).** uv ships its own root certificates and ignores the OS trust store, so a proxy's internal certificate fails with `invalid peer certificate: UnknownIssuer`. Point uv at the OS store rather than turning verification off:

```
export UV_SYSTEM_CERTS=true      # older uv: UV_NATIVE_TLS=true
# fallback: export SSL_CERT_FILE=/path/to/corporate-root-ca.pem
```

**3. Register it**, with the console toggle or one of the blocks above. Then restart your agent.

## GitLab

[`@zereight/mcp-gitlab`](https://github.com/zereight/gitlab-mcp) provides repository, merge request, issue and CI tools over the GitLab API. It runs through `npx`, so nothing is installed globally. The same command serves gitlab.com and any self-hosted instance.

**1. Create a personal access token** on the instance (User Settings → Access Tokens) with the scopes `api` and `read_repository`. Treat it like a password.

**2. Register the server.**

<!--harness:opencode-->
*(OpenCode only)*

```json
{
  "mcp": {
    "gitlab": {
      "type": "local",
      "command": ["npx", "-y", "@zereight/mcp-gitlab"],
      "environment": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      },
      "enabled": true
    }
  }
}
```
<!--/harness-->

<!--harness:claude-->
*(Claude Code only)*

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/mcp-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      }
    }
  }
}
```

You can also register it with `claude mcp add`.
<!--/harness-->

Keep the `/api/v4` suffix on the URL.

**A second instance** (gitlab.com plus a self-hosted server, for example) is a copy of the same block under a new name, such as `gitlab-acme`, with its own `GITLAB_API_URL` and token. The preset covers the first instance only. You add the copy by hand.

## Filesystem

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

## A server won't connect

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

## Reading non-markdown docs

The agent's doc discovery only sees markdown. The `ingest` skill teaches the agent to convert a PDF, Word, PowerPoint, Excel or HTML file, or a URL, to markdown before reading it. Install one converter and the skill uses it:

- **MarkItDown**: the broadest. Use the MCP server above (preferred on a host with MCP: nothing to install per call, one cheap tool), or `pip install markitdown`.
- **Pandoc**: excellent for Office and HTML, and a single binary.
- **Docling** (IBM): best for complex tables and scanned PDFs.

When an MCP converter is available, the skill prefers it. A prompt like *"convert file:///path/to/spec.pdf to markdown"* then just works. The skill never installs a converter silently. If none is present, it tells you which one to add.
