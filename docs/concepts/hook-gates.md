---
group: concepts
order: 7
title: "Hook gates, settings and the shim"
kind: "concept"
section: "Harness"
description: "Gates fail closed, the settings files hooks are written to, Bob and OpenClaude, and the hook shim."
---
How Geneseed's [hooks](hooks.md) behave when something goes wrong, where they are written on each host, and the one file they all run through.

## Gates fail closed, and leave a trace

If a gate cannot evaluate a call — an unreadable payload, a bug — it asks, with the error as its reason, rather than silently letting the call through. Every prompt a gate raises adds one line to `notebook/gates.jsonl` in the install: the rule and the time, never the command or content. `geneseed status` counts them by rule.

```bash
geneseed status
```

In an [excluded folder](exclusions.md), every hook of a global install exits silently. And a global install's `context`, `git-gate` and `learn` hooks stand down when the session's project folder (the one the session started in, not a parent of it) has its own live per-repo install of the same host that wires the same hook, so nothing is injected, asked or learned twice. A per-repo install that is deactivated, or whose hooks were never wired, does not count: the global hook keeps running. `GENESEED_STACK_GLOBAL=1` keeps both.

## Where they are written

| Host | Global | Per repo |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `.claude/settings.local.json` |
| OpenClaude | `~/.openclaude/settings.json` | `.openclaude/settings.local.json` |
| Bob | `~/.bob/settings/settings.json` | `.bob/settings.json` |

Per repo, Claude Code and OpenClaude hooks go into the **local**, untracked settings file: the hook commands contain paths on your machine, and the team-shared `settings.json` would hand every teammate broken hooks.

The merge is surgical. Every other key and every hook of your own survive, and the install manifest records exactly which hook groups are Geneseed's, so an upgrade replaces and an uninstall removes only those.

## Bob and OpenClaude

**OpenClaude** is a Claude Code fork: it gets the same hooks and the same prompts, unchanged.

**Bob** has its own contract. It uses Claude's event names but ignores a hook's output before a tool call — the only way to refuse is exit code 2 — and it has no tool matcher, `SubagentStop` or `PreCompact`. So Bob gets three hooks:

- `SessionStart` → `geneseed-hook context`.
- `PreToolUse` → `geneseed-hook tool-gate`, the git gate and the rule gate fused into one command that decides from the shape of the call. It **blocks** (exit 2) only for the checks that admit no judgement call: secrets, destructive git, and a write under a project's own protected-checks list. The commit/push and rule-or-memory checks become a warning line, because a hard block would leave Bob unable to commit at all.
- `Stop` → `geneseed-hook learn`.

Neither host has been verified live on the authoring machine. If a hook does not fire, the same rules still reach the agent through the instructions file.

## The hook shim

Hooks run with your project as the working directory, so each command needs an absolute path. Rather than write the Node path and the Geneseed checkout path into every settings file, every hook points at one stable file, the **hook shim**: `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows). The shim holds those two paths; your settings hold none. Set `GENESEED_HOME` to keep it somewhere other than `~/.geneseed`.

Every build rewrites the shim, so moving the checkout and running one build repairs every install at once.

**A stale shim fails silently.** Hooks report through their output and exit 0 on every path — that is what keeps a broken hook from breaking your tool calls. The flip side: if the shim points at a checkout that no longer exists, every hook on the machine stops working and nothing tells you. The agent simply stops getting project context and the gates stop asking. `geneseed doctor` checks the shim; a build repairs it.

```bash
geneseed doctor
```

See [Hook, context and memory problems](../reference/troubleshoot-hooks.md).

## Cost

The hook program is small on purpose: it adds about 14 ms to each tool call.
