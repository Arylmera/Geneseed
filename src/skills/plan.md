# {{SKILL}}: plan

> {{DESC_PLAN}}

**Trigger:** a task with more than a couple of steps, or touching several files
(universal {{LAW}} XIV).

## Procedure
1. If a design or spec already exists (e.g. from the brainstorm {{SKILL}}), derive the
   plan from it; otherwise restate the goal in one line. Either way, confirm the actual
   starting state before designing the steps (universal {{LAW}} III — verify before
   designing).
2. Write a numbered plan to `WORKLOG.md` (or `plans/<task>.md`): ordered steps, each
   independently checkable. Group the steps into milestones — coherent chunks after
   which the work can be verified and reviewed.
3. Execute one step at a time. After each, update the worklog — mark it done, note
   the current step, the next step, and any blockers.
4. At each milestone, stop and verify before continuing (run the checks — see the
   verify {{SKILL}}); on a consequential or ambiguous direction, surface the result
   for review before pressing on.
5. If the plan proves wrong, revise the file *before* continuing. The file, not
   your memory, is the source of truth for where you are.
6. On finishing, clear or archive the worklog.

## Done when
- Every plan step is checked off, each milestone was verified, and the goal's
  done-condition is confirmed.

> The worklog is external memory: it lets a context-limited agent recover its
> place after the window fills, and lets the user correct course early. Consider
> git-ignoring `WORKLOG.md` if it should stay local to each developer.
