# {{SKILL}}: refactor

> {{DESC_REFACTOR}}

**Trigger:** improving the structure of working code — extract, rename, inline, split, dedupe — without changing what it does.

## Procedure
1. Confirm a green baseline first: the relevant tests pass before you touch anything. No tests cover it? Add a characterisation test, or stop and say so.
2. Name the single move you're making (extract function, rename, inline, split module…) and its scope. One move at a time.
3. Make only that change — no behaviour changes and no new features riding along ({{LAW}} XV keeps the step focused).
4. Re-run the same tests: behaviour must be identical. If they go red, revert and reduce the step.
5. Commit the refactor on its own with the [commit {{SKILL}}](commit.md), separate from behavioural changes, so it's easy to review and revert.

## Done when
- Structure is improved, observable behaviour is unchanged, tests are green, and the refactor is committed by itself.
