---
group: concepts
order: 0
title: "The harness model"
kind: "concept"
---
Geneseed assembles its runtime pieces around a single `AGENT.md` entrypoint: an **Ontology** (how the agent thinks, decides and speaks — always on), **Rules** (the always-on invariants it never breaks), **Doctrines** (practice packs this repository chose at build time), **Agents** (capability specialists you delegate to), **Skills** (repeatable workflows the agent can invoke), **Memory** (one-fact-per-file durable knowledge), and a **Notebook** (the agent's own sovereign space). The first three are the [constitution](#/docs/rules), in that order of precedence — with your own `user-rules.md` sitting between the Rules and the Doctrines.
<!--harness:opencode-->
On OpenCode, {N_PLUGINS} **Plugins** bind the pieces to the host: context injection, learn-at-session-end, the safety guard, the saved workflow runner, end-of-run notifications, a live-activity feed for this console, and an opt-in minimal-code mode.
<!--/harness-->
<!--harness:claude-->
On Claude Code, four settings.json **hooks** bind the pieces to the host — context injection, the git consent gate (wired only when the **process** doctrine pack is built in), the rule gate on writes to `user-rules.md` and memory, and learn-at-session-end. See [How Geneseed binds to Claude Code](#/docs/claude-hooks).
<!--/harness-->
The structure is theme-independent — a theme only changes the *voice* (banner, sigil, prose), never a folder or a link. Four dials are fixed at build time and preserved across every rebuild: **[posture](#/docs/collaboration)** (the relationship register), **mode** ([direct vs foreman](#/docs/foreman-mode) — one agent turn by turn, or a foreman triaging tasks into [pipelines](#/docs/pipelines)), **[doctrine packs](#/docs/setup-choices)** (which practice rules bind — the only dial that changes *which* rules apply), and **[footprint](#/docs/footprint)** (how much of the constitution loads inline each turn, full vs lean). Around them the **[collaboration layer](#/docs/collaboration)** — posture, the Pact, typed memory, your profile — shapes how the agent works *with you*.

### What this UI actually shows

The **Library** and **Graph** render the Geneseed source live — they show the harness that *would* be deployed if you rebuilt right now. The **Settings** panes and the **Memory** drawer read from the deployed harness on disk (the harness install dir, e.g. `~/.config/opencode/…` for an OpenCode global install).

If you've built recently, the two match. If you edit a file under `src/` and reload this panel, the Library updates immediately — the deployed bundle does not, until the next `geneseed update` or `build`.
