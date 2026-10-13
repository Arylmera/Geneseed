# {{SKILL}}: plan

> {{DESC_PLAN}}

**Trigger:** a task with more than a couple of steps, or touching several files
({{DOCTRINE:plan-before-acting}}).

## Procedure
1. If a design or spec already exists (e.g. from the brainstorm {{SKILL}}), derive the
   plan from it; if the task is design-heavy and none exists yet, run the
   [brainstorm {{SKILL}}](brainstorm.md) first rather than planning blind. Otherwise
   restate the goal in one line. Either way, confirm the actual starting state before
   designing the steps ({{LAW:verify-before-asserting}} — verify before designing).
2. Write a numbered plan to `WORKLOG.md` (or `plans/<task>.md`): ordered steps, each
   independently checkable. Group the steps into milestones — coherent chunks after
   which the work can be verified and reviewed. Cut the steps as **vertical slices** —
   thin end-to-end pieces, each green and verifiable on its own, never one horizontal
   layer at a time — and give each a `Blocked by:` line naming the slices it waits on
   (`none` when it can start now). Sequence a wide refactor as expand → migrate
   callers in batches → contract, so every slice leaves the build green. A step records
   decisions, not code: the files, the exact signatures and the spec's values, the test
   that proves it, and the check command. Write a body only for an algorithm those leave
   open; a plan longer than the code it describes has written the code, and "TBD",
   "handle edge cases" or "add tests" decide nothing. The file's first line names the
   task or branch, then `Spec: <path>` when a spec exists — the spec outranks the plan
   where they conflict, and a worklog naming another task is stale, never resumed.
3. Execute one step at a time. After each, update the worklog — mark it done only after
   its check ran green in this session, with the command and result on the line — and
   note the current step, the next step, and any blockers. After a compaction, trust the
   worklog and `git log` over memory.
4. At each milestone, stop and verify before continuing — run the project's checks
   and read the output ({{LAW:verify-before-asserting}}). Decide forks yourself; stop
   only for what {{LAW:echo-the-intent}} or {{DOCTRINE:consent-before-push}} names.
5. If the plan proves wrong, revise the file *before* continuing. The file, not
   your memory, is the source of truth for where you are. A deviation you decide without
   asking gets a worklog line `Ruling: <what> — <why> — <cost if wrong>`; those lines feed
   {{DOCTRINE:declare-the-judgment-calls}} at the end.
6. On finishing, clear or archive the worklog.

## Done when
- The plan was re-read against the spec before step 1: every requirement has a step,
  names match across steps, and it is not several times the spec's length.
- Every plan step is checked off, each milestone was verified, and the goal's
  done-condition is confirmed.

> The worklog is external memory: it lets a context-limited agent recover its
> place after the window fills, and lets the user correct course early. Consider
> git-ignoring `WORKLOG.md` if it should stay local to each developer.

<!-- INCLUDE: skills/_self-improvement.md -->
