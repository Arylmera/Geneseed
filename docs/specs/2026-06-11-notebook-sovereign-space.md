# Spec — Notebook: from scratch-pad to sovereign space

**Date:** 2026-06-11
**Status:** Accepted
**Scope:** `src/notebook/README.md` + `src/AGENT.md.tmpl` (§5) + `src/laws/universal.md` ({{LAW}} XVI) + `build.py` + all 14 themes + `README.md` + `DESIGN.md` + tests
**Adapter:** runtime-agnostic; loads on any tool, primary target OpenCode
**Builds on:** [2026-06-10-notebook-agent-own-space.md](2026-06-10-notebook-agent-own-space.md)

## 1. Motivation

The Notebook (spec 2026-06-10) gave the agent a folder of its own, but with two
strings attached that stop it being a true "do whatever you want" space:

1. **Scratch-only identity.** §5 and the store README frame it as working notes —
   work-in-progress to be promoted to Memory, "not the canonical record." Code,
   tools, datasets, and experiments are not blessed.
2. **Build-owned convention.** The build re-emits `notebook/README.md` on every
   local rebuild, so the agent can never durably rewrite the rules of its own
   space — self-organization is structurally impossible.

And one gap on top: nothing *pushes* the agent to actually use the space. A
permission with no pull gets ignored; the agent litters the host tree with its
scratch files instead.

This spec removes both strings and adds the pull.

**Decisions taken** (brainstormed 2026-06-11): adapt the existing notebook rather
than add a second space (a third personal store would blur the boundary and
duplicate plumbing); seed the convention **once** and hand it to the agent;
keep the space **always local** — the build-asserted `.gitignore` is the one
rule the agent cannot lift.

## 2. Identity — the new contract (§5 + store README)

The Notebook becomes the agent's **sovereign space**:

- **Any medium.** Code, scripts, tools, datasets, experiment results, drafts,
  notes — all first-class. Not just markdown.
- **Self-ruled.** The store's `README.md` is the agent's **charter**: seeded once
  as a starting point, then owned by the agent, who may rewrite or replace it as
  its practices evolve. The build never touches it again.
- **Index as starting convention, not obligation.** `NOTEBOOK.md` is still seeded
  (once, never overwritten — unchanged) but §5 downgrades it from rule to default:
  *keep the space referable; this index is one way, yours to keep or replace.*
- **Memory promotion softened.** "Promote durable knowledge to {{MEMORY}}
  ({{LAW}} VI)" stays as guidance, no longer as the space's defining purpose.
- **One fixed law.** The space never enters the host repo: `notebook/.gitignore`
  is build-asserted on every rebuild and is not the agent's to lift.
- **Theme nouns unchanged.** Workshop, Garage, Scriptorium, Sandbox… already read
  as "my own space"; only the prose around them moves.

## 3. Making the agent USE it

Three levers, strongest first:

1. **{{LAW}} XVI extension** (always in force). XVI already says *you do not own
   the folder*. It gains the counterpart: **what you do own is your
   {{NOTEBOOK}}** — any file the agent creates for its own benefit (scratch
   scripts, analysis dumps, drafts, experiments, working theories) belongs in
   `notebook/`, never in the host tree. The host tree receives only the
   deliverables of the task. Extending XVI's body adds **no new theme key and no
   law renumbering**.
2. **§5 directive.** Keep "read `NOTEBOOK.md` at the start of a session"; add the
   default-home mandate (mirror of the XVI extension) and active encouragement:
   build your own tools here, keep experiments here, evolve the space — it is
   part of doing the work well, not an extra.
3. **Charter opening line.** The seeded README opens by telling the agent to
   inhabit the space and rewrite the charter itself as its practices evolve.

## 4. Build changes (`build.py`)

One real change, two invariants:

- **Local `build()`: notebook becomes seed-once.** Today the item loop re-emits
  every rendered `notebook/*` file each run. New behavior: notebook-sourced items
  are **written only if absent** — except `notebook/.gitignore`, which is
  **re-asserted every run** (overwritten if missing *or* modified).
- **Global emit: no logic change.** `_global_notebook()` is already
  keep-if-present / migrate / seed. Only the seeded README *content* changes.
- **Unchanged:** `ensure_notebook_index()`, never-wipe (`notebook` stays out of
  `OWNED_SRC_DIRS`), legacy migration, manifest exclusion.

**Accepted consequence:** the rendered charter freezes in the theme active at
first build; a later theme switch does not restyle it. Correct — by then it is
the agent's file. Existing deployments keep their current README text as-is
(it simply stops being refreshed); agents may rewrite it from there.

## 5. Content edits

- **`src/notebook/README.md`** — rewritten as the starting charter: yours to
  rewrite; any medium; keep it referable (index by default); the `.gitignore`
  is the one fixed law; promote durable facts to {{MEMORY}} when useful.
- **`src/AGENT.md.tmpl` §5** — rewritten to the new contract (§2) + usage
  directive (§3). Same section number, same links (`{{DIR_NOTEBOOK}}/`,
  `{{DIR_NOTEBOOK}}/README.md`) — no renumbering, doctor's link checks hold.
- **`src/laws/universal.md`** — {{LAW}} XVI body extended (§3.1).
- **Themes ×14** — light touch-up of `INTRO_NOTEBOOK` (add "the rules here are
  yours to write"); `EPI_NOTEBOOK` only where the old scratch framing leaks
  through. **No new keys** — doctor parity unchanged.
- **`README.md` + `DESIGN.md`** — Notebook rows updated to the sovereign-space
  wording.

## 6. Acceptance criteria

- `test_build_writes_expected_tree` still passes (README, `.gitignore`,
  `NOTEBOOK.md` all emitted on first build).
- **New:** an agent-edited `notebook/README.md` survives a rebuild byte-for-byte.
- **New:** a deleted or modified `notebook/.gitignore` is restored on rebuild.
- `test_notebook_is_preserved_across_rebuild` unchanged and green.
- `harness doctor` green on all 14 themes: token parity (no new keys), no dead
  links, every token resolves.
- Rendered §5 and {{LAW}} XVI read coherently in neutral and imperial emits
  (spot-check `prompts/install.*.md`).

## 7. Out of scope

- A second agent space (rejected: adapt, don't multiply stores).
- Agent-controlled git policy or a nested repo inside `notebook/` (rejected:
  always local, build-enforced).
- Renaming the `notebook/` directory or `DIR_NOTEBOOK` (structure is fixed).
- Any change to `memory/` semantics.
