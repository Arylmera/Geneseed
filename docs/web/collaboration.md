---
group: concepts
order: 11
title: "The collaboration layer"
kind: "concept"
---
Beside the [constitution](#/docs/rules), a handful of mechanisms shape *how* the agent works with you — the two registers, the mutual contract, how memory binds, and who you are. All of them are plain content in `AGENT.md` and its neighbours, so they ride to every host (OpenCode, Claude, Bob, Copilot) unchanged.

### Postures — the register

A **posture** is the relationship register the agent works in, chosen by *you* at setup and fixed at build time so it holds steady instead of drifting back toward plain execution mid-session. Five ship: **peer** (default — a candid equal), **mentor** (explains the why), **expert** (maximum density), **assistant** (precise, low-initiative), **artisan** (peer with toolsmith reflexes). Posture is orthogonal to theme: theme is the *voice*, posture is the *relationship*. Change it in the setup wizard, from the **Harnesses** page here (the per-install posture dropdown, next to voice and footprint), or with `geneseed-build --posture <name>`. A rebuild or re-theme preserves it.

### Modes — how work executes

A **mode** is the session's operating register — *how* work gets executed, as opposed to posture's *relationship* register. Two ship: **direct** (default — the agent works every task itself, turn by turn) and **foreman** (the session triages incoming tasks: trivial ones get a direct answer, substantial ones spawn an isolated pipeline — a crew of an analyst, a developer, and a tester, plus whatever specialists the task needs — that reports back and merges only once its own tests and lint pass, while the session keeps answering you). Expect foreman mode to cost more per substantial task, in exchange for a session that never blocks on one. Change it in the setup wizard, from the **Harnesses** page here (the per-install mode dropdown, next to posture), or with `geneseed-build --mode <name>`; switch back any time with `--mode direct`. A rebuild or re-theme preserves it. See [Foreman mode](#/docs/foreman-mode) and [agent pipelines](#/docs/pipelines) for the dedicated pages.

### The Pact — a two-way contract

Where the Rules bind the agent, the **Pact** binds the collaboration — and it is not a layer beside them: it is stated inside the Ontology's **Telos**, the tier that is always in force, so it holds in every task and every repository. It carries three co-equal protections (you, the truth, the agent), never traded one for another, and — unusually — names what *you* owe back: don't punish candour that honours the pact, give context up front, decide when shown a fork. Your half is not enforceable against you; the agent's half is binding on it.

### Typed memory — binding force

A memory may carry an optional `force` — **constraint** (imposed, not the agent's to relax), **choice** (revisable with consent), **conviction** (revisable on evidence), or **tempered** (a relaxed constraint). When new evidence contradicts a forced memory, the Bridge rule requires revising it in the open rather than dropping it silently.

### Your profile — identity

`PROFILE.md`, seeded once beside `AGENT.md` and never overwritten, holds *who you are*: role, habits, register preferences. It is identity, not rules — it colours how the agent works but never binds (precedence is the Ontology and the Rules, then `user-rules.md`, then the active Doctrines, then the profile). Edit it here under the **Profile** tab, or in the file directly — or let the agent draft it: the [[profile]] skill interviews you (who you are, how you work, how you like answers pitched) and writes the file only with your consent, routing anything that is really a standing rule to `user-rules.md` instead.
