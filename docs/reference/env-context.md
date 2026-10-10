---
group: reference
order: 4
title: "Context and memory variables"
kind: "concept"
section: "CLI & environment"
description: "The variables that steer what loads at session start and where memory is written."
---
The environment variables that steer context injection and memory. None is required. The rest are on [Environment variables](environment.md).

"Plugin" means one of the OpenCode plugins — see [OpenCode plugins](opencode-plugins.md). "Hook" means `geneseed-hook`, the small binary your tool's settings call on Claude Code, Bob and OpenClaude (see the [glossary](glossary.md)).

## Context injection

What gets loaded into the agent's context at session start — your project's docs and your machine wiki. See [Project context](../guides/project-context.md).

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_CONTEXT` | context plugin, context hook | Explicit `context.json` manifest path; overrides discovery. |
| `GENESEED_ROOT` | context hook | Repo root to discover docs from (default: the current directory). |
| `GENESEED_WIKI` | context + guard plugins, context hook, web console | Explicit `geneseed-wiki.jsonc` path (default `$GENESEED_HARNESS/geneseed-wiki.jsonc`, else beside the install). |
| `GENESEED_STACK_GLOBAL` | context hook, Claude Code project build | `1` lets a global and a project install of the same host both inject. By default the project install makes the global one stand down. Rebuild the project install after changing it. |
| `GENESEED_CONTEXT_INJECT` | context plugin | `off` disables injection; the agent is only *asked* to read the docs. |
| `GENESEED_CONTEXT_VISIBLE` | context plugin | `1` shows the visible `PROJECT CONTEXT` block instead of the invisible per-request delivery. |
| `GENESEED_CONTEXT_TRANSFORM` | context plugin | Legacy. `0`/`off` = same as `GENESEED_CONTEXT_VISIBLE=1`; `1` matches the default. |
| `GENESEED_EAGER_FILE_KB` / `GENESEED_EAGER_TOTAL_KB` | context plugin | Per-file / total budget for docs injected in full (default 16 / 48). An oversized file is listed instead, never truncated. |
| `GENESEED_LAZY_HEADINGS` | context plugin | Cap on headings read for listed docs per session (default 64). |
| `GENESEED_WIKI_LAZY_LIMIT` | context plugin | Cap on wiki notes listed per wiki per session (default 200; beyond it the listing ends with a count). |

## Memory and learn

Where distilled memories land at session end, and which model distils them. See [Memory](../concepts/memory.md).

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_HARNESS` | learn, context, guard plugins; CLI | Base whose `memory/` is written (and where `geneseed-wiki.jsonc` is looked up). Optional — the plugin finds the in-config store by itself; set it to pin the location. |
| `GENESEED_MEMORY` | learn plugin, CLI | Explicit memory dir; wins over `GENESEED_HARNESS`. |
| `GENESEED_MODEL` | learn + context plugins | `provider/model` fallback when the session's model can't be read from the transcript. |
| `GENESEED_LLM` | learn hook (Claude Code, Bob, OpenClaude) | Model CLI used to distil, e.g. `claude -p`. Unset, a real Stop/SubagentStop/PreCompact call returns immediately — nothing reads its stdout there; a manual `learn` run (notes piped or given as a file) still prints the prompt instead of distilling. |
| `GENESEED_LEARN_CHILD` | learn hook | Set by `learn` itself on the model CLI it spawns; a nested session's own Stop hook sees it and returns immediately, which stops `GENESEED_LLM="claude -p"` (hooks not disabled) from recursing. Not meant to be set by hand. |
| `GENESEED_LEARN_DEBOUNCE_MS` | learn plugin | Quiet period before distilling, in ms (default 60000). |
