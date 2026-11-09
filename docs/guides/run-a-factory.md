---
group: guides
order: 24.5
title: "Run a factory"
kind: "concept"
section: "Factories"
description: "Carry a bug report, an issue or an analysis to an open PR with green CI: what you need, how to ask, and where it stops for you."
---
A **factory** carries one work item to an open pull request with green CI. Each stage is a brick or a whole loop, and a red CI run sends the work back to the loop, a bounded number of times. You ask in plain words. The agent drives `geneseed factory`, which decides every step. No stage merges: at the end the agent asks you once whether to merge, and merges only on your yes.

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

## Start one by asking the agent

Name the factory and the work item in plain words, in a session in your repo:

```text
Run the bug-report-to-fix factory on https://github.com/acme/shop/issues/412
Take this bug report through bug-report-to-fix: totals round the wrong way on refunds
Run issue-to-pr on #42
Take issue 418 through the issue-to-pr factory
Take this analysis through analysis-to-build: docs/analysis/export-csv.md
Run the analysis-to-build factory on this request: add CSV export to the report page
```

On Claude Code, `/factory` with the same words is the explicit form: it loads the `factory`
skill directly. The console's **Factories** page shows the request for each factory, ready to copy.

The agent then:

1. Creates a worktree on a new branch, `git worktree add ../<repo>-factory-<slug> -b loop/factory-<slug>`, and works from there. Your own checkout is not touched. The slug never holds the word `git`, `commit` or `push`: `factory init` refuses it.
2. Runs `geneseed factory init --title … --requirement … --factory bug-report-to-fix --input <issue or text>`. This writes `FACTORY.md` at the worktree root and registers the run.
3. Steps the run: `intake` writes the work item, `holdout-write` writes the holdout scenarios outside the worktree, the `bugfix` loop fixes it commit by commit, `checks` runs the base branch's done list against the fix, `review-panel` has a panel of agents review it, `holdout` plays the scenarios against the fix, `pr-open` opens the PR, `merge-gate` waits for CI, and `retro` writes the run report. In `issue-to-pr`, a `triage` stage comes after `holdout-write` and picks the lane: the `bugfix`, `feature`, `deps-upgrade` or `refactor` loop, or the `docs-update` brick for a docs-only change. A failed check, review or scenario, or red CI, then sends the work back to that lane.

The holdout scenarios are checks the developer never sees: see [Holdout scenarios](../concepts/factories.md#holdout-scenarios). You can read them yourself in `~/.config/geneseed/holdout/<slug>/`; never paste them into the chat while the run is going, or the developer may see them.

## Start one by hand

Create the worktree first, then register the run in it. Never run `init` in your own checkout:
the run then works on your current branch. Keep the three commands as one `&&` chain and
replace every placeholder: if one command fails, the next ones do not run. Pick a slug without the
word `git`, `commit` or `push`: `factory init` refuses it.

```bash
git worktree add ../<repo>-factory-<slug> -b loop/factory-<slug> && cd ../<repo>-factory-<slug> && geneseed factory init --factory <name> --title "<title>" --requirement "<requirement>" --input "<issue URL, file path or pasted text>"
```

`init` alone runs nothing. It writes `FACTORY.md` and registers the run. An agent drives the run
from there with `geneseed factory next` and `geneseed factory record`: open a session in the
worktree and ask it to resume the run.

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
4. After the last task, `checks` and `review-panel` run once, `holdout` plays the scenarios,
   `pr-open` opens one PR for all of them, and `merge-gate` waits for CI.
5. A failed scenario sends the work back to the `feature` loop as one extra task, with one
   sentence per failure (observed against expected) as its first note. Red CI does the same, with
   the failing checks as the note: "make CI green". Each is twice at most; a third failure stops
   the run.

## Where it stops for you

| Moment | What you decide |
| --- | --- |
| `intake` reports `needs-info` | The work item leaves a question only you can answer. The agent shows its numbered questions, each with the assumption it would make. Answer them (`amend`, three times at most), say `ok` to go on with the assumptions, or `no` to stop. |
| `checks` reports `error` | Every check passed, but the branch changed a locked path: the done list, CI config, or a factory, loop or brick. `ok` lets it through (the run report names it), `no` stops. Or the finding starts `environment:`: the fetch failed, no default branch was found, or a check timed out or its tool is missing. The loop cannot fix that: fix the environment and answer `amend` to run the checks again, or `no` to stop; `ok` goes on without them. |
| `checks` reports `none` | The base branch has no done list, or an empty one. The agent shows the one it proposes (or says no manifest gave one). On your yes it commits the file in a temporary worktree on its own branch, `geneseed/done-list-<slug>`, pushes that branch and opens a PR to the base branch (each step asks). You merge that PR. Once the file is on the base, `ok` runs the checks again. |
| The `spec` gate (`analysis-to-build`) | The task list: `ok` starts the first task, `amend` revises the spec, `no` stops the run. The spec commit after your `ok` asks too. |
| A push | Every push that is not a loop's own commit asks you, `pr-open`'s included. |
| A loop gate | Anything the `bugfix` loop asks you, as in [While a loop runs](loop-running.md). |
| `merge-gate` reports `none` | The repo runs no CI on the PR: `ok` goes on to `retro`, `no` stops the run. Or the finding starts `environment:`: CI was still pending after 30 minutes, or `gh`/`glab` is missing or failed. `amend` waits again (after you fix the tool), `ok` goes on to `retro` without a green verdict (the close step reads CI once more, and proposes the merge only when it is green), `no` stops. |
| A `geneseed factory record` line asks | The git gate asks on any command line that holds the word `git` and the word `commit` or `push`. A record line starts with `git status`, so a spec path, a finding's path or an outcome name with `commit` or `push` in it makes the gate ask. On a record line this is a false alarm: answer yes. |
| The close commit | The last commit removes `FACTORY.md`, and it asks. Its push runs CI again: the agent reads the checks once more and reports the final state. A run with no loop (the `docs` lane) never committed `FACTORY.md`: the agent deletes the file, there is no close commit, and the final state is the one `merge-gate` read. |
| The merge proposal | Only when that final CI state is green: the agent shows the PR, the CI state and each review seat's verdict, and asks once whether to merge. Only on your explicit yes in chat does it squash-merge (`gh pr merge --squash`); no Geneseed gate asks before that command, so your answer is the only guard. Otherwise the PR stays open. It never turns on auto-merge. |

Red CI does not stop for you: it sends the work back to the run's loop (`bugfix`, or the lane `triage` chose) with the failing checks as its first note, twice at most. A third red result stops the run. A failed holdout scenario works the same way, with its own count of two, and so do a failed `checks` and a failed `review-panel`. A holdout `error` stops the run: the diff touched the holdout folder, or a scenario could not be played.

## When it ends

On success the agent reports the PR (merged on your yes, or open), every stage with its outcome, each rework and why, and the run report at `.geneseed/factory-runs/<slug>.md`. On a stop it reports the reason and still writes the run report; the branch and `FACTORY.md` stay as they were, so you can see where it stopped. After a crash, ask the agent to resume: it runs `geneseed factory next` in the worktree.

---

**Next:** [Factories](../concepts/factories.md)
