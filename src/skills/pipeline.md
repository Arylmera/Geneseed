# {{SKILL}}: pipeline

> {{DESC_PIPELINE}}

**Trigger:** [foreman mode](../modes/foreman.md) routes a triaged *substantial* task here; also directly invocable without that mode whenever the user asks to "run a pipeline" for a development, documentation, research, or review task.

## What it is

A pipeline is a small crew of {{AGENTS}} — analyst, developer, tester, plus whatever specialists the task demands — working a single task in isolation from the rest of the session, so the parent can keep answering the user while the crew runs. The parent never re-verifies the crew's work; it checks the crew's own mechanical proof and merges on that.

## Crew floors

The minimum roster per task type. The parent may add specialists on top — security, architect, reviewer, docs, historian, or any other {{AGENT}} the task genuinely needs — but never dispatches below the floor.

| Task type | Floor |
|---|---|
| Development | [explorer](../{{DIR_AGENTS}}/explorer.md) (analyst) → [developer](../{{DIR_AGENTS}}/developer.md) → [tester](../{{DIR_AGENTS}}/tester.md) + lint gate |
| Documentation | [explorer](../{{DIR_AGENTS}}/explorer.md) (analyst) → [docs](../{{DIR_AGENTS}}/docs.md) |
| Research / investigation | [explorer](../{{DIR_AGENTS}}/explorer.md) (analyst) alone; add [researcher](../{{DIR_AGENTS}}/researcher.md) when the question leaves the repository |
| Review / audit | [reviewer](../{{DIR_AGENTS}}/reviewer.md) + [skeptic](../{{DIR_AGENTS}}/skeptic.md) |

## Procedure

1. Confirm the task is genuinely substantial — a trivial one-file tweak or a question does not warrant a crew; do it directly instead.
2. Compose the crew from the floor above, adding specialists only where the task demands them.
3. Isolate the crew's work in its own git worktree/branch (the SETUP.md worktree add-on). Where worktrees are unavailable, fall back to a single tree, one pipeline at a time, and say so.
4. **The dev↔tester loop:** the developer implements, the tester validates — runs the tests and lint, produces raw logs. On failure, the findings go back to the developer. Cap at **5** iterations; on exhaustion, stop, do not merge, and report the failure with the branch left in place for inspection.
5. **Two execution shapes**, chosen by host capability (same pattern as the [workflow {{SKILL}}](workflow.md)):
   - *Deterministic:* where the host exposes a `workflow` tool, run a saved script encoding analyst → developer → (tester ⇄ developer)×≤5 → proof.
   - *Model-driven fallback:* everywhere else, run the same stages via the [parallel-agents {{SKILL}}](parallel-agents.md) or sequential personas, with the same handoff envelopes and the same delivery contract.
6. On success, hand the worktree back to the parent uncommitted, with the mechanical proof (test + lint output, exit codes) in the result envelope. The pipeline never commits, pushes, or merges ({{DOCTRINE}} process 5): the parent re-runs the proof commands itself, shows the user the diff and the output, and commits and merges once the user accepts.

## Delivery contract

A worktree containing the work, uncommitted, **plus** the mechanical proof in the result envelope: test and lint output with exit codes. Anything without green proof is surfaced, never merged. The crew's proof is what the parent re-runs, not what it trusts: a log is an account of the state, and the gate that decides the merge runs against the state itself.

## Done when

- Green proof: the crew delivered a worktree whose tests and lint the parent re-ran green, and the user accepted the commit and merge — or the loop cap was exhausted and the failure was reported with the branch left in place.

<!-- INCLUDE: skills/_self-improvement.md -->
