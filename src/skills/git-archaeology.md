# {{SKILL}}: git-archaeology

> {{DESC_GIT_ARCHAEOLOGY}}

**Trigger:** you need to learn something *from* the history — when a regression was
introduced, who last touched a line and why, or where a symbol or string entered the
codebase. Read-only: this {{SKILL}} investigates, it does not change history (to repair
or rewrite, use git-rescue.md; to write a new commit, use commit.md).

## Procedure
1. State the question precisely before touching git: *when did it break*, *why does
   this code exist*, or *where did this string/symbol come from*. The question picks
   the lens.
2. **"When did it break"** → `git bisect`. Find a known-good and known-bad commit, then
   `git bisect start <bad> <good>`. Drive it with `git bisect run <cmd>` when the test
   is scriptable — a non-zero exit marks bad — otherwise mark each step by hand. Read
   the actual command output at each step; never assume a result (universal {{LAW}} III).
3. **"Why / who"** → `git blame -w -C <file>` (ignore whitespace, follow moved code) to
   reach the introducing commit, then `git show <sha>` for its message and full diff.
4. **"Where did this come from"** → the pickaxe: `git log -S'<string>'` for when a
   string's count changed, `git log -G'<regex>'` for when matching lines changed, or
   `git log -p -- <path>` to walk a file's history with diffs.
5. Read the evidence end to end before concluding — the first matching commit is not
   always the cause. Corroborate across lenses when the answer is consequential
   (universal {{LAW}} III).
6. **Reset the investigation state** when done: `git bisect reset` returns to the
   original HEAD. Confirm the working tree is back where it started (universal {{LAW}} III).
7. Report the offending/originating commit with its evidence. Do **not** fix the bug
   inside this investigation — that is a separate, single-purpose change (universal
   {{LAW}} II); hand off to debug.md or commit.md.

## Done when
- The question is answered with a specific commit (or commits) and the diff/output that
  proves it, the bisect state is reset, and the working tree is unchanged.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
