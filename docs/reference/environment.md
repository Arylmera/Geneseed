---
group: reference
order: 2
title: "Environment variables"
kind: "concept"
---
Every environment variable Geneseed reads, grouped by what it changes. None is required: an install works with all of them unset. Set one in your shell profile (or your tool's environment) when you need to move a default.

"Plugin" means one of the OpenCode plugins — see [OpenCode plugins](opencode-plugins.md). "Hook" means `geneseed-hook`, the small binary your tool's settings call on Claude Code, Bob and OpenClaude (see the [glossary](glossary.md)).

### Where things install

Where Geneseed writes an install, and what an upgrade re-renders.

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_HOME` | build / hooks | Directory holding the hook shim `bin/geneseed-hook` (default `~/.geneseed`). Change it, then rebuild, so the emitted hooks point at the new location. |
| `OPENCODE_CONFIG_DIR` | OpenCode emits, `diff`, plugins | OpenCode's config dir — where the global install is written. |
| `XDG_CONFIG_HOME` | OpenCode emits, plugins | Used when `OPENCODE_CONFIG_DIR` is unset: the install goes to `$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`). |
| `BOB_CONFIG_DIR` | Bob emits | Bob's config dir (default `~/.bob`). |
| `OPENCLAUDE_CONFIG_DIR` | OpenClaude emits | OpenClaude's own config-dir variable (default `~/.openclaude`); also moves `.openclaude.json`. |
| `GENESEED_EMIT` | `geneseed upgrade` | Which emit target to re-render (e.g. `opencode-global`). Unset, it is read from the install's `.geneseed-emit` marker, else the plain bundle. |
| `GENESEED_OUT` | `geneseed upgrade` | Bundle location for a plain-bundle install (default `Harness/` beside the checkout). |
| `GENESEED_ROOT` | `geneseed upgrade` | Project root for that bundle (default: the bundle's parent). |
| `GENESEED_PRIMARY` | `geneseed build` | `1` also emits the primary orchestrator agent (OpenCode). |
| `GENESEED_COMMANDS` | `geneseed build` | `1` also emits the `/slash` command layer (OpenCode). |

### Context injection

What gets loaded into the agent's context at session start — your project's docs and your machine wiki. See [Project context](../guides/project-context.md).

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_CONTEXT` | context plugin, context hook | Explicit `context.json` manifest path; overrides discovery. |
| `GENESEED_ROOT` | context hook | Repo root to discover docs from (default: the current directory). |
| `GENESEED_WIKI` | context + guard plugins, context hook, web console | Explicit `wiki.jsonc` path (default `$GENESEED_HARNESS/wiki.jsonc`, else beside the install). |
| `GENESEED_STACK_GLOBAL` | context hook, Claude Code project build | `1` lets a global and a project install of the same host both inject. By default the project install makes the global one stand down. Rebuild the project install after changing it. |
| `GENESEED_CONTEXT_INJECT` | context plugin | `off` disables injection; the agent is only *asked* to read the docs. |
| `GENESEED_CONTEXT_VISIBLE` | context plugin | `1` shows the visible `PROJECT CONTEXT` block instead of the invisible per-request delivery. |
| `GENESEED_CONTEXT_TRANSFORM` | context plugin | Legacy. `0`/`off` = same as `GENESEED_CONTEXT_VISIBLE=1`; `1` matches the default. |
| `GENESEED_EAGER_FILE_KB` / `GENESEED_EAGER_TOTAL_KB` | context plugin | Per-file / total budget for docs injected in full (default 16 / 48). An oversized file is listed instead, never truncated. |
| `GENESEED_LAZY_HEADINGS` | context plugin | Cap on headings read for listed docs per session (default 64). |
| `GENESEED_WIKI_LAZY_LIMIT` | context plugin | Cap on wiki notes listed per wiki per session (default 200; beyond it the listing ends with a count). |

### Memory and learn

Where distilled memories land at session end, and which model distils them. See [Memory](../concepts/memory.md).

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_HARNESS` | learn, context, guard plugins; CLI | Base whose `memory/` is written (and where `wiki.jsonc` is looked up). Optional — the plugin finds the in-config store by itself; set it to pin the location. |
| `GENESEED_MEMORY` | learn plugin, CLI | Explicit memory dir; wins over `GENESEED_HARNESS`. |
| `GENESEED_MODEL` | learn + context plugins | `provider/model` fallback when the session's model can't be read from the transcript. |
| `GENESEED_LLM` | learn hook (Claude Code, Bob, OpenClaude) | Model CLI used to distil, e.g. `claude -p`. Unset, the hook prints the prompt instead of distilling. |
| `GENESEED_LEARN_DEBOUNCE_MS` | learn plugin | Quiet period before distilling, in ms (default 60000). |

### Guard

The OpenCode safety guard. On Claude Code, Bob and OpenClaude the same gates are hooks and have no environment switch.

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_GUARD` | guard plugin | `warn` downgrades every block to a logged warning; `off` disables the guard. |

### Notifications

The desktop ping when a long turn finishes (OpenCode).

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_NOTIFY` | notify plugin | `off` disables notifications. |
| `GENESEED_NOTIFY_MIN_SECONDS` | notify plugin | Minimum turn length before notifying (default 30; `0` = every turn). |
| `GENESEED_NOTIFY_TITLE` | notify plugin | Notification title (default `Geneseed`). |

### Other OpenCode plugins

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_PONYTAIL` | ponytail plugin | Starting minimal-code level: `lite` \| `full` \| `ultra` \| `off` (default `off`; switch live with `/ponytail <level>`). |
| `GENESEED_WORKFLOWS_DIR` | workflow plugin | Directory the `workflow` tool loads saved scripts from. |
| `GENESEED_ACTIVITY` | activity plugin | `off` stops writing the live-activity files the web console reads. |
| `GENESEED_DEBUG` | every plugin but guard and learn (which always log) | `1` logs what each plugin decided to stderr. |
| `OPENCODE_DISABLE_LSP_DOWNLOAD` | OpenCode itself | `true` stops OpenCode downloading language servers — for air-gapped machines; install each server yourself. |

### Web console and CLI

How the `geneseed` command behaves and prints.

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_NO_WEB` | `geneseed` (bare) | `1` stops bare `geneseed` opening the web console; it falls back to the terminal menu. |
| `GENESEED_NODE` | `./geneseed`, `geneseed.cmd`, `install` scripts | Node interpreter to run (default `node` on PATH). |
| `GENESEED_TUI_ASCII` | CLI output | Pure-ASCII output: no box-drawing or emoji. |
| `GENESEED_TUI_PLAIN` | CLI output | Drop emoji and animation. |
| `GENESEED_NO_ANIM` | install animation | Disable the themed install animation. |
| `NO_COLOR` | `geneseed status` | Any value disables colour. |
| `GENESEED_LOG` | `geneseed upgrade` | Install/upgrade log path (default `~/.geneseed-install.log`). |
| `GENESEED_NET_TIMEOUT` | `geneseed upgrade` | Seconds before the network fetch gives up (default 120, minimum 30). |
