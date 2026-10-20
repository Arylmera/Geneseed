# {{SKILL}}: geneseed-code-review

> {{DESC_CODE_REVIEW}}

{{CREDIT:mattpocock-skills:skills/engineering/code-review/SKILL.md}}

{{CREDIT:superpowers:skills/requesting-code-review/code-reviewer.md}}

**Trigger:** reviewing changes before merge, or the user asks for a review — including "roast my code": same passes, findings unsoftened. Critiquing the user's own ask or plan is [roast-me](roast-me.md).

## Procedure
1. Pin the diff: `git diff <base>...HEAD` for committed work, `git diff <base>`
   for uncommitted, or the PR the user names. `<base>` is `origin/<default branch>` after a
   `git fetch`, never a local branch that may be stale. Confirm the base resolves and the
   diff is non-empty.
2. Find the spec: issue refs in the commits, a path the user gave, a match under
   `docs/`, `specs/` or `.scratch/`. None → ask once; still none → skip pass 3 and say so.
3. Load the review rules: for each changed file, the nearest `REVIEW.md` above it, up to the
   repo root — a deeper one overrides a shallower one. They override everything below,
   output format included, but never a {{LAW}}.
4. For a large change, consider dispatching the
   [reviewer {{AGENT}}](../{{DIR_AGENTS}}/reviewer.md) to keep the main context clean.
   When a spec exists and the diff spans more than a few files, run pass 3 in its own
   subagent, handed only the diff command and the spec, alongside passes 1–2: a pass
   that has already filled up on code findings stops reading the spec closely, and
   kept apart, one axis's findings never mask the other's.
5. Pass 1 — correctness: logic errors, edge cases, error handling, race
   conditions. Verify suspect behaviour by running tests, not by assuming.
6. Pass 2 — quality: after `REVIEW.md`, the repo's documented standards override: search the repo for every file that states how code
   is written (`CODING_STANDARDS.md`, `CONTRIBUTING.md`, style or conventions docs), not one fixed path. Then, as judgement calls and skipping what tooling enforces:
   mysterious name, duplication, feature envy, data clumps, primitive obsession, repeated switches, shotgun surgery, divergent change, speculative generality, message chains, middle man, refused bequest, dead code, units that do too much.
7. Pass 3 — spec fidelity: flag anything asked for but missing, present but never
   asked for, or implemented wrong — quoting the spec line for each. Where the spec is silent,
   judge by what a reasonable user would expect: a crash, hang or data loss on an input the
   spec implies but never names is `issue (blocking)`, not a nitpick. Architecture drift too: when
   `docs/architecture.md` draws C4 and the diff adds, removes or rewires a container — a Dockerfile,
   a compose service, a deployable module, a datastore, a new client of another container — but
   leaves the diagram alone, raise `issue (non-blocking)` and point at
   [document-project](document-project.md) to redraw L2.
8. Write each finding as a Conventional Comment, `label (decoration): file:line — problem — fix`,
   correctness first. Labels: issue, suggestion, question, todo, nitpick, thought, note,
   praise. Decorations: blocking, non-blocking, if-minor. The line pastes straight into a
   merge-request comment, and a reader can filter on the label without reading the prose.
   Before the verdict, a **Set aside:** list — each behaviour you considered and left out of
   scope, one line with the reason, or `none` — for the caller to rule on
   ({{DOCTRINE:declare-the-judgment-calls}}).

## Done when
- Findings are reported with a verdict that follows from the decorations: any `blocking`
  finding → block; any `if-minor` and nothing blocking → fix-then-ship; otherwise ship.

<!-- INCLUDE: skills/_self-improvement.md -->
