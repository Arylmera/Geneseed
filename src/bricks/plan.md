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
the ordered list, one iteration per line, so it lands in LOOP.md's notes for `identify` to work
through one at a time:
{"intent": "<iteration 1>\n<iteration 2>\n...", "writeSet": [], "actions": []}

If the requirement cannot be split — it is already one atomic change — say so in the intent and
let the loop proceed with a single iteration.
