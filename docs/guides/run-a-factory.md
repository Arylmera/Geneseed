---
group: guides
order: 24.5
title: "Run a factory"
kind: "concept"
section: "Factories"
description: "Carry a bug report or an issue to an open PR with green CI: what you need, how to ask, and where it stops for you."
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
```

The agent then:

1. Creates a worktree on a new branch, `git worktree add ../<repo>-factory-<slug> -b loop/factory-<slug>`, and works from there. Your own checkout is not touched.
2. Runs `geneseed factory init --title … --requirement … --factory bug-report-to-fix --input <issue or text>`. This writes `FACTORY.md` at the worktree root and registers the run.
3. Steps the run: `intake` writes the work item, the `bugfix` loop fixes it commit by commit, `pr-open` opens the PR, `merge-gate` waits for CI, and `retro` writes the run report.

## Where it stops for you

| Moment | What you decide |
| --- | --- |
| A push | Every push that is not a loop's own commit asks you, `pr-open`'s included. |
| A loop gate | Anything the `bugfix` loop asks you, as in [While a loop runs](loop-running.md). |
| `merge-gate` reports `none` | The repo runs no CI on the PR: `ok` goes on to `retro`, `no` stops the run. |
| The close commit | The last commit removes `FACTORY.md`, and it asks. |

Red CI does not stop for you: it sends the work back to the `bugfix` loop with the failing checks as its first note, twice at most. A third red result stops the run.

## When it ends

On success the agent reports the PR, every stage with its outcome, each rework and why, and the run report at `.geneseed/factory-runs/<slug>.md`. On a stop it reports the reason and still writes the run report; the branch and `FACTORY.md` stay as they were, so you can see where it stopped. After a crash, ask the agent to resume: it runs `geneseed factory next` in the worktree.

---

**Next:** [Factories](../concepts/factories.md)
