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
5. **Get explicit consent before committing ({{DOCTRINE:consent-before-push}}).** On *every*
   branch — feature branches included — first show the user a plain-language summary of
   the change *and* the exact commit message, then wait for explicit acceptance before
   committing. A previous approval is not standing consent; ask again each commit. On a
   *shared branch* (`main`, `master`, `develop`/`development`, a release/hotfix branch,
   or any branch that is not a dedicated feature branch) apply the same gate with extra
   care.
6. Push only when the user has explicitly approved *that push* ({{DOCTRINE:consent-before-push}} / {{LAW:deletion-is-deliberate}})
   — never push on your own initiative, on any branch, and never treat one approval as
   consent for the next.

## Done when
- The commit contains only the intended change and the working tree is clean of it,
  and every commit and push went out only with the user's explicit, per-action consent.

<!-- INCLUDE: skills/_self-improvement.md -->
