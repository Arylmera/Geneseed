# {{SKILL}}: brainstorm

> {{DESC_BRAINSTORM}}

**Trigger:** a new feature or behaviour change with no design yet, or the user says "brainstorm" / "let's design this". (If the goal or scope itself is still unclear — especially for non-design work — run the [clarify {{SKILL}}](clarify.md) first.)

## Procedure
1. Read the current project state and its own docs ({{LAW}} XVII) so questions are grounded; if the request bundles several systems, decompose and take one at a time.
2. Ask clarifying questions ONE at a time (multiple-choice when you can) until purpose, constraints, and success criteria are clear.
3. Propose 2-3 approaches with trade-offs; lead with your recommendation.
4. Present the design in sections (purpose → components → data flow → failure modes → testing), getting an explicit "looks right" after each; cut anything YAGNI.
5. Write the agreed design to a spec the next session can find — `SPEC.md` beside the work, or the project's own spec home (e.g. `docs/specs/`) — re-read it for ambiguity, then hand off to the [plan {{SKILL}}](plan.md) to sequence it — writing no implementation code before that approval.

## Done when
- An approved, ambiguity-free design exists and `plan` has it to sequence, with no code written beforehand.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
