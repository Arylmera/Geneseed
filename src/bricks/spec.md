---
name: spec
description: Write the feature's spec — scope, EARS acceptance criteria, ordered tasks — for the user to review.
effect: mutate
agent: architect
gate: human
outcomes: pass, fail
---
Write `specs/<slug>/spec.md` (the slug of the loop's title) and touch nothing else — no code: the
problem, what is out of scope, acceptance criteria in EARS form ("WHEN <trigger> THE SYSTEM SHALL
<response>"), each one testable, and an ordered task list sized to one `identify` card apiece,
ending with an end-to-end verification task. A gate amendment in LOOP.md's notes answers your
open questions or corrects the spec: revise the spec to follow it.

The user reviews the spec before the loop continues. Report `pass` once every criterion is
testable, with the spec's path and its criteria count in a file in the OS temp directory — report
that file's path. Report `fail` if a criterion cannot be stated testably: list the open questions
in such a file and report its path; the user answers them with an amend.
