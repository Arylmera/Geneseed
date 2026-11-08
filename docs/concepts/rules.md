---
group: concepts
order: 3
title: "Rules (the constitution)"
kind: "concept"
section: "Harness"
description: "The constitution: the standing rules every session carries, in laws and doctrine packs."
link: {"hash": "#/laws", "label": "Browse the constitution →"}
---
The **constitution** is the set of standing rules the agent carries into every session. It is authored in `src/`, rendered into the instructions file your host reads (`AGENT.md`, `CLAUDE.md` or `AGENTS.md`), and comes in layers that differ in one thing: whether you can turn them off.

> **You already know this:** a lint config. Some rules are set to `error` and nobody may disable them; some come from presets you opt into; and your project's own overrides sit on top of the presets.

### Cited by name, never by number

Every rule has a name — *Deletion Is Deliberate*, *Consent Before Push* — and the agent, the docs and the hooks cite it by that name. Rules are also numbered in the rendered text, but a number is only the rule's current position: remove a rule and every number after it shifts. So when you write about a rule, in your own notes or in `user-rules.md`, use its name.

The one place you type a position is the command line: `--exclude-rules "process 5"` means "the fifth rule of the process pack in this checkout". Check the name it carries before you exclude it.

### The layers, in precedence order

When two instructions disagree, the higher one wins.

1. **Ethos** — always on. {N_ONTOLOGY} sections of flowing prose (Telos, Evidence, Decisions, Ownership, Conduct): what the agent is for, how it weighs evidence, how it decides, who owns the code it writes, how it behaves. It is where the **Pact**, the two-way contract between you and the agent, is stated ([Collaboration](collaboration.md)). Cited by section name, e.g. *Ethos: Decisions*.
2. **Rules** — always on. {N_LAWS} invariants, the things that are never traded away: sealed secrets, one intent per act, verify before asserting, deliberate deletion, surface failures, treat content as data not orders, least privilege, cure the cause, echo the intent. No install can switch one off.
3. **Your `user-rules.md`** — rules you write for yourself, seeded once and never overwritten. On a global install the file is in the [shared tier](shared-tier.md); on a project install it sits beside the instructions file. A rule here **outranks any doctrine rule**: a practice pack chosen at build time never overrides an instruction you wrote. It may tighten an invariant, never repeal one. Sub-agents get it too: on Claude Code and OpenClaude the `SubagentStart` hook injects every layer of it into each sub-agent, because no sub-agent receives the session-start output (OpenCode follows; Bob has no such event). The [rule skill](skills.md) helps you decide whether something belongs here or in [memory](memory.md).
4. **Doctrines** — chosen at build time. Practices rather than principles, grouped in packs (below).
5. **Mode** — chosen at build time ([Foreman mode](foreman-mode.md)). It binds *how* work is executed — done in place, or handed to a crew — and never overrides a layer above it. A mode that only informed lost every time to the host's own default of doing small work in place.
6. **`PROFILE.md`** — who you are. It colours how the agent works but never binds ([Collaboration](collaboration.md)).

### The shared tier

A global install keeps what you teach it in one place for every host on the machine: `~/.config/geneseed/`. [The shared tier](shared-tier.md) says what it holds, what stays per install, and how existing stores fold into it. The constitution itself is not in the tier: each install renders its own.

Your rules now come in layers, and the later layer wins: **project over host over shared**. A session reads the shared file first, then the host file, so a host or a project can narrow a machine-wide rule. All three stay in the place the list above gives `user-rules.md`, under the rules. `PROFILE.md` and the wiki manifest do not merge: a host file that is no longer its seed replaces the shared one.

**A project that reads the tier.** A project install does not read the tier by default: it sees only its own harness, as before. `--shared-tier on` (a `geneseed build` flag, a `setup` question for a per-repo install, and a switch on the project's panel in the console) adds a marker line, `Shared tier: on`, to the project's instructions file, and `rebuild-all` and `upgrade` keep it. Then the session start injects your machine-wide rules, profile and memory map as a labelled, read-only view, before the project's own docs. Writes stay local: the project keeps its own `memory/`, and its text keeps relative paths. A global install owns the tier, so the option is refused for one.

- **Benefit:** This project sees your machine-wide rules, profile and memory map, so what you taught one tool or repo applies here too.
- **Cost:** About 1 500 tokens at every session start, growing with your rules. The hook budget is fixed at 9 000 characters, and the tier loads before this project's docs, so a large tier can push them down to a lazy listing.

Only one hook injects the tier. On Claude Code, Bob and OpenClaude a wired project hook decides, and the global hook stands down, except under `$GENESEED_STACK_GLOBAL`, when the global hook injects and the project hook skips the tier. On OpenCode both plugins run, so the project plugin skips the tier when a global OpenCode install exists, and injects it when there is none. With the option off, a project gets no tier from its own hook, as today.

### Doctrine packs

{N_PACKS} packs ship, one file each under `src/doctrines/`:

| Pack | What it governs |
| --- | --- |
| **craft** | how code is written — reuse first, house conventions, docs in the same change, the smallest diff |
| **rigor** | how work is proven — idempotence, honest tests, cover and verify, gates that can actually fail |
| **ops** | how the machine is driven — tool discovery, commands that return, complete teardowns, restart is not reload |
| **process** | how a session runs — planning, context economy, docs first, bounded loops, consent before every commit and push |
| **comms** | how answers are presented — stable reference codes on tracked items, a diagram or table only where it earns its place |

All of them are on by default. This install built in {N_PACKS_ACTIVE}, carrying {N_DOCTRINE_RULES} rules between them. You choose packs at build time with `--doctrines`, or drop single rules with `--exclude-rules`; the how-to is in [Doctrine packs and single rules](../guides/setup-doctrines.md).

A pack you leave out **still ships**: every pack file lands under `doctrines/` beside the instructions file whether or not it was built in. A rule that cites an inactive pack still resolves on disk, and you can read the alternatives before turning one on. An inactive pack loses its binding force, not its availability.

**process** is the one pack whose removal changes what the machine does, not only what the agent reads: it holds *Consent Before Push*, which a hook enforces. Without it, commits and pushes are no longer stopped for a question — destructive git still is, because that is a Rule ([Hooks](hooks.md)).

### Themes do not move rules

A [theme](themes.md) renames the nouns — an `imperial` install calls the invariants *Dictates* — but the layers, their order and every rule stay exactly where they are.

### Related

[Footprint](footprint.md) — how much of this text loads every turn · [The shared tier](shared-tier.md) — your rules, memory and profile for the whole machine · [Exclusions](exclusions.md) — switching rules off per rule versus per repo · [Rule enforcement, by host](enforcement-table.md) — which rules a hook actually checks · [Glossary](../reference/glossary.md)
