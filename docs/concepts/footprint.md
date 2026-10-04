---
group: concepts
order: 10
title: "Footprint (lean vs full)"
kind: "concept"
section: "Configuration"
description: "Lean or full: how much of the constitution rides inline every turn."
link: {"hash": "#/settings", "label": "Toggle it in Settings →"}
---
**Footprint** decides how much of the [constitution](rules.md) the agent carries *inline* in its instructions file on every turn. It has two settings, **lean** (the default) and **full**, chosen per install. It is a token-cost dial, not a rules dial: every rule the install adopted is in force at either setting.

> **You already know this:** eager versus lazy loading. Full ships everything in the first payload; lean ships the index and fetches the rest when it is needed.

### The difference

- **Full** — the instructions file carries the Ethos, every Rule and every rule of the active doctrine packs at complete length, reasoning included, every turn.
- **Lean** — each Rule and each doctrine rule is carried as its heading plus a short form written by hand (the rule and how it works, not the first sentence cut off). Each layer ends with a pointer to its complete text on disk, and the agent reads the reasoning when a rule's application is unclear. The Ethos gets one hand-written short form for the whole layer, because it is flowing prose rather than numbered rules.

Neither setting hides text from the agent. They decide what is in front of it on *every* turn.

### What is on disk either way

- **Lean** writes the full `laws/`, `ontology/` and `doctrines/` text beside the instructions file, because the inline copy is shorter than what the agent may need.
- **Full** writes `doctrines/` too: it inlines only the packs this install built in, so the others must be on disk for a citation into them to resolve, and for you to read before turning one on.

Everything else is identical at both settings — the same agents, skills, plugins or hooks, commands, memory and notebook.

### Which to choose

- **Lean** (default) for long sessions, large repos or cost-sensitive work. It is safe: the full text ships, and the instructions tell the agent to read it before acting on secrets, deletion, git history, scope or untrusted content.
- **Full** when token cost does not matter, or with a smaller or cheaper model — with the reasoning always in context, a model applies a rule's edge cases more reliably.

For measured numbers per host, see [docs/token-footprint.md](../token-footprint.md).

### How to set it

Footprint is stored in a `.geneseed-footprint` marker in the install and kept across every rebuild and upgrade, on every host.

- **Setup wizard** — asks for it alongside voice, posture, mode and doctrine packs:

  ```bash
  geneseed setup
  ```

- **Web console** — the **Footprint** toggle in Settings flips the current install and rebuilds it; on the Harness page, each install has its own dropdown.
- **Command line** — with the emit target of the install you are changing:

  ```bash
  geneseed build --emit claude-global --footprint full
  ```

  On the command line, a flag you leave out takes the generator's default, not the install's current value. `geneseed status --json` shows what an install currently has.

The walkthrough for all build-time choices is [Choose your setup](../guides/choose-your-setup.md).
