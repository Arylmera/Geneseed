# {{SKILL}}: council

> {{DESC_COUNCIL}}

**Trigger:** the user asks to "convene a council", "debate this", "argue both sides", "stress-test this decision", or wants a change, plan, or claim challenged from several points of view before committing to it.

## Procedure
1. Frame the motion in one line — the exact decision, change, or claim under debate — and name what it feeds (a choice to make, a design to accept, a discussion to settle). Ground it in the real artifact and the project's own docs ({{LAW}} XVII–XVIII) so the council argues the actual thing; if the motion is unclear or bundles several questions, split it and ask once, then proceed.
2. Seat the council from the standing roster of read-only debate {{AGENTS}}, each arguing one fixed stance — convene the subset that genuinely clashes on *this* motion (usually 3–6, never the whole bench for its own sake), always anchored by the for/against spine of [advocate](../{{DIR_AGENTS}}/advocate.md) and [skeptic](../{{DIR_AGENTS}}/skeptic.md):
   - [advocate](../{{DIR_AGENTS}}/advocate.md) — the strongest case **for**; [skeptic](../{{DIR_AGENTS}}/skeptic.md) — devil's advocate, failure modes and hidden assumptions.
   - [pragmatist](../{{DIR_AGENTS}}/pragmatist.md) — cost, effort, YAGNI; [steward](../{{DIR_AGENTS}}/steward.md) — long-term architecture and debt; [operator](../{{DIR_AGENTS}}/operator.md) — running it in production.
   - [visionary](../{{DIR_AGENTS}}/visionary.md) — the bold, transformative version; [framer](../{{DIR_AGENTS}}/framer.md) — whether it's even the right problem; [empiricist](../{{DIR_AGENTS}}/empiricist.md) — every claim held to evidence; [historian](../{{DIR_AGENTS}}/historian.md) — what was tried before.
   - [user-advocate](../{{DIR_AGENTS}}/user-advocate.md) — whoever consumes the outcome.

   Hand each chosen seat the motion and a one-line charter scoped to this topic; skip the seats with nothing to say here, and add an ad-hoc seat (e.g. the [security](../{{DIR_AGENTS}}/security.md) surface) only when the topic plainly demands a voice the roster doesn't cover.
3. Round one — positions: convene the seats by dispatching each stance {{AGENT}} as its own subagent in one batch where the tool supports it (the [parallel-agents {{SKILL}}](parallel-agents.md)), so each argues in an isolated context with no groupthink; where no subagent capability exists, voice each seat in turn as a persona. Each returns its steelmanned brief ({{LAW}} VIII) — no hedging, no strawmen.
4. Round two — clash: put the briefs in front of each other and have the seats rebut only on the points that actually conflict, surfacing the cruxes, the load-bearing assumptions, and where the evidence is thin. Hold to a fixed number of rounds so the debate converges instead of looping; the skeptic already pairs every objection with what would resolve it (the [roast-me {{SKILL}}](roast-me.md) discipline).
5. The chair synthesises in neutral voice: state the verdict and its reasoning, record the strongest surviving dissent verbatim so it is not lost, list what would change the verdict, and name the single next action. Surface it for the user to decide — the council advises, it does not commit: write no code and push nothing on its own ({{LAW}} XIV, {{LAW}} XX).

## Done when
- A crisp motion was debated by distinct, steelmanned seats over bounded rounds, and the chair has delivered a verdict, the preserved dissent, and one next action for the user to weigh.
