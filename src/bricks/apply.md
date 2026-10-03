---
name: apply
description: Implement the current card's intent, touching only its declared write set.
effect: mutate
agent: developer
outcomes: pass
---
Implement the card's intent exactly, touching only the files in its `writeSet`. If the card
carries an `amend`, that supersedes the original intent — follow the amendment, not the plan it
replaced.

Make no unrelated edits: no drive-by rename, no incidental cleanup, no touching a file the card
did not declare. If the change genuinely needs a file outside the write set, stop and report that
rather than widening scope unasked — the diff is scored against the declared set, not your
judgement of what else looked wrong.

Report `pass` once the change is made, with a short account of what changed and where.
