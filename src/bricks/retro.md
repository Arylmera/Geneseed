---
name: retro
description: Write the factory run's report — what failed, what was reworked — and keep only a durable lesson in memory.
effect: read
agent: docs
outcomes: pass
---
Read `FACTORY.md` (stage history, cycle counters, reason, carry) and the notes of the run's loops.
A loop's notes leave with its `LOOP.md`, which its close commit removes; read each from git. Find
the base (`git merge-base HEAD origin/<default>`), list the commits that removed `LOOP.md`, newest
first: `git log --format=%H --diff-filter=D <merge-base>..HEAD -- LOOP.md`, and read each loop's
last `LOOP.md` from its parent: `git show <commit>^:LOOP.md`. A `LOOP.md` that was never
committed (a loop that made no commit) is gone: say so in the report. Then write the run report to `.geneseed/factory-runs/<slug>.md` at the worktree root, `<slug>`
being the branch name after `loop/factory-`. First run `git check-ignore -q <that path>`: when it
exits non-zero the path is not ignored, so write the report to the OS temp directory instead.
The report holds the work item, the PR URL, every stage with its outcome, each rework and its
reason, each held outcome the user let through with `ok` (above all a locked path `checks`
reported), and how the run ended (closed, or stopped and why).

Change nothing else: no tracked file, no commit. Only a lesson that will hold beyond this run —
a cause that will recur, a check this project lacks — goes into memory, one entry, under Persist
Insight; a fact about this run alone stays in the report. Report `pass` with the report's path.
