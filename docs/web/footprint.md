---
group: concepts
order: 8
title: "Footprint (lean vs full)"
kind: "concept"
link: {"hash": "#/settings", "label": "Toggle it in Settings →"}
---
**Footprint** controls how much of the Rules your agent carries *inline* in `AGENT.md` every turn. Two states — **lean** (the default) and **full** — set per install. It's a token-cost dial, not a change to which Rules apply: every Rule is always in force, and across lean and full the emitted files are otherwise identical — same Agents, Skills, plugins, commands, Memory, and Notebook.

### The difference

- **Full** — Section 1 of `AGENT.md` inlines every Rule's complete text *and* its reasoning. The agent sees the full law set, rationale included, on every single turn.
- **Lean** — Section 1 carries each Rule as its **heading + the rule itself** (one line), followed by a pointer to the complete law file (`laws/universal.md`, shipped beside `AGENT.md`) — the agent reads the rationale on demand when a rule's application is unclear. Lean trims Section 1 by roughly 40%.

### Which to choose

- Keep **full** if token cost is a non-issue, you want the rationale always present, or you run a smaller/cheaper model — with the *why* eagerly in context, a model applies a Rule's nuance more reliably. This is why full is the default.
- Switch to **lean** to reclaim context and cost on long sessions, large repos, or cost-sensitive runs, trusting the agent to pull the full law when it needs the *why*. Lean is **safe**: the complete law text still ships, and the harness explicitly points the agent there before acting on secrets, deletion, git history, scope, or untrusted content. It's an optimization, not a rules cut.

### How to set it

It's set-and-forget — stored in the `.geneseed-footprint` marker, preserved across every rebuild, identical on every host (OpenCode, Claude Code, Bob, Copilot). Changing it re-emits the install.

- **Settings** — the **Footprint** toggle flips the current install (full ⇄ lean) and rebuilds it in place.
- **Harnesses tab** — a per-harness dropdown sets it for any one install independently, then **Apply**.
- **Setup / re-theme wizard** — asks for footprint alongside voice and mode.
- **CLI** — `geneseed-build --footprint lean` (with any `--emit`).

---

**Related:** [Rules (Laws)](#/laws) · [Voice vs structure](#/docs/themes) · [Token footprint — the numbers](#/docs/token-footprint)
