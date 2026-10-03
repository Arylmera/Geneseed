---
name: test
description: Run the suite and linter over this iteration's change.
effect: read
agent: tester
outcomes: pass, fail
---
Run this project's full test suite and its linter over the current change. Never edit any file —
this brick only observes; a fix belongs in `apply`, not here.

Report `pass` only if both exit clean.

Report `fail` otherwise, with the raw failures (not a paraphrase) so `apply` can act on the actual
error rather than your summary of it. Name every failing test and lint violation you saw.
