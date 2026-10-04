---
name: identify
description: Choose the next iteration of the loop, or declare the requirement done.
effect: read
agent: explorer
outcomes: more, done
---
Read the requirement and the loop's history (LOOP.md, `git log --format=%(trailers)` on this
branch). If the requirement is fully met and the suite is green, report `done`.

Otherwise pick the SMALLEST next change that moves the requirement forward and can be tested on
its own — when the branch has `specs/*/spec.md`, its next unfinished task. If the latest note is
`done-check`'s unmet criteria, report `more` with a card for one of them, never `done`. Report
`more` with a card, as JSON:
{"intent": "<one line>", "writeSet": ["<every file ANY brick this iteration writes, tests/docs too>"],
 "actions": ["<each of: format, imports, rename, logic, new-file, api, delete, architecture>"]}

Declare every action honestly: the diff is scored again before commit, and anything outside the
write set or under-declared escalates to a blocking stop. If LOOP.md's notes say the previous
attempt was re-split, make this card strictly smaller than that one.

Never edit, create or delete any file: this brick only reads.
