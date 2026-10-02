---
group: concepts
order: 12
title: "Themes"
kind: "concept"
---
A **theme** changes the agent's *voice* and the words the harness uses for its own parts. It never changes structure: the same rules, in the same order, with the same files, folders and links, whatever theme you pick.

> **You already know this:** an editor colour scheme. It changes how everything looks, never what the code does.

### What changes and what does not

| Changes with the theme | Never changes |
| --- | --- |
| how the agent phrases its replies | which rules apply, and their order |
| the nouns for the harness's parts — an `imperial` install calls the Rules *Dictates*, agents *Adepts*, skills *Rites* | folder names: `agents/`, `skills/`, `memory/`, `laws/`, `doctrines/`… |
| the banner, the readiness line the agent prints when it starts, the closing lines | section layout and the links between files |
| the names and descriptions shown for rules, agents and skills | rule addresses such as `process 5` |

`neutral` keeps the plain words — Rule, Doctrine, Agent, Skill, Memory — so it is the theme to pick if you want no flavour at all. The [glossary](../reference/glossary.md) shows each themed word beside its neutral one.

### The themes that ship

14 themes ship: `neutral`, `imperial` (Warhammer 40k), `military`, `pirate`, `wizard`, `cyberpunk`, `gamer`, `sports` (play-by-play), `biker`, `commentator`, `joker`, `marvin`, `mean` and `verstappen`.

### Switching

The theme is stored in a `.geneseed-theme` marker in the install, so upgrades and rebuilds keep it.

- **Setup wizard** — lists every theme with a live preview:

  ```bash
  geneseed setup
  ```

- **Web console** — the per-install voice dropdown on the Harness page.
- **Command line** — with the emit target of the install you are changing:

  ```bash
  geneseed build --emit claude-global --theme pirate
  ```

<!--harness:opencode-->
*(OpenCode only)*
OpenCode also has *colour* themes for its interface. Those are separate from voice themes; `geneseed theme <name>` creates your own colour theme in OpenCode's themes folder, and it survives rebuilds.
<!--/harness-->

### Writing your own

A theme is one JSON file of voice tokens in `themes/`. How the tokens split between voice and structure, and how to add one, is in the maintainer design notes: [DESIGN.md](../../DESIGN.md).
