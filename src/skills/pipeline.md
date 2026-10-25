# {{SKILL}}: pipeline

> {{DESC_PIPELINE}}

{{CREDIT:superpowers:skills/subagent-driven-development/SKILL.md}}

**Trigger:** [foreman mode](../modes/foreman.md) routes a triaged *substantial* task here; also directly invocable without that mode whenever the user asks to "run a pipeline" for a development, documentation, research, or review task. The crew is a relay, not a fan-out: its agents take turns in one worktree, each handed what the previous one produced — for independent subtasks run side by side, use [parallel-agents](parallel-agents.md).

## What it is

A pipeline is a small crew of {{AGENTS}} working a single task in isolation from the rest of the session, so the parent can keep answering the user while the crew runs. The parent dispatches **one crew lead** in the background and steps away. The crew lead composes the crew, runs the relay, and returns one result envelope. The parent never merges on the crew's word: it re-runs the crew's proof commands itself and merges only once the user accepts.

The parent does not run the relay itself. Each hand-off it ran would pull it back from the user, which is the one thing this {{SKILL}} exists to prevent.

## Crew floors

The minimum roster per task type. The crew lead chooses the crew from the whole {{AGENT}} roster: any {{AGENT}} the task genuinely needs — security, architect, performance, reviewer, docs, historian, researcher, or any other — in any order the task needs. The floor is the least it may dispatch, never the most.

| Task type | Floor |
|---|---|
| Development | [explorer](../{{DIR_AGENTS}}/explorer.md) (analyst) → [developer](../{{DIR_AGENTS}}/developer.md) → [tester](../{{DIR_AGENTS}}/tester.md) + lint gate |
| Documentation | [explorer](../{{DIR_AGENTS}}/explorer.md) (analyst) → [docs](../{{DIR_AGENTS}}/docs.md) |
| Research / investigation | [explorer](../{{DIR_AGENTS}}/explorer.md) (analyst) alone; add [researcher](../{{DIR_AGENTS}}/researcher.md) when the question leaves the repository |
| Review / audit | [reviewer](../{{DIR_AGENTS}}/reviewer.md) + [skeptic](../{{DIR_AGENTS}}/skeptic.md) |

## Procedure

