---
group: plugins
order: 6
title: "geneseed-ponytail"
kind: "concept"
---
The sustained counterpart to the `ponytail` skill: once you opt in, it appends the laziest-that-works ruleset to the system prompt **every turn**, so the agent doesn't drift back to over-building mid-session, and it persists the level across turns.

- **Opt-in:** the mode starts at `off` and injects nothing until you switch it on. Geneseed treats ponytail as a skill you reach for, not as part of the [constitution](#/docs/rules): it is neither an always-on invariant nor a doctrine pack you build in, so nothing about it binds until you ask for it.
- **Toggle:** `/ponytail lite|full|ultra|off` (a bare `/ponytail` means `full`). The level is written to `.geneseed-ponytail` beside OpenCode's config and applies from the next turn.
- **Hooks:** `experimental.chat.system.transform` appends the ruleset; `command.execute.before` records the switch. Every failure is swallowed; on a build without the system-transform hook it simply never injects (the skill still covers the invokable path).

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup).

### Configure

- `GENESEED_PONYTAIL=lite|full|ultra` — make a level the default for new installs (default `off`, i.e. dormant until asked).

### Verify

With `GENESEED_DEBUG=1`, run `/ponytail full` — you'll see `[geneseed-ponytail] ponytail full`, and the next turn's replies favour the minimal solution.
