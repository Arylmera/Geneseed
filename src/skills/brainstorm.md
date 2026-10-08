# {{SKILL}}: brainstorm

> {{DESC_BRAINSTORM}}
<!-- aliases: grill-me -->

**Trigger:** a new feature, behaviour change, or project arrives without a design, or the
user says "brainstorm", "interview me" or "grill me". Also when goal, scope or success
criteria are unstated ("let's design this", "clarify this first", "stress-test this plan"),
and for non-design work (a refactor, a migration) whose *ask* is fuzzy: the interview runs,
the design is skipped.

## Procedure
1. **Ground.** Read the current project state and its own docs ({{DOCTRINE:read-the-docs-first}})
   so every question is about the real thing ({{LAW:verify-before-asserting}}). If the request bundles
   several goals or systems, separate them and take one at a time.
2. **Interpret charitably, then interview.** Read the request in its strongest
   reasonable form — do not manufacture ambiguity from a fair ask. If goal, scope and
   success criteria are already unambiguous, restate them in one line and go to step
   4. Otherwise ask ONE numbered round of every question answerable now, each with your
   recommended answer so "yes" accepts it; dependent questions wait a round. Drive at
   *why* (the outcome wanted), *scope* (in and out) and *done* (how success is judged) —
   not *how* yet. Stop when each is unambiguous. Facts are yours to find (read the code,
   dispatch a subagent), never the user's. A decision someone else owns gets a drafted
   `questionnaire-<slug>.md` for them — ask the user only who and what they need back.
3. **Ledger the decisions.** Name every KEY DECISION the answers imply or leave open —
   direction chosen, trade-offs accepted, load-bearing constraints, assumptions,
   non-goals. Surface each silent assumption as a decision to ratify, not a settled
   fact. Read the ledger back as a numbered list and get an EXPLICIT confirmation
   ({{LAW:echo-the-intent}} — an inferred intent is not ground truth until echoed and agreed);
   scope the read-back to what is consequential, irreversible or genuinely uncertain.
4. **Design — only when there is something to design.** Propose 2–3 approaches with
   trade-offs, leading with your recommendation. Present the chosen design in
   sections (purpose → components → data flow → failure modes → testing), getting an
   explicit "looks right" after each; cut anything YAGNI. For a non-design ask, skip
   this step.
5. **Write the spec.** One file the next session can find — `SPEC.md` beside the work,
   or the project's own spec home (e.g. `docs/specs/`): the goal in one line, the
   confirmed decision ledger, then the design (when there is one). Re-read it cold for
   ambiguity and fix what a stranger could misread.
6. **Exit — route, don't build.** Hand the spec to the {{SKILL}} the work now needs:
   [plan](plan.md) for a multi-step build whose route is known (sliced if too big for a
   session), [wayfinder](wayfinder.md) only when the route itself is still in the fog,
   [debug](debug.md) for a defect. Write no implementation code before that handoff.

## Done when
- A confirmed, ambiguity-free goal with its ratified decision ledger — and, where
  the ask was a design, an approved design — sits in one spec file, and the work has
  been handed to the next {{SKILL}} with no code written beforehand.

<!-- INCLUDE: skills/_self-improvement.md -->
