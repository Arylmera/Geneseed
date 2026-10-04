---
name: characterize
description: Pin what legacy code does today with characterization tests, touching tests only.
effect: mutate
agent: tester
outcomes: pass, fail
---
For the card's change point (with no card, the code the requirement names), write tests that pin
what the code DOES today, not what it should do: assert a value you expect to be wrong, run it,
and copy the observed value in. Touch only test files — never production code.

Pin odd behaviour as it is and name it in the test's title; do not fix it here. If LOOP.md's notes
list surviving mutants for this card, add the assertions that kill them.

Report `pass` once the new tests run green against the unchanged code.
Report `fail` if the code cannot be put under test without breaking a dependency first — that is
a refactor in its own right — naming the dependency.
