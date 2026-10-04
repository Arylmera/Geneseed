---
name: flake-check
description: Rerun the card's test until it proves stable — a retry or a sleep is not a fix.
effect: read
agent: tester
outcomes: stable, flaky
---
Rerun the card's test 20 times alone, then 20 with its suite, as `flake-repro` did (Maven: a
loop of `mvn test -Dtest=<Class>#<method>`, shuffled). Never edit any file.

Read this iteration's diff first. Polling on the awaited condition (Awaitility
`await().atMost(…).until(…)`, `waitFor`) in place of a fixed sleep is a fix; adding a sleep or
raising an existing timeout is not, and neither is a retry (`rerunFailingTestsCount`,
`@RetryingTest`, `jest.retryTimes`) — report `flaky` naming it, whatever the runs say.

Report `stable` only on 0 failures in all runs. Report `flaky` otherwise, with the failure count
and one failure's output in a file in the OS temp directory — report that file's path.
