# {{SKILL}}: develop

> {{DESC_DEVELOP}}

**Trigger:** implementing a feature, fixing a bug, or changing code behaviour in a repo that has (or should have) a test suite.

## Procedure
1. Orient on the project's own documentation for what you are about to touch ({{LAW}} XVII).
2. Make the smallest change that advances the task ({{LAW}} XXV).
3. Cover the behaviour — test-first via the [tdd {{SKILL}}](tdd.md) where the target is known up front; otherwise write the covering test alongside the change ({{LAW}} XXXV).
4. Run the *affected* tests and read the output ({{LAW}} III); on failure, fix the cause, do not mask it ({{LAW}} XXIV).
5. Tidy the green code via the [refactor {{SKILL}}](refactor.md) — the tests are your safety net.
6. Commit the green slice via the [commit {{SKILL}}](commit.md) ({{LAW}} XX). Loop one slice at a time; dispatch the [tester {{AGENT}}](../{{DIR_AGENTS}}/tester.md) for heavier or unfamiliar coverage.

## Done when
- The behaviour changed is covered by tests written this session, the affected suite is green with its output shown, and each slice was committed.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
