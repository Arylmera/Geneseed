---
group: concepts
order: 10
title: "Footprint (lean vs full)"
kind: "concept"
section: "Configuration"
description: "Lean or full: how much of the constitution rides inline every turn."
link: {"hash": "#/installs/hosts", "label": "Change it on Installs →"}
---
**Footprint** decides how much of the [constitution](rules.md) the agent carries *inline* in its instructions file on every turn. It has two settings, **lean** (the default) and **full**, chosen per install. It is a token-cost dial, not a rules dial: every rule the install adopted is in force at either setting.

> **You already know this:** eager versus lazy loading. Full ships everything in the first payload; lean ships the index and fetches the rest when it is needed.

### The difference

- **Full** — the instructions file carries the Ethos, every Rule and every rule of the active doctrine packs at complete length, reasoning included, every turn.
- **Lean** — each Rule and each doctrine rule is carried as its heading plus a short form written by hand (the rule and how it works, not the first sentence cut off). One pointer after the doctrine packs names where the complete text of both layers is on disk, and the agent reads the reasoning when a rule's application is unclear. The Ethos gets one hand-written short form for the whole layer, because it is flowing prose rather than numbered rules. Lean also drops the voice's flourish: a heading names the rule by its plain principle (`Dictate I — Sealed Secrets`, not `Dictate I — Arcana Sigillata · Sealed Secrets`), and no section opens with an italic epigraph. Full keeps both, and so do the complete files on disk.

Neither setting hides text from the agent. They decide what is in front of it on *every* turn.

### What is on disk either way

- **Lean** writes the full `laws/`, `ontology/` and `doctrines/` text beside the instructions file, because the inline copy is shorter than what the agent may need.
- **Full** writes `doctrines/` too: it inlines only the packs this install built in, so the others must be on disk for a citation into them to resolve, and for you to read before turning one on.

Everything else is identical at both settings — the same agents, skills, plugins or hooks, commands, memory and notebook.

### Which to choose

- **Lean** (default) for long sessions, large repos or cost-sensitive work. It is safe: the full text ships, and the instructions tell the agent to read it before acting on secrets, deletion, git history, scope or untrusted content.
- **Full** when token cost does not matter, or with a smaller or cheaper model — with the reasoning always in context, a model applies a rule's edge cases more reliably.

For measured numbers per host, see [docs/token-footprint.md](../token-footprint.md).

### There is no chat mode

Footprint is the only token dial. There is no command that switches the harness off for a quick question, and that is deliberate.

- **What it costs.** Measured on 2026-11-12, the harness adds about 11–14k tokens to a session at lean and 18–21k at full, depending on the host. Where the provider caches prompts, that is billed at the full price once per session and at the cached rate on every later message.
- **Why not a command in the chat.** The harness is in the context before your first message, and no host can take it back out of a running conversation. A command could only tell the agent to ignore the rules, which saves nothing.
- **Why not a toggle on resume.** On Claude Code and OpenCode 2, resuming a conversation without the harness keeps it in the history, and resuming with it again loads it a second time.

So the harness stays in place in every session. For a single session without it, each host has its own launch option; the launch lines, their limits and every measurement are in [Why there is no chat mode](../token-footprint.md#why-there-is-no-chat-mode).

### How to set it

Footprint is stored in a `.geneseed-footprint` marker in the install and kept across every rebuild and upgrade, on every host.

- **Setup wizard** — asks for it alongside voice, posture, mode and doctrine packs:

  ```bash
  geneseed setup
  ```

- **Web console** — each install's own panel on the Hosts page changes its footprint and rebuilds it; Settings shows the footprint of the install its own picker names and links there. A new install or deploy from the console starts lean, as from the command line.
- **Command line** — with the emit target of the install you are changing:

  ```bash
  geneseed build --emit claude-global --footprint full
  ```

  On the command line, a flag you leave out takes the generator's default, not the install's current value. A build that would change a setting of an existing install that you did not pass refuses: it lists each change and prints the command that keeps them. `geneseed status --json` shows that command for every install. Add `--reset` only to accept the defaults.

The walkthrough for all build-time choices is [Choose your setup](../guides/choose-your-setup.md).
