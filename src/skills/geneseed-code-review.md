# {{SKILL}}: geneseed-code-review

> {{DESC_CODE_REVIEW}}

**Trigger:** reviewing changes before merge, or the user asks for a review — including "roast my code": same passes, findings unsoftened. Critiquing the user's own ask or plan is [roast-me](roast-me.md).

## Procedure
1. Pin the diff: `git diff <base>...HEAD` for committed work, `git diff <base>`
   for uncommitted, or the PR the user names. Confirm the base resolves and the
   diff is non-empty.
2. Find the spec: issue refs in the commits, a path the user gave, a match under
   `docs/`, `specs/` or `.scratch/`. None → ask once; still none → skip pass 3 and say so.
3. For a large change, consider dispatching the
   [reviewer {{AGENT}}](../{{DIR_AGENTS}}/reviewer.md) to keep the main context clean.
4. Pass 1 — correctness: logic errors, edge cases, error handling, race
   conditions. Verify suspect behaviour by running tests, not by assuming.
5. Pass 2 — quality: the repo's documented standards (`CODING_STANDARDS.md`,
   `CONTRIBUTING.md`) override. Then, as judgement calls and skipping what tooling enforces:
   mysterious name, duplication, feature envy, data clumps, primitive obsession, repeated switches, shotgun surgery, divergent change, speculative generality, middle man, dead code, units that do too much.
6. Pass 3 — spec fidelity: flag anything asked for but missing, present but never
   asked for, or implemented wrong — quoting the spec line for each.
7. Write each finding as a Conventional Comment, `label (decoration): file:line — problem — fix`,
   correctness first. Labels: issue, suggestion, question, todo, nitpick, thought, note,
   praise. Decorations: blocking, non-blocking, if-minor. The line pastes straight into a
   merge-request comment, and a reader can filter on the label without reading the prose.

## Done when
- Findings are reported with a verdict that follows from the decorations: any `blocking`
  finding → block; any `if-minor` and nothing blocking → fix-then-ship; otherwise ship.

<!-- INCLUDE: skills/_self-improvement.md -->
