---
group: guides
order: 24.5
title: "Run a factory"
kind: "concept"
section: "Factories"
description: "Carry a bug report, an issue or an analysis to an open PR with green CI: what you need, how to ask, and where it stops for you."
---
A **factory** carries one work item to an open pull request with green CI. Each stage is a brick or a whole loop, and a red CI run sends the work back to the loop, a bounded number of times. You ask in plain words. The agent drives `geneseed factory`, which decides every step. The run never merges: the PR is yours to review and merge.

This page is the how-to. For how the engine works (stages, cycles, state files), see [Factories](../concepts/factories.md).

## Before you start

| You need | Why |
| --- | --- |
| An install that carries the `factory` and `loop` skills | The `factory` skill talks to `geneseed factory`, and runs each loop stage through the `loop` skill. After upgrading Geneseed, run `geneseed rebuild-all`. |
| A git repository with a remote named `origin` | Every loop iteration pushes to `loop/factory-<slug>`, and `pr-open` opens the PR from that branch. |
| The `gh` CLI (GitHub) or `glab` (GitLab), signed in | `intake` reads an issue with it, `pr-open` opens the PR, `merge-gate` reads the checks. |
| CI that runs on pull requests | `merge-gate` waits for it. With no CI, it reports `none` and asks you whether the run goes on. |
| A test command the agent can run | The `bugfix` loop inside the factory needs it, as any loop does. |

See the factories your repo can run:

```bash
geneseed factory list
geneseed factory check
```

## Start a run

```text
run the bug-report-to-fix factory on issue 412
take this bug report through the factory: totals round the wrong way on refunds
run the issue-to-pr factory on issue 418
```

The agent then:

1. Creates a worktree on a new branch, `git worktree add ../<repo>-factory-<slug> -b loop/factory-<slug>`, and works from there. Your own checkout is not touched.
2. Runs `geneseed factory init --title … --requirement … --factory bug-report-to-fix --input <issue or text>`. This writes `FACTORY.md` at the worktree root and registers the run.
3. Steps the run: `intake` writes the work item, `holdout-write` writes the holdout scenarios outside the worktree, the `bugfix` loop fixes it commit by commit, `holdout` plays the scenarios against the fix, `pr-open` opens the PR, `merge-gate` waits for CI, and `retro` writes the run report. In `issue-to-pr`, a `triage` stage comes after `holdout-write` and picks the lane: the `bugfix`, `feature`, `deps-upgrade` or `refactor` loop, or the `docs-update` brick for a docs-only change. A failed scenario or red CI then sends the work back to that lane.

The holdout scenarios are checks the developer never sees: see [Holdout scenarios](../concepts/factories.md#holdout-scenarios). You can read them yourself in `~/.config/geneseed/holdout/<slug>/`; never paste them into the chat while the run is going, or the developer may see them.

## Build from an analysis

`analysis-to-build` takes a larger piece of work: a design document, an analysis pasted into the
chat, or a plain request. It splits the work into tasks that you approve, then builds them one by
one in the same worktree, and opens one PR at the end.

```text
run the analysis-to-build factory on docs/analysis/export-csv.md
```

1. `intake` writes the work item from the document.
2. `spec` writes `specs/<slug>/spec.md`: the scope, acceptance criteria in EARS form, and an
   ordered task list (20 tasks at most). The run then stops for you. Read the spec and answer
   `ok`, `no`, or `amend` with your corrections; an amend rewrites the spec.
3. After your `ok`, the agent commits the spec (the commit asks you), `holdout-write` writes the
   holdout scenarios from it, and the agent runs the `feature` loop once per task, in order.
   `geneseed factory next` names each one as `task <i>/<n>`.
4. After the last task, `holdout` plays the scenarios, `pr-open` opens one PR for all of them,
   and `merge-gate` waits for CI.
5. A failed scenario sends the work back to the `feature` loop as one extra task, with one
   sentence per failure (observed against expected) as its first note. Red CI does the same, with
   the failing checks as the note: "make CI green". Each is twice at most; a third failure stops
   the run.

## Where it stops for you

| Moment | What you decide |
| --- | --- |
| The `spec` gate (`analysis-to-build`) | The task list: `ok` starts the first task, `amend` revises the spec, `no` stops the run. The spec commit after your `ok` asks too. |
| A push | Every push that is not a loop's own commit asks you, `pr-open`'s included. |
| A loop gate | Anything the `bugfix` loop asks you, as in [While a loop runs](loop-running.md). |
| `merge-gate` reports `none` | The repo runs no CI on the PR: `ok` goes on to `retro`, `no` stops the run. |
| The close commit | The last commit removes `FACTORY.md`, and it asks. Its push runs CI again: the agent reads the checks once more and reports the final state. |

Red CI does not stop for you: it sends the work back to the run's loop (`bugfix`, or the lane `triage` chose) with the failing checks as its first note, twice at most. A third red result stops the run. A failed holdout scenario works the same way, with its own count of two. A holdout `error` stops the run: the diff touched the holdout folder, or a scenario could not be played.

## When it ends

On success the agent reports the PR, every stage with its outcome, each rework and why, and the run report at `.geneseed/factory-runs/<slug>.md`. On a stop it reports the reason and still writes the run report; the branch and `FACTORY.md` stay as they were, so you can see where it stopped. After a crash, ask the agent to resume: it runs `geneseed factory next` in the worktree.

---

**Next:** [Factories](../concepts/factories.md)
