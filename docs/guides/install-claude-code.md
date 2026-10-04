---
group: guides
order: 4
title: "Install for Claude Code"
kind: "concept"
section: "Install"
description: "The Claude Code install, global or per repo, and the hook shim every hook calls."
---
The setup wizard runs this for you (see [Install](install.md)). Use the commands directly when you script an install, or when you want a scope the wizard did not offer you.

```
geneseed build --emit claude-global                                  # ~/.claude, every repo
geneseed build --emit claude --out /path/to/repo --root /path/to/repo   # one repo
```

The install writes `CLAUDE.md`, `agents/`, `skills/`, `memory/` and `notebook/`, plus hooks in Claude Code's `settings.json`. Hooks are commands Claude Code runs around each tool call. They gate risky actions and load project context (see [Hooks](../concepts/hooks.md)). For a project install the hooks go into `.claude/settings.local.json`, which stays out of git because it names a path on your machine.

Every hook calls `geneseed-hook <verb>` through one stable file, the **hook shim** at `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows). The shim knows where Node and Geneseed live. If you move or replace Geneseed, one rebuild rewrites the shim and every install works again. `GENESEED_HOME` moves the shim's folder.

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
