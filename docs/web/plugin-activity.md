---
group: plugins
order: 7
title: "geneseed-activity"
kind: "concept"
---
Feeds this console's **Activity** view: writes one small JSON file per session (`activity/<session_id>.json` beside the OpenCode config) recording what the harness is *doing* — current phase, model, token and cost totals, turn-elapsed, files touched, the plan, and the last error. The web server reads and prunes those files; writer and reader only ever meet on the filesystem, so a crash on either side never blocks a session.

- **One entry per top-level session** — sub-agent child sessions and the learn plugin's throwaway distil sessions are skipped.
- **Self-cleaning** — the reader prunes entries whose process is dead or whose timestamp went stale, so a crashed writer's file disappears on its own.

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup).

### Configure

- `GENESEED_ACTIVITY=off` — hard kill switch at startup.
- The **Activity** page's toggle writes a `.geneseed-activity` flag file read per event — takes effect without restarting OpenCode.

### Verify

Start a session, then open **Activity** in this console — a card for the session appears. `GENESEED_DEBUG=1` logs each write as `[geneseed-activity] …` to stderr.
