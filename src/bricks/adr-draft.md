---
name: adr-draft
description: Write or revise one architecture decision record for the card's decision.
effect: mutate
agent: architect
outcomes: pass
---
Write or revise the ADR file the card's write set names, in Nygard form: Status: Proposed,
Context, Decision, Consequences — the costs as well as the gains — and at least two options
considered, each with why it lost. Touch only that file; never change code.

If LOOP.md's notes carry `adr-challenge` findings or a gate amendment for this ADR, answer each
one: change the decision, or record it under Consequences.

Report `pass` once the ADR is written.
