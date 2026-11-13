# {{SKILL}}: ship

> {{DESC_SHIP}}

{{CREDIT:mattpocock-skills-2509:skills/engineering/pr/SKILL.md}}

**Trigger:** the change is committed and verified, and it is time to open a pull
request or merge the branch.

## Procedure
1. Confirm the work is actually done before shipping. Find the project's Definition
   of Done — its test, lint, and build commands (often pointed at from
   `context.json`); if it is undefined, ask rather than assume. Run those checks and
   read the actual output ({{LAW:verify-before-asserting}}); state what you ran and its result.
   Never ship on an unproven claim. Documentation ships with the code
   ({{DOCTRINE:documentation-in-step}}) — a change that alters behaviour without its docs is
   incomplete, not ready to ship.
2. Review the change before anyone else sees it: run the
   [geneseed-code-review {{SKILL}}](geneseed-code-review.md) on the branch diff (dispatch the
   [reviewer {{AGENT}}](../{{DIR_AGENTS}}/reviewer.md) for a large one). Any `blocking`
   finding stops the ship until it is fixed, and every **Set aside:** line is ruled on
   before pushing.
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
   danger**: one-way door (destructive or hard to reverse — a migration, a deletion, a
   published contract) or two-way (cheap to roll back), the blast radius (what breaks if
   it is wrong — consumers, layout, data), and any follow-up. Link the
   issue it closes; keep the title an imperative one-line summary.
6. **Auto-merge.** It is off unless the user's standing rule *Auto-merge green PRs* in
   `user-rules.md` arms it (the later layer wins: project over host over shared). With no such
   rule, say once, on the first PR you open in this repo: "Auto-merge is off; say 'turn on
   auto-merge' to set a standing rule" — the [rule {{SKILL}}](rule.md) writes it. With the rule,
   arm it only when all of these hold; otherwise leave the merge to the user:
   - **Tier**, from the PR's diff. Any file in a sensitive zone → `never`. Sensitive is each
     `sensitive:` zone of the repo's `AGENTS.md` ownership block, plus by default: auth and
     authz, secrets and credentials, data migrations and schema, CI and deploy config,
     dependency manifests and lockfiles, release and versioning, gate and hook config. Else any
     code → `normal`. Else (docs and tests only) → `docs-tests`. The rule's line for the tier
     decides: `auto` arms; `human` arms only when the forge also requires one approving review;
     `reviewer` arms only after the [fresh-eyes {{SKILL}}](fresh-eyes.md) passes, its verdict in
     the PR body; `never` does not arm. A missing or unreadable value counts as `human`.
   - **Forge.** The base branch has required checks (GitHub: a ruleset or branch protection,
     `gh api repos/{owner}/{repo}/rules/branches/<base>`; GitLab: *Pipelines must succeed*), and
     the repo allows auto-merge. A requirement you cannot read counts as absent. Never judge
     green yourself: the forge's checks are the gate ({{DOCTRINE:external-gate}}).
   Arm with the reviewed head pinned: `gh pr merge <pr> --auto --squash --match-head-commit
   <sha>`, or `glab mr merge <mr> --auto-merge --squash --sha <sha>` (a plain `glab mr merge`
   arms it too, so always name the flag). The rule arms only the forge's merge; every push still
   asks. Recommend CODEOWNERS with required code-owner review on sensitive paths, as the forge's
   own backstop.
7. If the project merges locally instead, merge into the base branch only after
   review/approval.
8. Once the branch is merged — locally or through the PR — delete it, local and remote
   (`git branch -d <branch>`, `git push origin --delete <branch>`), with consent: it is a
   deletion ({{LAW:deletion-is-deliberate}}). A PR usually merges after your turn ends,
   with nobody left to delete its branch, so the first time you ship in a repo, check
   whether the forge deletes merged branches by itself (GitHub: *Automatically delete
   head branches*) and recommend turning it on if not.
   If shipping triggers a production deploy, confirm a tested rollback or
   fix-forward path and a retained previous artifact *before* deploying — there must
   be a way back ({{LAW:deletion-is-deliberate}}); dispatch the
   [operator {{AGENT}}](../{{DIR_AGENTS}}/operator.md) when the runtime surface is
   non-trivial.

## Done when
- The diff passed review with no `blocking` finding, and the PR is open (or the branch is merged) with a Summary / Evidence / Merge danger
  body, and nothing unrelated rides along.
- Auto-merge is armed only under the user's standing rule, for its tier, on a forge that
  requires checks, with the reviewed head pinned — or it is off and, on the repo's first PR,
  the user was told how to turn it on.
- A branch merged while you are still working is deleted, local and remote, or the user
  declined.

<!-- INCLUDE: skills/_self-improvement.md -->
