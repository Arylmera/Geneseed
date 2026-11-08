---
name: retro
description: Write the factory run's report — what failed, what was reworked — and keep only a durable lesson in memory.
effect: read
agent: docs
outcomes: pass
---
Read `FACTORY.md` (stage history, cycle counters, reason, carry) and the notes of the run's loops,
then write the run report to `.geneseed/factory-runs/<slug>.md` at the worktree root, `<slug>`
being the branch name after `loop/factory-`. First run `git check-ignore -q <that path>`: when it
exits non-zero the path is not ignored, so write the report to the OS temp directory instead.
The report holds the work item, the PR URL, every stage with its outcome, each rework and its
reason, and how the run ended (closed, or stopped and why).

Change nothing else: no tracked file, no commit. Only a lesson that will hold beyond this run —
a cause that will recur, a check this project lacks — goes into memory, one entry, under Persist
Insight; a fact about this run alone stays in the report. Report `pass` with the report's path.
