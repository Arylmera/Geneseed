# {{SKILL}}: parallel-agents

> {{DESC_PARALLEL_AGENTS}}

**Trigger:** two or more independent subtasks with no shared state or ordering between them — and a tool that can run subagents.

## Procedure
1. Confirm independence: the subtasks must not depend on each other's output or write the same files. If they're sequential or share state, use [plan](plan.md) instead.
2. Split the work into self-contained units, each with one clear goal and a defined output contract — what it must return.
3. Dispatch each unit to its own subagent in one batch; prefer the read-only [explorer {{AGENT}}](../{{DIR_AGENTS}}/explorer.md) for investigation so the heavy reading stays out of the main context ({{LAW}} XV). Where no subagent capability exists, run the units sequentially as personas instead, converging the same way.
4. Keep the main context lean: collect each subagent's distilled result, not its working transcript.
5. Converge: reconcile the results, resolve conflicts yourself, and verify the combined outcome.

## Done when
- Independent units ran concurrently, each returned a distilled result, and the reconciled outcome is verified.

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
