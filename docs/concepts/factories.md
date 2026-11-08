---
group: concepts
kind: "concept"
section: "Factories"
order: 24.5
title: "Factories"
link: {"hash":"#/docs/factory-actions","label":"The geneseed factory actions →"}
description: "What a factory is: one work item carried through bricks and whole loops to an open PR, with routes back when CI fails."
---
To run one, see [Run a factory](../guides/run-a-factory.md).

A **factory** carries one work item (a request, a document or analysis, or a GitHub or GitLab
issue) through a graph of **stages** to an open pull request with green CI. A stage is a
[brick](loop-bricks.md) or a whole [loop](loops.md). `geneseed factory` is the state machine: it
decides every transition, cycle count and stop, and the `factory` [skill](skills.md) runs the stage
it is handed. **A run never merges.** It ends at "PR open, CI green", and the merge is yours.

> **You already know this:** a ticket moving across a board — triaged, worked, reviewed, shipped
> for review. A failed check sends the card back a column, but only so many times before someone
> has to look at it.

## Stages, and the routes back

A factory is the loop graph one level up. Each stage reports an outcome, and each outcome has
one edge: to the next stage, to `$close`, or to `$stop`. A `loop:<name>` stage runs a whole loop
in the same worktree and reports `pass` when that loop closed, `fail` when it stopped.

A failure may route back to an earlier stage: red CI at `merge-gate` sends the work back to the
loop that wrote it. Every such route sits inside a declared **cycle** with a `max` (5 at most).
Each lap back to the cycle's first stage spends one; past the `max`, the run stops. A route back
always starts a **fresh** loop: a new `LOOP.md`, whose first note is the reason the last lap
failed. The commits made before stay on the branch. A run also stops after 30 stage transitions,
whatever its cycles say.

`geneseed factory check` refuses a factory before any stage runs: an unknown brick or loop, an
outcome with no edge, a `$close` nothing reaches, a cycle with no `max`, a cycle entered anywhere
but its first stage, or a route back that spends no cycle.

## One worktree, two state files

A run works on its own branch, `loop/factory-<slug>`, in its own worktree. `FACTORY.md` at the
root holds the run's state; while a loop stage runs, its `LOOP.md` sits beside it. The loop
engine treats `FACTORY.md` as bookkeeping, as it treats `LOOP.md`: it never scores it. A stage
that is not a loop never changes the worktree, and `factory record` refuses a dirty tree after
one. Each run is listed in `factories.json` beside the loop registry, and each child loop's row
names the run it belongs to.

## The shipped factories

| Factory | Stages |
| --- | --- |
| `bug-report-to-fix` | `intake` → `loop:bugfix` → `pr-open` → `merge-gate` → `retro` → `$close`. A red `merge-gate` sends the fix back to `loop:bugfix`, twice at most (cycle `ci`) |
| `issue-to-pr` | `intake` → `triage` → `loop:$triaged` → `pr-open` → `merge-gate` → `retro` → `$close`. `triage` picks the loop from the factory's `loops`: `bugfix`, `feature`, `deps-upgrade` or `refactor`. A red `merge-gate` sends the work back to that same loop, twice at most (cycle `ci`) |

The bricks they add:

| Brick | Does | Outcomes |
| --- | --- | --- |
| `intake` | Reads the request, the document or the issue (`gh issue view`, `glab issue view`) and writes one clear work item with testable criteria | `pass`, `fail` |
| `triage` | Reads the work item and picks one loop from the factory's `loops`, with its reason. The engine refuses a loop outside that list. `fail` when none fits | `pass`, `fail` |
| `pr-open` | Pushes the branch (the push asks you) and opens the PR, or updates the one already open | `pass`, `fail` |
| `merge-gate` | Waits for the PR's CI with a watch that returns by itself (each call under 10 minutes), 30 minutes at most. A repo with no CI reports `none`, and you decide | `pass`, `fail`, `none` |
| `retro` | Writes the run report to `.geneseed/factory-runs/<slug>.md`, and keeps only a lasting lesson in memory | `pass` |

The run report is git-ignored by the `.geneseed/.gitignore` Geneseed seeds. Where no such file is
in the worktree, `retro` writes the report to the OS temp directory instead, so the tree stays
clean. The report lives in the worktree and goes when you remove it.

## In the console

The console's **Factories** page (in the Build group, after Loops) draws each factory as a
graph: its stages left to right, a `loop:` stage as a block that holds its loop's ring, each
route back as an arc above the row with its cycle and `max`, and `close` and `stop` as end caps.
Its **Active** tab lists every registered run, with the current stage lit, the laps spent on
each cycle and the child loop's current step. The page changes nothing in a run (its poll only drops finished runs older than 7 days from `factories.json`, as Loops does); you answer a run in the
agent's session.

## Your own factories

Factories load from three levels, as bricks and loop templates do, and a later level overrides
an earlier one by name: shipped, global (`~/.config/geneseed/factories/`), and project
(`<repo>/.geneseed/factories/`).

## Read on

- [Run a factory](../guides/run-a-factory.md): how to start one, and what it asks you.
- [Loops](loops.md): what runs inside a `loop:` stage.
- [Human gates](loop-gates.md): the stages that wait for a person.
- [Factory actions](../reference/factory-actions.md): the `geneseed factory` commands.
