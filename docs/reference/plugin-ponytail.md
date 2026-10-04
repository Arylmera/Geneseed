---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 16
title: "geneseed-ponytail"
description: "An opt-in minimal-code mode, re-applied every turn."
---
One of the [OpenCode plugins](opencode-plugins.md). Its switches are also listed in [Environment variables](environment.md).

**What it does.** Holds an opt-in minimal-code mode: once on, it appends the "laziest solution that works" ruleset to the system prompt **every turn**, so the agent doesn't drift back to over-building mid-session. It is the sustained form of the `ponytail` skill, and it is not part of the [rules](../concepts/rules.md): nothing about it applies until you switch it on.

**When it runs.** Every turn, while a level is set. It starts `off`.

**What you see.** Replies that favour the smallest working change. Switch with `/ponytail lite|full|ultra|off` (bare `/ponytail` means `full`); the level is saved to `.geneseed-ponytail` beside OpenCode's config and applies from the next turn. On an OpenCode build without the experimental system-prompt hook it never injects; the skill still works.

**Switches.**
- `GENESEED_PONYTAIL=lite|full|ultra` — the starting level (default `off`).
- `GENESEED_DEBUG=1` — logs `[geneseed-ponytail] ponytail <level>` on each switch.
