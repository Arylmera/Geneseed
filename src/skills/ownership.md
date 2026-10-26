# {{SKILL}}: ownership

> {{DESC_OWNERSHIP}}

{{CREDIT:vibe-wise:skills/learn/behavior.md}}

**Trigger:** the developer must stay the owner of production code: they decide each part and
can answer for every line that lands. Phrases: "ownership", "let me decide each file", "I must
answer for this code", "set up AGENTS.md for the team". Your harness file also sends you here in
an **application repo** — a git root holding a build manifest (`package.json`, `pom.xml`,
`build.gradle*`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `composer.json`,
`Gemfile`) — when its root `AGENTS.md` has `## Ownership` with `mode: on`, and before the first
write when it has no such section. To learn while building, use the
[learn-mode {{SKILL}}](learn-mode.md); it always comes first (see below).

The developer owns the decisions. You propose options, interfaces and placements, and write what
they approve. An approval without understanding is not ownership.

## Team config — `## Ownership` in the root `AGENTS.md`

Committed with the repo, outside any `<!-- BEGIN GENESEED -->` … `<!-- END GENESEED -->` block
(never write inside that block):

```markdown
## Ownership

mode: on                 # on | off — off opts this repo out
granularity: file        # feature | file | function — the team default
sensitive:               # always a checkpoint, whatever the granularity
  - src/main/java/**/payment/**
  - src/main/resources/db/migration/**
```

The rest of `AGENTS.md` holds the project's coding rules: conventions, commands, project rules.
They never go in `user-rules.md`, which is for agent behaviour only.

## Personal state — `.geneseed/ownership.md`

```markdown
Granularity: team        # or a level finer than the team default
## Pending
<the one checkpoint awaiting the developer, or "none">
## Decisions
- <date> <decision the developer took, with their reason>
```

A personal override may only be finer than the team default. A coarser one needs the developer's
explicit yes, logged under `## Decisions`.

<!-- INCLUDE: skills/_checkpoints.md -->

Here, interface and sensitive-zone checkpoints are mandatory. Log under `## Decisions` only forks,
interfaces, sensitive-zone changes and granularity changes — not routine steps.

## Setup
Run it when the repo has no `## Ownership` section, or when the developer asks. A hand-written
`AGENTS.md` without the section gets one lighter question first: "add the Ownership section?".
1. **Extract.** Use the method of the `AGENTS.md` step of the
   [document-project {{SKILL}}](document-project.md): read the code and propose the conventions
   found — naming, layers, test patterns, build commands. Write nothing yet.
2. **Kit.** If the stack matches a kit (`spring-boot`, `react`), propose it.
3. **Interview.** About five questions, one at a time, each with a recommended answer: confirm or
   correct the conventions; ownership on for this repo; the default granularity; the sensitive
   zones (for example `payment/`, migrations, security config); free-form project rules.
4. **Write** — the only write of the setup: `AGENTS.md` (at most ~60 lines, this section
   included) and `.geneseed/ownership.md`. Show the diff. Commit only on request.
5. **Check how diffs reach the developer.** Read the permission mode from the host's settings;
   when the live mode cannot be seen there, ask the developer. If edits are auto-accepted (bypass,
   accept-edits), warn that no native diff will stop for them; if they keep it, use the compact
   diff (see *Each checkpoint*). On OpenCode, propose `permission.edit: "ask"` in the project
   `opencode.json`.

"Proceed without" skips the setup for this session only; propose it again in the next one.

## Granularity
- `feature` — one checkpoint on the plan; then each file is announced as routine, and its Edit is
  the approval.
- `file` — the default: no plan checkpoint; one checkpoint per file, announced or asked (see
  *Each checkpoint*).
- `function` — the signature, then the body.

Whatever the level, an **interface is always a checkpoint** — a public signature, an API
contract, a DB schema, a new dependency — and so is every change in a `sensitive:` zone. The
developer can change the level for the current task at any moment ("go finer here", "do the rest
in one go"); the file keeps its default.

**Adapt to complexity, asymmetrically.** Weigh these signals with judgement, no metric tool:
business branching, transactions, concurrency, security, a non-obvious algorithm, an effect on
other modules, a performance trap, deep nesting, long methods, duplication.
- **Finer** — decide alone, and add 3–6 lines on why the part is complex and what to watch for
  (the detail on request).
- **Coarser** — propose it ("these 6 DTOs and 2 mappers are trivial — one batch?") and wait for
  the developer's yes. Never coarsen silently.

## Each checkpoint
Announce, do not ask, except at a real fork.
- **Routine** (follows the plan and the conventions, no choice) — announce it in 1–3 lines. The
  native Edit is the approval: accepting it answers the checkpoint, refusing it returns to it.
  The Edit prompt is the wait, so write `## Pending` only for a step you ask about.
- **Real fork** (two or more credible options, an interface, a sensitive zone) — ask, with the
  recommended option first.
- **Complex** (the signals above) — announce it, plus a 3–6 line explanation.

The chat carries what / where / why in 5–10 lines: `file:line`, the changed signature or
interface, the options at a fork — no code. The native Edit carries the diff. When edits are
auto-accepted, show a compact diff in the chat first (changed hunks only, ±2 lines); that is an
asked step: write `## Pending` and wait for the developer's reply.

Guardrails:
1. Never ask what the code, `AGENTS.md` or an earlier decision of the session already answers.
2. Group the decisions of one step into one message.
3. Always recommend, so "ok" is an answer.
4. "Carry on" switches the rest of the task to routine. "Skip" and "fewer checkpoints" lower the
   cadence the same way. Neither removes a mandatory checkpoint.

## Delegation
The parent holds every checkpoint. A background worker — a Foreman developer, a pipeline crew, a
parallel agent — receives only decisions already approved. It never runs the setup and never
treats its own diff as approved. On a choice no approved decision covers, it stops and returns
`blocked: decision needed` with the options.

## Refactor in a named zone
When the developer names a zone (a file, a class, a package), stay inside it. With the signals
above, propose 2–4 points where a refactor pays (`file:line` and why); they pick, then follow the
[refactor {{SKILL}}](refactor.md). No repo-wide scan. With no zone named, refactor runs unchanged.

## learn-mode comes first
While `.geneseed/learn.md` says `Learning mode: active`, learn-mode drives the flow: no project
can forbid a developer from learning. The team rules in `AGENTS.md` — conventions, and interfaces
and sensitive zones as checkpoints — still apply on top.

## Done when
- The root `AGENTS.md` has `## Ownership` outside the Geneseed block, or the developer chose
  "proceed without" or `mode: off`; every interface and sensitive-zone change got its own
  checkpoint; no code landed without an answered checkpoint or an accepted Edit; each fork,
  interface, sensitive-zone change and granularity change is logged in `.geneseed/ownership.md`;
  and the developer can say, for each change, what changed, where and why.

<!-- INCLUDE: skills/_self-improvement.md -->
