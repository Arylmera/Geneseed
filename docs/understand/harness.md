---
group: understand
order: 1
title: "What a harness is"
kind: "concept"
---
Your coding agent starts every session knowing nothing about how you work. It does not know that you never push without looking at the diff first, that secrets live in `.env`, or that this repo's docs explain the build. You tell it again, or it guesses.

The usual fix is a `CLAUDE.md` or `AGENTS.md`: a page of instructions the tool loads at the start of each session. That helps, but it has two weaknesses. It is prose, so the model reads it and usually follows it, but nothing makes it. And you copy it into every repo, where each copy slowly drifts from the others.

A **harness** is everything around the model that shapes how it works: the instructions it loads, the specialists it can hand work to, the routines it can follow, what it remembers between sessions, and the checks that run before it acts. Every Geneseed term is defined in the [glossary](../reference/glossary.md).

> **You already know this:** git hooks, CI, and a team runbook, but for the agent. The runbook says how work is done. The hooks and CI stop the mistakes that matter before they land.

### What Geneseed is

Geneseed is a build that produces a harness. One source renders:

- **the rules**: a short set of rules the agent always follows, plus practice packs you choose ([Rules](../concepts/rules.md));
- **agents**: specialists such as a reviewer or a tester that the main agent can delegate to ([Agents](../concepts/agents.md));
- **skills**: written procedures you call by name, such as `brainstorm` or `plan` ([Skills](../concepts/skills.md));
- **a memory convention**: one fact per file, kept on your machine between sessions ([Memory](../concepts/memory.md)).

It renders them for OpenCode, Claude Code, Bob, OpenClaude, or as a plain bundle for any tool that reads `AGENT.md`. The content is the same on every host. Only the wiring differs.

Where the host lets it, Geneseed also installs **gates**: small programs that run before a tool call and stop a few things outright, such as a force-push or a credential written into a tracked file. Those rules do not depend on the model remembering them. [Enforced vs. asked](enforced-vs-asked.md) explains which rules a gate stops and which ones the model is only told about.

### Install once, use everywhere

You install it once, at the user level, and every repo you open inherits it. There is nothing to copy into each project. When the source changes, you rebuild and every install picks up the change, so no copy drifts.

The name comes from Warhammer 40,000, where gene-seed is implanted once and the rest grows from it. That is the only lore you need. The default theme is neutral.

---

**Next:** [What lands on your machine](on-your-machine.md)
