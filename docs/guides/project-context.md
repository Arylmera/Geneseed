---
group: guides
order: 14
title: "Project context"
kind: "concept"
section: "Set up"
description: "Choose which of a repo's docs the agent loads."
---
At the start of every session, the harness shows the agent your repo's own documentation. Usually you have nothing to configure. This page explains what gets loaded and what each choice costs, so you know when to override it.

## Eager and lazy: what each costs

The context step sorts every doc it finds into one of two lists:

- **Eager**: the full text is put into the session. The agent knows it from the first turn, but you pay its tokens in **every** session in that repo, whether the task needs it or not.
- **Lazy**: only the path (and a heading) is listed. The agent reads the file when a task calls for it. The cost is close to zero until the file is read.

> **You already know this:** eager versus lazy loading of imports. Eager is fast to use and always paid for. Lazy costs one extra step and is free until you need it.

## What is found automatically

With no configuration, the context step finds these files:

- **Eager:** root `AGENTS.md`, `AGENT.md`, `CLAUDE.md` and `.cursorrules`, plus `README.md` and `CONTRIBUTING.md` (or their AsciiDoc `.adoc` twins). The root file your tool already loads by itself is skipped, so you never pay for it twice.
- **Lazy:** `docs/`, `doc/`, `documentation/`, `architecture/`, `adr/` and `ADR/`, monorepo `packages/*/README.md` and `apps/*/README.md`, and any other root `*.md`. AsciiDoc docs (`.adoc`) are found everywhere a `.md` is.
- **Never scanned:** `node_modules`, `.git`, `dist`, `build`, `vendor`, `.next`, `target`, `.venv`, `__pycache__`, `.opencode` and `.harness`.

On Claude Code, Bob and OpenClaude the whole injection stays under 9,000 characters, because Claude Code hands the model only a short preview of a hook output past about 10,000 and keeps the rest in a file. Your session files come first, then eager files whole; an eager file that does not fit is listed instead, to be read on demand. On OpenCode eager files share a 48 KB budget. On every host, three or more docs in one folder are listed as that folder with a count (`docs/guides/ — 30 docs`), not file by file.

On OpenCode the context plugin does this work. On Claude Code, Bob and OpenClaude, the session-start hook does it (`geneseed-hook context`). Both read the same override file, described next.

## Override it with `context.json`

Add a manifest only when the convention does not fit your repo. Put it at `.harness/context.json`, or at `context.json` in the repo root, or point `$GENESEED_CONTEXT` at it:

```json
{
  "extend": true,
  "context": [
    { "path": "docs/house-rules.md", "load": "eager", "description": "Branch policy, definition of done." },
    { "path": "docs/**/*.md", "load": "lazy" },
    { "path": "internal/secrets.md", "load": "exclude" }
  ]
}
```

- `path` is absolute, relative to the repo, or a glob.
- `load` is `eager`, `lazy` or `exclude`.
- `"extend": true` keeps automatic discovery running and adds your entries on top. Without it, the manifest replaces discovery entirely.

### Example: a monorepo

A monorepo with docs scattered across packages might write:

```json
{
  "extend": true,
  "context": [
    { "path": "docs/architecture.md", "load": "eager", "description": "system map" },
    { "path": "api/README.md", "load": "eager" },
    { "path": "web/README.md", "load": "eager" }
  ]
}
```

Keep the eager list to the few files a new teammate would read first. Three sharp docs beat ten broad ones. Use `"load": "lazy"` for anything a session should only read on demand.

<!--harness:opencode-->
*(OpenCode only)*

## What else OpenCode adds

On OpenCode the eager budget is adjustable: 16 KB per file and 48 KB in total by default, changed with `GENESEED_EAGER_FILE_KB` and `GENESEED_EAGER_TOTAL_KB`. When it can, the context block also adds two lines, so the agent starts out oriented:

- the repo's **runnable commands**: targets from `Makefile`, `package.json` scripts (with the right runner for the lockfile), `justfile` and `Taskfile`;
- the session's **current model**, read from the transcript, with `GENESEED_MODEL=provider/model` as a fallback.

A line is simply left out when its source is missing.

## How OpenCode delivers it

By default, the plugin delivers the context invisibly. It prepends the context to each request through OpenCode's experimental `experimental.chat.messages.transform` hook, so nothing appears in the conversation. Because it is re-sent with every request, the context also survives compaction. If your OpenCode build lacks that hook, the plugin notices and falls back to posting a visible `PROJECT CONTEXT` message.

- `GENESEED_CONTEXT_VISIBLE=1` always shows the visible block, so you can see what the agent received.
- `GENESEED_CONTEXT_INJECT=off` turns injection off. The agent then relies on the instruction in `AGENT.md` to read the docs itself.
- `GENESEED_DEBUG=1` logs what was discovered and how it was delivered.
<!--/harness-->

All the knobs are listed in [Context and memory variables](../reference/env-context.md). For knowledge that belongs to you rather than to one repo, see [Wiki](wiki.md).
