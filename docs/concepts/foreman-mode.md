---
group: concepts
order: 16
title: "Foreman mode"
kind: "concept"
section: "Working together"
description: "Direct or foreman: whether the session does the work or hands it to a task worker."
link: {"hash": "#/installs/hosts", "label": "Set the mode on Installs →"}
---
**Mode** decides how work gets executed in a session. Two modes ship: **direct**, the default, where the agent does every task itself, and **foreman**, where the session hands each task that would block it to a background [agent](agents.md) and keeps talking to you while it works.

> **You already know this:** a tech lead with a team. Quick questions get answered on the spot; a real feature becomes a ticket that someone builds on a branch, and the lead reviews the result before it is merged.

Mode is chosen at build time, so it does not drift mid-session, and kept across every rebuild and re-theme. It is separate from [posture](collaboration.md) (the relationship register), the doctrine packs ([Rules](rules.md)) and [footprint](footprint.md). It is also separate from a [loop](loops.md) — a task worker or a pipeline is a one-shot run for a single task, committed only on its own branch and merged by the session once you accept; a loop is a long-running state machine that commits each validated iteration on its own branch.

### direct — the default

The agent works every task itself, turn by turn. Nothing is spawned; you talk to one agent from start to finish. Keep it unless you want the session to manage work for you.

### foreman — a session that triages

The session sorts every request:

- **Delegated** — handed to one **task worker** running in the background. The session tells you it is running and stays free to answer you. A task is delegated when any one of these holds: it will run a command longer than about a minute (a test suite, a build, a canary), it will change three or more files, or it can run beside work already in flight while you keep talking.
- **Inline** — none of those holds: a question, a read-and-explain, an edit to one or two files with a quick check, a short investigation. Done directly, as in direct mode.

When the session is unsure, it delegates. The test is still a count, because "substantial" left to judgement lost every time to the host's own default of doing small work in place. The count asks what would block the session, not how big the task looks.

### The task worker

A task worker is one `developer` agent in its own git worktree. It explores, implements and tests in a single context, loading skills as it needs them, so nothing it read is lost in a hand-off. After two repair rounds on its own failing tests it returns with its findings instead of looping.

A worker can lead a small team inside its own worktree. It can start read-only helpers (`explorer`, `researcher`) at any time. It can also start writing **sub-workers**, each in its own worktree branched from the worker's branch. The worker commits and merges their branches into its own branch, locally, and re-runs the proof after each merge. *Consent Before Push* names this as a batch. The git gate lets a commit or merge through without a prompt only when all of these hold: the host marks the call as a sub-agent's (Claude Code's `agent_id`), the directory is a linked worktree, and its branch is not shared (`main`, `master`, `develop`, `development`, `release/*`, `hotfix/*`, a remote's default, or the branch the main checkout has, in any letter case). The command may hold only adds, read-only git commands and plain commit or merge arguments with one quoted message, after at most one `cd`; anything that can run a second command (`(`, `@`, `$`, `{`, a backtick) asks. A session that only runs in a worktree, as the desktop app's do, still asks. A push still asks everywhere. Bob sends no sub-agent field, so Bob still logs its warning. On OpenCode the static `git commit*` permission still asks, because a permission glob sees only the command, not the worktree. The gate reads the command, not git's own hooks: a `post-commit` hook or a `core.hooksPath` can push on commit, on any branch, as it always could. Nesting stops at two levels below the session: session → worker → sub-worker. A sub-worker starts nothing. A lead holds every member's result before it ends. The blind reviewer is still the session's, never the worker's.

| Host | What caps the depth |
| --- | --- |
| Claude Code | the install writes `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "2"` into its settings file, only when the key is absent (Claude Code allows three levels by default) |
| OpenCode | the install writes a top-level `"subagent_depth": 2` into `opencode.json`, only when the key is absent |
| OpenClaude | nothing in the host: its source has no such cap (checked on 0.31). The rule text is the only bound |
| Bob | nothing documented. The rule text is the only bound |

A value you set yourself is kept. The value 2 is read as session → worker → sub-worker; that reading is the design's, not yet observed live on either host.

