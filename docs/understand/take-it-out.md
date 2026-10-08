---
group: understand
order: 6
title: "Taking it back out"
kind: "concept"
section: "On your machine"
description: "What geneseed uninstall removes, and what it keeps for you."
---
`geneseed uninstall` removes only what Geneseed recorded writing: the rules file or its managed block, `agents/`, `skills/`, plugins, and Geneseed's own hook and config entries. It keeps `memory/` and `notebook/` in place, along with the files it seeded for you to edit (`user-rules.md`, `PROFILE.md`, `geneseed-wiki.jsonc`). Add `--archive-memory` to move memory and notebook aside instead. It still deletes nothing. See [Uninstall](../guides/uninstall.md).

---

**Next:** [A day with the harness](a-day.md)
