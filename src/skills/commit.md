# {{SKILL}}: commit

> {{DESC_COMMIT}}

**Trigger:** about to commit changes.

## Procedure
1. Review the working tree; identify the paths that belong to *this* change only.
2. Stage exactly those paths — never `git add -A` blindly (universal {{LAW}} II:
   one intent, one act). Leave unrelated dirty files out.
3. Confirm no secret is being committed (universal {{LAW}} I).
4. Write a message: imperative subject ≤50 chars; a body only when the *why*
   isn't obvious from the diff. Follow the project's commit convention.
5. **Check the branch (universal {{LAW}} XX).** On a *shared branch* — `main`,
   `master`, `develop`/`development`, a release/hotfix branch, or any branch that is
   **not** a dedicated feature branch — first show the user a plain-language summary of
   the change *and* the exact commit message, then wait for explicit acceptance before
   committing. On a personal feature branch, commit as normal flow.
6. Push only when the user has explicitly approved it ({{LAW}} XX / {{LAW}} IV) or the
   project's {{LAWS}} call for it — never push a shared branch on your own initiative.

## Done when
- The commit contains only the intended change and the working tree is clean of it,
  and any shared-branch commit/push went out only with the user's explicit consent.
