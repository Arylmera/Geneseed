---
name: baseline-green
description: Confirm the suite and linter are green before the loop changes anything.
effect: read
agent: tester
outcomes: pass, fail
---
Run this project's full test suite and its linter, unchanged — no fix, no skip, no retry with
different flags. This is the loop's starting line, not a chance to tidy up first.

Report `pass` only if every test and the linter both exit clean. Include the raw command output
in your report either way, so a `fail` carries the actual failure rather than a summary of it.

Report `fail` on the first red suite or linter run, and stop there: a loop that starts on a red
baseline cannot tell its own changes apart from pre-existing breakage.

Never edit, create or delete any file: this brick only reads.
