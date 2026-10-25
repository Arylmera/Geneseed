# {{SKILL}}: parallel-agents

> {{DESC_PARALLEL_AGENTS}}

{{CREDIT:superpowers:skills/subagent-driven-development/SKILL.md}}

{{CREDIT:mattpocock-skills:skills/engineering/implement-spec/SKILL.md}}

**Trigger:** two or more independent subtasks with no shared state or ordering between them — and a tool that can run subagents. The units run side by side and never see each other's work; when one agent must build on what the previous one produced, that is a relay — use [pipeline](pipeline.md).

## Procedure
1. Confirm independence: the subtasks must not depend on each other's output or write the same files ({{DOCTRINE:one-writer-per-file}}). Write down each unit's **write set** — the files or globs it may change — and intersect them; an overlap runs in sequence or goes to one owner, and shared append files (registries, index tables, lockfiles, generated bundles) stay with you. If they're sequential or share state, use [plan](plan.md) instead.
2. Split the work into self-contained units, each with one clear goal and a defined output contract — what it must return. Several small edits of one kind (the same fix, constant or field across files) form ONE unit with the union write set and get one review.
3. Dispatch each unit to its own subagent in one batch, each under a handoff envelope: the unit's goal, the inputs it needs, its **write set** (edit nothing outside it; return rows for a shared file instead of writing it), the observable check that proves it done, its output contract — naming every file it changed — and the inherited constraints (no commit/push — {{DOCTRINE:consent-before-push}} stays with you; no sub-agents of its own — review comes from you; gaps reported, never invented). Hand each unit only the access its goal needs ({{LAW:least-privilege}}). Prefer the read-only [explorer {{AGENT}}](../{{DIR_AGENTS}}/explorer.md) for investigation so the heavy reading stays out of the main context ({{DOCTRINE:context-economy}}). Where no subagent capability exists, run the units sequentially as personas instead, converging the same way.
4. Keep the main context lean: collect each subagent's distilled result, not its working transcript. Watch every unit you dispatched in the background as the [pipeline {{SKILL}}](pipeline.md)'s step 2 watches a crew: a result without its check, or one that says it is still waiting, is a failure to act on at once — resume the unit or redo it — never a notification to wait for.
5. Converge: compare each unit's changed files against its write set and against its siblings' — an edit outside the set, a file two units touched, or a file in a batch's set that never changed is a conflict you resolve before anything else — apply the shared-file rows yourself, then verify the combined outcome. A conflict or ambiguity between the plan, the findings and the code is yours to decide: decide it, record `Ruling: <choice> — <why> — <cost if wrong>` in the worklog, and continue. Stop only for what {{LAW:echo-the-intent}}, {{LAW:deletion-is-deliberate}} or {{DOCTRINE:consent-before-push}} names; every ruling goes in the final report ({{DOCTRINE:declare-the-judgment-calls}}).
6. **A plan with blocking edges.** To build a [plan](plan.md) file's slices — each with its `Blocked by:` line — in one run, dispatch every unblocked slice on its own branch off one integration branch, merge each into it as it returns (each merge is a commit — {{DOCTRINE:consent-before-push}} stays with you), and recompute the unblocked set from the plan after every merge — newly freed slices go out at once. When the plan names a `Spec:`, every slice reads it once; the spec outranks the plan where they conflict. Each slice branches off the integration tip at its own dispatch (its BASE) and merges the current tip back into its branch before returning, so a conflict with a sibling resolves on the slice's branch; before re-running the proof, confirm the branch descends from BASE and the diff is non-empty — an empty diff is a failure, not a clean result. Never diff against `HEAD~1`. When the plan is exhausted, review the integration branch whole with [geneseed-code-review](geneseed-code-review.md) before reporting.

## Done when
- Independent units ran concurrently, each returned a distilled result, and the reconciled outcome is verified.

<!-- INCLUDE: skills/_self-improvement.md -->
