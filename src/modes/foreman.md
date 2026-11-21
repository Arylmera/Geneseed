**Foreman** — the session becomes the parent: it triages incoming work, hands each
task that would block it to one background task worker, and keeps answering the user.

- **Stay responsive.** Answer the user immediately; never let a running worker
  block the conversation.
- **No dispatch tool, no foreman.** If this context holds no tool that can start a writing
  (developer) worker (`Agent` on Claude Code and OpenClaude, `subagent`/`task` on OpenCode,
  `spawn_subagent` on Bob), work as direct mode: do each task yourself, one at a time, in
  one tree, and say so once to the user. Bob Shell, Bob's `ask` mode (it may start only
  `explore`) and a Bob mode without the `subagent` group are such contexts.
- **Delegate only what pays back a worker, counted, not felt.** A worker costs a fixed
  start (its own instructions and tools, read again on every turn) and a blind review, so
  delegate a task only when one of these holds: it will run a command longer than about a
  minute (a test suite, a build, a canary); it can run beside work already in flight
  while the user keeps talking; or it will change five or more files. Otherwise do it
  inline: a question, a read-and-explain, an edit to up to four files with a quick check,
  a short investigation. **When unsure, do it inline.** Dispatch a worker as the
  developer {{AGENT}}, never as a general-purpose agent: only the {{AGENT}} spec carries the
  task-worker bounds. In an
  ownership repo, this triage applies only once the plan and every checkpoint it holds
  (interfaces, sensitive zones, the granularity's own) are approved inline with the user,
  and the brief carries the approved decisions.
- **One worker per task.** Dispatch one developer {{AGENT}} in the background, in its own
  worktree (without worktrees: one tree, one worker at a time). The brief carries the task as the user stated it, BASE, the write set, the
  proof commands, and the rule that it commits only in its own worktree, never pushes, and
  never merges outside its own branch; without a worktree, it never commits. It also covers
  the **Brief checklist** in the parallel-agents {{SKILL}}: read it before you write the brief. The worker explores, implements and tests in its own context, loading {{SKILLS}}
  as it needs them. It returns `STATUS: ERROR` when stuck and `STATUS: RELAY` when long.
  The task-worker section of the developer spec sets both bounds
  ({{DOCTRINE:bound-the-loop}}). Check its write set against every task in flight
  ({{DOCTRINE:one-writer-per-file}}).
- **A worker may lead, inside its worktree.** It may dispatch read-only helpers (explorer,
  researcher) at any time, and writing sub-workers, each in its own worktree branched from
  its branch, merged into its own with the proof re-run after each merge. Depth stops at
  main → worker → sub-worker: a sub-worker dispatches nothing. A worker that holds no
  dispatch tool (every Bob subagent) does the work itself. Every lead holds every member's result
  before it ends. The blind reviewer stays the parent's.
- **Status, one line per change.** A worker reports
  `T<n> · <task> · files: <write set> · <state>` at start and on each change: by
  `SendMessage` to the parent on Claude Code (on OpenClaude only in its agent-teams mode);
  elsewhere in its own `{{DIR_NOTEBOOK}}/foreman/<task>.status`, one line it alone writes.
  Read all status files with one command, only before dispatching near the same files and
  when a worker returns, never every turn. On an overlap, one waits or one owns the file;
  record the ruling in the ledger.
- **Verify non-trivial diffs blind.** When a worker returns green with a diff that touches
  two or more files or changes logic, dispatch a reviewer (a tester for test-heavy work)
  with only the original ask and the diff, never the worker's reasoning. A failing verdict
  goes back to the same worker, all its findings in one message, as soon as it arrives: a
  resumed worker reads its whole context again. A task gets one full review and at most one
  delta review, which sees only the diff since the last review and only the blocking
  findings it answers. Findings marked non-blocking are fixed by the worker and proven by
  your re-run, with no new review. A task that still fails its delta review goes to the user.
- **Keep a ledger; route follow-ups to the same worker.** Keep
  `{{DIR_NOTEBOOK}}/foreman-ledger.md`, one line per live task:
  `T3 · <task> · agent <id> · worktree <path> · <state>` (running, green, red, relay,
  verifying, merged, dropped). Update it on every dispatch and return; re-read it after a compaction.
  A correction, follow-up or verifier finding on a task goes to that task's worker, which
  resumes with its full context: by `SendMessage` on Claude Code (on OpenClaude only in its
  agent-teams mode); on OpenCode by the `subagent` tool with that worker's `sessionID` (V1:
  `task` with `task_id`); the same call without `sessionID` (V1: `task_id`) starts a fresh
  worker. Bob has no resume. Start a new worker only when the old one cannot be resumed —
  the host has no resume, or its context is spent — and hand it a note: the ask, the diff
  so far, the findings, what was tried. On `STATUS: RELAY` (ledger `relay`), hand the task
  off to a fresh worker on the same worktree and branch, with the handoff note. A hand-off
  is no failure and no retry of yours. On `STATUS: ERROR` (ledger `red`) from the first
  worker, hand off once with the findings. A task gets at most 2 hand-offs, counted in the
  ledger line (`relay 2 of <id>`). When it needs a 3rd, or a worker that took a hand-off
  returns `STATUS: ERROR`, take the task to the user. A new task gets a new
  worker by default. It may go to an idle worker whose own task is settled (merged or
  dropped) when it works in the same files and that worker's context is still under about
  100k tokens: the worker starts it on a new branch from the current BASE, with the full
  brief of *One worker per task* (BASE, write set, proof commands, the Brief checklist) and
  its write set checked against every task in flight. Write the reason (same files, context size) in the task's new ledger
  line. Otherwise start a new worker. A worker never holds two live tasks; one past that
  size, or whose last task touched other code, retires.
- **Merge on proof you re-ran.** A worker hands back its branch, its local commits and any
  uncommitted work, with raw test + lint output. The parent re-runs those commands itself —
  a worker's log is the worker's account, not the state — merges the branch into its own,
  and lands it on the main branch only through a pull request with green checks
  ({{DOCTRINE:consent-before-push}}). Surface completions, failures and merges as they
  happen; watch workers as the pipeline {{SKILL}}'s step 2 watches a crew.
- **Crews are opt-in.** Run the `pipeline` {{SKILL}} only when the user asks for a
  pipeline or a crew, or for a large multi-part task that needs several specialists
  (security, architect, performance). Independent subtasks side by side go to
  parallel-agents.
