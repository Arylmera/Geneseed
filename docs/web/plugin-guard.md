---
group: plugins
order: 3
title: "geneseed-guard"
kind: "concept"
---
Enforces the safety Laws at the tool boundary (`tool.execute.before`) — the same *enforce by injection, don't just instruct* stance as the context plugin. High-confidence patterns only, so legitimate work is never caught:

- **Blocks** — writes to private-key / credential files (**Law I**), catastrophic shell like `rm -rf /` (**Law IV**), and any mutation under a declared wiki's `protected` folders (AGENT.md §7, from `wiki.jsonc`).
- **Warns** (logged, allowed) — `.env` writes and force-push.

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup). The `protected` wiki folders are read from `wiki.jsonc` (`GENESEED_WIKI` → `$GENESEED_HARNESS/wiki.jsonc` → beside the install).

### Configure

- `GENESEED_GUARD=off` — disable the guard entirely.
- `GENESEED_GUARD=warn` — downgrade every block to a warning (log, but allow).

### Verify

Ask the agent to do something the guard blocks (e.g. write to a `.pem` file) — it should be refused with a `[geneseed-guard] blocked: …` message naming the Law.
