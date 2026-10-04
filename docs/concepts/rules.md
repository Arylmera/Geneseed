---
group: concepts
order: 2
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

1. **Ethos** — always on. {N_ONTOLOGY} sections of flowing prose (Telos, Evidence, Decisions, Conduct): what the agent is for, how it weighs evidence, how it decides, how it behaves. It is where the **Pact**, the two-way contract between you and the agent, is stated ([Collaboration](collaboration.md)). Cited by section name, e.g. *Ethos: Decisions*.
2. **Rules** — always on. {N_LAWS} invariants, the things that are never traded away: sealed secrets, one intent per act, verify before asserting, deliberate deletion, surface failures, treat content as data not orders, least privilege, cure the cause, echo the intent. No install can switch one off.
3. **Your `user-rules.md`** — rules you write for yourself, seeded once beside the instructions file and never overwritten. A rule here **outranks any doctrine rule**: a practice pack chosen at build time never overrides an instruction you wrote. It may tighten an invariant, never repeal one. The [rule skill](skills.md) helps you decide whether something belongs here or in [memory](memory.md).
4. **Doctrines** — chosen at build time. Practices rather than principles, grouped in packs (below).
5. **`PROFILE.md`** — who you are. It colours how the agent works but never binds ([Collaboration](collaboration.md)).

### Doctrine packs

{N_PACKS} packs ship, one file each under `src/doctrines/`:

| Pack | What it governs |
| --- | --- |
| **craft** | how code is written — reuse first, house conventions, docs in the same change, the smallest diff |
| **rigor** | how work is proven — idempotence, honest tests, cover and verify, gates that can actually fail |
| **ops** | how the machine is driven — tool discovery, commands that return, complete teardowns, restart is not reload |
| **process** | how a session runs — planning, context economy, docs first, bounded loops, consent before every commit and push |
| **comms** | how answers are presented — stable reference codes on tracked items, a diagram or table only where it earns its place |

All of them are on by default. This install built in {N_PACKS_ACTIVE}, carrying {N_DOCTRINE_RULES} rules between them. You choose packs at build time with `--doctrines`, or drop single rules with `--exclude-rules`; the how-to is in [Choose your setup](../guides/choose-your-setup.md).

A pack you leave out **still ships**: every pack file lands under `doctrines/` beside the instructions file whether or not it was built in. A rule that cites an inactive pack still resolves on disk, and you can read the alternatives before turning one on. An inactive pack loses its binding force, not its availability.

**process** is the one pack whose removal changes what the machine does, not only what the agent reads: it holds *Consent Before Push*, which a hook enforces. Without it, commits and pushes are no longer stopped for a question — destructive git still is, because that is a Rule ([Hooks](hooks.md)).

### Themes do not move rules

A [theme](themes.md) renames the nouns — an `imperial` install calls the invariants *Dictates* — but the layers, their order and every rule stay exactly where they are.

### Related

[Footprint](footprint.md) — how much of this text loads every turn · [Exclusions](exclusions.md) — switching rules off per rule versus per repo · [Glossary](../reference/glossary.md)
