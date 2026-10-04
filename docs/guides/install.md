---
group: guides
order: 1
title: "Install"
kind: "concept"
section: "Install"
description: "The one-command install, what it needs, and the page for each host."
---
Geneseed builds a harness (the rules, agents, skills and hooks your AI coding tool loads; see [What a harness is](../understand/harness.md)) and installs it into the tool you already use. Most people need one command.

## The 5-minute path

The only prerequisite is **Node 22.3 or newer**.

```
npx geneseed setup
```

The command is the same on macOS, Linux and Windows (cmd, PowerShell or any POSIX shell). The setup wizard lists the AI coding tools it found on your `PATH`, then asks for a theme, a posture, a mode, the doctrine packs, an install mode and a footprint. Each one has a safe default, so you can hold Enter through all of them. [Choose your setup](choose-your-setup.md) explains each question. **OpenCode global** is the recommended install mode: you install once and every repo inherits it, with nothing committed into your projects. The wizard then builds the harness and ends with a short summary: the root file your tool loads and where it was written, the hooks it wired (Claude Code, Bob and OpenClaude), whether memory learning is on, which tool to restart, and a link to what was installed. It then offers to run a health check.

To keep the command on your machine:

```
npm install -g geneseed
```

This puts three commands on your `PATH`: `geneseed` (the CLI you type), `geneseed-build` (the generator) and `geneseed-hook` (what the host tool calls on every tool use, which you never type yourself).

Next: [Verify it works](verify.md). To see what the install just wrote, read [What lands on your machine](../understand/on-your-machine.md).

## Prerequisites

- **Node 22.3 or newer.** This is the only hard requirement. Geneseed has zero runtime dependencies, and nothing it installs needs a second interpreter.
- **Your agent tool**: OpenCode (recommended), Claude Code, IBM Bob, OpenClaude, or any tool that reads a root instructions file.
- **git**, for a clone only. A clone updates itself with `git pull`.
- *Optional:* a document converter (MarkItDown, Pandoc or Docling) if you want the agent to read PDFs and Office files. See [MCP servers](mcp.md#reading-non-markdown-docs).

## Install paths, one per host

The wizard runs one of these for you. Use them directly when you script an install, or when you want a scope the wizard did not offer you.

- [OpenCode](install-opencode.md): global (recommended) or per repo.
- [Claude Code](install-claude-code.md): global or per repo, with hooks.
- [OpenClaude](install-openclaude.md): Claude Code's pieces under OpenClaude's own folder.
- [IBM Bob](install-bob.md): global or per repo.
- [Any AGENT.md tool](install-agent-md.md): the plain bundle, or a machine with no runtime.

No npm? Install [from a clone](install-clone.md). Scripting it? See [Install without the wizard](install-scripted.md).

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
