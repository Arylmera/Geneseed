---
group: concepts
order: 17
title: "Ownership"
kind: "concept"
section: "Working together"
description: "The developer decides each part of production code, at a granularity the team sets."
---
**Ownership** keeps the developer the author of production code. The agent proposes options, interfaces and placements; the developer decides each part, at a granularity the team chooses, and can answer for every line that lands.

> **You already know this:** pair programming where you hold the keyboard rights. Your partner suggests, explains the hard parts and types what you approve — but you must be able to defend every change in review without them.

## Why

The Credo carries an **Ownership** section, always in force: the code belongs to whoever will answer for it — the developer who ships it, the team that maintains it — never to the agent that typed it. Work is handed over only when the developer can say what changed, where and why. Approval without understanding is not ownership, so a genuinely complex part is explained before it lands, unasked.

The `ownership` [skill](skills.md) carries the procedure; a repository switches it on for its team.

## The `## Ownership` section

The team's settings live in the committed root `AGENTS.md`, the cross-tool rules file, outside any `<!-- BEGIN GENESEED -->` block:

```markdown
## Ownership

mode: on                 # on | off
granularity: file        # feature | file | function — the team default
sensitive:               # always a checkpoint, whatever the granularity
  - src/main/java/**/payment/**
  - src/main/resources/db/migration/**
```

The rest of `AGENTS.md` holds the project's coding rules: conventions, build and test commands, project rules. Each developer's own state — a finer granularity, the pending checkpoint, the log of decisions — lives in `.geneseed/ownership.md`. That file is created only when there is such state to keep, and no file means the team granularity, nothing pending and no decisions. It is never committed: from its first write, `.geneseed/` gets a `.gitignore` that ignores everything in it except the team's files — the `.gitignore` itself, `bricks/`, `loops/`, `protected-checks.txt` and `done-checks.txt`. [Set up ownership](../guides/set-up-ownership.md) walks through the setup, which writes `AGENTS.md` only.

## Granularity

- **`feature`** — one checkpoint on the plan, then each file is announced and its edit is the approval.
- **`file`** — the default: one checkpoint per file.
- **`function`** — the signature, then the body.

Whatever the level, an **interface is always a checkpoint** — a public signature, an API contract, a database schema, a new dependency — and so is every change in a `sensitive:` zone. The developer can change the level for the current task at any moment ("go finer here", "do the rest in one go"); the file keeps its default.

On complex code (business branching, transactions, concurrency, security) the agent goes finer by itself and explains why; on trivial code it may only *propose* a coarser batch. It announces routine steps — the host's diff prompt is the approval — and asks only at a real fork, recommended option first.

## The first-write gate

On every host, a hook stops the first write in an application that has not decided yet:

- **Where.** An *application repo*: a git root holding a build manifest — `package.json`, `pom.xml`, `build.gradle*`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `composer.json` or `Gemfile`. A folder with no git or no manifest is never gated.
- **When.** Its root `AGENTS.md` has no `## Ownership` heading outside Geneseed's managed block. The heading with `mode: on` or `mode: off` both count: the team has decided.
- **What.** The first Write, Edit or NotebookEdit of the session in that repo is refused once. The refusal's reason goes to the agent, which then asks you: set ownership up, or proceed without for this session. The next write passes. Writes to `AGENTS.md` and `.geneseed/` themselves always pass.
- **What it skips.** Sub-agents defer on Claude Code and OpenClaude, which name them in the hook's input, and on OpenCode, whose guard sees that the session has a parent: a sub-agent cannot ask you, so it never spends the session's one stop. Shell writes are not seen; the line in the harness file covers them.

Per host: Claude Code and OpenClaude deny the call with the reason; Bob refuses it with exit 2, once; OpenCode's guard plugin refuses it. See [Hooks](hooks.md) and [Rule enforcement, by host](enforcement-table.md).

## Turning it off

| Scope | How | Lasts |
| --- | --- | --- |
| One session | Answer "proceed without" when the agent asks | This session; it asks again in the next one |
| One repo | `## Ownership` with `mode: off` in the root `AGENTS.md` | Until the line changes; travels with the repo |
| One install | Rebuild with `--no-ownership-gate` ([Exclusions](exclusions.md)) | Every rebuild replays it |

The per-install switch stops only the gate. A repo with `mode: on` still runs the ownership checkpoints, and the Credo section still binds.

## learn-mode comes first

While `.geneseed/learn.md` says `Learning mode: active`, learn-mode drives the flow. It is the developer's personal choice, and no project can forbid a developer from learning. The team's `AGENTS.md` rules still apply on top: conventions, and interfaces and sensitive zones as checkpoints.

The two draw close — both stop at checkpoints, and learn-mode may now propose a solution, though it never applies one it has not explained. Keep them apart by what differs:

| | learn-mode | ownership |
| --- | --- | --- |
| Who chooses it | The developer, for themself | The team, in `AGENTS.md`; a developer may go finer, coarser only with an explicit, logged yes |
| Explanation | Every solution, before it is applied | Complex parts only; routine steps are announced |
| Record | `## Understood` in `.geneseed/learn.md`: what the developer has grasped | `## Decisions` in `.geneseed/ownership.md`: forks, interfaces, sensitive zones, granularity changes |
| Pacing | A level: beginner, intermediate, advanced | A granularity: feature, file, function |

Under [Foreman mode](foreman-mode.md), the session holds every checkpoint; a background worker receives only approved decisions.
