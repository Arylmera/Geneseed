# {{SKILL}}: factory

> {{DESC_FACTORY}}

**Trigger:** the user names a factory (`analysis-to-build`, `bug-report-to-fix`, `issue-to-pr`),
or asks to carry an issue, request or document to a PR with green CI.

## What it is

`geneseed factory` is a state machine kept in `FACTORY.md` at the worktree's root. A stage is a
brick or a whole loop; the engine decides every transition, cycle count and stop, and you run the
stage it hands you and report the outcome. Every action prints one JSON object: act on its keys,
never on your own reading of the graph. The run ends at an open PR with green CI. **The merge is
never part of a run.**

**Holdout rule.** The `holdout-write` stage writes scenarios the developer never sees, and the
`holdout` stage plays them before the PR. Both run as the `tester` {{AGENT}}, never as the
developer and never inline. Never put holdout content (anything under `~/.config/geneseed/holdout/`)
into any brief, prompt, note or `--carry` you hand on; never name that folder to a developer or a
loop; never read it on a developer's behalf. Record `holdout-write`'s pass with the `--carry` it
received, unchanged, and a `holdout` fail with the one-sentence file it reported. No hook refuses a
read of the folder on any host: the folder is protected only by its place outside the worktree, by `holdout`'s `error`
when the diff touches it, and by this rule.

## Setup

1. Pick a short kebab-case `<slug>` from the work item. Create the run's worktree:
   `git worktree add ../<repo>-factory-<slug> -b loop/factory-<slug>`, then make it the session's
   working directory with its own command. Every later command runs there as written below: no
   `cd` prefix, no `git -C`. Several runs may share a repo, each in its own worktree.
2. Use the factory the user names, else `geneseed factory list` and pick the one whose
   description fits; confirm the pick with the user when two fit. None fits → the `factory-forge` {{SKILL}}.
3. `geneseed factory init --title "<title>" --requirement "<the user's ask, in their words>" --factory <name> --input "<issue URL, file path or pasted text>"`.
   A refused factory prints `problems`: report them, never edit the graph to get past them.

## The cycle

Repeat `geneseed factory next` and act on its JSON:

- **`{stage, prompt, outcomes}`** — a brick stage. Dispatch its `agent` (or follow its `skill`)
  with the `prompt`, the `requirement`, the `input`, the `carry` and the factory's `rules`. Then:
  `git status --porcelain --untracked-files=all | geneseed factory record --outcome <outcome> --carry "<the file path the stage reported>"`.
  The `--carry` is how the next stage gets this one's finding. Always use that porcelain form:
  plain `--porcelain` folds a new directory into one line, which the engine refuses.
  A fork stage (such as `triage`) also gets `lanes`: each outcome it may report, with the stage
  it leads to. Record the outcome it reported (`--outcome docs`): that outcome names the lane,
  and a later route back to `$lane` returns to it.
  A brick stage with `effect: mutate` (a `docs-update` lane) commits what it changed before the
  record: `git add <the files it named>`, then `git commit -m "factory(<slug>): <stage>"`. The
  engine refuses a dirty tree after any stage outside a loop.
  The `spec` stage writes `specs/<slug>/spec.md` (the run's slug; a gate amend reaches it as the
  `carry`, not as a LOOP.md note) and reports with
  `git status --porcelain --untracked-files=all | geneseed factory record --outcome <outcome> --spec specs/<slug>/spec.md --carry <its finding file>`, so the gate shows the user what to review.
  Its gate holds for the user's review of the task list. After `decide --verdict ok`, commit the
  spec before the first loop: `git add specs/<slug>/spec.md`, then
  `git commit -m "factory(<slug>): spec"` (it asks). An uncommitted spec stops the loop's first
  read brick; the engine exempts it only until then.
- **`{stage, loop, notes}`** — a loop stage: see *Loop stages*.
- **`{awaiting}`** — a `gate: human` stage holds. Show the user the `stage`, the `outcome` it
  reported and the file its `note` names, then **end the run** and wait. On their answer:
  `geneseed factory decide --verdict ok|no|amend --note "<their words>"` — `ok` follows the
  reported outcome's edge, `no` stops, `amend` re-runs the stage with their note — and continue.
