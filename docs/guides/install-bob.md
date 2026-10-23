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

Bob is shaped like Claude Code, so it gets the same agents and skills. Per repo, the preamble goes into a root `AGENTS.md` and the rest into `.bob/`. Globally, everything goes under `~/.bob` (`$BOB_CONFIG_DIR` moves it), and the preamble rides `rules/geneseed.md`, because Bob does not auto-load a global `AGENTS.md`. Bob's hooks refuse an action with exit code 2, and Bob has no `SubagentStop` or `PreCompact` events.

Both scopes open Bob's carrier with a short first-reply override, so the theme's readiness line (for example "🧬 Gene-seed implanted…") starts the first reply. Without it, Bob's own greeting outranked the instruction lower in the file. A bare greeting such as "hi" still gets Bob's fixed welcome; the line appears on the first real request. That much was checked by hand in the Bob IDE (2026-10); the rest of the Bob support has not been verified against a live install.

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
