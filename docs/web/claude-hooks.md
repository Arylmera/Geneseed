---
group: hooks
order: 0
title: "How Geneseed binds to Claude Code"
kind: "concept"
---
Claude Code has no `instructions` array and no JS plugin dir — the harness reaches it through **`settings.json` hooks** instead: the same capabilities the OpenCode plugins provide, each driven by a `harness.py` subcommand. `CLAUDE.md` itself auto-loads by location, so it needs no hook at all.

### The four hooks

- **Context injection** — `SessionStart` (startup, clear, resume) runs `harness.py context`: auto-discovers the repo's docs by convention and injects them before your first turn, plus your machine wiki. It honours the same `GENESEED_CONTEXT` manifest as the OpenCode context plugin.
- **Git gate** — `PreToolUse` on Bash runs `harness.py git-gate`: enforces the safety Laws at the tool boundary, before a shell command executes.
- **Rule gate** — `PreToolUse` on the write tools runs `harness.py rule-gate`: a write to `user-rules.md` or to a memory file asks first, because whether something you want kept is a standing rule or a durable fact is *your* call, settled through the [rule skill](#/docs/skills) (**Law VI**). Ordinary edits are untouched.
- **Learn** — `Stop` and `SubagentStop` run `harness.py learn`: distils durable memories into the install's `memory/` store at session end; a subagent's stop routes to the per-agent lesson path (`memory/agents/<name>.md`).

### Where they live

The emit merges the hook groups surgically into your `settings.json` (global `~/.claude/settings.json`, or the project's), preserving every other key and any hooks of your own. The install manifest records exactly which groups Geneseed owns, so an upgrade replaces and an uninstall removes precisely those — never yours.

### The hook shim

Hooks run with the project as their working directory, so every command has to be an absolute path. Rather than write the interpreter and this checkout into your `settings.json`, the emit points all four hooks at one stable file — the **hook shim**, at `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows). The shim holds the two volatile paths; the config holds none.

That indirection is what lets the checkout move. Before it, relocating or replacing the clone silently broke the gates in every install at once, and the only repair was re-emitting every config. Now a single build rewrites the shim and every install is live again. The shim is refreshed on **every** emit, so an ordinary `geneseed build` is the repair; `geneseed doctor` reports it if it was ever stale.

Set `GENESEED_HOME` to keep the shim somewhere other than `~/.geneseed`.

The shim prints nothing of its own, deliberately: the gates return success on every path and signal their verdict as JSON on **stdout**, so a single stray byte from the shim would corrupt that verdict and turn a blocking gate into a silently permissive one.

### Verify

Open Claude Code in any repo: the first reply opens with the readiness sigil and your project's docs are already in context. End a session and check the install's `memory/` dir for distilled files.

---

**Deeper:** [Claude Code adapter](#/docs/adapters-claude-code)
