# {{SKILL}}: review-response

> {{DESC_REVIEW_RESPONSE}}

**Trigger:** review feedback has arrived — from a human or another agent — and is about
to be acted on; or the user wants a review criterion recorded ("add a review rule…",
"reviews should always check…").

## Procedure
1. Read every comment in full before changing anything. Group related comments.
2. Classify each comment: correct, partially correct, wrong, or unclear.
3. For anything you judge wrong or unclear, verify it against the code or a test before
   responding — do not comply blindly and do not dismiss blindly ({{LAW:verify-before-asserting}},
   {{ONTOLOGY}}: {{ONT_CONDUCT}}).
4. Respond to each comment: the change you will make and why, or a reasoned decline
   with evidence.
5. Apply the accepted changes — one intent per commit ({{LAW:one-intent-one-act}}), each through the
   [commit {{SKILL}}](commit.md) so {{DOCTRINE:consent-before-push}}'s per-commit consent holds — then
   re-run the checks ({{LAW:verify-before-asserting}}).
6. Surface anything the review missed that you noticed while addressing it.
7. Upgrade the review itself. A finding that recurs, a criterion the user asks for, or a
   defect a review should have caught becomes a rule in the nearest `REVIEW.md` above the
   files it governs — create it if missing. Show the exact lines and write them only on
   the user's word. Rules for *criticising* go here, not into the root file the coder
   loads every session.

## Done when
- Every comment has a reasoned response and either an applied change or a justified
  decline, the resulting changes are verified, and any agreed review rule is in `REVIEW.md`.

<!-- INCLUDE: skills/_self-improvement.md -->
