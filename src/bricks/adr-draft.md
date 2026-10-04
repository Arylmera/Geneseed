---
name: adr-draft
description: Write or revise one architecture decision record for the card's decision, for the user to review.
effect: mutate
agent: architect
gate: human
outcomes: pass
---
Write or revise the ADR the card names (`docs/adr/NNNN-<slug>.md`, or the repo's own ADR folder
and numbering) in Nygard form: Status: Proposed, Context, Decision, Consequences — the costs as
well as the gains — and at least two options considered, each with why it lost. Touch only the
ADR file; never change code.

If LOOP.md's notes carry `adr-challenge` findings or a gate amendment for this ADR, answer each
one: change the decision, or record it under Consequences.

The user reviews the ADR before the loop continues: write its path, the decision in one line and
the options it rejected to a file in the OS temp directory and report that file's path with the
outcome. Report `pass` once the ADR is written.
