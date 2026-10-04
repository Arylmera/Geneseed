---
group: concepts
order: 4
title: "Agents"
kind: "concept"
section: "Harness"
description: "The specialists the main session can hand work to."
link: {"hash": "#/section/agents", "label": "Browse the catalog →"}
---
An **agent** is a specialist the main session can hand a piece of work to. Each one is a markdown file with its own instructions, installed where your host looks for subagents (`agents/` in the install). It runs in its own context and returns a result, so its reading and searching does not fill your conversation.

> **You already know this:** handing a ticket to a colleague. You do not explain how to review code to the reviewer — you say what to review, and they come back with findings.

{N_AGENTS} agents ship, in two groups.

### The specialists

| Agent | What it does |
| --- | --- |
| `explorer` | reads and searches widely in a throwaway context, returns only distilled findings |
| `researcher` | searches the open web, cross-checks every claim against two sources, returns sourced findings |
| `architect` | produces a design or implementation plan before code is written |
| `developer` | implements a scoped change in an isolated worktree, self-checked, ready for the tester |
| `tester` | writes, runs and diagnoses tests |
| `reviewer` | reviews a change for correctness and quality before it merges |
| `security` | audits changes that touch the security surface |
| `docs` | writes and updates user-facing documentation after code lands |

### The council

Ten read-only debaters — `advocate`, `skeptic`, `pragmatist`, `steward`, `operator`, `visionary`, `framer`, `empiricist`, `historian`, `user-advocate` — each arguing one fixed stance. You do not call them one by one: the **council** [skill](skills.md) seats the ones that actually disagree on your question, runs bounded rounds of debate, and hands you a verdict with the strongest dissent kept verbatim. The council advises; it writes no code.

### Specialists, not folder owners

An agent is picked by **what the work needs**, not by **where the file lives**. There is no "agent for `src/api/`": a change to any folder goes to the `developer`, and its review to the `reviewer`. You can name one ("have the reviewer look at this"), or let the main session route the request to the right specialist itself.

In [foreman mode](foreman-mode.md) the session chains several of them into a pipeline — explorer, developer and tester, plus whatever specialists the task needs.

### Agents learn too

When a subagent finishes, the learn step can record a lesson for that agent alone, in `memory/agents/<name>.md` — one bullet per lesson, capped so it never grows unbounded. The next time that agent runs, it starts with what it learned. See [Memory](memory.md). (Not on Bob, which has no subagent-finished event.)

<!--harness:opencode-->
*(OpenCode only)*
OpenCode also has a **primary agent** — the one your session talks to directly. Geneseed installs it alongside the specialists; the specialists are subagents it delegates to.
<!--/harness-->
