---
group: hooks
order: 0
title: "How Geneseed binds to Claude Code"
kind: "concept"
---
Claude Code has no `instructions` array and no JS plugin dir — the harness reaches it through **`settings.json` hooks** instead: the same capabilities the OpenCode plugins provide, each driven by a `harness.py` subcommand. `CLAUDE.md` itself auto-loads by location, so it needs no hook at all.

### The three hooks

- **Context injection** — `SessionStart` (startup, clear, resume) runs `harness.py context`: auto-discovers the repo's docs by convention and injects them before your first turn, plus your machine wiki. It honours the same `GENESEED_CONTEXT` manifest as the OpenCode context plugin.
- **Git gate** — `PreToolUse` on Bash runs `harness.py git-gate`: enforces the safety Laws at the tool boundary, before a shell command executes.
- **Learn** — `Stop` and `SubagentStop` run `harness.py learn`: distils durable memories into the install's `memory/` store at session end; a subagent's stop routes to the per-agent lesson path (`memory/agents/<name>.md`).

### Where they live

The emit merges the hook groups surgically into your `settings.json` (global `~/.claude/settings.json`, or the project's), preserving every other key and any hooks of your own. The install manifest records exactly which groups Geneseed owns, so an upgrade replaces and an uninstall removes precisely those — never yours.

### Verify

Open Claude Code in any repo: the first reply opens with the readiness sigil and your project's docs are already in context. End a session and check the install's `memory/` dir for distilled files.

---

**Deeper:** [Claude Code adapter](#/docs/adapters-claude-code)
