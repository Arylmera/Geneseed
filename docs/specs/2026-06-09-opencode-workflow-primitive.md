# Spec — OpenCode Workflow Primitive

**Date:** 2026-06-09
**Status:** implemented (verified 2026-06-15)
**Scope:** `adapters/opencode/` + `src/skills/` + theme tokens + tests
**Adapter:** OpenCode only (v1)

## 1. Motivation

Claude Code ships a `Workflow` tool: a **code-driven**, deterministic orchestration
runtime. A JavaScript script (`agent()`, `parallel()`, `pipeline()`, `phase()`,
`budget`, `args`) is executed *by the harness*, spawning real subagents with
structured-output guarantees, concurrency caps, and progress reporting. The model is
removed from the control flow — the script decides what fans out, what verifies, what
synthesises.

Geneseed already ships a **model-driven** multi-agent layer:

- `council` skill — persona debate, the LLM decides who speaks.
- `parallel-agents` skill — fan-out, the LLM decides to dispatch.
- `orchestrator` agent — delegation by prose.

These depend on the model choosing to orchestrate, in prose, every time. The Workflow
primitive is categorically different: deterministic control flow in code. This spec
brings an equivalent to the generated **OpenCode** harness.

## 2. Decisions (locked)

| Fork | Decision | Rationale |
| --- | --- | --- |
| Script source | **Saved workflows only** — named `*.js`, no runtime eval | Safe, reviewable, fits the "generate a curated harness" model. No arbitrary model-authored code in the user's repo. |
| Structured output | **Prompt-for-JSON + Zod-validate + retry** | OpenCode registers a plugin's tool set *once at startup* — a per-run schema can't be baked into a dedicated tool, so the schema lives in the prompt either way. Validating on our side (Zod) keeps retries fully under our control. The `agent()` wrapper already awaits session completion for termination. |
| Execution model | **Synchronous MVP** — tool blocks its session, in-process concurrency, no background/resume | Covers most real use; ships fast. Background + journal/resume deferred. |
| Build posture | **Self-contained Geneseed plugin** on the OpenCode SDK | Zero external plugin deps; portable; matches the Harness-rebuild ethos; fully under Geneseed's control. |

## 3. Architecture

Four units, each independently testable.

### 3.1 `adapters/opencode/plugins/geneseed-workflow.js` — the tool

Registers **one** custom tool via the OpenCode `tool()` helper:

```
workflow({ name: string, args?: any })
```

`execute`:
1. Resolve `name` → `adapters/opencode/workflows/<name>.js` (reject path traversal;
   reject unknown name with the list of available workflows).
2. Import the script module (`meta` + default/exported run function).
3. Build the **runtime context** (§3.2) bound to the plugin's `client`, `directory`,
   `worktree`, and the caller's `args`.
4. Run the script. Catch and surface errors with the failing phase/agent label.
5. Return the script's result, distilled to a compact summary string for the calling
   agent (full structured result written to the progress file).

The tool is registered statically at plugin load (OpenCode requirement). The schema is
fixed: `name` + freeform `args`. All per-workflow variation lives in the saved scripts.

### 3.2 Runtime core — `adapters/opencode/workflows/_runtime.js`

The deterministic API handed to every saved script. Pure, with `client` injected, so it
is unit-testable against a mock.

- **`agent(prompt, opts?)`** — spawn a child session
  (`client.session.create` → `client.session.prompt`), await completion, read the final
  assistant message.
  - `opts.schema` (a Zod schema or JSON-schema-like object): extract the JSON block from
    the reply, validate, and on failure re-prompt the same child with the validation
    error, up to **2 retries**. Returns the validated object. Without `schema`, returns
    the final text string.
  - `opts.agent` — OpenCode subagent name (defaults to a general worker).
  - `opts.label` / `opts.phase` — progress grouping.
  - On user-skip / hard failure after retries → returns `null` (scripts filter with
    `.filter(Boolean)`), matching Claude semantics.
- **`parallel(thunks)`** — `Promise.all` behind a concurrency limiter of
  `min(16, cpuCount - 2)`. A thunk that throws resolves to `null` (never rejects the
  batch).
- **`pipeline(items, ...stages)`** — each item flows through all stages independently,
  **no barrier** between stages. Stage callback receives
  `(prevResult, originalItem, index)`. A throwing stage drops that item to `null`.
