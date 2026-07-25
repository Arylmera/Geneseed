---
group: concepts
order: 12
title: "Foreman mode"
kind: "concept"
link: {"hash": "#/harnesses", "label": "Set the mode in Harnesses →"}
---
**Mode** is the session's *operating* register — how work gets executed — a separate dial from posture (the *relationship* register) and footprint (how much of the Rules loads inline). Two modes ship, set at build time so the choice holds steady instead of drifting mid-session, and preserved across every rebuild and re-theme.

### direct — the default

The agent works every task itself, turn by turn — exactly as it does without the dial. Nothing spawns; you talk to one agent from start to finish. Keep it unless you specifically want the session managing work for you.

### foreman — a session that triages

The session becomes a triage layer instead of a single worker. It sorts each incoming request:

- **Trivial** — answered directly, in-line, just like direct mode.
- **Substantial** — handed to an isolated [agent pipeline](#/docs/pipelines): a crew that runs on its own, reports back, and merges only once its own tests and lint pass.

Because the crew runs apart from the conversation, the session stays responsive — you keep talking to the foreman while the work proceeds. Expect foreman to cost more per substantial task (a crew runs instead of one agent), in exchange for a session that never blocks on a long job.

### How to set it

Set-and-forget, stored beside the install and preserved across rebuilds and re-themes:

- **Harnesses tab** — the per-install **Mode** dropdown (beside Voice, Footprint, and Posture), then **Apply**.
- **Setup / re-theme wizard** — asks for mode alongside voice, posture, and footprint.
- **CLI** — `build.py --mode foreman`; switch back with `--mode direct`.

---

**Related:** [Agent pipelines](#/docs/pipelines) · [The collaboration layer](#/docs/collaboration)
