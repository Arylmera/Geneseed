---
name: triage
description: Pick the lane that fits the work item, from the lanes the factory offers, and say why.
effect: read
agent: explorer
outcomes: bug, feature, deps, refactor, docs, fail
---
The stage hands you the work item's file as `carry` and the factory's lanes as `lanes`: each
outcome you may report, with the stage it leads to. Read the work item in full, then the code it
names. Pick the one outcome that fits: `bug` for a defect with a way to reproduce it, `feature`
for new behaviour, `deps` for a dependency to raise, `refactor` for a change of structure with no
change of behaviour, `docs` for a change to the documentation alone. Never report an outcome that
is not in `lanes`, and never edit any file.

Write a file in the OS temp directory, never inside the worktree: one paragraph on why the lane
fits and why the next-best one does not, then the work item copied in full, so the lane starts
from it. Report the outcome that names the lane, with that file's path. Report `fail` when no lane
fits the work item, or it mixes two kinds of work that need two runs — say which, in such a file,
and report its path.
