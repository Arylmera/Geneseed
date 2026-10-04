---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 17
title: "geneseed-activity"
description: "Feeds the web console's Activity view, one small file per session."
---
One of the [OpenCode plugins](opencode-plugins.md). Its switches are also listed in [Environment variables](environment.md).

**What it does.** Feeds the web console's **Activity** view: one small JSON file per session under `activity/` beside OpenCode's config, recording what the session is doing — phase, model, token and cost totals, files touched, plan, last error. The console reads and prunes those files; the two only meet on disk, so a crash on either side never blocks a session.

**When it runs.** On session events, for top-level sessions only (sub-agents and learn's sessions are skipped). Entries whose process died or went stale are pruned by the reader.

**What you see.** A card per live session in **Activity** (`geneseed web`).

**Switches.**
- `GENESEED_ACTIVITY=off` — kill switch at startup.
- The Activity page's own toggle writes a `.geneseed-activity` flag file, read per event — no restart needed.
- `GENESEED_DEBUG=1` — logs each write as `[geneseed-activity] …`.
