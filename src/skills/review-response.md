# {{SKILL}}: review-response

> {{DESC_REVIEW_RESPONSE}}

**Trigger:** review feedback has arrived — from a human or another agent — and is about
to be acted on.

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

## Done when
- Every comment has a reasoned response and either an applied change or a justified
  decline, and the resulting changes are verified.

<!-- INCLUDE: skills/_self-improvement.md -->
