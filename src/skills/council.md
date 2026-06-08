# {{SKILL}}: council

> {{DESC_COUNCIL}}

**Trigger:** the user asks to "convene a council", "debate this", "argue both sides", "stress-test this decision", or wants a change, plan, or claim challenged from several points of view before committing to it.

## Procedure
1. Frame the motion in one line — the exact decision, change, or claim under debate — and name what it feeds (a choice to make, a design to accept, a discussion to settle). Ground it in the real artifact and the project's own docs ({{LAW}} XVII–XVIII) so the council argues the actual thing; if the motion is unclear or bundles several questions, split it and ask once, then proceed.
2. Seat the panel: pick 3–5 distinct, named viewpoints that genuinely pull in different directions on *this* topic — e.g. the advocate (champions it), the skeptic (hunts failure modes), the pragmatist (cost, effort, YAGNI), the steward (long-term architecture and debt), the user's voice (impact on whoever consumes it). Give each a one-line charter so no two collapse into the same stance.
3. Round one — positions: each seat states its strongest case and steelmans its corner ({{LAW}} VIII) — no hedging, no strawmen. For real independence and no groupthink, dispatch each seat to its own subagent where the tool supports it (the [parallel-agents {{SKILL}}](parallel-agents.md)); otherwise voice each seat in turn as a persona.
4. Round two — clash: each seat rebuts the others only on the points that actually conflict, surfacing the cruxes, the load-bearing assumptions, and where the evidence is thin. Hold to a fixed number of rounds so the debate converges instead of looping; borrow the [roast-me {{SKILL}}](roast-me.md) discipline — pair every objection with what would resolve it.
5. The chair synthesises in neutral voice: state the verdict and its reasoning, record the strongest surviving dissent verbatim so it is not lost, list what would change the verdict, and name the single next action. Surface it for the user to decide — the council advises, it does not commit: write no code and push nothing on its own ({{LAW}} XIV, {{LAW}} XX).

## Done when
- A crisp motion was debated by distinct, steelmanned seats over bounded rounds, and the chair has delivered a verdict, the preserved dissent, and one next action for the user to weigh.
