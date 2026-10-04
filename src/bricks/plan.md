---
name: plan
description: Split the requirement into an ordered list of iterations before any code changes.
effect: read
agent: architect
outcomes: pass
---
Read the requirement and survey the code it touches. Split the work into an ordered list of
small iterations, each one sized to a single `identify` card — one testable change apiece.

Do not edit any code; this brick only plans it. Report `pass` with a card whose intent carries
the ordered list, one iteration per line:
{"intent": "<iteration 1>\n<iteration 2>\n...", "writeSet": [], "actions": []}
The card does not survive into `identify` on its own — write the same list to a file in the OS
temp directory (never inside the worktree) and report that file's path with the outcome, so it
is recorded into LOOP.md's notes.

If the requirement cannot be split — it is already one atomic change — say so in the intent and
let the loop proceed with a single iteration.
