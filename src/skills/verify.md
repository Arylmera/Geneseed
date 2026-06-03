# {{SKILL}}: verify

> {{DESC_VERIFY}}

**Trigger:** about to say a task is done, fixed, or passing.

## Procedure
1. Find the project's Definition of Done — typically the test, lint, and build
   commands. It lives in the project's own docs (pointed at from `context.json`);
   if it is undefined, ask rather than assume.
2. Run them. Read the actual output; do not assume (universal {{LAW}} III).
3. If anything fails, the task is not done — fix it or report it; do not claim
   success.
4. State what you ran and its result when you report completion.

## Done when
- The Definition-of-Done checks have been run and observed to pass.
