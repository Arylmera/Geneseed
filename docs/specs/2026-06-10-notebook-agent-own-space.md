# Spec — Notebook: the agent's own freeform space

**Date:** 2026-06-10
**Status:** Accepted
**Scope:** `src/notebook/` (new) + `src/AGENT.md.tmpl` + `build.py` + all 8 themes + `README.md` + `DESIGN.md` + tests
**Adapter:** runtime-agnostic; loads on any tool, primary target OpenCode

## 1. Motivation

Every store Geneseed ships is shaped by someone other than the agent that uses it:
`memory/` is a curated fact base with a fixed one-fact-per-file format, written for
recall and (on OpenCode) appended by the `geneseed-learn` plugin; `laws/`, `agents/`,
`skills/` are generated and build-owned; `context.json` points at the project's docs.
There was **no place the agent owns** — a freeform space it can shape for itself,
keep across sessions, and reference at will.

This adds one: a **Notebook**. A space generated for the agent to make its own, where
it stores what it wants, how it wants, and may create, modify, move, and delete
freely — no imposed format. It is the agent's working room: plans, scratch designs,
a map of the code it built, a task ledger, working theories — anything that helps it
think and work.

## 2. Design

A new top-level store mirrors the proven `memory/` mechanism exactly, so it inherits
memory's safety guarantees with no new machinery:

- **Source:** `src/notebook/` ships `README.md` (the convention, themed) and a
  `.gitignore` (`*` except `.gitignore` + `README.md` — personal and local, never
  committed or shared, like memory).
- **Index:** the agent keeps a `NOTEBOOK.md` table of contents at the store root.
  `build.ensure_notebook_index()` seeds an empty one and **never** overwrites it
  (it accumulates), mirroring `ensure_memory_index()`.
- **Never wiped:** `notebook` is deliberately **not** in `OWNED_SRC_DIRS`. The build
  refreshes the convention in place and preserves every file the agent kept — a
  rebuild can never destroy the agent's own work.
- **Global emit:** `_global_notebook()` mirrors `_global_memory()` — keep-if-present,
  else migrate a legacy bundle's `notebook/`, else seed from `src/`. The store is host
  state, **excluded from the `.geneseed-manifest.json` owned list**, so a re-emit
  never prunes it.
- **Structure stays plain English:** the folder is always `notebook/` (`DIR_NOTEBOOK`
  in the fixed `STRUCTURE` map); only the prose label is themed via `{{NOTEBOOK}}`
  (e.g. imperial → *Scriptorium*, military → *Ready Room*, pirate → *Chart Room*,
  wizard → *Study*, cyberpunk → *Sandbox*, gamer → *Workshop*, sports → *Clipboard*).

### AGENT.md

A new **§5 Notebook** section sits right after §4 Memory (Workspace/Context/Scripts
renumber to §6/§7/§8; the one internal section cross-reference — the readiness sigil's
pointer to the Context section — was bumped accordingly). It is **instruction-first**,
matching how memory is read: the agent is told to read `NOTEBOOK.md` at session start,
keep it current, and reference the space whenever useful. It explicitly contrasts the
Notebook (freeform working space) with Memory (curated durable facts) and tells the
agent to **promote** a note that hardens into a durable fact up into Memory (Rule VI).

### Why not the learn plugin / injection

The Notebook is deliberately **agent-curated, not plugin-managed**. `geneseed-learn`
keeps writing to `memory/`; it never touches the Notebook. Reading the index is the
agent's discipline (the established memory pattern), not an injected block — a
freeform space the harness silently rewrote would not be the agent's *own*. (A future
enhancement could surface the index at session start via the context plugin; it was
left out of v1 to keep the change consistent with memory and free of new runtime
code.)

## 3. Tests / validation

- `test_build_writes_expected_tree` asserts `notebook/README.md`, `.gitignore`, and a
  seeded `NOTEBOOK.md` are emitted.
- `test_notebook_is_preserved_across_rebuild` writes an index + a freeform file, then
  rebuilds over the same dir and asserts both survive untouched.
- `harness doctor` stays green: all 8 themes define the new `NOTEBOOK`,
  `EPI_NOTEBOOK`, and `INTRO_NOTEBOOK` keys (parity), every token resolves, and the
  `notebook/` + `notebook/README.md` links are not dead.
