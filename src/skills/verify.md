# {{SKILL}}: verify

> Confirm work is actually done before claiming it — run the checks, read the output.

**Trigger:** about to say a task is done, fixed, or passing.

## Procedure
1. Find the project's Definition of Done (see [`laws/project.md`](../laws/project.md))
   — typically the test, lint, and build commands.
2. Run them. Read the actual output; do not assume (universal {{LAW}} III).
3. If anything fails, the task is not done — fix it or report it; do not claim
   success.
4. State what you ran and its result when you report completion.

## Done when
- The Definition-of-Done checks have been run and observed to pass.
