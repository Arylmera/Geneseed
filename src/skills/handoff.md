# {{SKILL}}: handoff

> {{DESC_HANDOFF}}

**Trigger:** the context window is filling, a session is ending mid-task, or you're passing work to another agent or developer.

## Procedure
1. Capture the state in the worklog (`WORKLOG.md` or the task's plan file): the goal, what's done, the step in progress, and the exact next step.
2. Record open decisions, dead ends already ruled out, blockers, and any irreversible changes already made ({{LAW}} XIV) — so the next agent neither re-derives nor repeats them.
3. Promote any durable fact or correction learned this session into {{MEMORY}} (§4), not just the worklog.
4. Point to the live artifacts: branch name, changed files, how to run the tests, and where any failure reproduces.
5. Put a one-line "resume here" pointer at the top so a fresh context picks up in a single read ({{LAW}} XV).
6. Verify it: re-read the worklog as a cold reader ({{LAW}} III) — goal, progress, next step, and blockers must be answerable from it alone. Fix what isn't.

## Done when
- A fresh agent can resume from the worklog alone — goal, progress, next step, and blockers are all written down.
