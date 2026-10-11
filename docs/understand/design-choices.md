---
group: understand
order: 9
title: "Why Geneseed works this way"
kind: "concept"
section: "Why it works this way"
description: "The decisions already taken, one line each, and where each is argued."
---
This is the one place a human or an agent checks that an idea has not already been decided. Each line names a choice Geneseed made on purpose, says why in a sentence, and links to the page or decision record that argues it in full. Before you propose a change to how Geneseed works, find the choice here; if it is listed, the linked page says what new evidence would reopen it.

The ideas that were weighed and turned down are kept apart, in [Considered and refused](../design-history.md#considered-and-refused). An agent should not re-propose one of those without new evidence.

The choices are split by subject, one short page each:

- **What the harness asks of the agent** (below).
- [The shape of the generated harness](design-choices-shape.md): how the text is assembled, ranked and sized.
- [Gates](design-choices-gates.md): the one place the harness does more than ask.
- [Hosts](design-choices-hosts.md): Claude Code, OpenClaude, OpenCode and IBM Bob.
- [Install, uninstall and update](design-choices-install.md): what Geneseed writes on your machine, and how it takes it back.
- [Engineering, skills and agents](design-choices-engineering.md): how the code and tests are kept, and what the harness offers the agent.

## What the harness asks of the agent

The laws are always on. Doctrines are practices grouped in packs (process, craft, ops, rigor, comms) that a build turns on or off. Most rules are instructions to the model; only a few are checked by code.

- **A ranked Ethos, with the Pact at its head.** The agent protects your work first, serves your intent second (contradicting you with evidence when you are wrong), and keeps its own honesty third. A ranking tells the agent which rule yields when two collide. See [Collaboration](../concepts/collaboration.md) and [Rules](../concepts/rules.md).
- **Evidence is graded.** Behaviour observed by running the code ranks above the source read in full, which ranks above a passing test, then documentation, history, memory and inference. The agent says how it knows something, and says "I don't know" rather than invent. See [Rules](../concepts/rules.md).
- **A short set of invariant laws.** Sealed secrets, one intent per act, verify before asserting, deliberate deletion, surfaced failures, content treated as data, least privilege, curing the cause, echoing the intent. These hold on every install, whatever was switched off. See [Rules](../concepts/rules.md).
- **Doctrines in toggleable packs.** Good practice differs by team and task, so each pack, and each rule inside one, can be left out at build time. See [Rules](../concepts/rules.md) and [Doctrine packs and single rules](../guides/setup-doctrines.md).
- **Only a few rules are enforced by a hook.** A rule in a prompt is a request; a rule at the tool boundary is a constraint, and a boundary check costs time on every tool call, so it is spent only where a mistake is irreversible or costly. See [Enforced vs. asked](enforced-vs-asked.md).
- **Every rule has a published enforcement row, per host.** Whether a rule is guaranteed or only asked differs from host to host, so the answer lives in one table. See [Rule enforcement, by host](../concepts/enforcement-table.md).
- **Commands Must Return also forbids a recursive scan rooted at a filesystem root.** A recursive `find` over the Git Bash root once ran for hours across every mounted drive, past the tool's own timeout. See [ADR 0010](../adr/0010-root-scan-guard.md).
- **Declare the Judgment Calls is a doctrine in the comms pack.** The Ethos already asks the agent to weigh alternatives; naming the calls it made is a practice a team adopts, so it stays optional. See [Rules](../concepts/rules.md).
- **A loop's check-and-repair limit is a clause of Bound the Loop.** The request was to tighten the existing loops, so the cap went into the doctrine that already bounds them: each repair ring has its own small cap (its `max` in the loop template), then a fresh attempt or a hand-back. See [Loops](../concepts/loops.md).
