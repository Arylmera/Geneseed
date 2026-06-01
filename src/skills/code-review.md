# {{SKILL}}: code-review

> Review a diff or PR for correctness first, quality second.

**Trigger:** reviewing changes before merge, or the user asks for a review.

## Procedure
1. Read the task/issue the change is meant to satisfy.
2. Get the diff. For a large change, consider dispatching the
   [reviewer {{AGENT}}](../{{DIR_AGENTS}}/reviewer.md) to keep the main context clean.
3. Pass 1 — correctness: logic errors, edge cases, error handling, race
   conditions. Verify suspect behaviour by running tests, not by assuming.
4. Pass 2 — quality: duplication, naming, dead code, units that do too much.
5. Write each finding as `file:line — problem — fix`, correctness first.

## Done when
- Findings are reported with a clear verdict: ship / fix-then-ship / block.
