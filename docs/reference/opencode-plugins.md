---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 10
title: "OpenCode plugins"
description: "What the OpenCode plugins are, how they install, and the folders that silence them."
---
On OpenCode, Geneseed's automation runs as {N_PLUGINS} plugins: small JavaScript files OpenCode loads from its `plugins/` directory at startup. They are what turns a rule from *asked* into *enforced* — the context load, the safety gates, memory distillation. On Claude Code, Bob and OpenClaude the same jobs are done by hooks instead (see [Hooks](../concepts/hooks.md)).

> **You already know this:** a plugin is a git hook for your agent — code that runs on an event (session start, before a tool call, session idle), not text the model may or may not follow.

Every plugin installs in the same step as the rest of the harness: `geneseed setup`, or `geneseed build --emit opencode-global` (global, into `~/.config/opencode/plugins/`) / `--emit opencode` (per-repo, into `.opencode/plugins/`). Installing by hand is covered in [Install](../guides/install.md). Keep **one** copy of each: OpenCode loads two local copies of the same plugin twice.

Every plugin swallows its own errors — none can block or crash a session. Each variable below is also listed in [Environment variables](environment.md).

## The plugins

- [geneseed-context](plugin-context.md): Puts your project docs, rules, profile, memory index and wiki in front of the agent.
- [geneseed-guard](plugin-guard.md): Blocks credential files, catastrophic commands and protected wiki writes before they run.
- [geneseed-learn](plugin-learn.md): Distils durable facts into memory/ once a session goes quiet.
- [geneseed-workflow](plugin-workflow.md): Adds a workflow tool that runs saved orchestration scripts.
- [geneseed-notify](plugin-notify.md): A desktop notification when a long turn finishes.
- [geneseed-ponytail](plugin-ponytail.md): An opt-in minimal-code mode, re-applied every turn.
- [geneseed-activity](plugin-activity.md): Feeds the web console's Activity view, one small file per session.

## Excluded folders

`geneseed-context`, `geneseed-guard` and `geneseed-learn` go dormant inside a folder listed in the global install's `excludes.json` (managed by `geneseed exclude`). See [Exclusions](../concepts/exclusions.md).
