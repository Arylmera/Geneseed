# {{SKILL}}: develop

> {{DESC_DEVELOP}}

**Trigger:** implementing a feature, fixing a bug, or changing code behaviour in a
repo that has (or should have) a test suite — before writing implementation code.
Covers both the test-first cycle (red → green → refactor) and the cover-alongside
case where the seam is only known once the change is made.

## Procedure
1. Orient on the project's own documentation for what you are about to touch
   ({{DOCTRINE}} process 4), and confirm the actual starting state — the suite runs,
   the baseline is green ({{LAW}} III). A red baseline is a [debug {{SKILL}}](debug.md)
   task first, not something to build on.
2. Agree the seams: name the public interfaces the tests will target and confirm
   them with the user when they are not obvious — no test is written at an
   unconfirmed seam. Testing effort belongs on critical paths and complex logic,
   not every edge.
3. Pick the next **smallest slice** that advances the task ({{DOCTRINE}} craft 6), then
   cover it:
   - *Seam known up front* — test-first. Write ONE failing test that pins the slice,
     specific about the expected output (for a bug, the test reproduces it). Run it
     and watch it fail **for the right reason** — a test that passes immediately, or
     fails on a typo, proves nothing.
   - *Seam only clear once the change exists* — write the covering test alongside the
     change ({{DOCTRINE}} rigor 3), then break the implementation on purpose once to
     see the test go red before trusting it.
4. Write the minimum code that makes it pass; add nothing the test doesn't demand.
5. Run the *affected* tests and read the output ({{LAW}} III); on failure fix the
   cause, never mask it ({{LAW}} VIII). Dispatch the
   [tester {{AGENT}}](../{{DIR_AGENTS}}/tester.md) for heavier or unfamiliar coverage,
   or when the blast radius is unclear.
6. With the slice green, tidy through the [refactor {{SKILL}}](refactor.md) — the tests
   are the safety net — then commit the slice through the [commit {{SKILL}}](commit.md)
   ({{DOCTRINE}} process 5). Loop from step 3, one slice at a time.
7. **Exit.** When the last slice is in: run the whole affected suite once more, state
   what was run and its result, and hand over — to the [ship {{SKILL}}](ship.md) when
   the change is ready for a PR, or to the [handoff {{SKILL}}](handoff.md) if the
   session ends mid-task. Leave no slice uncommitted and no test you could not make
   fail.

## Done when
- Every behaviour changed is covered by a test written this session that was seen
  to fail before it passed, the affected suite is green with its output shown, each
  slice was committed on its own, and the work has been handed to ship or handoff.

<!-- INCLUDE: skills/_self-improvement.md -->
