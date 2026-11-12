---
group: guides
order: 6
title: "Install for IBM Bob"
kind: "concept"
section: "Install"
description: "The IBM Bob install, global or per repo, and how its hooks differ."
---
The setup wizard runs this for you (see [Install](install.md)). Use the commands directly when you script an install, or when you want a scope the wizard did not offer you.

```
geneseed build --emit bob-global                                   # ~/.bob
geneseed build --emit bob --out /path/to/repo --root /path/to/repo # one repo
```

Bob is shaped like Claude Code, so it gets the same agents and skills. A read-only agent is limited with Bob's own `groups:` key, because Bob ignores Claude's `disallowedTools`. Per repo, the preamble goes into a root `AGENTS.md` and the rest into `.bob/`. Globally, everything goes under `~/.bob` (`$BOB_CONFIG_DIR` moves it), and the preamble rides `rules/geneseed.md`, because Bob does not auto-load a global `AGENTS.md`. Bob's hooks refuse an action with exit code 2. Bob has no `SubagentStop` event; Bob 2.2.3 does have `PreCompact` and `PostCompact`, which Geneseed does not wire.

Both scopes open Bob's carrier with a short first-reply override, so the theme's readiness line (for example "🧬 Gene-seed implanted…") starts the first reply. Without it, Bob's own greeting outranked the instruction lower in the file. A bare greeting such as "hi" still gets Bob's fixed welcome; the line appears on the first real request. For what was checked against Bob itself, and when, see [What is verified](../concepts/host-matrix.md#what-is-verified); [Verify it works](verify.md) has the steps to check your own install by hand.

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
