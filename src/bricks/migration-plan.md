---
name: migration-plan
description: Plan a breaking interface change as expand, migrate each consumer, contract — for the user to review.
effect: read
skill: migrate
gate: human
outcomes: pass, fail
---
Following the migrate skill, plan the change as ordered steps: expand (add the new shape beside
the old), migrate (one consumer or call-site group per step), contract (remove the old shape).
Every step must leave the system deployable and fit one `identify` card. Name the contract files
the expand and contract steps touch — API specs, schema migrations, event schemas. Never edit any
file.

The user reviews the plan before the loop continues: write the steps, one per line, then the
contract files, to a file in the OS temp directory and report that file's path with the outcome.
Those files belong in LOOP.md's `contracts` (`geneseed loop init --contracts <globs>`), so the
expand and contract steps stop for a human.

Report `pass` with the plan. Report `fail` if no backward-compatible path exists, naming what
forces the break.
