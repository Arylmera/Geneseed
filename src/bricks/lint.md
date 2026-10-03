---
name: lint
description: Run the project's linter alone, without the test suite.
effect: read
agent: tester
outcomes: pass, fail
---
Run this project's linter only — not the test suite, which is `test`'s job. Never edit any file;
this brick only observes.

Report `pass` if the linter exits clean.

Report `fail` otherwise, with the raw linter output (every violation, not a count or a summary)
so the next `apply` can act on the actual finding.
