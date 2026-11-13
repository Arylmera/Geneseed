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
   `user-rules.md` arms it (the later layer wins: project over host over shared). That rule is
   the durable authorization {{LAW:deletion-is-deliberate}} permits for the forge's merge; it
   arms only that merge, and every push still asks. With no such rule, say once per session in
   each repo, when you open a PR there: "Auto-merge is off; say 'turn on auto-merge' to set a
   standing rule" — the [rule {{SKILL}}](rule.md) writes it. With the rule, arm only when all of
   these hold; otherwise leave the merge to the user:
   - **Tier**, from the PR's diff. Any sensitive file → `sensitive`. Else, when every file is
     docs (prose that is neither shipped nor executed) or tests → `docs-tests`. Anything else →
     `normal`. Sensitive is each `sensitive:` zone of the ownership block in the *base* branch's
     `AGENTS.md` (never the head's), plus by default: auth and authz, secrets and credentials,
     data migrations and schema, CI and deploy config, dependency manifests and lockfiles,
     release and versioning, gate and hook config, `AGENTS.md`, `CLAUDE.md`, `CODEOWNERS`, any
     `user-rules.md`, agent, skill and instruction files, and test files that CI runs as a gate.
   - **The rule's line for the tier.** `sensitive` never arms, whatever the rule says.
     `docs-tests` accepts `auto | human | reviewer | never`; `normal` accepts `human | reviewer
     | never` (`auto` is not valid there). A missing or other value counts as `human`. `auto`
     arms. `human` arms only when the forge requires one approving review. `reviewer` arms only
     after the [fresh-eyes {{SKILL}}](fresh-eyes.md) passes: first add its verdict to the PR
     body (`gh pr edit <pr> --body-file <file>`, `glab mr update <mr> --description <text>`).
     `never` does not arm.
   - **Forge**, one probe each; a result you cannot read counts as absent. Required checks on
     the base: a `required_status_checks` rule in `gh api repos/{owner}/{repo}/rules/branches/<base>`,
     or `required_status_checks` in `gh api repos/{owner}/{repo}/branches/<base>/protection`;
     GitLab: `only_allow_merge_if_pipeline_succeeds` in `glab api projects/:id`. One approving
     review (`human`): a `pull_request` rule with `required_approving_review_count` of 1 or more,
     or the same count under `required_pull_request_reviews` in the protection. Auto-merge
     allowed: `gh repo view --json autoMergeAllowed`. Never judge green yourself: the forge's
     checks are the gate ({{DOCTRINE:external-gate}}).
   Arm with the reviewed head named: `gh pr merge <pr> --auto --squash --match-head-commit
   <sha>`, or `glab mr merge <mr> --auto-merge --squash --sha <sha>` (a plain `glab mr merge`
   arms it too, so always name the flag). On GitHub the pin is checked only when you arm: an
   armed PR stays armed after a later push. So before any further push to an armed PR, disarm
   it (`gh pr merge <pr> --disable-auto`; GitLab: `glab api --method POST
   projects/:id/merge_requests/<iid>/cancel_merge_when_pipeline_succeeds`), then classify,
   review and arm again on the new head. Recommend CODEOWNERS with required code-owner review on
   sensitive paths, and *Dismiss stale pull request approvals* for the `human` tier, as the
   forge's own backstops.
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
- Auto-merge is armed only under the user's standing rule, never for a sensitive diff, on a
  forge that requires checks, on the reviewed head, and disarmed before any later push — or it
  is off and the user was told once this session how to turn it on.
- A branch merged while you are still working is deleted, local and remote, or the user
  declined.

<!-- INCLUDE: skills/_self-improvement.md -->
