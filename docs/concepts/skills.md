---
group: concepts
order: 5
title: "Skills"
kind: "concept"
section: "Harness"
description: "Written playbooks the agent follows for a repeatable task."
link: {"hash": "#/section/skills", "label": "Browse the catalog →"}
---
A **skill** is a repeatable workflow written as a markdown playbook: when it applies, the steps, and what "done" looks like. The agent reads the playbook before acting, so a task it has a skill for is done the same careful way every time instead of improvised.

> **You already know this:** a runbook. Nobody deploys from memory — you open the deploy runbook and follow it. A skill is that runbook, addressed to the agent.

{N_SKILLS} skills ship. Each is authored once under `src/skills/` and installed under `skills/` in the install, where the host looks for skills.

### How a skill gets used

- **By name.** Ask for it — "brainstorm this", "run a council on it" — or, on hosts with slash commands, type `/<name>`.
- **By trigger.** Every skill has a one-line description of its purpose and when it applies. The host shows those descriptions to the agent every turn, and the agent opens the matching skill when your request fits.
- **User-only skills.** A few skills are marked to open only when *you* call them (a teaching drill, a tool tied to a setup the agent cannot see, a guide for one stack or one personal vault). They answer `/<name>` but the agent never starts them on its own, and their description stays out of the always-loaded list.

### A tour

| You want to… | Skill |
| --- | --- |
| turn a raw idea into an approved design before any code | `brainstorm` |
| write a plan to a file before a non-trivial task | `plan` |
| drive a change through smallest change → tests → green suite | `develop` |
| find a bug by evidence: reproduce, isolate, root-cause, verify | `debug` |
| answer a question from the open web, every claim cross-checked | `research` |
| have several viewpoints debate a decision | `council` |
| get an adversarial critique of your own ask, plan or idea | `roast-me` |
| see what a change does before you agree to commit it | `explain-changes` |
| stage the right paths and write a focused commit | `commit` |
| open a pull request, or finish and merge a branch | `ship` |
| decide whether something is a standing rule or a fact to remember | `rule` |
| be taught a topic, or quizzed on it | `teach`, `quiz` |

The full list, with each description, is in the catalog.

### Skills improve themselves

Every skill ends with one beat of reflection: if a step misled or a step was missing, the agent proposes the exact edit to that skill and applies it only with your assent. Most runs end with nothing to change.

### Old names keep working

When two skills merge, the old name still works as a slash command: `/deps-audit` runs `dependencies`, and `/ci-fix` runs `debug`. The old names are user-only, so the agent's list shows each skill once. If you had left out a skill that was later merged, a rebuild leaves out the merged skill instead. A skill removed with no replacement is dropped from that list, with a note.

### What they cost

The skill *bodies* are read only when used. The *descriptions* are listed to the agent every turn so it can pick the right one — that list is part of the always-on cost described in [Footprint](footprint.md).

### Related

[Agents](agents.md) — who does the work · [Rules](rules.md) — what every skill obeys · writing your own: [docs/extending.md](../extending.md)
