# {{SKILL}}: geneseed-code-review

> {{DESC_CODE_REVIEW}}

**Trigger:** reviewing changes before merge, or the user asks for a review.

## Procedure
1. Pin the diff: `git diff <base>...HEAD` (three-dot) for committed work,
   `git diff <base>` when the change is still uncommitted, or the PR the user
   names. First confirm `git rev-parse <base>` resolves and the diff is non-empty.
2. Look for the spec in this order: issue refs in the commits, a path the
   user gave, a matching file under `docs/`, `specs/` or `.scratch/`. None
   found → ask once; no answer or no spec → skip pass 3 and say so.
3. For a large change, consider dispatching the
   [reviewer {{AGENT}}](../{{DIR_AGENTS}}/reviewer.md) to keep the main context clean.
4. Pass 1 — correctness: logic errors, edge cases, error handling, race
   conditions. Verify suspect behaviour by running tests, not by assuming.
5. Pass 2 — quality: check the repo's documented standards
   (`CODING_STANDARDS.md`, `CONTRIBUTING.md`) first, since they override.
   Then flag Fowler smells as judgement calls: mysterious name, duplication,
   feature envy, data clumps, primitive obsession, repeated switches,
   shotgun surgery, divergent change, speculative generality, middle man; also dead
   code and units that do too much. Skip anything tooling already enforces.
6. Pass 3 — spec fidelity: compare the diff against the spec from step 2;
   flag anything asked for but missing, anything present that was never
   asked for, and anything that looks implemented but is wrong — quoting
   the spec line for each. Skipped when step 2 found no spec.
7. Write each finding as a Conventional Comment, `label (decoration): file:line — problem — fix`,
   correctness first. Labels: issue, suggestion, question, todo, nitpick, thought, note,
   praise. Decorations: blocking, non-blocking, if-minor. The line pastes straight into a
   merge-request comment, and a reader can filter on the label without reading the prose.

## Done when
- Findings are reported with a verdict that follows from the decorations: any `blocking`
  finding → block; any `if-minor` and nothing blocking → fix-then-ship; otherwise ship.

<!-- INCLUDE: skills/_self-improvement.md -->
