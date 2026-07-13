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
| Research / investigation | [explorer](../{{DIR_AGENTS}}/explorer.md) (analyst) alone |
| Review / audit | [reviewer](../{{DIR_AGENTS}}/reviewer.md) + [skeptic](../{{DIR_AGENTS}}/skeptic.md) |

## Procedure

1. Confirm the task is genuinely substantial — a trivial one-file tweak or a question does not warrant a crew; do it directly instead.
2. Compose the crew from the floor above, adding specialists only where the task demands them.
3. Isolate the crew's work in its own git worktree/branch (the SETUP.md worktree add-on). Where worktrees are unavailable, fall back to a single tree, one pipeline at a time, and say so.
4. **The dev↔tester loop:** the developer implements, the tester validates — runs the tests and lint, produces raw logs. On failure, the findings go back to the developer. Cap at **5** iterations; on exhaustion, stop, do not merge, and report the failure with the branch left in place for inspection.
5. **Two execution shapes**, chosen by host capability (same pattern as the [workflow {{SKILL}}](workflow.md)):
   - *Deterministic:* where the host exposes a `workflow` tool, run a saved script encoding analyst → developer → (tester ⇄ developer)×≤5 → proof.
   - *Model-driven fallback:* everywhere else, run the same stages via the [parallel-agents {{SKILL}}](parallel-agents.md) or sequential personas, with the same handoff envelopes and the same delivery contract.
6. On success, attach the mechanical proof to the branch (test + lint output, exit codes) and hand the result back to the parent for the merge decision — the pipeline never commits, pushes, or merges on its own ({{LAW}} XX).

## Delivery contract

A branch/worktree containing the work **plus** the mechanical proof: test and lint output with exit codes, either committed alongside the run's notes or handed back in the result envelope. Anything without green proof is surfaced, never merged — merging on proof (not re-verification) is only sound because every {{AGENT}} in the crew inherits all {{LAWS}} through the handoff envelope.

## Done when

- Green proof: the crew delivered a branch with passing tests and lint, and the parent merged it — or the loop cap was exhausted and the failure was reported with the branch left in place.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
