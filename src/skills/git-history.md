# {{SKILL}}: git-history

> {{DESC_GIT_HISTORY}}
<!-- aliases: git-archaeology, git-rescue -->

**Trigger:** something must be learned *from* the git history, or it needs repair.
Learn: when a regression came in, who last touched a line and why, where a symbol or
string entered. Repair: lost commits, a rebase/merge/reset gone wrong, a detached HEAD, a
half-finished operation, work stranded in a stash, a conflict to resolve, or a
deliberate rewrite (interactive rebase, squash, amend). Pick the part first: Part A
never changes history; Part B does. To write a new commit, use the
[commit {{SKILL}}](commit.md).

## Procedure

### Part A — Investigate (read-only)
1. State the question before touching git: *when did it break*, *why does this code
   exist*, or *where did this come from*. The question picks the lens.
2. **When did it break** → `git bisect start <bad> <good>`; drive it with
   `git bisect run <cmd>` when the test is scriptable (non-zero exit marks bad),
   otherwise mark each step by hand. Read the actual output at every step; never
   assume a result ({{LAW:verify-before-asserting}}).
3. **Why / who** → `git blame -w -C <file>` (ignore whitespace, follow moved code) to
   reach the introducing commit, then `git show <sha>` for its message and diff.
4. **Where did it come from** → the pickaxe: `git log -S'<string>'` (count changed),
   `git log -G'<regex>'` (matching lines changed), or `git log -p -- <path>`.
5. Read the evidence end to end — the first matching commit is not always the cause;
   corroborate across lenses when the answer is consequential
   ({{LAW:verify-before-asserting}}).
6. `git bisect reset`, and confirm the working tree is back where it started
   ({{LAW:verify-before-asserting}}).
7. Report the commit(s) with their evidence. Do **not** fix inside the investigation —
   that is a separate change ({{LAW:one-intent-one-act}}); hand off to the
   [debug {{SKILL}}](debug.md) or the [commit {{SKILL}}](commit.md).

### Part B — Recover or rewrite
1. **Stop.** Run nothing that could compound the damage. Capture and read the state:
   `git status`, `git reflog`, `git stash list` ({{LAW:verify-before-asserting}}). Every HEAD move is
   recoverable from the reflog.
2. **Back up before any destructive op:** `git branch backup/$(date +%Y%m%d-%H%M%S)`.
   A branch keeps only *committed* state — if the tree is dirty, `git stash push -u`
   (or a WIP commit) first, so a `reset --hard` cannot destroy work the reflog never
   saw. Never rewrite, reset or force-push without a recovery path
   ({{LAW:deletion-is-deliberate}}).
3. Choose the **minimal** recovery:
   - *Lost commits / bad reset:* find the SHA in `git reflog`, then `git reset --hard <sha>`
     (or `git cherry-pick` / `git branch <name> <sha>` to salvage selectively).
   - *Operation gone wrong:* `git rebase --abort`, `git merge --abort`,
     `git cherry-pick --abort`.
   - *Detached HEAD with work:* `git branch <name>` to anchor it before moving.
   - *Stranded changes:* `git stash apply <ref>`; dropped stashes via their reflog SHA.
   - *Uncommitted file clobbered:* `git restore --source=<sha> <path>`.
4. **Resolving conflict hunks:** read the primary sources for each side — commit
   messages, PRs, original issues — and understand why each change was made. Preserve
   both intents where possible; where incompatible, pick the one matching the merge's
   stated goal and note the trade-off. Never invent new behaviour in a resolution, and
   — unlike the deliberate `--abort` in step 3 — never `--abort` to escape a conflict
   you were asked to resolve. Before concluding, run the project's checks (typecheck,
   tests, format) and fix what the merge broke.
5. **Deliberate rewrite** (interactive rebase, squash, fixup, amend): on a dedicated
   branch, never a shared one, as the only change in flight ({{LAW:one-intent-one-act}}). A
   rewrite *creates commits*, so present what will change and get the user's
   acceptance first, as for any commit ({{DOCTRINE:consent-before-push}}).
6. Verify against `git log --oneline`, `git status` and the diff to the intended state
   — read the output, do not assume the rewrite landed ({{LAW:verify-before-asserting}}).
7. Push only with the user's explicit per-push consent. A rewrite needs a
   `--force-with-lease` push, doubly outward-facing: present what changed and wait for
   acceptance ({{DOCTRINE:consent-before-push}} / {{LAW:deletion-is-deliberate}}). Never force-push a shared
   branch without confirming it is safe.

## Done when
- **Part A:** the question is answered with specific commit(s) and the output that
  proves it, the bisect state is reset, and the working tree is unchanged.
- **Part B:** the repository is in the intended state, verified against actual git
  output, and the pre-rescue state is still recoverable from the backup branch or the
  reflog.

<!-- INCLUDE: skills/_self-improvement.md -->