- **`{terminal: "$close"}`** or **`{terminal: "$stop"}`** — see *The end*.
- A `record` or `decide` result (`{stage}`, `{awaiting}`, `{stopped}`) — call `next` again.
- **`{error}`** — read it; it names the step you skipped or the evidence `record` lacks. Do that
  step. Never edit the state block in `FACTORY.md` to get past it.

## Loop stages

4. Call `next` before every loop, each task of a spec included: it records the launch that
   `record` later checks. When it refuses a `LOOP.md` left by the previous loop, remove it:
   `git rm -f LOOP.md` when git tracks it, else delete the file (a loop that made no commit
   leaves it untracked). Commit only when `git status` then shows the removal:
   `git commit -m "factory(<slug>): clear the previous loop"` (it asks). Then `next` again.
   A loop that ended `done` may instead be recorded `pass` while its `LOOP.md` is still there.
5. Start the loop in this same worktree:
   `geneseed loop init --title "<title>" --requirement "<requirement, plus the task when next gave one>" --graph <loop> --preset {{TRUST}} --factory <slug> --note-file <notes[0]>`
   where the task is item `task.index` under the spec's Tasks heading, written as
   "task <index>/<count>: <its text>". When `task.extra` is set, the last task has passed and a
   later stage sent the work back: the task is "make CI green" (or, for another stage, make it
   pass), and `notes[0]` says why. Use `--note-file <notes[0]>`
   when `notes[0]` is the path of a stage's finding file (the usual carry), so the loop gets the
   finding, not its path; `--note "<notes[0]>"` when it is plain text; neither when `notes` is
   empty. A loop
   re-entered after a failure is a fresh loop: the reason arrives as its note.
6. Follow the `loop` {{SKILL}} from *The cycle* through *The end*, skipping its Setup: the
   worktree is this one, and its `loop/<slug>` is `loop/factory-<slug>` here, so every loop push
   is `git push -u origin HEAD:loop/factory-<slug>`. Skip its final report too: the run goes on.
7. When the loop reaches `$close` and its close commit has removed `LOOP.md`:
   `git status --porcelain --untracked-files=all | geneseed factory record --outcome pass`.
   When it reaches `$stop`, leave its `LOOP.md` in place:
   `git status --porcelain --untracked-files=all | geneseed factory record --outcome fail --carry "<the stop reason>"`.

## The end

8. On `$close`: the `retro` stage has written the run report. Close the run with
   `git rm -f FACTORY.md`, then `git commit -m "factory(<slug>): close"` and
   `git push -u origin HEAD:loop/factory-<slug>`. The gate asks: that ask is the user's consent.
   The push re-runs CI on the PR, after `merge-gate` saw it green. Read the PR's checks again
   once, with the bounded wait the `merge-gate` brick names (30 minutes at most), and add the
   final state (green, red with the failing checks, or still pending at the bound) to the run
   report. A red result is reported, never reworked: the run has closed.
9. On `$stop`: the engine hands out no stage after a stop, so have the `docs` {{AGENT}} write the
   run report the `retro` brick would: the stop `reason` first, then the work item, the PR URL if
   any, every stage with its outcome and each rework with its reason, read from `FACTORY.md` and
   the loops' notes. It goes to `.geneseed/factory-runs/<slug>.md`, or to the OS temp directory
   when `git check-ignore -q <that path>` exits non-zero. No tracked file changes, no commit; only
   a lesson that holds beyond this run goes into memory, one entry. Leave the branch and
   `FACTORY.md` as they are.
10. Report: the PR URL, the final CI state after the close commit, the stages with their outcomes from `summary.history`, every rework and
    its reason, the run report's path, and the branch. **Never merge.**

## Resume

After a crash or an answered `awaiting`, from the worktree: `geneseed factory next`. When it
says a loop still runs, resume that loop first with `geneseed loop next` (the `loop`
{{SKILL}}'s *Resume*). The state is `FACTORY.md`, the child `LOOP.md` and the branch.

## Done when

- `$close` is reported with the PR open, `FACTORY.md` removed, and the CI state after that
  removal read and reported; or `$stop` is
  reported with its reason and the run report. In both cases nothing was merged.

<!-- INCLUDE: skills/_self-improvement.md -->
