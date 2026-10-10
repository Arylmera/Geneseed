---
group: understand
order: 5
title: "On Bob, or any AGENT.md tool"
kind: "concept"
section: "On your machine"
description: "Where an install lands on IBM Bob or as a plain AGENT.md bundle, and how little is enforced there."
---
Bob and the plain bundle carry the same rules, agents and skills as the other hosts. What differs is where they land and how much of it is enforced. The **Kind** words are explained in [What lands on your machine](on-your-machine.md).

**Bob.** A global install writes to `~/.bob/`, or `BOB_CONFIG_DIR`. Bob does not load a global `AGENTS.md`, so the rules go into `~/.bob/rules/geneseed.md`. A per-repo install writes `AGENTS.md` instead. Hooks live in `~/.bob/settings/settings.json`. Bob runs three of them: context at session start, one combined gate before each tool call, and learn at session end. Bob has no "ask" prompt, so the gate refuses outright, and only for the checks that admit no judgement call: credentials, destructive git, and a write under a project's own protected-checks list. The commit/push and memory questions become log lines.

**Plain bundle.** The `files` target writes `AGENT.md` and the same folders into `./Harness/` for any tool that reads `AGENT.md`. It installs no hooks and no plugins, so nothing in it is enforced.

---

**Next:** [Taking it back out](take-it-out.md)
