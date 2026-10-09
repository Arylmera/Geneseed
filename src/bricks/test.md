---
name: test
description: Run the project's checks over this iteration's change, in order, and report every finding.
effect: read
agent: tester
outcomes: pass, fail, error
---
Run this project's checks over the current change, in this order. Never edit any file — this
brick only observes; a fix belongs in `apply`, not here.

1. **Gate** — the build or compile step. If it fails, mark every check below `SKIPPED (gate
   failed)` and report.
2. **Focused checks** — the linter and the tests the change can reach. Run every one even after a
   failure: they check independent properties, and each repair must see every finding at once.
3. **Full suite** — only when everything above passed; otherwise `SKIPPED (an earlier check failed)`.

List every check with `PASS`, `FAIL`, `ERROR` or `SKIPPED (reason)` — one that did not run is
never left out, and silence is never a pass. Write each failure as four lines: the check's
purpose, the property it guards, a one-line diagnostic (not the raw log), and the command that
reruns it alone. Keep full logs in a file, and write the list to the note file.

Report `pass` only if every check passed. Report `error` if a check crashed or could not be run —
no test runner, a missing tool, evidence never wired: that is a stop for a human, not a repair.
Report `fail` otherwise.
