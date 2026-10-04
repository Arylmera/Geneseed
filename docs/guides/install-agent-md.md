---
group: guides
order: 7
title: "Install for any AGENT.md tool"
kind: "concept"
section: "Install"
description: "The plain bundle for Codex CLI, Cursor, Gemini CLI and the like, or a prompt for a machine with no runtime."
---
The setup wizard runs this for you (see [Install](install.md)). Use the commands directly when you script an install, or when you want a scope the wizard did not offer you.

```
geneseed build            # renders the plain bundle into ./Harness
```

Point your tool's instructions or rules setting at `Harness/AGENT.md`. If the tool only loads one specific filename, rename or symlink the file (`AGENT.md` to `AGENTS.md` or `CLAUDE.md`). The rules then rest on the agent's own discipline, because these tools have no hooks or plugins to enforce anything (see [Enforced vs. asked](../understand/enforced-vs-asked.md)).

Some of these tools also load skills. Their own docs list where:

- **Codex CLI** loads a root `AGENTS.md` and `~/.codex/AGENTS.md`, and skills from `~/.codex/skills` or `.agents/skills`.
- **Cursor** loads `AGENTS.md`, and skills from `.cursor/skills`, `.agents/skills` or `.claude/skills`.
- **Gemini CLI** reads `GEMINI.md` by default. Set `context.fileName` in its `settings.json` to include `AGENTS.md`. Skills load from `.gemini/skills` or `.agents/skills`.

Copy or symlink the bundle's `skills/` to `.agents/skills/` and all three of them see it.

## No runtime on the target machine

If the machine that will use the harness cannot run Node, run this once on a machine that can:

```
npx geneseed prompt --theme neutral > install-geneseed.md
```

This produces one self-contained prompt that recreates the whole file tree. Paste it into any capable agent on the target machine. There is nothing to install and no build step. Any theme works the same way.

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
