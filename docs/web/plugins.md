---
group: concepts
order: 10
title: "Plugins (OpenCode)"
kind: "concept"
harness: "opencode"
link: {"hash": "#/docs/plugin-context", "label": "One page per plugin →"}
---
OpenCode loads {N_PLUGINS} plugins from the deployed bundle:

- **geneseed-context** — injects the project's docs *and* your machine wiki at every session start (and after compaction).
- **geneseed-learn** — distils memory at session end (powers the `learn` skill).
- **geneseed-guard** — enforces the safety Laws and protected wiki folders at the tool boundary.
- **geneseed-workflow** — registers the `workflow` tool that runs saved orchestration scripts.
- **geneseed-notify** — sends a native OS notification when a long run finishes, so you can step away and be called back.
- **geneseed-ponytail** — holds an opt-in minimal-code mode (`/ponytail lite|full|ultra|off`), injecting the laziest-that-works ruleset every turn so it doesn't drift.
- **geneseed-activity** — streams what each live session is *doing* (phase, model, tokens, files touched) to this console's Activity view.
