# {{SKILL}}: clarify

> {{DESC_CLARIFY}}

**Trigger:** a task or whole project arrives with its goal, scope, or success criteria unstated or ambiguous — including non-design work (a refactor, migration, ops chore, investigation) — or the user says "interview me" / "what am I actually trying to do" / "clarify this first". If a concrete design problem is already identified, use the [brainstorm {{SKILL}}](brainstorm.md) instead.

## Procedure
1. Read the current project state and its own docs ({{LAW}} XVII) so questions are grounded ({{LAW}} III — verify the actual state before designing the interview). If the request bundles several goals, separate them and take one at a time.
2. If the goal, scope, and success criteria are already unambiguous, restate them in one line and skip to step 4 — no ceremony on a clear ask. Otherwise interview the user ONE question at a time (multiple-choice when you can), driving at *why* (the outcome wanted), *scope* (what is explicitly in and out), and *done* (how success is judged) — not *how* yet. Keep asking until each is unambiguous.
3. Name every KEY DECISION the answers imply or leave open — chosen direction, trade-offs accepted, load-bearing constraints, assumptions, and non-goals. Surface each silent assumption as a decision to ratify, not a settled fact.
4. Write the goal and the key-decision ledger to `BRIEF.md` (or `clarify/<task>.md`), then read it back to the user as a numbered list and get an EXPLICIT confirmation before acting ({{LAW}} III — confirm intent, not just state) — so nothing material is silently assumed. Scope the read-back to decisions that are consequential, irreversible, or genuinely uncertain; correct the file and re-confirm any the user changes.
5. Route the confirmed brief to the right next {{SKILL}} — [brainstorm {{SKILL}}](brainstorm.md) for a design problem, [plan {{SKILL}}](plan.md) for a multi-step build, [debug {{SKILL}}](debug.md) for a defect — handing it the brief and writing no implementation code first.

## Done when
- A confirmed, ambiguity-free goal with an explicitly verified key-decision ledger is written to `BRIEF.md`, and the work has been handed to the appropriate downstream {{SKILL}}.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
