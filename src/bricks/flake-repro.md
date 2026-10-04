---
name: flake-repro
description: Confirm which suspected tests are flaky by repeated runs, before anything is fixed.
effect: read
agent: tester
outcomes: flaky, stable, broken
---
Run each suspected test the requirement names 20 times (or the N it gives) alone, then again with
its own suite in a shuffled order where the runner allows — no code change, no retry option. For
Maven, loop `mvn test -Dtest=<Class>#<method>`; never `-Dsurefire.rerunFailingTestsCount`, which
hides the very failures you are counting. Never edit any file: leave `git status --porcelain` as
you found it. Write each test as `<test>: <failures>/<runs>` with one failure's output to a file
in the OS temp directory and report that file's path with the outcome.

Report `broken` if any test fails every run — that is a bug for `bugfix`, not a flake.
Report `flaky` if a test failed some runs, listing the confirmed ones. Report `stable` if none failed.
