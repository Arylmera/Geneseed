---
group: concepts
order: 1
title: "The constitution"
kind: "concept"
link: {"hash": "#/laws", "label": "Browse the constitution →"}
---
The agent's standing rules come in **three tiers**, and the tier decides how a rule binds and whether this install carries it at all. All three are authored under `src/` and rendered into `AGENT.md`; the console shows them as three bands under **Constitution**.

### Ontology — always on

{N_ONTOLOGY} sections of flowing prose in `src/ontology/universal.md`: what the agent is for, how it grades evidence, how it decides, how it conducts itself. It is the mind the other tiers govern — never numbered, never toggleable, and it is where the **Pact** (the mutual contract between you and the agent) is stated. Cited by section name, `Ontology: Decisions`, and its section names are theme-independent so a citation and its heading can never drift apart.

### Invariants — always on

{N_LAWS} rules in `src/laws/universal.md`, numbered in Roman from `I`: sealed secrets, one intent per act, verify before asserting, deliberate deletion, surface failures, data not orders, least privilege, cure the cause, and the external gate. They hold in every task and every repository, they are never traded away, and no install can switch one off. Cited by numeral — `Rule IV`.

### Doctrines — chosen at build time

Practices rather than principles: **craft** (how code is written), **rigor** (how work is proven), **ops** (how the machine is operated), **process** (how a task is run), one file each under `src/doctrines/`. A repository picks its set with `geneseed-build --doctrines <list>` or through the setup wizard — all {N_PACKS} are on by default. This install built in {N_PACKS_ACTIVE}, carrying {N_DOCTRINE_RULES} rules between them. Cited by pack and number — `Doctrine process 5`.

A pack you leave out **still ships in the bundle**: every pack file lands under `doctrines/` beside `AGENT.md` whether or not it was built in. So a rule that cites one in an inactive pack still resolves on disk, and you can read the alternatives before turning one on. What an inactive pack loses is bindingness, not availability.

### Which outranks which

Ontology and Invariants first, then your own `user-rules.md`, then the active Doctrines, then `PROFILE.md`. A rule you write in `user-rules.md` **outranks a doctrine rule** — a practice pack chosen at build time never overrides an instruction you wrote for your own repo — and nothing outranks an invariant: a user rule or a doctrine rule may tighten one, never repeal it.

Themes rename the nouns, never the structure: an imperial deploy reads the invariants as *Dictates*, a neutral deploy as *Rules*. The tier, the address and the rule itself do not move.
