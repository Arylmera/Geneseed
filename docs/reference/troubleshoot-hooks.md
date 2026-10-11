---
group: reference
kind: "concept"
section: "Troubleshooting"
order: 7
title: "Hook, context and memory problems"
description: "Hooks that stopped firing, no readiness sigil, project docs not loaded, no memory written."
---
Each entry gives the likely cause, the fix, and how to confirm it worked. First stop for almost anything: `geneseed doctor` (see [Troubleshooting](troubleshooting.md)).

## Hooks stopped firing

The agent loads its rules, but nothing is enforced and no memory is written — on Claude Code, Bob or OpenClaude.

Every `geneseed` command now says so first, on stderr:

> `[geneseed] ⚠ hooks are off on this machine: the hook shim points at <path>, which no longer exists. Fix: geneseed rebuild-all`

and the `gates` row of `geneseed status` reads `DEAD — hook shim points at <path>; run: geneseed rebuild-all`. A script that must not see the line can set `GENESEED_NO_SHIM_CHECK=1`.

**Cause.** Almost always a **stale hook shim**. Your tool's settings call `geneseed-hook` through one small script, `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows), which holds the absolute path of your Geneseed folder. Move or delete that folder and the shim points at nothing: the hooks still fire, fail, and every gate goes silently dead. `geneseed doctor` reports it as:

> `[shim] <path> pointed at <old path>, which does not exist — every hook in every install was dead (the checkout most likely moved).`

**Fix.** Re-emit from where Geneseed lives now — any build rewrites the shim:

```bash
geneseed rebuild-all
```

If you moved the shim itself with `GENESEED_HOME`, set it the same way before rebuilding.

**Confirm.** `geneseed doctor` prints no `[shim]` line, and a new session opens with the readiness sigil and your project docs in context.

<!--harness:claude-->
*(Claude Code only)*

## A Bash/Write/Edit call is refused with `onFailure is "block"`

Claude Code refuses a `Bash`, `PowerShell`, `Write`, `Edit` or `NotebookEdit` call outright, and the transcript carries wording like:

> `PreToolUse:Bash hook error: [...]: failed; blocking because onFailure is "block"`

(or `... timed out; blocking because onFailure is "block"`) — not the usual "nothing is enforced" silence, but every matching tool call refused, one after another.

**Cause.** Claude Code's two gates, `git-gate` and `rule-gate`, carry `onFailure: "block"` (Claude Code v2.1.295+, required): when the gate itself cannot run at all — a dead hook shim, a moved checkout, a crash — the tool call is now refused instead of silently let through. This is deliberate (a crashing gate failing open is worse), but it turns the usual "Hooks stopped firing" symptom above into a hard stop for exactly these two gates. The underlying cause is almost always the same stale or missing shim: `geneseed doctor`/`geneseed status`, run from **outside** the stuck session, now also catch the shim having been deleted outright (not just moved) while a live install still names it — `[shim] <path> does not exist, but <install> still runs its hooks through it` / the `gates` row reading `DEAD`.

**Fix.** Rebuild from wherever Geneseed lives now:

```bash
geneseed rebuild-all
```

**Recovering without leaving the blocked session.** Claude Code's bash mode — a message that starts with `!`, e.g. `! geneseed rebuild-all` — is reported (outside Anthropic's own hooks reference, which is silent on the point either way) to bypass `PreToolUse` hooks entirely, so it is worth one try before leaving the session:

```
! geneseed rebuild-all
```

or `! geneseed doctor` to see the cause first. If that message is ALSO refused, that is proof the bypass does not apply to your Claude Code build — fall back to a plain terminal outside Claude Code entirely, where no hook can fire at all:

```bash
geneseed rebuild-all   # or: geneseed doctor
```

**Confirm.** Start a **new** Claude Code session after the rebuild; a `git commit`, a `Write`/`Edit` call and `geneseed doctor` all go through again with no `onFailure` refusal.
<!--/harness-->

## The agent never shows the readiness sigil

The first reply of a session should open with the readiness sigil (`✅` in the neutral theme) — the agent's sign that it loaded the harness.

**Cause.** The tool is not loading the root file. On OpenCode, `opencode.json` `instructions` does not point at `AGENT.md`; on another tool, its rules setting does not.

**Fix.** Rebuild the install so its config is merged again:

```bash
geneseed rebuild-all
```

For a tool Geneseed does not wire itself, point its rules setting at the bundle's `AGENT.md`.

**Confirm.** Start a **new** session; the first reply opens with the sigil. See [Verify](../guides/verify.md).

<!--harness:opencode-->
*(OpenCode only)*

## The agent doesn't load my project docs

**Cause.** The `geneseed-context` plugin is not in OpenCode's plugins directory, or injection is switched off (`GENESEED_CONTEXT_INJECT=off`).

**Fix.**

```bash
geneseed build --emit opencode-global
```

and unset `GENESEED_CONTEXT_INJECT`.

**Confirm.** `ls ~/.config/opencode/plugins/` shows the `geneseed-*.js` files, and a session started with `GENESEED_DEBUG=1` logs what the plugin discovered. See [OpenCode plugins](opencode-plugins.md).

## `PROJECT CONTEXT` appears twice

**Cause.** Two copies of the context plugin — the global one and a leftover `.opencode/plugins/` in the repo. OpenCode loads both.

**Fix.** Delete the project copy (`.opencode/plugins/geneseed-context.js`), or uninstall the project-scoped install.

**Confirm.** A new session shows the block at most once.

## The full `PROJECT CONTEXT` block shows in the terminal

**Cause.** Either `GENESEED_CONTEXT_VISIBLE=1` (or legacy `GENESEED_CONTEXT_TRANSFORM=0`) is set, or your OpenCode build lacks the experimental hook for invisible delivery and the plugin fell back to the visible block.

**Fix.** Unset the variable. If it still shows, your OpenCode build is the reason — update OpenCode, or live with the visible block; the context is the same.

**Confirm.** Run with `GENESEED_DEBUG=1`; the plugin's log says which delivery it used.

## No memory is written after a session

**Cause.** The learn plugin found no memory directory, or it did not load.

**Fix.** Pin the store, then restart OpenCode:

```bash
export GENESEED_HARNESS=~/.config/opencode
```

(or `GENESEED_MEMORY` for an explicit directory), and confirm the `geneseed-*.js` files are in the plugins dir.

**Confirm.** About a minute after the session goes quiet, stderr shows `[geneseed-learn] wrote N memory file(s): …` or a `skipped:` reason. Total silence means the plugin did not load.
<!--/harness-->

Model, read-only agent, document and MCP problems are on [their own page](troubleshoot-tools.md).
