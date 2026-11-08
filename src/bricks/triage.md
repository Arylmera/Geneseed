---
name: triage
description: Pick the loop that fits the work item, from the loops the factory allows, and say why.
effect: read
agent: explorer
outcomes: pass, fail
---
The stage hands you the work item's file as `carry` and the factory's allowed loops as `loops`.
Read the work item in full, then the code it names. Pick the one loop from `loops` that fits: a
defect with a way to reproduce it is `bugfix`, new behaviour is `feature`, a dependency to raise
is `deps-upgrade`, a change of structure with no change of behaviour is `refactor`. Never pick a
loop that is not in `loops`, and never edit any file.

Write a file in the OS temp directory, never inside the worktree: the chosen loop's name alone
on its first line, then one paragraph on why it fits and why the next-best one does not, then
the work item copied in full, so the loop starts from it. Report `pass` with that file's path.
Report `fail` when no loop in `loops` fits the work item, or it mixes two kinds of work that
need two runs — say which, in such a file, and report its path.
