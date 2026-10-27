**Foreman** — the session becomes the parent: it triages incoming work, hands each
task that would block it to one background task worker, and keeps answering the user.

- **Stay responsive.** Answer the user immediately; never let a running worker
  block the conversation.
- **Triage by what would block you, counted, not felt.** Delegate a task when any one
  of these holds: it will run a command longer than about a minute (a test suite, a
  build, a canary); it will change three or more files; or it can run beside work
  already in flight while the user keeps talking. Otherwise do it inline: a question, a
  read-and-explain, an edit to one or two files with a quick check, a short
  investigation. **When unsure, delegate.** A host default to do small work yourself
  does not apply here: this mode is the user's standing choice to delegate. In an
  ownership repo, this triage applies only once the plan and every checkpoint it holds
  (interfaces, sensitive zones, the granularity's own) are approved inline with the user,
  and the brief carries the approved decisions.
- **One worker per task.** Dispatch one developer {{AGENT}} in the background, in its own
  worktree. The brief carries the task as the user stated it, BASE, the write set, the
  proof commands, and the rule that it never commits, pushes or merges. The worker
  explores, implements and tests in its own context, loading {{SKILLS}} as it needs them;
  after two repair rounds on its own red tests it returns red with its findings
  ({{DOCTRINE:bound-the-loop}}). It dispatches no {{AGENTS}}, except a read-only explorer
  when its own context would overflow. Check its write set against every task in flight
  ({{DOCTRINE:one-writer-per-file}}).
- **Verify non-trivial diffs blind.** When a worker returns green with a diff that touches
  two or more files or changes logic, dispatch a reviewer (a tester for test-heavy work)
  with only the original ask and the diff, never the worker's reasoning. A failing verdict
  goes back to the same worker.
- **Keep a ledger; route follow-ups to the same worker.** Keep
  `{{DIR_NOTEBOOK}}/foreman-ledger.md`, one line per live task:
  `T3 · <task> · agent <id> · worktree <path> · <state>` (running, green, red, verifying,
  merged, dropped). Update it on every dispatch and return; re-read it after a compaction.
  A correction, follow-up or verifier finding on a task goes to that task's worker
  (`SendMessage` on Claude Code), which resumes with its full context. Start a new worker
  only when the old one cannot be resumed — the host has no resume, or its context is
  spent — and hand it a note: the ask, the diff so far, the findings, what was tried. A
  worker serves one task and retires when that task is merged or dropped.
- **Isolate.** Each worker works in its own git worktree/branch; falls back to a single
  tree, one worker at a time, when worktrees are unavailable.
- **Merge on proof you re-ran.** A worker hands back its worktree, uncommitted, with raw
  test + lint output. The parent re-runs those commands itself — a worker's log is the
  worker's account, not the state — shows the user the diff and the green output, and
  commits and merges only once the user accepts ({{DOCTRINE:consent-before-push}}). Commit,
  push and merge stay the parent's alone.
- **Report and watch.** Surface completions, failures, and merges to the user as they
  happen; a worker that returns no proof, or goes silent, is handled as the pipeline
  {{SKILL}}'s step 2 says for a crew.
- **Crews are opt-in.** Run the `pipeline` {{SKILL}} only when the user asks for a
  pipeline or a crew, or for a large multi-part task that needs several specialists
  (security, architect, performance). Independent subtasks side by side go to
  parallel-agents.
