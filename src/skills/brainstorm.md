# {{SKILL}}: brainstorm

> {{DESC_BRAINSTORM}}
<!-- aliases: grill-me -->

{{CREDIT:superpowers:skills/brainstorming/SKILL.md}}

{{CREDIT:mattpocock-skills:skills/productivity/grilling/SKILL.md}}

{{CREDIT:mattpocock-skills:skills/productivity/to-questionnaire/SKILL.md}}

**Trigger:** a new feature, behaviour change, or project arrives without a design, or the
user says "brainstorm", "interview me" or "grill me". Also when goal, scope or success
criteria are unstated ("let's design this", "clarify this first", "stress-test this plan"),
and for non-design work (a refactor, a migration) whose *ask* is fuzzy: the interview runs,
the design is skipped.

## Procedure
1. **Ground.** Read the current project state, its own docs ({{DOCTRINE:read-the-docs-first}})
   and whatever the user pointed at (a spec, a handoff, files), until you can say how the
   relevant parts work today and what the change would touch — so every question is about
   the real thing ({{LAW:verify-before-asserting}}). Never ask what that already answers, nor
   reopen what the user already decided. If the request bundles several goals or systems,
   separate them and take one at a time.
2. **Interpret charitably, then interview.** Read the request in its strongest
   reasonable form — do not manufacture ambiguity from a fair ask. If goal, scope and
   success criteria are already unambiguous, restate them in one line (naming any
   platform or language choice, and any constraint, conflict or cheaper path you found),
   get it confirmed — a handed-in spec is often incomplete — and go to step 4. Otherwise
   ask ONE numbered round of every question answerable now, each with your recommended
   answer so "yes" accepts it; dependent questions wait a round. Drive at *why* (the
   outcome wanted), *scope* (in and out), *done* (how success is judged) and which build
   choices (platform, language, key libraries) the user wants to own. Existing work
   decides by default ({{DOCTRINE:respect-conventions}}); a choice you take goes in the
   ledger as **your call**, never as agreed. Stop when each is unambiguous. Facts are
   yours to find (read the code, dispatch a subagent), and so are process calls (where
   the spec goes, writing it up): make them and say so. A pending lookup holds back only
   the questions that depend on it. A decision someone else owns gets a drafted
   `questionnaire-<slug>.md` for them — ask the user only who and what they need back.
   Most important first (async gets one pass), one idea per question with an empty
   answer stub under it, and say "I don't know" is a useful answer. When the skill
   started on its own (no trigger phrase from the user), end your first message with a
   one-line offer to just start; taken, the size is *Quick*: first state any platform,
   language or tool you chose, in one line.
3. **Ledger the decisions.** Name every KEY DECISION the answers imply or leave open —
   direction chosen, trade-offs accepted, load-bearing constraints, assumptions,
   non-goals. Surface each silent assumption as a decision to ratify, not a settled
   fact. Read the ledger back as a numbered list and get an EXPLICIT confirmation
   ({{LAW:echo-the-intent}} — an inferred intent is not ground truth until echoed and agreed);
   scope the read-back to what is consequential, irreversible or genuinely uncertain.
4. **Size it, then design.** Say the size; the user may override. *Quick* — exit and do
   it, no spec. *Small* — the confirmed ledger in chat is the spec; go to step 6.
   *Project* — design, spec file, builder check. If it grows mid-work, stop and step up.
   For a *Project*, design only when there is something to design: propose 2–3
   approaches grounded in what the project does, with trade-offs, leading with your
   recommendation — in a message of their own; the user picks before any design is
   written (one sensible way: say why the others do not fit). Present the chosen design
   in sections (purpose → components → data flow → failure modes → testing), getting an
   explicit "looks right" after each; cut anything YAGNI. For a non-design ask, skip
   this step.
5. **Write the spec.** One file the next session can find — `SPEC.md` beside the work,
   or the project's own spec home (e.g. `docs/specs/`): the goal in one line, the
   confirmed decision ledger, then — when there is a design — the approaches weighed
   (trade-offs, the pick and why) and the design. Then run the builder
   check: read [brainstorm/builder-check.md](brainstorm/builder-check.md) and follow it.
6. **Exit — route, don't build.** Hand the spec to the {{SKILL}} the work now needs:
   [plan](plan.md) for a multi-step build whose route is known (sliced if too big for a
   session), [wayfinder](wayfinder.md) only when the route itself is still in the fog,
   [debug](debug.md) for a defect. Write no implementation code before that handoff.

## Done when
- A confirmed, ambiguity-free goal with its ratified decision ledger — and, where
  the ask was a design, an approved design that passed the builder check — sits in one
  spec file (or, for a small change, in the confirmed chat ledger), and the work has
  been handed to the next {{SKILL}} with no code written beforehand — or, sized quick,
  the brainstorm was exited to do the work.

<!-- INCLUDE: skills/_self-improvement.md -->
