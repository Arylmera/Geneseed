---
name: red-test
description: Write the failing test for the card's intent before any production code changes.
effect: mutate
agent: tester
outcomes: red, green, untestable
---
Write the smallest test that expresses the card's intent at its seam, touching only the test
files in the card's `writeSet` — never production code; making it pass is `apply`'s job. Run it.

Report `red` if it fails FOR THE REASON the intent states — not an import error, a typo, or a
broken fixture in the test itself.
Report `green` if it already passes: the behaviour exists, so keep the test as coverage.
Report `untestable` if no seam lets a test reach the behaviour without changing production code
first, naming what blocks it. If the card's `writeSet` names no test file, report `untestable`
and say so.
