---
group: concepts
kind: "concept"
section: "Factories"
order: 24.5
title: "Factories"
link: {"hash":"#/docs/factory-actions","label":"The geneseed factory actions →"}
description: "What a factory is: one work item carried through bricks and whole loops to an open PR, with routes back when CI fails."
---
To run one, ask the agent in plain words ("Run the bug-report-to-fix factory on issue 412"). See
[Run a factory](../guides/run-a-factory.md#start-one-by-asking-the-agent).

A **factory** carries one work item (a request, a document or analysis, or a GitHub or GitLab
issue) through a graph of **stages** to an open pull request with green CI. A stage is a
[brick](loop-bricks.md) or a whole [loop](loops.md). `geneseed factory` is the state machine: it
decides every transition, cycle count and stop, and the `factory` [skill](skills.md) runs the stage
it is handed. **No stage merges.** A run ends at "PR open, CI green"; then the agent asks you once
whether to merge, and merges only on your yes.

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
failed. When two cycles share that first stage, the lap spends the smallest one that holds the
stage it came from: a failed `holdout` spends `holdout`, a red `merge-gate` spends `ci`. The commits made before stay on the branch. A run also stops after 60 stage transitions,
whatever its cycles say.

`geneseed factory check` refuses a factory before any stage runs: an unknown brick or loop, an
outcome with no edge, a `$close` nothing reaches, a cycle with no `max`, a cycle entered anywhere
but its first stage, or a route back that spends no cycle.

## Forks and lanes

A **fork** is where the work takes one way or another. It is a brick that declares **named
outcomes**, any outcome other than `pass`, `fail`, `error`, `none` or `needs-info`. `triage` is one: `bug`,
`feature`, `deps`, `refactor`, `docs` and `fail`. Each named outcome has its own edge to its own
stage, its **lane**, and the outcome the brick reports picks the lane. `geneseed factory next`
hands the fork its `lanes`: each outcome with the stage it leads to.

Not every factory runs a loop, and not every lane is one. A loop is the lane for work that
changes code, because the loop carries the test → fix → verify proof. A brick is the lane where a
loop adds nothing: in `issue-to-pr`, `docs` goes to the `docs-update` brick, which commits its own
change. Every lane joins the same path after it: `checks`, `review-panel` and `holdout`, then
`pr-open` and `merge-gate`.

A route back after a fork targets **`$lane`**: the stage the run's most recent fork chose. The
engine records it in `FACTORY.md` when the fork's outcome is recorded, and an edge to `$lane` goes
there. A cycle may start at `$lane` too, and each route back to it spends one lap, as any route
back does. `check` refuses `$lane` in a factory with no fork, or where some path reaches it before
any fork. In its other checks, `$lane` stands for every lane, so a graph that passes holds for the
lane any run takes.

A factory written before forks used a `loop:$triaged` stage and a `loops` list. Both are retired:
`check` names each with its replacement, and the doctor reports it. Nothing rewrites your file.

## One worktree, two state files

A run works on its own branch, `loop/factory-<slug>`, in its own worktree. `FACTORY.md` at the
root holds the run's state; while a loop stage runs, its `LOOP.md` sits beside it. The loop
engine treats `FACTORY.md` as bookkeeping, as it treats `LOOP.md`: it never scores it. A stage
that is not a loop records only on a clean worktree, and `factory record` refuses a dirty tree
after one. A brick that changes files, such as a `docs-update` lane, commits them first. The one
exception is the run's spec, `specs/<slug>/spec.md`: the `spec` stage writes it, and
it is committed once you approve it, before the first loop. Each run is listed in `factories.json` beside the loop registry, and each child loop's row
names the run it belongs to.

## The shipped factories

| Factory | Stages |
| --- | --- |
| `analysis-to-build` | `intake` → `spec` → `holdout-write` → `loop:feature` → `checks` → `review-panel` → `holdout` → `pr-open` → `merge-gate` → `retro` → `$close`. `spec` writes `specs/<slug>/spec.md` with an ordered task list, and you approve it at its gate. `loop:feature` then runs once per task, in order, in the same worktree; `checks` and `review-panel` run once, after the last task, and one PR opens at the end. A failed `checks`, `review-panel` or `holdout`, or a red `merge-gate`, sends the work back to `loop:feature` as one extra task, twice at most each (cycles `checks`, `review`, `holdout` and `ci`) |
| `bug-report-to-fix` | `intake` → `holdout-write` → `loop:bugfix` → `checks` → `review-panel` → `holdout` → `pr-open` → `merge-gate` → `retro` → `$close`. A failed `checks`, `review-panel` or `holdout`, or a red `merge-gate`, sends the fix back to `loop:bugfix`, twice at most each (cycles `checks`, `review`, `holdout` and `ci`) |
| `issue-to-pr` | `intake` → `holdout-write` → `triage`, a fork → one lane → `checks` → `review-panel` → `holdout` → `pr-open` → `merge-gate` → `retro` → `$close`. `triage` reports the lane: `bug` → `loop:bugfix`, `feature` → `loop:feature`, `deps` → `loop:deps-upgrade`, `refactor` → `loop:refactor`, `docs` → the `docs-update` brick. A failed `checks`, `review-panel` or `holdout`, or a red `merge-gate`, sends the work back to `$lane`, that same lane, twice at most each (cycles `checks`, `review`, `holdout` and `ci`) |

The bricks they add:

| Brick | Does | Outcomes |
| --- | --- | --- |
| `intake` | Reads the request, the document or the issue (`gh issue view`, `glab issue view`) and writes one clear work item with testable criteria, its `size` and its `areas`. `needs-info` holds for your answers to its questions (`gate: human`) | `pass`, `fail`, `needs-info` |
| `holdout-write` | Writes 3 to 8 prose scenarios (given / when / then) for the work item into the holdout folder, outside the worktree, and hands the work item on unchanged | `pass`, `fail` |
| `holdout` | Plays every scenario against the built change. `fail` carries one sentence per failed scenario, observed against expected; `error` when the diff touches the holdout folder or a scenario cannot be played | `pass`, `fail`, `error` |
| `checks` | Runs the done list as the base branch holds it, never the branch's copy. `error` holds when the diff touches a locked path; `none` holds with a proposed list when the base has none | `pass`, `fail`, `error`, `none` |
| `review-panel` | The `factory` skill seats a panel sized to the work item, each seat blind to how the change was built, and merges their verdicts | `pass`, `fail` |
| `triage` | A fork: reads the work item and reports the outcome that names its lane, with its reason. `fail` when no lane fits | `bug`, `feature`, `deps`, `refactor`, `docs`, `fail` |
| `pr-open` | Pushes the branch (the push asks you) and opens the PR, or updates the one already open | `pass`, `fail` |
| `merge-gate` | Waits for the PR's CI with a watch that returns by itself (each call under 10 minutes), 30 minutes at most. A repo with no CI reports `none`, and you decide | `pass`, `fail`, `none` |
| `retro` | Writes the run report to `.geneseed/factory-runs/<slug>.md`, and keeps only a lasting lesson in memory | `pass` |

`analysis-to-build` also uses the loops' own `spec` brick (`gate: human`), the one the
`spec-first-feature` loop starts with, and `issue-to-pr` the loops' `docs-update` brick as its
docs lane.

The run report is git-ignored by the `.geneseed/.gitignore` Geneseed seeds. Where no such file is
in the worktree, `retro` writes the report to the OS temp directory instead, so the tree stays
clean. The report lives in the worktree and goes when you remove it.

## Checks and the review panel

A loop proves its work with commands it can also edit. After the loop, two stages check it from
outside.

- **`checks` reads the done list from the base branch** (`.geneseed/done-checks.txt` there, read
  with `git show`), never from the branch, and runs it against the branch. A red command is a
  `fail`; a timeout or a missing tool is a `fail` marked `environment`, which the loop cannot fix.
- **Locked paths.** Only when every command passes, `checks` lists the paths the branch changed,
  a rename's old path included, and looks for a **locked path**: the done list,
  `.github/workflows/`, `.gitlab-ci.yml`, `.geneseed/factories/`, `.geneseed/loops/`,
  `.geneseed/bricks/`, plus each entry of the factory's `protected` list. A path is locked when it
  equals an entry, or lies under an entry that ends in `/`. That `error` holds for you: `ok` lets
  the change through and the run report names it, `no` stops. Tests are not locked; the review
  judges a weakened test.
- **No done list on the base**, or one with no command. `checks` proposes one, inferred from the
  base's manifests as the done gate infers checks, and holds; with no manifest it proposes nothing
  and says so. On your yes, the agent lands the file on the base branch from a temporary worktree
  (or you land it by PR when the branch is protected); once it is there, `ok` runs `checks`
  again, once.
- **`review-panel` seats agents by the work item's size and areas.** `intake` rates the `size`
  (`small`, `medium`, `large`) and the `areas` (`security`, `performance`, `ui`, `data`). The
  factory's `review.seats` maps them to agents; the shipped default is `reviewer` for small, plus
  `tester` for medium, plus `steward` for large, with `security` for security or data,
  `performance` for performance and `user-advocate` for ui. Each seat gets only the work item,
  the diff and the factory's rules, in its own context: never the loop's notes or the holdout
  scenarios, and it edits nothing. A failing verdict from `reviewer`, `security` or `tester`
  fails the stage; `performance`, `steward` and `user-advocate` advise. A seat may name only an
  agent Geneseed ships: `geneseed factory check` refuses any other, a project's own agents
  included.

A failed check or review sends the work back to the loop, twice at most each (cycles `checks` and
`review`).

## Holdout scenarios

A loop's tests are written by the same agent that writes the code, so they can share its
blind spots. A factory therefore keeps a second set of checks the developer never sees. After
`intake` (or `spec`), the `holdout-write` stage writes 3 to 8 scenarios in plain prose, each a
`Given` / `When` / `Then`, to `~/.config/geneseed/holdout/<slug>/` (under `$XDG_CONFIG_HOME` when
it is set): outside the worktree, so no commit, diff or loop note carries them. After the loop,
the `holdout` stage plays each scenario against the change as built and reports.

- **On a failure**, the work goes back to the loop with one sentence per failed scenario: what was
  observed against what was expected. Never the scenario's text. That lap spends the `holdout`
  cycle, twice at most.
- **On `error`**, the run stops: the diff touches the holdout folder, or a scenario cannot be
  played.
- **One folder per slug.** `holdout-write` reports `fail` when the folder already holds files from
  an earlier run with the same slug; clear it yourself, then run again.
- **Who sees them.** Both stages run as the `tester` agent. The `factory` skill never puts holdout
  content or the folder's path into a brief, a note or a carry.
- **No hook refuses a read of it**, on any host. A Claude Code read gate was built but is not
  shipped: it would run a hook process on every Read, Grep and Glob of every session (about 90 ms
  each on Windows) for a protection only a factory run uses. The folder is protected only by its place
  outside the worktree, by `holdout`'s `error`, and by the skill's rule. A shell command such as
  `cat` is not covered on any host.

## In the console

The console's **Factories** page (in the Build group, after Loops) draws each factory as a
graph: its stages top to bottom, a fork's lanes side by side, a `loop:` stage as a compact box
that names its loop over `whole loop`, each route back as a rail on the left with its cycle and
`max`, and `close` and `stop` as end caps.
Each factory shows how to start it: the request to give the agent, and the commands to start it
by hand, the worktree first and then `geneseed factory init`. Its **Active** tab lists every
registered run, with the current stage lit, the laps spent on each cycle and the child loop's
current step, written `at <node>` in the current stage's box. The page changes nothing in a run (its poll only drops finished runs older than 7 days from `factories.json`, as Loops does); you answer a run in the
agent's session.

## Your own factories

Factories load from three levels, as bricks and loop templates do, and a later level overrides
an earlier one by name: shipped, global (`~/.config/geneseed/factories/`), and project
(`<repo>/.geneseed/factories/`).

To compose or change one, use the `factory-forge` skill — ask it. It interviews you for the
stages, the routes back and their `max`, writes the file at project or global level and runs
`geneseed factory check` until it passes. When a stage needs a brick that does not exist, it
offers the `brick-forge` skill: that skill alone writes bricks.

## Read on

- [Run a factory](../guides/run-a-factory.md): how to start one, and what it asks you.
- [Loops](loops.md): what runs inside a `loop:` stage.
- [Human gates](loop-gates.md): the stages that wait for a person.
- [Factory actions](../reference/factory-actions.md): the `geneseed factory` commands.
