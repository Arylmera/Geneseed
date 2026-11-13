# {{SKILL}}: commit

> {{DESC_COMMIT}}

**Trigger:** about to commit changes.

## Procedure
1. Review the working tree; identify the paths that belong to *this* change only.
2. Stage exactly those paths — never `git add -A` blindly ({{LAW:one-intent-one-act}}:
   one intent, one act). Leave unrelated dirty files out.
3. Confirm no secret is being committed ({{LAW:sealed-secrets}}), and no leftover
   debug scaffolding rides along — `console.log`, `debugger`, `print`,
   commented-out code, or hardcoded test values left over from diagnosis
   ({{LAW:cure-the-cause}}).
4. Write a message: imperative subject ≤50 chars; a body only when the *why*
   isn't obvious from the diff. **Match the repository's existing commit convention**
   ({{DOCTRINE:respect-conventions}}) — detect it from commit tooling (`commitlint`,
   `semantic-release`, `release-please`, husky hooks) and recent `git log`. When the
   repo has no discernible convention, default to **Conventional Commits**:
   `type(scope): subject` (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`…),
   with a `!` before the colon or a `BREAKING CHANGE:` footer for a breaking change.
5. **Commit on your own branch; never on the main branch ({{DOCTRINE:consent-before-push}}).**
   On your own branch, commit without asking once steps 1–4 hold. The main branch
   (`main`, `master`, the remote's default, and from a linked worktree the main checkout's branch) takes no direct
   commit: move the work to a branch first and land it through a pull request. Where the
   repository has no remote or no CI, a commit on the main branch needs explicit
   acceptance: show a plain-language summary and the exact message, then wait. For a
   non-trivial change, offer the `explain-changes` skill's visual walkthrough — an
   offer, never a condition. A dispatched worker, crew or slice commits only in its own
   worktree.
6. Push your own branch with a plain push when the work is ready for review; a forced
   push asks, and a push onto the main branch asks ({{DOCTRINE:consent-before-push}} /
   {{LAW:deletion-is-deliberate}}). A dispatched worker, crew or slice never pushes. If the
   branch's PR has auto-merge armed, disarm it before the push (`gh pr merge <pr> --disable-auto`;
   GitLab: `glab api --method POST projects/:id/merge_requests/<iid>/cancel_merge_when_pipeline_succeeds`):
   an armed PR would merge the new head unreviewed. Re-arm only through the [ship {{SKILL}}](ship.md).

## Done when
- The commit contains only the intended change and the working tree is clean of it,
  and nothing was committed or pushed onto the main branch without a green pull
  request or the user's explicit acceptance.

<!-- INCLUDE: skills/_self-improvement.md -->
