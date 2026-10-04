---
group: guides
order: 5
title: "Install for OpenClaude"
kind: "concept"
section: "Install"
description: "The OpenClaude install: Claude Code's pieces under OpenClaude's own config folder."
---
The setup wizard runs this for you (see [Install](install.md)). Use the commands directly when you script an install, or when you want a scope the wizard did not offer you.

```
geneseed build --emit openclaude-global                                   # ~/.openclaude
geneseed build --emit openclaude --out /path/to/repo --root /path/to/repo # one repo
```

[OpenClaude](https://openclaude.gitlawb.com/) is a fork of Claude Code that can drive any model. You get the same agents, skills and hooks as Claude Code, under a different config directory. OpenClaude never reads `~/.claude` or a project `.claude/`, so the two installs can sit side by side. The differences:

- Per repo, the preamble is written to `.openclaude/CLAUDE.md` rather than a root file, and the hooks go into `.openclaude/settings.local.json`.
- `$OPENCLAUDE_CONFIG_DIR` moves the global directory (default `~/.openclaude`).

OpenClaude support has not yet been verified against a live install.

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
