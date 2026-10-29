---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 13
title: "geneseed-context"
description: "Puts your project docs, rules, profile, memory index and wiki in front of the agent."
---
One of the [OpenCode plugins](opencode-plugins.md). Its switches are also listed in [Context and memory variables](env-context.md).

**What it does.** Puts your project's documentation (and your machine wiki) into the agent's context before your first turn, so the agent never has to be trusted to read it. It needs **no per-repo file**: it discovers docs by convention.

- **Injected in full (eager):** root `README.md`, `CONTRIBUTING.md` (or `README.adoc`, `CONTRIBUTING.adoc`), `.cursorrules`, `user-rules.md`, `PROFILE.md`. Budget-capped; an oversized file is listed instead, never silently truncated. (`AGENT.md`, `AGENTS.md` and `CLAUDE.md` are not injected — OpenCode already loads them.)
- **Listed (lazy, path + first heading, read on demand):** `docs/`, `doc/`, `documentation/`, `architecture/`, `adr/`, and `packages/*/README.md` / `apps/*/README.md` in a monorepo, AsciiDoc `.adoc` docs included. `node_modules`, `.git`, `dist`, `build`, `vendor` and similar are never scanned.
- **Machine wiki:** the wikis declared in `geneseed-wiki.jsonc` ride in the same block, on the same budgets. See [Wiki](../guides/wiki.md).
- **Explicit manifest:** `$GENESEED_CONTEXT`, `.harness/context.json` or a root `context.json` takes over from discovery; `"extend": true` layers it on top instead. See [Project context](../guides/project-context.md).

**When it runs.** On every request: the context rides invisibly in the request's message list, so it also survives compaction. If your OpenCode build lacks that (experimental) hook, the plugin notices and falls back to one visible message at session start, re-pushed when the session compacts.

**The done gate's reminder.** The project's checks come from `.geneseed/done-checks.txt`, or, without that file, are inferred from the manifests at the project's git root (see [Hooks](../concepts/hooks.md)). A request that follows a turn which edited files without every check passing since gets one more invisible message naming the checks owed (inferred ones marked advisory). OpenCode has no turn-end event a plugin can block on, so this is a reminder, not a block. OpenCode 1 only: on OpenCode 2 the turn is not judged, and with a listed file the plugin logs that once. The context block also opens with one line naming the checks and their source (`Done gate: …`), ending `(reminder)` for a listed file or `(advisory)` for inferred checks on OpenCode 1, and `(not judged on this host)` on OpenCode 2. `GENESEED_CONTEXT_INJECT=off` does not turn the reminder off; a done list that lists nothing does, and so does an install built `--no-done-gate` (`Done gate: off` in its `AGENT.md`, read once when OpenCode starts), which also silences the OpenCode 2 log line and the context line.

**The ownership decline line.** In an application repo whose root `AGENTS.md` has no `## Ownership` section, a `Setup: declined <YYYY-MM-DD>` line in the personal `.geneseed/ownership.md` of the main worktree (the main checkout's, from a linked git worktree) adds one line beside the done line: `Ownership: setup declined since <date> — not set up; say "set up ownership" to run it`. An install built `--no-ownership-gate` (`Ownership gate: off` in its `AGENT.md`, read once when OpenCode starts) prints no such line.

**What you see.** Normally nothing — the context is there, but not shown. With the visible fallback, a `PROJECT CONTEXT` block at the top of the session.

**Switches.**
- `GENESEED_CONTEXT_INJECT=off` — no injection; the agent is only *asked* to read the docs.
- `GENESEED_CONTEXT_VISIBLE=1` — force the visible block (legacy `GENESEED_CONTEXT_TRANSFORM=0` does the same).
- `GENESEED_EAGER_FILE_KB` / `GENESEED_EAGER_TOTAL_KB` (default 16 / 48), `GENESEED_LAZY_HEADINGS` (64), `GENESEED_WIKI_LAZY_LIMIT` (200) — budgets.
- `GENESEED_WIKI` — explicit `geneseed-wiki.jsonc` path.
- `GENESEED_DEBUG=1` — log what it discovered and injected to stderr. Silence with this set means the plugin did not load.
