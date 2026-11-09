---
name: spec
description: Write the feature's spec — scope, EARS acceptance criteria, ordered tasks — for the user to review.
effect: mutate
agent: architect
gate: human
outcomes: pass, fail
---
Write `specs/<slug>/spec.md` and touch nothing else — no code. The slug is the run's: in a factory,
the factory run's `<slug>`; in a loop, the slug of the loop's title. Write the problem, what is out
of scope, acceptance criteria in EARS form ("WHEN <trigger> THE SYSTEM SHALL <response>"), each one
testable, and an ordered task list sized to one `identify` card apiece, ending with an end-to-end
verification task.

Write the task list in the one form a factory counts. Put it under the spec's first heading that
contains the word `task` or `tasks` (any case, such as `## Tasks`). Under it, write each task as one
top-level numbered item, `1.` or `1)`, indented 3 spaces at most. A sub-item or a deeper indent is
not a task. A deeper heading keeps the list open; the next heading of the same or a higher level
ends it. List one task at least, and no more than the factory's task limit: a factory refuses a
longer list and names its limit (Geneseed's Factory actions reference states it), so split the
requirement instead.

An amendment answers your open questions or corrects the spec: in a factory it arrives as this
stage's `carry`, in a loop as a note in LOOP.md. Revise the spec to follow it.

The user reviews the spec before the work continues. Report `pass` once every criterion is
testable, with the spec's path and its criteria count in a file in the OS temp directory — report
that file's path. Report `fail` if a criterion cannot be stated testably: list the open questions
in such a file and report its path; the user answers them with an amend.
