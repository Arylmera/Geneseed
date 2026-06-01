# Skill: commit

> Stage the right paths and write a focused commit.

**Trigger:** about to commit changes.

## Procedure
1. Review the working tree; identify the paths that belong to *this* change only.
2. Stage exactly those paths — never `git add -A` blindly (universal Rule II:
   one intent, one act). Leave unrelated dirty files out.
3. Confirm no secret is being committed (universal Rule I).
4. Write a message: imperative subject ≤50 chars; a body only when the *why*
   isn't obvious from the diff. Follow the project's commit convention.
5. Commit. Push only if the project's Rules or the user call for it.

## Done when
- The commit contains only the intended change and the working tree is clean of it.
