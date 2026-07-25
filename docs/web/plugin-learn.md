---
group: plugins
order: 2
title: "geneseed-learn"
kind: "concept"
---
The runtime-agnostic counterpart of the Claude Code `Stop` hook: on `session.idle` it distils durable memories from the conversation into the bundle's `memory/` dir and maintains `MEMORY.md`, deduping against what's already stored — exactly what `geneseed learn` does, but self-contained in JS, so no Python and no model CLI are required.

It distils with the **same model the session already used** (read from the transcript), inheriting your OpenCode provider config — no API key, nothing to set. Trivial sessions are skipped and any error is swallowed, so it never blocks a session.

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup).

### Configure — where it writes

Memories land in the first location that resolves:

1. `GENESEED_MEMORY` — an explicit memory dir;
2. `$GENESEED_HARNESS/memory` (or `/anamnesis` for the imperial theme);
3. `./memory` or `./Harness/memory` when the bundle lives in the project.

Because the bundle is global, set `GENESEED_HARNESS` once to its absolute path so the plugin always writes to the same store no matter where you launch OpenCode. If it can't read the session's model from the transcript, set a fallback `GENESEED_MODEL=provider/model`.

### Verify

Start a session, do a little work, end it. On `session.idle` the plugin logs `[geneseed-learn] wrote N memory file(s): …` or a skip reason to stderr. Total silence means it didn't load.
