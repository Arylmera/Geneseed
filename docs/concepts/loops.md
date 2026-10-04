---
group: concepts
kind: "concept"
section: "Loops"
order: 14
title: "Loops"
link: {"hash":"#/docs/loop-actions","label":"The geneseed loop actions →"}
description: "What a loop is, the ring of bricks it runs, and how it differs from foreman mode."
---
To run one, see [Run a loop](../guides/run-a-loop.md).

A **loop** is a requirement worked as small, validated, committed iterations instead of one long
turn. `geneseed loop` is the state machine: it decides every transition, ceiling, score and stop,
and hands the agent one node at a time to run. The `loop` [skill](skills.md) is the only thing
that talks to it — the agent runs the node it is given and reports the outcome, never its own
reading of the graph.

> **You already know this:** a checklist a tech lead walks through on a ticket, where some steps
> need a sign-off before continuing and others don't. The lead doesn't improvise the order; the
> checklist decides it, and only the risky steps stop for you.

## The ring

A loop is a graph of **bricks** — one node each — wired by **edges**, one per outcome a brick can
report. One cycle through the graph back to its head is an **iteration**; the graph's `loops`
array names every cycle that is allowed to exist, each with a `max` number of times a node inside
it may be re-entered. Picture it as rings: the outer ring is the iteration itself (plan, apply,
test, review, back to plan), and inner rings sit inside it for retries (apply failed its test, try
`apply` again without going all the way back around). The shipped templates that center on
`apply` — `bugfix`, `feature`, `refactor`, `tdd`, `legacy-refactor`, `deps-upgrade` — all nest a
short `apply`↔`test` retry ring inside the iteration ring, and most nest a second, wider
`review-fix` ring around that. `legacy-tests` and `ci-repair` have no `apply` at all: the first
only ever writes tests, the second repairs CI directly through `ci-fix`.

Work closes into a commit whenever the graph re-enters the iteration loop's head — so any setup
work before the loop starts (reproducing a bug, say) is its own unit, numbered iteration 0, kept
out of iteration 1's diff. For the same reason the iteration has exactly one way in: its
**head** is the first node listed in the iteration loop (normally `identify`), and every edge that
enters the iteration from outside it — and `start`, when `start` is inside it — must target that
head. `geneseed loop check` refuses a graph that enters anywhere else.

**A node's re-entry budget is not each loop's `max` added up.** Every node inside one or more
inner loops gets a single shared counter: `1 + the largest max among the inner loops that contain
it`. A node in both a `max: 5` and a `max: 3` loop gets 6 re-entries total, not 8 — the loops don't
stack, the larger one wins and the `+1` is the node's own first run. A node inside no inner loop at
all gets exactly 1 — no re-entry — which is also why **every cycle inside an iteration must be a
named inner loop** in the graph JSON: `geneseed loop check` (and `loop init`, which runs the same
check) refuses a graph with an undeclared cycle inside an iteration, before a single node runs.

## Limits

- **No parallel nodes.** The graph runs one node at a time; there is no fan-out.
- **A per-install skill exclusion is invisible to the CLI** (see [Bricks and their origins](loop-bricks.md)) — the `loop` skill is
  responsible for skipping bricks it can't run, not the engine.

## Read on

- [Loop templates](loop-templates.md): the shipped graphs, and when to use each.
- [Bricks and their origins](loop-bricks.md): what a brick is, and where your own override the shipped ones.
- [Notes and rules](loop-notes.md): what survives an iteration, and what every brick must follow.
- [Risk, trust and validation levels](loop-risk.md): how a change is scored, and when it stops for you.
- [Human gates](loop-gates.md): the bricks that always wait for a person.
- [Contracts and ignored deletions](loop-contracts.md): the globs that raise or ignore risk.
- [LOOP.md, trailers and the loop branch](loop-branch.md): the state file, the commit trailers, and why merging always asks.
- [Loop actions](../reference/loop-actions.md): the `geneseed loop` commands.

## Not foreman mode

A loop and a [foreman-mode](foreman-mode.md) pipeline are both "hand work off and keep going," but
they solve different problems. A pipeline is a one-shot crew for a single task, uncommitted until
you accept it. A loop is a long-running, self-scoring state machine that commits each validated
iteration on its own branch as it goes, and only stops for a person when the risk crosses a
threshold.
