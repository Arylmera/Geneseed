---
group: plugins
order: 3
title: "geneseed-guard"
kind: "concept"
---
Enforces the safety Laws at the tool boundary (`tool.execute.before`) — the same *enforce by injection, don't just instruct* stance as the context plugin. High-confidence patterns only, so legitimate work is never caught:

- **Blocks** — writes to private-key / credential files (**Law I**), catastrophic shell like `rm -rf /` (**Law IV**), and any mutation under a declared wiki's `protected` folders (AGENT.md §7, from `wiki.jsonc`).
- **Warns** (logged, allowed) — `.env` writes and force-push.
- **Speed-bumps** — the *first* write to `user-rules.md` or a memory file is refused, naming **Law VI**: a standing rule or a durable fact is the user's call, settled through the rule skill. A re-issued write goes through, so a legitimate write is never trapped. (On Claude Code and Bob the same guard is a `geneseed-hook rule-gate` hook, which can *ask* the user instead of refusing — OpenCode's `tool.execute.before` has no ask tier.)

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup). The `protected` wiki folders are read from `wiki.jsonc` (`GENESEED_WIKI` → `$GENESEED_HARNESS/wiki.jsonc` → beside the install).

### Configure

- `GENESEED_GUARD=off` — disable the guard entirely.
- `GENESEED_GUARD=warn` — downgrade every block to a warning (log, but allow).

### Verify

Ask the agent to do something the guard blocks (e.g. write to a `.pem` file) — it should be refused with a `[geneseed-guard] blocked: …` message naming the Law.
