---
group: concepts
order: 8
title: "Footprint (lean vs full)"
kind: "concept"
link: {"hash": "#/settings", "label": "Toggle it in Settings →"}
---
**Footprint** controls how much of the [constitution](#/docs/rules) your agent carries *inline* in `AGENT.md` every turn. Two states — **lean** (the default) and **full** — set per install. It's a token-cost dial, not a change to which rules apply: whatever this install adopted is in force at either setting, and across lean and full the emitted files are otherwise identical — same Agents, Skills, plugins, commands, Memory, and Notebook. (The dial that *does* change which rules apply is the [doctrine packs](#/docs/setup-choices), a separate choice.)

### The difference

- **Full** — `AGENT.md` inlines the Ontology, every Rule and every rule of the **active** doctrine packs, complete text and reasoning included, on every single turn.
- **Lean** — each Rule and each doctrine rule is carried as its **heading + the rule itself** (one line), each tier closing with a pointer to its complete text shipped beside `AGENT.md` — the agent reads the reasoning on demand when a rule's application is unclear. The **Ontology ships whole even at lean**: it is flowing prose, not numbered blocks, and truncating it to first sentences would leave orphan fragments rather than a shorter argument.

### What ships on disk either way

Neither setting hides text from the agent; they hide it from *every turn*.

- **Lean** writes `laws/`, `ontology/` and `doctrines/` in full text into the install, beside `AGENT.md`, because the inline copy has lost text the agent may still need.
- **Full** writes `doctrines/` for the mirror-image reason: full inlines only the packs this install built in, so the ones it left out have to be on disk for a citation into them to resolve, and for you to read before turning one on.

### Which to choose

- Keep **lean** — the default — on long sessions, large repos, or cost-sensitive runs, trusting the agent to pull the complete text when it needs the *why*. Lean is **safe**: that text still ships, and the harness explicitly points the agent there before acting on secrets, deletion, git history, scope, or untrusted content. It's an optimization, not a rules cut.
- Switch to **full** if token cost is a non-issue, you want the reasoning always present, or you run a smaller/cheaper model — with the *why* eagerly in context, a model applies a rule's nuance more reliably.

### How to set it

It's set-and-forget — stored in the `.geneseed-footprint` marker, preserved across every rebuild, identical on every host (OpenCode, Claude Code, Bob, Copilot). Changing it re-emits the install.

- **Settings** — the **Footprint** toggle flips the current install (full ⇄ lean) and rebuilds it in place.
- **Harnesses tab** — a per-harness dropdown sets it for any one install independently, then **Apply**.
- **Setup / re-theme wizard** — asks for footprint alongside voice, posture, mode, and doctrine packs.
- **CLI** — `geneseed-build --footprint lean` (with any `--emit`).

---

**Related:** [The constitution](#/docs/rules) · [Voice vs structure](#/docs/themes) · [Token footprint — the numbers](#/docs/token-footprint)
