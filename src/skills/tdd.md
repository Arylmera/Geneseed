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
