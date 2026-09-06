# {{SKILL}}: workflow

> {{DESC_WORKFLOW}}

**Trigger:** a task that benefits from *deterministic* multi-agent orchestration — a
fan-out across independent units, a staged find→verify pipeline, a fresh-context
handoff between phases, or a loop that accumulates to a target — **and** the host
exposes a workflow tool. When it does not, use [parallel-agents](parallel-agents.md)
or [council](council.md) instead — those are *model-driven*; this {{SKILL}} is
*code-driven*.

## What it is

A workflow is a script that orchestrates subagents in **code**, not prose. The
script — not the model — decides what fans out, what runs in sequence, and what
verifies; the host runs it and hands back a distilled result. Use it when the control
flow should be exact and repeatable rather than re-improvised each time, and when the
work is worth a crew: a one-file tweak or a question never is.

## The hosts

| Host | Tool | Scripts | Opt-in |
|---|---|---|---|
| OpenCode | `workflow` (the `geneseed-workflow` plugin) | **saved only** — `<name>.js` in `.opencode/workflows/` per repo or `<config>/workflows/` global (`GENESEED_WORKFLOWS_DIR` overrides); nothing inline is eval'd | none — call it when the shape fits |
| Claude Code | `Workflow` (native) | a saved `.claude/workflows/<name>` by `name`, **or** an inline `script` you author | **required** — the tool refuses unless the user opted in for this task ("use a workflow", "ultracode", a skill that says so) |
| Bob, Copilot | none | — | fall back to [parallel-agents](parallel-agents.md) / [council](council.md) |

Both runtimes speak the same primitives — `agent()`, `parallel()`, `pipeline()`,
`phase()`, `args` — and every script opens with a literal `export const meta = { name,
description, phases }`. The four shipped scripts are OpenCode-saved today; on Claude
Code the same shapes are authored inline (the host's `workflow-authoring` reference
carries the script API — load it before writing one).

## The shipped shapes

- **review** — sweep a change across dimensions, then adversarially verify each
  finding before reporting (the canonical find→verify pipeline: a dimension's findings
  verify as soon as that dimension returns, no barrier).
- **research-plan-implement** — three clean phases, each in its own child context,
  carrying only the distilled output of the prior phase.
- **council** — the [council](council.md) debate on rails: seat the stance {{AGENTS}},
  gather positions in parallel, chair synthesises, dissent preserved.
- **dispatch** — decompose a multi-domain goal, route each subtask to its owning
  capability {{AGENT}}, converge (model-driven fallback: [parallel-agents](parallel-agents.md)).

## Procedure
1. **Confirm the host and the opt-in.** OpenCode: the `workflow` tool is present. Claude
   Code: the tool is present *and* the user opted in — if the shape plainly warrants a
   workflow but they have not, describe it in two lines with its rough cost (how many
   agents) and ask; never call the tool on your own judgement. No tool at all → fall
   back and stop here.
2. **Confirm the task is crew-sized** and the shape is one of the four above (or a
   plain variation). Sequential work with shared state is a [plan](plan.md); a
   dev↔test loop in an isolated tree is a [pipeline](pipeline.md), which itself runs on
   a workflow where one exists.
3. **Pick saved over inline.** List what is available first — OpenCode: call `workflow`
   with no `name`; Claude Code: read `.claude/workflows/`. A saved script has been run
   before; an inline one has not. Author inline only when no saved shape fits, keep it
   to the primitives, and hold to the host's size guideline unless the user asked for
   more.
4. **Pass the task as `args`, never baked in** — target paths, the motion, the question,
   any timestamp. Scripts stay deterministic: no wall clock, no randomness, nothing
   read from the environment that the next run would see differently, so a run is a
   pure function of (script, args, child replies) and can be replayed.
5. **Run it and wait for the result, not the transcript.** The run is asynchronous on
   Claude Code (a task notification arrives; `/workflows` watches it live) and
   synchronous on OpenCode. Read the returned summary; the full structured result and
   the phase-by-phase trace are in the run's progress file — point the user there for
   detail, do not paste it. Never fabricate a result for a run that has not returned.
6. **On failure, resume — don't rerun.** A script that died mid-way keeps its completed
   `agent()` results; fix the script or the args and resume from the run id where the
   host supports it, so finished stages are not paid twice. A stage that keeps failing
   is a finding about the task, not a reason to loop.
7. **Exit — carry the conclusion yourself.** The workflow gathers and verifies;
   committing, pushing, merging, or opening anything outward stays with you
   ({{DOCTRINE}} process 5, {{LAW}} IV). State what the run concluded, what you are
   doing with it, and where the trace lives.

## Done when
- The right shape ran to completion on the host's tool (with the user's opt-in where
  the host demands one), its summary was read and its trace is locatable, a failed run
  was resumed rather than restarted, and you — not the script — have carried its
  conclusion into the next {{SKILL}} or the commit gate. Or: no tool existed, and the
  model-driven equivalent ran instead.

<!-- INCLUDE: skills/_self-improvement.md -->
