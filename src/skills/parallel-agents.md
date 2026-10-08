# {{SKILL}}: parallel-agents

> {{DESC_PARALLEL_AGENTS}}

**Trigger:** two or more independent subtasks with no shared state or ordering between them — and a tool that can run subagents.

## Procedure
1. Confirm independence: the subtasks must not depend on each other's output or write the same files ({{DOCTRINE:one-writer-per-file}}). Write down each unit's **write set** — the files or globs it may change — and intersect them; an overlap runs in sequence or goes to one owner, and shared append files (registries, index tables, lockfiles, generated bundles) stay with you. If they're sequential or share state, use [plan](plan.md) instead.
2. Split the work into self-contained units, each with one clear goal and a defined output contract — what it must return.
3. Dispatch each unit to its own subagent in one batch, each under a handoff envelope: the unit's goal, the inputs it needs, its **write set** (edit nothing outside it; return rows for a shared file instead of writing it), the observable check that proves it done, its output contract — naming every file it changed — and the inherited constraints (no commit/push — {{DOCTRINE:consent-before-push}} stays with you; gaps reported, never invented). Hand each unit only the access its goal needs ({{LAW:least-privilege}}). Prefer the read-only [explorer {{AGENT}}](../{{DIR_AGENTS}}/explorer.md) for investigation so the heavy reading stays out of the main context ({{DOCTRINE:context-economy}}). Where no subagent capability exists, run the units sequentially as personas instead, converging the same way.
4. Keep the main context lean: collect each subagent's distilled result, not its working transcript.
5. Converge: compare each unit's changed files against its write set and against its siblings' — an edit outside the set or a file two units touched is a conflict you resolve before anything else — apply the shared-file rows yourself, then verify the combined outcome.
6. **A plan with blocking edges.** To build a [plan](plan.md) file's slices — each with its `Blocked by:` line — in one run, dispatch every unblocked slice on its own branch off one integration branch, merge each into it as it returns (each merge is a commit — {{DOCTRINE:consent-before-push}} stays with you), and recompute the unblocked set from the plan after every merge — newly freed slices go out at once.

## Done when
- Independent units ran concurrently, each returned a distilled result, and the reconciled outcome is verified.

<!-- INCLUDE: skills/_self-improvement.md -->
