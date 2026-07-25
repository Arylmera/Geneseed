---
group: extend
order: 1
title: "Write a new theme"
kind: "concept"
link: {"hash": "#/themes", "label": "Open the theme gallery →"}
---
A theme is one JSON file under `themes/` declaring voice tokens only: `BANNER`, `TAGLINE`, `LOADED_SIGIL`, `VOICE`, the core nouns (`LAW(S)`/`AGENT(S)`/`SKILL(S)`/`MEMORY`/`NOTEBOOK`/`WIKI`), the law titles `LEX_*`, the section intros `INTRO_*`, the epigraphs `EPI_*`, the `BENEDICTION`, the `ROAST_PERSONA`, and `DESC_*` blurbs. Copy `themes/neutral.json` and edit. `python build.py --theme yours` renders it; `doctor` checks for missing tokens.
