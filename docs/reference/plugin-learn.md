---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 15
title: "geneseed-learn"
description: "Distils durable facts into memory/ once a session goes quiet."
---
One of the [OpenCode plugins](opencode-plugins.md). Its switches are also listed in [Context and memory variables](env-context.md).

**What it does.** Distils durable memories from the conversation into the install's `memory/` directory and keeps `MEMORY.md` up to date, de-duplicating against what is already stored. It is the OpenCode counterpart of the Claude Code `Stop` hook, but needs no API key and no model CLI: it distils with the **same model the session used**, through your OpenCode provider config. See [Memory](../concepts/memory.md).

**When it runs.** After the session goes quiet. OpenCode signals "idle" after every turn, so each idle re-arms a timer and the distil runs once nothing has happened for `GENESEED_LEARN_DEBOUNCE_MS` (default 60 s). Trivial sessions are skipped.

**What you see.** On stderr: `[geneseed-learn] wrote N memory file(s): …`, or `skipped: <reason>`. Total silence means it did not load.

**Where it writes** — the first that resolves:
1. `GENESEED_MEMORY` — an explicit memory dir;
2. `$GENESEED_HARNESS/memory` (`/anamnesis` for the imperial theme);
3. the `memory/` beside the plugin's own install (the global install's store);
4. `./memory` or `./Harness/memory`, when the bundle lives in the project.

So a global install needs nothing set; use `GENESEED_HARNESS` only to pin the location. If none resolves, it logs `no memory dir — set $GENESEED_HARNESS or $GENESEED_MEMORY.` and does nothing.

**Switches.**
- `GENESEED_MODEL=provider/model` — fallback when the session's model can't be read. Without it you get `could not determine a model`.
- `GENESEED_LEARN_DEBOUNCE_MS` — the quiet period.
