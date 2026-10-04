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

Bob is shaped like Claude Code, so it gets the same agents and skills. Per repo, the preamble goes into a root `AGENTS.md` and the rest into `.bob/`. Globally, everything goes under `~/.bob` (`$BOB_CONFIG_DIR` moves it), and the preamble rides `rules/geneseed.md`, because Bob does not auto-load a global `AGENTS.md`. Bob's hooks refuse an action with exit code 2, and Bob has no `SubagentStop` or `PreCompact` events. Bob support has not yet been verified against a live install.

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
