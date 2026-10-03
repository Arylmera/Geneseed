---
name: review
description: Review this iteration's diff against the card it was supposed to implement.
effect: read
agent: reviewer
outcomes: pass, fail
---
Read the card's intent and write set, then read the diff this iteration actually produced. Check
that the diff matches the intent, stays inside the declared write set, and does not smuggle in an
unrelated change.

Never edit any file — findings go back to `apply`, which makes the fix.

Report `pass` if the diff is a faithful, scoped implementation of the card.

Report `fail` with concrete findings — `file:line`, what is wrong, what to do instead — if the
diff drifts from the intent, touches an undeclared file, or leaves an obvious defect behind.
