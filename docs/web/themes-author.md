---
group: extend
order: 1
title: "Write a new theme"
kind: "concept"
link: {"hash": "#/harness", "label": "Open the voice gallery →"}
---
A theme is one JSON file under `themes/` declaring voice tokens only: `BANNER`, `TAGLINE`, `LOADED_SIGIL`, `VOICE`, the core nouns (`ONTOLOGY`/`LAW(S)`/`DOCTRINE(S)`/`AGENT(S)`/`SKILL(S)`/`MEMORY`/`NOTEBOOK`/`WIKI`), the section intros `INTRO_*`, the epigraphs `EPI_*`, the `BENEDICTION`, the `ROAST_PERSONA`, and `DESC_*` blurbs. Copy `themes/neutral.json` and edit. `geneseed build --theme yours` renders it; `doctor` checks for missing tokens.

### The constitution's titles

Every rule in the constitution gets its title from a theme key, and a theme that omits one ships a rule with a blank heading:

- `LEX_I`…`LEX_IX` — one title per invariant. `doctor` holds this to an **equality**, not mere presence: a `LEX_*` outside `I`–`IX` is a title for a rule that does not exist and fails the check too.
- `DOC_*` — one title per doctrine rule, named after its address (`DOC_CRAFT_1`, `DOC_PROCESS_5`, …). `doctor` reads the pack files under `src/doctrines/` and requires exactly the set they name — a missing one is a blank heading, an extra one is a dead key.
- `PACK_*` — one name per pack (`PACK_CRAFT`, `PACK_RIGOR`, `PACK_OPS`, `PACK_PROCESS`), used for the pack's own sub-heading.

The Ontology's section names are **not** theme keys: a citation reads `({{ONTOLOGY}}: {{ONT_TELOS}})`, token on both sides, so heading and reference always move together. They live in the build's fixed structure table and you neither declare nor rename them.

> ⚠ `LAW` and `DOCTRINE` must each be a **single word**. Both heading parsers match the tier noun with `\S+`, so a two-word value does not error — the heading simply stops matching and the whole tier parses to nothing, in silence. `doctor` gates this for every real voice (`_TEMPLATE.json` is exempt; its values are placeholders).
