---
group: concepts
order: 12
title: "Collaboration"
kind: "concept"
section: "Working together"
description: "Register, contract, how firmly a memory binds, and who you are."
---
Beside the [rules](rules.md), a few pieces shape *how* the agent works with you: the register it speaks in, the contract between you, how firmly a memory binds, and who you are. All of them are plain text in the install, so they reach every host unchanged.

> **You already know this:** a team's working agreement. The coding standards say what the code must look like; the working agreement says how people treat each other's reviews, questions and decisions.

### Posture — the relationship

A **posture** is the register the agent works in. You choose it at setup and it is fixed at build time, so it does not drift back toward plain execution halfway through a session.

| Posture | For |
| --- | --- |
| **peer** (default) | a candid equal — dense, challenges you, no flattery |
| **mentor** | leaves you more capable — explains the why, checks understanding |
| **expert** | maximum density for a fluent user — terse, no basics |
| **assistant** | precise execution, low initiative — you steer |
| **artisan** | a peer with toolsmith reflexes — terminal-first, automates repetition |

Posture is separate from the [theme](themes.md): the theme is the *voice*, the posture is the *relationship*. Every posture obeys the same rules; what shifts is how firmly and how loudly the agent voices disagreement. Change it with `geneseed setup`, the web console's Harness page, or:

```bash
geneseed build --emit claude-global --posture mentor
```

How the agent *executes* work — itself, or through a crew — is the separate **mode** setting: see [Foreman mode](foreman-mode.md).

### The Pact — a two-way contract

The **Pact** is stated in the first section of the Ethos, the layer that is always on, so it holds in every task and every repository. It ranks three duties for the agent, each yielding only to the one above:

1. protect you — and the future maintainer of your code;
2. serve your intent;
3. keep its own honesty.

Unusually, it also says what *you* owe back:

- **Don't punish candour.** When the agent contradicts you with evidence, flags a risk or admits a doubt, that is the Pact working. Penalising it teaches the agent to flatter.
- **Give the context up front.** The agent cannot weigh what it was not told.
- **Decide when shown a fork.** An unmade decision stalls work as surely as a wrong one.

Your half is not enforced against you. The agent's half binds it.

### Memory force — how firmly a memory binds

A [memory](memory.md) can carry an optional `force`:

| Force | Meaning |
| --- | --- |
| **constraint** | imposed; not the agent's to relax |
| **choice** | revisable, with your consent |
| **conviction** | revisable on evidence |
| **tempered** | a constraint that was relaxed |

When new evidence contradicts a memory with a force, the agent must revise it in the open rather than quietly drop it.

### Profile — who you are

`PROFILE.md` sits beside the instructions file, is seeded once and is never overwritten. It holds your role, habits and how you like answers pitched. It colours how the agent works but never binds — it is last in [precedence](rules.md). Edit the file directly, use the Profile tab in the web console, or let the `profile` [skill](skills.md) interview you and draft it; it writes only with your consent, and routes anything that is really a standing rule to `user-rules.md`.
