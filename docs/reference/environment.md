---
group: reference
order: 3
title: "Environment variables"
kind: "concept"
section: "CLI & environment"
description: "Where Geneseed installs, how the CLI and console behave, and where the other variables are listed."
---
The environment variables Geneseed reads, grouped by what they change. None is required: an install works with all of them unset. Set one in your shell profile (or your tool's environment) when you need to move a default.

"Plugin" means one of the OpenCode plugins — see [OpenCode plugins](opencode-plugins.md). "Hook" means `geneseed-hook`, the small binary your tool's settings call on Claude Code, Bob and OpenClaude (see the [glossary](glossary.md)).

The variables that steer context injection and memory are on [Context and memory variables](env-context.md).

## Where things install

Where Geneseed writes an install, and what an upgrade re-renders.

| Variable | Read by | Effect |
| --- | --- | --- |
| `GENESEED_HOME` | build / hooks | Directory holding the hook shim `bin/geneseed-hook` (default `~/.geneseed`). Change it, then rebuild, so the emitted hooks point at the new location. |
| `GENESEED_NO_SHIM_CHECK` | CLI | `1` silences the warning every `geneseed` command prints when the hook shim points at a path that no longer exists. For scripted callers; the `status` gates row still says `DEAD`. |
| `OPENCODE_CONFIG_DIR` | OpenCode emits, `diff`, plugins | OpenCode's config dir — where the global install is written. |
| `XDG_CONFIG_HOME` | OpenCode emits, plugins | Used when `OPENCODE_CONFIG_DIR` is unset: the install goes to `$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`). |
| `BOB_CONFIG_DIR` | Bob emits | Bob's config dir (default `~/.bob`). |
| `OPENCLAUDE_CONFIG_DIR` | OpenClaude emits | OpenClaude's own config-dir variable (default `~/.openclaude`); also moves `.openclaude.json`. |
| `GENESEED_EMIT` | `geneseed upgrade` | Which emit target to re-render (e.g. `opencode-global`). Unset, it is read from the install's `.geneseed-emit` marker, else the plain bundle. |
| `GENESEED_OUT` | `geneseed upgrade` | Bundle location for a plain-bundle install (default `Harness/` beside the checkout). |
| `GENESEED_ROOT` | `geneseed upgrade` | Project root for that bundle (default: the bundle's parent). |
| `GENESEED_PRIMARY` | `geneseed build` | `1` also emits the primary orchestrator agent (OpenCode). |
| `GENESEED_COMMANDS` | `geneseed build` | `1` also emits the `/slash` command layer (OpenCode). |

## OpenCode plugin variables

Each OpenCode plugin's page lists its own switches: [guard](plugin-guard.md) (`GENESEED_GUARD`), [notify](plugin-notify.md) (`GENESEED_NOTIFY`, `GENESEED_NOTIFY_MIN_SECONDS`, `GENESEED_NOTIFY_TITLE`), [ponytail](plugin-ponytail.md) (`GENESEED_PONYTAIL`), [workflow](plugin-workflow.md) (`GENESEED_WORKFLOWS_DIR`) and [activity](plugin-activity.md) (`GENESEED_ACTIVITY`). `GENESEED_DEBUG=1` makes every plugin but guard and learn (which always log) say what it decided on stderr. `OPENCODE_DISABLE_LSP_DOWNLOAD` belongs to OpenCode itself: see [Language servers](../concepts/lsp.md).

## Web console and CLI

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