1. Take the triage as given. Under foreman mode the task reached you because it met the mode's count; invoked directly, the user's request is the trigger. Do not weigh it again and fall back to doing the work yourself.
2. **Dispatch the crew lead** in the background, using the host's general-purpose {{AGENT}}. Before dispatch, record BASE and set the crew's **write set**; check it against every other pipeline in flight ({{DOCTRINE:one-writer-per-file}}) — two crews whose sets overlap do not run at once. The brief carries: the task as the user stated it, the task type, BASE, the write set, the proof commands, a pointer to this {{SKILL}}, and the rule that it never commits, pushes or merges. Tell the user the pipeline is running, then go back to the user. Do not wait on the crew lead. **Then watch what you dispatched.** An envelope without proof, or one that says the crew is still waiting, is a failure: act on it at once — resume the crew lead (`SendMessage` on Claude Code) or take over its worktree — never wait for a notification it promised. A crew member's report that reaches you directly means its crew lead has already ended; act on it the same way. Before you end a turn with a crew still out, set a check where the host offers one (`CronCreate` on Claude Code, top level only); elsewhere, check at the start of every turn. A crew is stalled when its transcript and output have not grown for 15 minutes **and** it has no live child process: ping it once; if the next check shows no change, stop it, then take over from its worktree. A crew whose output still grows, or that runs a child process, is never taken over — a long suite or canary is not a stall.
3. **The crew lead composes the crew** from the floor above and adds any {{AGENT}} the task needs. It dispatches each crew member as its own subagent, each handed what the previous one produced. **The crew lead never ends with a member unresolved.** Its last message is its result: once it ends, nothing wakes it, and a member that outlives it reports past it, to the parent. It may run members in parallel, but holds every member's result before it ends — returned, or failed and then redone or named as failed in the envelope. A member that returns nothing has failed. Where the crew lead holds no dispatch tool (see *Hosts* below), it plays each role in turn itself, with the same hand-offs and the same envelope. Steps 4 to 7 are the crew lead's, except where they name the parent.
4. Isolate the crew's work in its own git worktree/branch. Where worktrees are unavailable, fall back to a single tree, one pipeline at a time, and say so. The crew writes only inside its write set; shared append files (registries, index tables, lockfiles, generated bundles) are the parent's to apply, never a crew's.
5. **The dev↔tester loop:** the developer implements, the tester validates — runs the tests and lint, produces raw logs. On failure, the findings go back to the developer — two repair rounds at most, then one fresh developer (a higher model tier where the host offers one) carrying the tester's findings ({{DOCTRINE:bound-the-loop}}); if that fails too, stop, do not merge, and report the failure with the branch left in place for inspection. A conflict or ambiguity between the plan, the findings and the code is yours to decide: decide it, record `Ruling: <choice> — <why> — <cost if wrong>` in the worklog, and continue. Stop only for what {{LAW:echo-the-intent}}, {{LAW:deletion-is-deliberate}} or {{DOCTRINE:consent-before-push}} names; every ruling goes in the final report ({{DOCTRINE:declare-the-judgment-calls}}). When the plan names a `Spec:`, the analyst reads it once; the spec outranks the plan.
6. **Pick the shape by host** (table below). Where the host offers a workflow tool the {{SKILL}} may use without a fresh opt-in, a saved script may stand in for the crew lead: analyst → developer → (tester ⇄ developer)×≤2 → fresh developer → proof ([workflow {{SKILL}}](workflow.md)). Everywhere else the crew lead runs the same stages, with the same hand-offs and the same delivery contract.
7. On success, hand the worktree back to the parent uncommitted, with the mechanical proof (test + lint output, exit codes) and the list of files it changed in the result envelope, rebased on the current base so a conflict with a sibling resolves on the crew's branch. The pipeline never commits, pushes, or merges ({{DOCTRINE:consent-before-push}}): the parent records BASE before dispatch and, before re-running the proof, confirms the branch descends from it and the diff is non-empty (an empty diff is a failure; never `HEAD~1`); it re-runs the proof commands itself, shows the user the diff and the output, and commits and merges once the user accepts.

## Hosts

| Host | Crew lead runs in the background | Crew lead can dispatch the crew | Shape |
|---|---|---|---|
| Claude Code | yes — a subagent started from the main conversation runs in the background by default | yes — subagents nest up to three layers by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), and a background subagent keeps the `Agent` tool | crew lead → crew subagents. Not the `Workflow` tool: it refuses without the user's opt-in for that task, and the mode is not one |
| OpenCode | the `task` tool starts a child session; whether the parent's turn waits is unverified | unverified — `permission.task` decides which subagents an agent may start | crew lead → crew subagents where it holds `task`; else roles in turn. A saved `workflow` script (no opt-in needed) may stand in for the crew lead |
| OpenClaude | expected as Claude Code (it reads Claude's subagent dialect); unverified | unverified | as Claude Code; else roles in turn |
| Bob | unverified — Bob reads Claude's subagent dialect | unverified | crew lead plays the roles in turn |

Check, do not assume: before the first pipeline of a session on a host marked unverified, look at the tools you and the crew lead actually hold ({{DOCTRINE:tool-discovery}}). When a fact above proves wrong, report it through this {{SKILL}}'s self-improvement loop.

## Delivery contract

A worktree containing the work, uncommitted, **plus** the mechanical proof in the result envelope: test and lint output with exit codes. Anything without green proof is surfaced, never merged. The crew's proof is what the parent re-runs, not what it trusts: a log is an account of the state, and the gate that decides the merge runs against the state itself.

## Done when

- Green proof: the crew delivered a worktree whose tests and lint the parent re-ran green, and the user accepted the commit and merge — or the loop cap was exhausted and the failure was reported with the branch left in place.

<!-- INCLUDE: skills/_self-improvement.md -->
