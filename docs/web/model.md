---
group: concepts
order: 0
title: "The harness model"
kind: "concept"
---
Geneseed assembles five runtime pieces around a single `AGENT.md` entrypoint: **Rules** (the laws the agent obeys), **Agents** (capability specialists you delegate to), **Skills** (repeatable workflows the agent can invoke), **Memory** (one-fact-per-file durable knowledge), and a **Notebook** (the agent's own sovereign space).
<!--harness:opencode-->
On OpenCode, {N_PLUGINS} **Plugins** bind the pieces to the host: context injection, learn-at-session-end, the safety guard, the saved workflow runner, end-of-run notifications, a live-activity feed for this console, and an opt-in minimal-code mode.
<!--/harness-->
<!--harness:claude-->
On Claude Code, three settings.json **hooks** bind the pieces to the host — context injection, the git safety gate, and learn-at-session-end. See [How Geneseed binds to Claude Code](#/docs/claude-hooks).
<!--/harness-->
The structure is theme-independent — a theme only changes the *voice* (banner, sigil, prose), never a folder or a link. A separate dial, the **[footprint](#/docs/footprint)**, sets how much of the Rules load inline each turn (full vs lean), the **[collaboration layer](#/docs/collaboration)** — posture, the Pact, typed memory, your profile — shapes how the agent works *with you*, and the **mode** dial ([direct vs foreman](#/docs/foreman-mode)) sets *how work gets executed* — one agent turn by turn, or a foreman triaging tasks into [pipelines](#/docs/pipelines).

### What this UI actually shows

The **Library** and **Graph** render the Geneseed source live — they show the harness that *would* be deployed if you rebuilt right now. The **Settings** panes and the **Memory** drawer read from the deployed harness on disk (the harness install dir, e.g. `~/.config/opencode/…` for an OpenCode global install).

If you've built recently, the two match. If you edit a file under `src/` and reload this panel, the Library updates immediately — the deployed bundle does not, until the next `geneseed update` or `build`.
