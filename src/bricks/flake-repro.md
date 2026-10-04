---
name: flake-repro
description: Confirm which suspected tests are flaky by repeated runs, before anything is fixed.
effect: read
agent: tester
outcomes: flaky, stable, broken
---
Run each suspected test the requirement names 20 times (or the N it gives) alone, then 20 with
its suite in a shuffled order — no code change, no retry option. Maven: loop `mvn test
-Dtest=<Class>#<method>` (multi-module: add `-pl <module> -Dsurefire.failIfNoSpecifiedTests=false`),
shuffled with `-Dsurefire.runOrder=random` and, under JUnit 5,
`-Djunit.jupiter.testmethod.order.default=org.junit.jupiter.api.MethodOrderer$Random`. Never
`-Dsurefire.rerunFailingTestsCount`: it hides the failures you count. Never edit any file. Write
each test as `<test>: <failures>/<runs>` with one failure's output to a file in the OS temp
directory and report that file's path.

Report `broken` if any test fails every run — a bug for `bugfix`, not a flake. Report `flaky` if a
test failed some runs, listing the confirmed ones. Report `stable` if none failed.
