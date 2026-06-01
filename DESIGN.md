# Geneseed — Design

The spec behind the harness. Read this before changing structure.

## Origin

Geneseed is a generic port of a personal, Obsidian-vault-grown agent system. The
source system had five layers: governance law, folder-owning delegate agents,
lifecycle-hook automation, skills, and persistent memory. Geneseed keeps the
parts that are **runtime-agnostic** and drops the parts that assumed a specific
vault or a specific tool's hooks.

## Decisions

1. **Target: generic `AGENT.md`, no hooks assumed.** The harness must work in any
   assistant that reads an instructions file at the repo root. Automation is
   therefore *optional* (standalone CLIs) rather than load-bearing.

2. **Instructions-first.** The valuable behaviours (memory, learning, delegation)
   are expressed primarily as instructions in `AGENT.md` that the model follows.
   Scripts are a power-user convenience layered on top, never a requirement.

3. **Theme is terminology, not structure.** A single neutral source renders to
   any theme via token substitution. Folder/file names in `dist/` stay neutral so
   output is drop-in for any tool; only prose labels change. Toggle = one flag.
   This is why themes are flat JSON maps and the generator is pure substitution.

4. **Delegation by capability, not by folder.** The source system owned content
   folders with delegate agents. For code repositories, specialists by capability
   (reviewer, tester, architect, docs, security) fit better and stay generic.

5. **Hermetic.** Geneseed references nothing outside itself — no links into the
   vault it grew from, no secrets, no host-specific paths. This guarantees a
   clean `git subtree split` / copy into any destination.

## Components

| Component | Source | `dist/` output | Purpose |
| --- | --- | --- | --- |
| Entrypoint | `src/AGENT.md.tmpl` | `AGENT.md` | what the tool reads; inlines the rules, links the rest |
| Governance | `src/laws/` | `laws/` | universal rules + a project-specific stub |
| Delegation | `src/agents/` | `agents/` | capability specialists with output contracts |
| Workflows | `src/skills/` | `skills/` | repeatable procedures |
| Memory | `src/memory/` | `memory/` | one-fact-per-file convention + index |
| Themes | `themes/*.json` | — | token → label maps |
| Generator | `build.py` | — | substitution + `<!-- INCLUDE: -->` inlining |
| Automation | `scripts/harness.py` | — | optional `build` / `doctor` / `learn` |
| Adapters | `adapters/` | — | optional per-tool glue (hooks) |

## Generator contract

- Substitutes `{{TOKEN}}` in file *contents* only; paths are never themed.
- Resolves `<!-- INCLUDE: relpath -->` by inlining the rendered target.
- Unknown tokens are left visible (debugging aid); `doctor` flags them.
- Stdlib only; no third-party dependencies, ever.

## Explicitly out of scope

Graph/index generation, web-clipping pipelines, session-classification capture,
sync-conflict cleanup, and folder-ownership delegation — all assumed a specific
vault and lifecycle hooks. They are not ported. The `learn` CLI is the one
distilled survivor of the original learning loop, made model-CLI-agnostic.
