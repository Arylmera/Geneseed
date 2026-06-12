# {{SKILL}}: workflow

> {{DESC_WORKFLOW}}

**Trigger:** a task that benefits from *deterministic* multi-agent orchestration — fan-out across independent units, a staged find→verify pipeline, or a loop that accumulates to a target — **and** the host provides the `workflow` tool (OpenCode). When the host has no such tool, use [parallel-agents](parallel-agents.md) or [council](council.md) instead — those are *model-driven*; this {{SKILL}} is *code-driven*.

## What it is

A `workflow` is a saved script that orchestrates subagents in **code**, not prose. The script — not the model — decides what fans out, what runs in sequence, and what verifies. The host runs it and hands you back the distilled result. Use it when the control flow should be exact and repeatable rather than re-improvised each time.

Saved workflows live in the host's workflows directory — on OpenCode that is `.opencode/workflows/` in the repo, or `workflows/` under the global config (see the adapter README) — and you run one **by name**, you do not author one inline. To add a new workflow, copy an existing script and register it there.

## Procedure
1. Confirm the host exposes the `workflow` tool. If not, fall back to [parallel-agents](parallel-agents.md) / [council](council.md) and stop here.
2. Pick the saved workflow that fits the shape of the work — call `workflow` with no `name`, or an unknown one, to list what is available:
   - **review** — sweep a change across dimensions, then adversarially verify each finding before reporting (the canonical find→verify pipeline).
   - **research-plan-implement** — three clean phases with fresh-context handoffs between them.
   - **council** — the [council](council.md) debate as deterministic code: seat the stance {{AGENTS}}, gather positions in parallel, synthesise a verdict.
3. Run it: `workflow({ name, args })`. Pass the task-specific inputs (target paths, the motion, the question) as `args` — the script reads them.
4. Read the returned summary. The full structured result and a phase-by-phase trace are written to the run's progress file; point the user at it if they want the detail.
5. Act on the result yourself — the workflow gathers and verifies, but committing, pushing, or merging stays with you ({{LAW}} XX).

## Done when
- The right saved workflow ran to completion, its result was read, and you have carried its conclusion forward — or, where no `workflow` tool exists, the equivalent model-driven {{SKILL}} was used instead.

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
