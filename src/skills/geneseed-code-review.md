# {{SKILL}}: geneseed-code-review

> {{DESC_CODE_REVIEW}}

**Trigger:** reviewing changes before merge, or the user asks for a review.

## Procedure
1. Read the task/issue the change is meant to satisfy.
2. Get the diff. For a large change, consider dispatching the
   [reviewer {{AGENT}}](../{{DIR_AGENTS}}/reviewer.md) to keep the main context clean.
3. Pass 1 — correctness: logic errors, edge cases, error handling, race
   conditions. Verify suspect behaviour by running tests, not by assuming.
4. Pass 2 — quality: duplication, naming, dead code, units that do too much.
5. Pass 3 — spec fidelity: compare the diff against the task or issue from
   step 1; flag anything asked for but missing, and anything present that was
   never asked for. No spec available → say so and skip the pass.
6. Write each finding as a Conventional Comment, `label (decoration): file:line — problem — fix`,
   correctness first. Labels: issue, suggestion, question, todo, nitpick, thought, note,
   praise. Decorations: blocking, non-blocking, if-minor. The line pastes straight into a
   merge-request comment, and a reader can filter on the label without reading the prose.

## Done when
- Findings are reported with a verdict that follows from the decorations: any `blocking`
  finding → block; any `if-minor` and nothing blocking → fix-then-ship; otherwise ship.

<!-- INCLUDE: skills/_self-improvement.md -->
