# {{SKILL}}: worktree

> {{DESC_WORKTREE}}

**Trigger:** work must not share a working tree with what is already in flight — a
[pipeline](pipeline.md) crew needs its own tree, a second task starts while the first
is uncommitted, another agent or session is editing this checkout, a risky migration
or rewrite needs a disposable copy, or the user says "worktree", "isolate this",
"don't touch my checkout". Also the first thing to reach for when `git status` shows
changes you did not make.

## Procedure
1. **Look before you branch** ({{LAW}} III). `git status` and `git worktree list`
   first. Uncommitted changes you did not author mean someone else owns this tree —
   never `checkout -b` from it (that moves *their* HEAD onto your branch) and never
   stash or revert it. Note the branch they are on; you will not touch it.
2. **Create the tree beside the repo, from a clean base:**
   ```
   git worktree add -b <type>/<slug> ../<repo>-<slug> <base>
   ```
   `<base>` is the integration branch (`main`, or `origin/main` after a `git fetch`),
   never the dirty tree's HEAD. One worktree per task; name the directory after the
   branch so `git worktree list` reads as a task list.
3. **Make it runnable.** A worktree shares the repository, not the untracked files:
   install dependencies (`npm ci`, the project's equivalent) or link the ones that are
   large and pure; copy no `.env` — secrets are the user's to place ({{LAW}} I). Run
   the project's checks once in the new tree and read the output before changing
   anything, so a later red is yours.
4. **Work only in the worktree.** Every edit, test, commit and `doctor`/lint run
   happens under its path — use absolute paths in tools whose cwd resets. The
   original checkout stays as found. Host hooks or shims that write machine-wide
   state (a global config, a hook shim) run from the worktree only when they resolve
   the repo through it; verify with the tool's own status command rather than assume.
5. **Integrate through the normal gate** — commit via the [commit {{SKILL}}](commit.md),
   ship via [ship](ship.md). A worktree earns no exemption from per-commit and
   per-push consent ({{DOCTRINE}} process 5). Expect conflicts with a sibling tree that
   touched the same files; resolve them on the branch, not in the other tree.
6. **Clean up when the branch is merged or abandoned** — with consent, since removal
   is deletion ({{LAW}} IV):
   ```
   git worktree remove ../<repo>-<slug>
   git branch -d <type>/<slug>
   ```
   `git worktree prune` after a directory was deleted by hand. Leave nothing listed
   that no task owns.

## Done when
- The task ran to its commit or PR entirely inside its own tree from a clean base,
  the original checkout is byte-for-byte as it was found, and the worktree is either
  still listed with a live task or removed with its branch.

<!-- INCLUDE: skills/_self-improvement.md -->
