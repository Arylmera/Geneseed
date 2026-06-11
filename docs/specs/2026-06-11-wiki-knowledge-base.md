# Spec — Wiki: a machine-wide Obsidian knowledge base

**Date:** 2026-06-11
**Status:** Accepted
**Scope:** `src/` (AGENT.md template, skills, themes) + `adapters/opencode/plugins/` + `build.py` + tests
**Adapter:** prose contract everywhere; plugin enforcement on OpenCode

> Give the agent first-class read-write citizenship in the user's own Obsidian
> vault(s) — declared per machine in a `wiki.jsonc` manifest, injected per the
> existing eager/lazy convention, guarded at the tool boundary.

## Problem

The harness is hermetic: it carries no user knowledge. `context.json` hands the
agent *project* docs, and `memory/` holds *agent-curated* facts — but many users
keep a personal, machine-wide knowledge base (typically an Obsidian vault) that
the agent should consult and contribute to. Every user keeps that vault at a
different path, so nothing can be baked in; the harness needs a per-machine
declaration and a convention for how the agent behaves inside someone else's
living wiki.

## Decisions (brainstormed 2026-06-11)

1. **Interaction model: full read-write.** The agent may create, edit, and
   interlink notes following Obsidian conventions (wikilinks, frontmatter). The
   wiki's own rules constrain it (see `conventions`, `protected`, `inbox`).
2. **Declaration: a manifest, not a bare env var.** `wiki.jsonc` lives beside
   `AGENT.md` in the install — once per machine for OpenCode-global. A bare
   path can't express entry points, conventions, inbox, or protected folders.
   Resolution chain: `$GENESEED_WIKI` (explicit override) → `wiki.jsonc` beside
   the bundle. Created empty by the build on first run, never overwritten —
   exactly like `context.json`.
3. **Session-start loading: per-entry `eager`/`lazy`**, reusing the
   `context.json` semantics verbatim. The user decides whether their wiki's
   core note auto-loads every session or stays on-demand.
4. **Wiring: extend `geneseed-context`, not a fifth plugin.** Injection is the
   same mechanism as project context at a different scope; budgets, demotion,
   lazy heading hints, and compaction re-injection are inherited rather than
   duplicated. The genuinely new substance (write conventions, capture
   workflow) lives in the AGENT.md section and a `wiki` skill — which is also
   what non-OpenCode targets run on, degraded to prose-obedience.
5. **Naming: "wiki".** "Vault" is already taken by AGENT.md §6 (the folder the
   harness lives in), and structure names stay plain English; themes flavour
   only the voice around it.

## The manifest — `wiki.jsonc`

```json
{
  "wikis": [{
    "name": "Anamnesis",
    "path": "C:/Users/guill/Documents/git/Terra/Anamnesis",
    "description": "machine-wide brain",
    "entries": [
      { "path": "MACHINE-BRAIN.md", "load": "eager", "description": "always-on core" },
      { "path": "_Cartographicum/INDEX.md", "load": "lazy", "description": "meta-index" }
    ],
    "conventions": "DESIGN.md",
    "inbox": "Inbox/",
    "protected": ["Codex/"]
  }]
}
```

- The file is **JSONC** (amended same day): consumers strip `//` and `/* */`
  comments plus trailing commas — string-aware — so the seeded stub documents
  itself and carries a commented copy-and-edit example for setup. The filename
  is **`wiki.jsonc`** (second same-day amendment, so the extension says what the
  content is); a `wiki.json` seeded by an earlier build is still honoured by
  every consumer, and its presence suppresses the new stub.
- Multiple wikis allowed; an empty `wikis` list (the emitted default) means the
  feature is off.
- `entries[].path` is relative to the wiki's `path`; `load` is `eager`/`lazy`
  with the same meaning as in `context.json`.
- `conventions` names the note the agent must read **before its first write**
  in that wiki.
- `inbox` is the fallback drop folder when the agent is not confident where a
  note files.
- `protected` lists folders (relative to the wiki root) the agent must never
  write to — enforced by `geneseed-guard` on OpenCode.

## Components

| Piece | Change |
| --- | --- |
| `src/AGENT.md.tmpl` | new Wiki section after §6; Context and Scripts renumber |
| `src/skills/wiki.md` | consult / capture / interlink / promote workflows + Obsidian authoring rules |
| `themes/*.json` | new voice tokens for the section + skill (key parity enforced by doctor) |
| `build.py` | emit empty `wiki.jsonc` once beside `AGENT.md`, never overwrite |
| `geneseed-context.js` | resolve `$GENESEED_WIKI` → bundle-adjacent `wiki.jsonc`; merge entries into the injection block as a labelled `MACHINE WIKI` segment |
| `geneseed-guard.js` | block write/edit tool calls under any declared wiki's `protected` paths (`on`/`warn`/`off` modes apply) |
| docs | README table + plugins row, SETUP.md section, OpenCode adapter README |
| tests | emit-once/never-overwrite unit test; guard protected-path test |

## Error handling

Missing or empty manifest → feature silently off. Unparseable manifest or
missing wiki root → skipped, logged under `GENESEED_DEBUG`. Missing eager
entry → visible `MISSING` line (existing context-plugin behaviour). Oversized
eager entries → existing per-file/total budget demotion.

## Out of scope (v1)

Vault-side filing automation (the user's own wiki processes own that), Obsidian
plugin/API integration, watching the vault for changes mid-session, and any
search index over the vault — the agent navigates by entry notes and wikilinks.
