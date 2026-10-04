---
group: guides
order: 10
title: "Choose your setup"
kind: "concept"
section: "Set up"
description: "The voice and working style: theme, posture and mode, and where the other setup choices are."
---
The setup wizard asks a handful of questions before it builds. Every one has a safe default, so you can accept them all and move on. Three pages say what each one changes, so you can pick on purpose: this one covers the voice and how the agent works with you; [Doctrine packs and single rules](setup-doctrines.md) covers which practices bind; [Footprint, loop trust and changing later](setup-footprint.md) covers the token cost, how far a loop goes, and how to change any of it.

All of these choices are made **at build time**. The build writes them into the files your agent loads. Nothing switches at runtime. Rebuilds, re-themes and upgrades keep each install's choices, because they are recorded in small marker files beside the install.

> **You already know this:** these are compiler flags. You set them once, the output is built from them, and changing one means rebuilding rather than editing the output by hand.

## Theme: the voice

A theme changes how the harness *sounds*: the banner, the readiness sigil the agent opens with, and the vocabulary of its prose. It never changes which rules apply or which files ship. The wizard previews each theme live as you move through the list.

`neutral` is plain English. The others are `imperial`, `military`, `pirate`, `wizard`, `cyberpunk`, `gamer`, `sports`, `biker`, `commentator`, `joker`, `marvin`, `mean` and `verstappen`.

```
geneseed build --emit opencode-global --theme imperial
```

More in [Themes](../concepts/themes.md).

## Posture: how the agent works with you

Posture is the relationship register, fixed at build time so it does not drift mid-session:

- **peer** *(default)*: a candid equal. Dense, challenges you, no flattery.
- **mentor**: explains the why and checks your understanding.
- **expert**: maximum density, no basics.
- **assistant**: precise execution, low initiative. You steer.
- **artisan**: a peer with toolsmith reflexes, terminal-first.

```
geneseed build --emit opencode-global --posture mentor
```

Pick **peer** unless you know you want another register. A theme changes the prose, while a posture changes the relationship. See [Collaboration](../concepts/collaboration.md).

## Mode: who does the work

- **direct** *(default)*: the agent works every task itself, turn by turn.
- **foreman**: the session sorts each incoming task. A trivial task gets a direct answer. A substantial task goes to a small crew of agents (a **pipeline**) running in its own git worktree, while the session keeps answering you.

A pipeline never commits or merges. It hands back its worktree uncommitted, together with its test and lint output. The session then re-runs those commands itself, shows you the diff and the passing output, and commits and merges only after you accept. Foreman mode costs more per substantial task, because several agents run instead of one. In exchange, the session stays responsive.

```
geneseed build --emit opencode-global --mode foreman
geneseed build --emit opencode-global --mode direct    # back to the default
```

More in [Foreman mode](../concepts/foreman-mode.md).

---

**Next:** [Doctrine packs and single rules](setup-doctrines.md)
