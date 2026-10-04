---
group: reference
order: 18
title: "Glossary"
kind: "glossary"
section: "Glossary & about"
description: "Every Geneseed word you won't find in a programming glossary, with a dev analogy."
---
Every word Geneseed uses that you would not find in a general programming glossary. The console shows this table in your installed theme's voice beside the neutral words; on GitHub you read the neutral ones.

| Term | Theme key | Meaning | In dev terms |
|---|---|---|---|
| Harness | — | everything Geneseed installs around the model: the rules it loads, the gates that run before its actions, the workflows it can call | git hooks + CI + a runbook, for an agent |
| Hook | — | a command your tool runs before or after an agent action; Geneseed's hooks gate risky actions and load context | a git hook, fired on every tool call |
| Ethos (Ontology) | ONTOLOGY | the always-on worldview under the rules — telos, evidence, decisions, conduct; it holds the Pact | the team's engineering principles |
| Rule (Law) | LAW | one of the nine always-on invariants: what is never done | a lint rule set to error |
| Rules (Laws) | LAWS | the body of always-on invariants | the error-level rule set |
| Doctrine | DOCTRINE | one practice rule, cited `<pack> <n>` — how work is done here | a team convention in CONTRIBUTING.md |
| Doctrines | DOCTRINES | the practice packs, chosen at build time; inactive packs still ship in the bundle | opt-in lint presets |
| Agent | AGENT | a capability specialist | a colleague you hand a ticket to |
| Agents | AGENTS | the roster of specialists | the team |
| Skill | SKILL | a repeatable workflow | a runbook |
| Skills | SKILLS | the catalogue of workflows | the runbook folder |
| Memory | MEMORY | durable, one-fact-per-file knowledge | a team wiki the agent writes |
| Notebook | NOTEBOOK | the agent's sovereign space | the agent's scratch branch |
| Wiki | WIKI | the machine-wide knowledge base | your personal notes, shared with the agent |
| Pact | PACT | the two-way collaboration contract, stated in Telos, the first Ethos section | a working agreement |
| Posture | — | the relationship register the agent works in (peer, mentor, expert, assistant, artisan) | pairing style |
| Mode | — | how work gets executed — direct (the agent works every task itself) or foreman (substantial tasks spawn an isolated pipeline) | solo vs. delegating to a sub-team |
| Footprint | — | how much of the Rules loads inline each turn (full vs lean) | eager vs. lazy loading |
| Loop | — | a requirement worked as small, validated, committed iterations on their own branch, driven by `geneseed loop` | a state machine over a ticket's steps |
| Iteration | — | one cycle of a loop back to its head; closes into its own commit | one sprint-of-one through a checklist |
| Brick | — | one node of a loop graph: a prompt for one agent or skill, reporting one of a declared set of outcomes | a step in a runbook |
| Trust preset | — | the loop's risk tolerance — prudent, balanced (default) or aggressive — set at `loop init` and editable in `LOOP.md` | how much a reviewer lets through without a second look |
| Profile | — | who you are — seeded once, colours but never binds | your onboarding notes |
| Memory force | — | a memory's binding strength (constraint, choice, conviction, tempered) | MUST / SHOULD / MAY |
| Tagline | TAGLINE | the one-line essence of the theme | — |
| Loaded sigil | LOADED_SIGIL | what the agent emits when ready | a health-check line |
| Benediction | BENEDICTION | the closing line of an install | — |
