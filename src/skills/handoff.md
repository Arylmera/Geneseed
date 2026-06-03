# {{SKILL}}: handoff

> {{DESC_HANDOFF}}

**Trigger:** the context window is filling, a session is ending mid-task, or you're passing work to another agent or developer.

## Procedure
1. Capture the state in the worklog (`WORKLOG.md` or the task's plan file): the goal, what's done, the step in progress, and the exact next step.
2. Record open decisions, dead ends already ruled out, and blockers — so the next agent doesn't re-derive them.
3. Promote any durable fact or correction learned this session into {{MEMORY}} (§4), not just the worklog.
4. Point to the live artifacts: branch name, changed files, how to run the tests, and where any failure reproduces.
5. Put a one-line "resume here" pointer at the top so a fresh context picks up in a single read ({{LAW}} XV).

## Done when
- A fresh agent can resume from the worklog alone — goal, progress, next step, and blockers are all written down.
