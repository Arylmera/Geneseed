---
group: guides
order: 18
title: "GitLab (MCP)"
kind: "concept"
section: "Set up"
description: "Merge requests, issues and CI from the agent: token scopes, the config block, a second instance."
---
One of the [MCP server](mcp.md) presets. Where each host keeps the config, and how to check the server connected, are on that page.

> **Never commit a real token.** The presets ship with an empty `GITLAB_PERSONAL_ACCESS_TOKEN` and a sample filesystem path. Fill them in your own config, never in a tracked file.

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

---

**Next:** [Filesystem (MCP)](mcp-filesystem.md)
