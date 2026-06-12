# {{SKILL}}: git-rescue

> {{DESC_GIT_RESCUE}}

**Trigger:** the repository is in a broken or messy state — a bad rebase/merge/reset,
lost commits, a detached HEAD, a half-finished operation, work stranded in a stash — or
you intend to deliberately rewrite history (interactive rebase, squash, amend). For
finding *when/why* something changed without altering history, use git-archaeology.md.

## Procedure
1. **Stop.** Do not run more commands that could compound the damage. Capture the
   current state first and read it: `git status`, `git reflog`, and `git stash list`
   (universal {{LAW}} III). The reflog is the safety net — every HEAD move is recoverable
   from it.
2. **Back up before any destructive op.** Create a timestamped marker so the current
   state is always recoverable: `git branch backup/$(date +%Y%m%d-%H%M%S)`. A branch
   preserves only *committed* state — if the working tree is dirty, `git stash push -u`
   (or a WIP commit) first, so a later `reset --hard` cannot destroy uncommitted or
   untracked work the reflog will never see. Rewriting, resetting, and force-pushing
   are irreversible acts — never run one without a recovery path in place (universal
   {{LAW}} IV).
3. Choose the **minimal** recovery for the actual problem:
   - *Lost commits / bad reset:* find the SHA in `git reflog`, then
     `git reset --hard <sha>` (or `git cherry-pick`/`git branch <name> <sha>` to salvage
     selectively).
   - *Operation in progress gone wrong:* abort cleanly —
     `git rebase --abort`, `git merge --abort`, `git cherry-pick --abort`.
   - *Detached HEAD with work on it:* `git branch <name>` to anchor it before moving.
   - *Stranded changes:* `git stash list` → `git stash apply <ref>`; recover dropped
     stashes via their reflog SHA.
   - *Uncommitted file clobbered:* `git restore --source=<sha> <path>`.
4. For a **deliberate rewrite** (interactive rebase, squash, fixup, amend): work on a
   dedicated branch, never a shared one, and keep it the only change in flight
   (universal {{LAW}} II). A rewrite *creates commits* — amend, squash, `--continue`
   all do — so present what will change and get the user's acceptance before running
   it, exactly as for any commit (universal {{LAW}} XX).
5. Verify the result before declaring success: inspect `git log --oneline`,
   `git status`, and the diff against the intended state — read the actual output, do
   not assume the rewrite landed as planned (universal {{LAW}} III).
6. Push only with the user's explicit, per-push consent — and a history rewrite needs a
   **force**-push (`--force-with-lease`), which is doubly outward-facing: present what
   changed and wait for acceptance before pushing (universal {{LAW}} XX / {{LAW}} IV).
   Never force-push a shared branch without confirming it is safe to do so.

## Done when
- The repository is in the intended state, verified against actual git output, and the
  pre-rescue state is still recoverable from the backup branch or the reflog.
