---
name: flake-check
description: Rerun the card's test until it proves stable — a retry or a sleep is not a fix.
effect: read
agent: tester
outcomes: stable, flaky
---
Rerun the card's test 20 times (or the N the requirement gives), alone and with its own suite,
as `flake-repro` did (Maven: a loop of `mvn test -Dtest=<Class>#<method>`). Never edit any file.

Read this iteration's diff first: a retry (`rerunFailingTestsCount`, `@RetryingTest`,
`jest.retryTimes`), an added sleep or a longer timeout hides the race instead of fixing it — report
`flaky` naming it, whatever the runs say.

Report `stable` only on 0 failures in N runs. Report `flaky` otherwise, with the failure count and
one failure's output in a file in the OS temp directory — report that file's path.
