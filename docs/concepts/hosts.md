---
group: concepts
order: 1
title: "Hosts"
kind: "concept"
section: "Harness"
description: "The AI coding tools Geneseed installs into, and what each one can enforce."
---
A **host** is the AI coding tool Geneseed installs into — OpenCode, Claude Code, Bob or OpenClaude. Geneseed does not run the model; the host does. Geneseed writes the files the host reads (the instructions file, agents, skills) and, where the host allows it, wires small programs that run around the agent's actions. The *content* is the same on every host. What differs is how much of it the host lets Geneseed **automate** — check in code before an action — rather than only **ask** of the model in prose.

> **You already know this:** one codebase, several CI providers. The pipeline does the same job everywhere, but each provider exposes different hooks, so some checks run natively on one and are a manual step on another.

## What is the same everywhere

One build renders the same text for every host: the constitution ([rules](rules.md)), the {N_AGENTS} [agents](agents.md), the {N_SKILLS} [skills](skills.md), the [memory](memory.md) and [notebook](notebook.md) conventions, and the theme's voice. No host drops an agent, a skill or the memory convention.

Each host has a **global** install (in its config directory, active in every repo) and a **per-repo** install (inside one project). There is also a portable `files` bundle — a plain `Harness/` folder with an `AGENT.md` that any tool reading an instructions file can use, with no automation at all.

## Two engines

- **OpenCode** runs its own engine: Geneseed installs JavaScript **plugins** that OpenCode loads, plus permission entries in `opencode.json`. It also gets OpenCode-only extras: colour themes, [language servers](lsp.md), a workflow runner, a primary agent and `/`-commands.
- **Claude Code**, **Bob** and **OpenClaude** share one Claude-shaped engine: Geneseed wires **hooks** into the host's `settings.json`, each calling `geneseed-hook <verb>`. See [Hooks](hooks.md).

## Where to go next

- Which checks each host runs in code, row by row: [What each host automates](host-matrix.md).
- What exactly each host writes to disk: [What lands on your machine](../understand/on-your-machine.md).
- Code-enforced versus asked-of-the-model, in plain terms: [Enforced vs. asked](../understand/enforced-vs-asked.md).
- Per-host detail for maintainers: [OpenCode](../../adapters/opencode/README.md) · [Claude Code](../../adapters/claude-code/README.md) · [Bob](../../adapters/bob/README.md) · [OpenClaude](../../adapters/openclaude/README.md).
