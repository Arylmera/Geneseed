# {{SKILL}}: review-response

> {{DESC_REVIEW_RESPONSE}}

**Trigger:** you have received review feedback — from a human or another agent — and
are about to act on it.

## Procedure
1. Read every comment in full before changing anything. Group related comments.
2. Classify each comment: correct, partially correct, wrong, or unclear.
3. For anything you judge wrong or unclear, verify it against the code or a test before
   responding — do not comply blindly and do not dismiss blindly ({{LAW}} III,
   {{LAW}} VIII).
4. Respond to each comment: the change you will make and why, or a reasoned decline
   with evidence.
5. Apply the accepted changes — one intent per commit ({{LAW}} II), each through the
   [commit {{SKILL}}](commit.md) so {{LAW}} XX's per-commit consent holds — then
   re-run the checks ({{LAW}} III).
6. Surface anything the review missed that you noticed while addressing it.

## Done when
- Every comment has a reasoned response and either an applied change or a justified
  decline, and the resulting changes are verified.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
