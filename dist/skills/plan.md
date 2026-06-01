# Skill: plan

> Write a plan to a file before executing a non-trivial task; track progress as you go.

**Trigger:** a task with more than a couple of steps, or touching several files
(universal Rule XIV).

## Procedure
1. Restate the goal in one line and confirm the actual starting state (universal
   Rule III — verify before designing).
2. Write a numbered plan to `WORKLOG.md` (or `plans/<task>.md`): ordered steps,
   each independently checkable.
3. Execute one step at a time. After each, update the worklog — mark it done, note
   the current step, the next step, and any blockers.
4. If the plan proves wrong, revise the file *before* continuing. The file, not
   your memory, is the source of truth for where you are.
5. On finishing, clear or archive the worklog.

## Done when
- Every plan step is checked off and the goal's done-condition is verified.

> The worklog is external memory: it lets a context-limited agent recover its
> place after the window fills, and lets the user correct course early. Consider
> git-ignoring `WORKLOG.md` if it should stay local to each developer.
