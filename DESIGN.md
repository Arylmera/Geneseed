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

3. **Theme covers vocabulary and the bundle's folder names.** A single neutral
   source renders to any theme via token substitution. A theme changes both the
   prose labels *and* the top-level folder names of the rendered bundle
   (`laws→leges`, `agents→legati`, `skills→rites`, `memory→anamnesis`, defined by
   the `DIR_*` tokens). Two things stay fixed regardless of theme: the **source
   tree** under `src/` (always neutral, for sane authoring) and the **`.opencode/`
   layer** emitted by `--emit opencode` (OpenCode requires the exact dir names
   `agent/` and `command/`). Internal links in the bundle are themed via the same
   `DIR_*` tokens so they always resolve. Toggle = one flag.

4. **Delegation by capability, not by folder.** The source system owned content
   folders with delegate agents. For code repositories, specialists by capability
   (reviewer, tester, architect, docs, security) fit better and stay generic.

5. **Hermetic — with one git-ignored escape hatch.** The *tracked* harness
   references nothing outside itself — no links into the vault it grew from, no
   secrets, no host-specific paths. This guarantees a clean `git subtree split` /
   copy into any destination. The single sanctioned bridge to host-specific
   documentation is the `references/` layer (Decision 6): because everything in it
   except the convention is git-ignored, host paths and proprietary docs never
   enter the published bundle, so hermeticity holds.

6. **References are a local, git-ignored layer — never published.** A consumer
   often needs the agent to know about substantial external documentation
   (framework internals, front-/back-end architecture) that must not be committed
   into the portable harness. `references/` mirrors the `memory/` pattern: only
   `README.md` + `.gitignore` are tracked; the `REFERENCES.md` index, the absolute
   paths it points to, and any doc dropped in the folder stay on the machine. It
   accepts both modes at once — external absolute-path pointers and locally
   dropped files — and is distinct from `memory/` (atomic learned *facts*) by
   holding pointers to *bodies of documentation* maintained elsewhere.

## Components

The `Harness/` output column shows the **neutral** folder name; the imperial theme
renders it as the name in parentheses.

| Component | Source | `Harness/` output | Purpose |
| --- | --- | --- | --- |
| Entrypoint | `src/AGENT.md.tmpl` | `AGENT.md` | what the tool reads; inlines the rules, links the rest |
| Governance | `src/laws/` | `laws/` (`leges/`) | universal rules + a project-specific stub |
| Delegation | `src/agents/` | `agents/` (`legati/`) | capability specialists with output contracts |
| Workflows | `src/skills/` | `skills/` (`rites/`) | repeatable procedures |
| Memory | `src/memory/` | `memory/` (`anamnesis/`) | one-fact-per-file convention + index |
| References | `src/references/` | `references/` (`apocrypha/`) | pointers to host-specific external docs; git-ignored, never published |
| Themes | `themes/*.json` | — | token → label maps |
| Generator | `build.py` | — | substitution + `<!-- INCLUDE: -->` inlining |
| Automation | `rituals/harness.py` | — | optional `build` / `doctor` / `learn` |
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