When a worker returns green with a diff that touches two or more files or changes logic, the session sends a `reviewer` only your request and the diff — never the worker's reasoning — for a blind check. A failing verdict goes back to the same worker.

The session keeps a ledger in its notebook (`notebook/foreman-ledger.md`), one line per task: the task, the agent id, the worktree and the state. A correction, a follow-up or a reviewer finding goes back to **the same worker**, which resumes with everything it already knows. A new worker starts only when the old one cannot be resumed, and it receives a note of the ask, the diff so far and what was tried. A worker serves one task and retires once that task is merged or dropped.

### Status lines

A worker reports one line at start and on each change: `T<n> · <task> · files: <write set> · <state>`. On Claude Code it sends that line to the session with `SendMessage`; OpenClaude can do the same only in its agent-teams mode. OpenCode and Bob have no channel back to the session, so there the worker writes the line to its own file, `notebook/foreman/<task>.status`, which no other agent writes. The session reads all status files with one command, and only at two moments: before it starts a worker near the same files, and when a worker returns. When two write sets overlap, the session decides: one worker waits, or one worker owns the file. It records that decision in the ledger.

> **Why not a crew by default?** Splitting a task by role — one agent reads, the next builds, the next tests — passes each result on as a summary, and the next agent reads the code again. Anthropic's guide [When to fold subagents into your main agent loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop) found one loop with skills usually beats that, and keeps separate agents for verification, parallel work and context that would overflow. The blind reviewer is that kind of split.

### What a pipeline is

A **pipeline** is the opt-in alternative: a small crew of agents working one task in isolation. The session runs one when you ask for a pipeline or a crew, or when a large task needs several specialists. The minimum crew depends on the task:

| Task | Minimum crew |
| --- | --- |
| development | `explorer` (analyses the request) → `developer` → `tester`, plus a lint check |
| documentation | `explorer` → `docs` |
| research | `explorer`; add `researcher` when the question leaves the repository |
| review or audit | `reviewer` + `skeptic` |

The session does not run the crew itself. It starts one **crew lead** in the background and goes back to you. The crew lead picks the crew from the whole agent roster — `security`, `architect`, `performance`, `reviewer` and so on, as the task needs, never fewer than the minimum — and passes the work from one agent to the next. On Claude Code each crew member is its own subagent. On a host where the crew lead cannot start subagents, it plays each role in turn. The `pipeline` skill has the table per host.

The crew works in its own git worktree and branch. When worktrees are unavailable it falls back to the main tree, one pipeline at a time, and says so. Two pipelines whose sets of files overlap do not run at once.

Inside the crew, the developer implements and the tester runs the tests and lint. Failures go back to the developer for at most two repair rounds, then to one fresh developer carrying the tester's findings; if that fails too, the crew stops and reports the failure, leaving the branch for you to inspect.

### Nothing lands beyond the worker's branch

A worker or crew commits only in its own worktree, never pushes, and never merges outside its own branch. When it is done, it hands back that branch: its local commits (its own, and its sub-workers' merges) and any uncommitted work. Each comes with the raw test and lint output and the list of files it changed. Then the session:

1. re-runs the tests and lint itself — its log is its own account, not proof;
2. shows you the diff from the base it recorded, and the green output;
3. commits and merges **only once you accept**.

Push, and every merge beyond a worker's own branch, belong to the session alone, under *Consent Before Push* ([Rules](rules.md)). A worker or crew that cannot get to green reports back instead of landing broken work.

You can also start a pipeline without foreman mode: ask the agent to "run a pipeline" for a task, and the `pipeline` [skill](skills.md) takes it from there.

### How to set it

- **Setup wizard** — asks for mode alongside voice, posture, doctrine packs and footprint:

  ```bash
  geneseed setup
  ```

- **Web console** — the per-install **Mode** dropdown on the Installs page, then **Apply**.
- **Command line** — with the emit target of the install you are changing; switch back with `--mode direct`:

  ```bash
  geneseed build --emit claude-global --mode foreman
  ```
