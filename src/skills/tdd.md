# {{SKILL}}: tdd

> {{DESC_TDD}}

**Trigger:** implementing a feature or fixing a bug whose behaviour can be expressed as a test — before writing implementation code.

## Procedure
1. Write one failing test that pins the next small slice of behaviour; be specific about the expected output. For a bug, the test reproduces it.
2. Run it and watch it fail for the RIGHT reason — a test that passes immediately proves nothing.
3. Write the minimum code to make it pass; add nothing the test doesn't demand ({{LAW}} II).
4. With the suite green, tidy up via the [refactor {{SKILL}}](refactor.md) — the tests are your safety net.
5. Repeat one slice at a time, committing each green cycle with the [commit {{SKILL}}](commit.md).

## Done when
- The behaviour is covered by tests written before the code, the suite is green, and each cycle was committed.

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
