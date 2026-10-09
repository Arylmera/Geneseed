# {{SKILL}}: ship

> {{DESC_SHIP}}

**Trigger:** the change is committed and verified, and it is time to open a pull
request or merge the branch.

## Procedure
1. Confirm the work is actually done before shipping. Find the project's Definition
   of Done — its test, lint, and build commands (often pointed at from
   `context.json`); if it is undefined, ask rather than assume. Run those checks and
   read the actual output ({{LAW:verify-before-asserting}}); state what you ran and its result.
   Never ship on an unproven claim.
2. Review the change before anyone else sees it: run the
   [geneseed-code-review {{SKILL}}](geneseed-code-review.md) on the branch diff (dispatch the
   [reviewer {{AGENT}}](../{{DIR_AGENTS}}/reviewer.md) for a large one). Any `blocking`
   finding stops the ship until it is fixed.
3. Confirm the branch carries only this change's commits and is rebased/updated on
   the base branch; resolve any divergence before opening.
4. Push the branch only with the user's explicit, per-push acceptance — on every
   branch, feature branches included ({{DOCTRINE:consent-before-push}}); present the change summary + commit
   message and wait, and never treat an earlier approval as consent for this push.
   Opening a PR or merging is **outward-facing** — get explicit confirmation first too,
   unless already authorized ({{LAW:deletion-is-deliberate}}).
5. Open the PR with a three-part body. **Summary**: what changed and why, with the
   smallest visual that makes the point (a call tree, diff sketch, file tree or
   Mermaid diagram). **Evidence**: how it was tested, as before/after — the test that
   failed and now passes, the output, a screenshot for a visual change. **Merge
   danger**: one-way or two-way door, the blast radius, and any follow-up. Link the
   issue it closes; keep the title an imperative one-line summary.
6. If the project merges locally instead, merge into the base branch only after
   review/approval, then delete the merged branch.
   If shipping triggers a production deploy, confirm a tested rollback or
   fix-forward path and a retained previous artifact *before* deploying — there must
   be a way back ({{LAW:deletion-is-deliberate}}); dispatch the
   [operator {{AGENT}}](../{{DIR_AGENTS}}/operator.md) when the runtime surface is
   non-trivial.
7. Make sure documentation shipped with the code ({{DOCTRINE:documentation-in-step}}) — a change
   that alters behaviour without its docs is incomplete, not ready to ship.

## Done when
- The diff passed review with no `blocking` finding, and the PR is open (or the branch is merged) with a Summary / Evidence / Merge danger
  body, and nothing unrelated rides along.

<!-- INCLUDE: skills/_self-improvement.md -->
