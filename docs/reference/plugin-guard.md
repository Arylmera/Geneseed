---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 14
title: "geneseed-guard"
description: "Blocks credential files, catastrophic commands and protected wiki writes before they run."
---
One of the [OpenCode plugins](opencode-plugins.md). [Environment variables](environment.md) points here for its switches.

**What it does.** Enforces the safety rules at the tool boundary — before a tool call runs, not after. High-confidence patterns only, so legitimate work is not caught.

- **Blocks** writes to private-key and credential files (*Sealed Secrets*), catastrophic shell commands such as deleting the filesystem root (*Deletion Is Deliberate*), and any change — write, move, rename, delete — under a wiki folder declared `protected` in `geneseed-wiki.jsonc`, and writes to a check listed in the project's `.geneseed/protected-checks.txt` (*External Gate* — see [Hooks](../concepts/hooks.md)).
- **Warns** (logged, allowed) on `.env` writes and force-push.
- **Speed-bumps** the *first* write to `user-rules.md` or a memory file: it is refused once, naming *Persist Insight* — whether something is a standing rule or a fact to remember is your call, settled through the `rule` skill. The re-issued write goes through.

It ships whole on every install, whatever [doctrine packs](../concepts/rules.md) you chose. On Claude Code and Bob the same checks are hooks, which can *ask* you instead of refusing; OpenCode's tool hook has no ask tier. Protected wiki folders are enforced only here — on the other hosts they are an instruction.

A `permission.ask` hook lets through only a fixed set of commit/push forms on a `loop/*` branch with a running loop — anything else still asks, same as the Claude/Bob git-gate's loop/* exemption.

**When it runs.** Before every tool call (`tool.execute.before`), and before a static `permission.bash` ask is shown to you (`permission.ask`).

**What you see.** A refused tool call: `[geneseed-guard] blocked: <reason> — set GENESEED_GUARD=off to allow`. Warnings go to stderr.

**Switches.**
- `GENESEED_GUARD=warn` — log every block, allow the call.
- `GENESEED_GUARD=off` — disable the guard.