- **`phase(title)`** / **`log(msg)`** — append a structured line to the run's progress
  file (`.geneseed/workflow-runs/<runId>.log`); `phase` opens a group, `log` narrates.
  (No `/workflows` TUI in v1 — the file is tailable.)
- **`budget`** — `{ total, spent(), remaining() }`. `total` from `args.budget` or null.
  `spent()` sums child-session token usage observed so far. Once `spent() >= total`,
  further `agent()` calls throw. With no total, `remaining()` is `Infinity`.
- **`args`** — the caller's `args` value, verbatim.
- **Determinism guards** — `Date.now`, `Math.random`, argless `new Date()` throw inside
  a script (parity with Claude; keeps runs reproducible). Timestamps come via `args`.
- **Caps** — lifetime agent counter ≤ **1000**; a single `parallel`/`pipeline` call
  accepts ≤ **4096** items (hard error above).

### 3.3 Saved workflows — `adapters/opencode/workflows/*.js`

Each: `export const meta = { name, description, phases }` (pure literal) + a run
function. Same authoring shape as Claude's Workflow scripts. Starter set:

- **`review.js`** — the canonical dimensions → find → verify pipeline.
- **`research-plan-implement.js`** — sequential phases with clean handoffs.
- **`council.js`** — the existing `council` skill rendered as deterministic code: seat
  the stance agents, round-one positions in `parallel`, synthesise. This is the
  flagship demo — it turns a *model-driven* skill into a *code-driven* one.

### 3.4 `src/skills/workflow.md` — model-facing skill

Tells the agent when to reach for `workflow`, how to list available saved workflows, and
how to read the result. Authored once in `src/`, rendered into all themes by `build.py`.

Per the add-skill checklist this requires:
- new tokens in **all 8 theme JSONs** (`{{SKILL}}`/`{{DESC_WORKFLOW}}` etc. as the
  existing skills use),
- a row in `AGENT.md.tmpl`,
- bumping the hard-coded skill-count assert in `tests/test_harness.py`.

## 4. Data flow

```
calling agent
  └─ workflow({ name, args })            (custom tool)
       └─ load workflows/<name>.js
            └─ runtime.agent()/parallel()/pipeline()
                 └─ client.session.create + prompt   (child OpenCode subagents)
                 └─ collect results in-process
       └─ return distilled summary  ──▶  calling agent summarises to user
  progress ──▶ .geneseed/workflow-runs/<runId>.log   (tailable)
```

## 5. Out of scope (v1, YAGNI)

- Background execution, JSONL journal, resume (`runId` caching).
- `/workflows` progress TUI.
- Model-authored / eval'd workflows.
- `workflow()` nesting.
- `isolation: 'worktree'`.
- Claude-adapter port (OpenCode only).

Each is an additive follow-up that does not require reworking the v1 core.

## 6. Build risks to confirm during implementation

1. **SDK completion + readback** — `client.session.prompt` must await to completion (or
   we poll `session.idle`) and expose the final assistant message + token usage. The
   `HOW-OPENCODE-LOADS.md` reference already cites `client.session.messages({ path: { id } })`
   and `client.session.prompt`.
2. **Concurrency** — N concurrent child sessions under one OpenCode server must not
   serialise. If they do, the limiter still works; throughput just drops.

If either assumption fails, fall back to sequential child sessions (the runtime API is
unchanged; only `parallel`/`pipeline` lose their speedup).

## 7. Testing

- **Unit** (mock `client`): concurrency cap honoured; `pipeline` has no barrier
  (item A reaches stage 3 while item B is in stage 1); `schema` validate + retry path;
  caps (1000 agents / 4096 items) throw; determinism guards throw.
- **Integration**: one saved workflow end-to-end against a stub agent that returns
  canned JSON.
- **Harness**: `tests/test_harness.py` skill-count assert bumped (+1).

## 8. Done when

- `geneseed-workflow.js` registers the `workflow` tool; the three starter workflows run
  end-to-end on a live OpenCode harness.
- `src/skills/workflow.md` renders across all 8 themes; `build.py` + `doctor` clean;
  `tests/` green.
- Spec committed; feature committed and pushed.
