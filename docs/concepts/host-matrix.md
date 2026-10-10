---
group: concepts
order: 2
title: "What each host automates"
kind: "concept"
section: "Harness"
description: "Row by row, which checks each host runs in code and which stay prose."
---
Every [host](hosts.md) gets the same content. This table is what each one lets Geneseed **automate** (check in code before an action) rather than only **ask** of the model.

| Capability | OpenCode | Claude Code | Bob | OpenClaude |
| --- | :---: | :---: | :---: | :---: |
| Instructions file | `AGENT.md` via `opencode.json` | `CLAUDE.md` | `AGENTS.md` + `rules/geneseed.md` | `CLAUDE.md` (`.openclaude/` per repo) |
| Agents · Skills · Memory · Notebook | ✅ | ✅ | ✅ | ✅ |
| Project context loaded at session start | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 🪝 hook² |
| Memory written back at session end (learn) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 🪝 hook² |
| Destructive git (force-push, `reset --hard`…) | 🔒 permission ask | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Secrets kept out of files | ⚙️ block⁴ | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Consent before every commit and push | 🔒 permission ask | 🪝 ask | 🪝 warning¹ | 🪝 ask² |
| Rule-or-memory write needs your call | ⚙️ speed bump³ | 🪝 ask | 🪝 warning¹ | 🪝 ask² |
| Sovereign-repo exclusions | ⚙️ plugins stand down | ✅ `claudeMdExcludes` | ✅ rules shadow stub | ✅ `claudeMdExcludes` |
| MCP server wiring | ✅ `mcp` | ✅ `mcpServers` | ✅ `mcp.json` | ✅ `mcpServers` |
| Colour themes · LSP · workflow runner · primary agent · `/`-commands | ✅ | ➖ | ➖ | ➖ |

✅ native · ⚙️ OpenCode plugin · 🔒 `permission.bash` entry in `opencode.json` · 🪝 `settings.json` hook · ➖ no host mechanism (the rule still applies as prose).

¹ **Bob** has its own hook contract: Claude's event names, but it ignores a hook's output on `PreToolUse`, so the only way to refuse is exit code 2. Geneseed therefore blocks only the rules that admit no judgement call — secrets, destructive git, and a write under a project's own protected-checks list — and turns the two consent checks into a logged warning. It has no `SubagentStop` or `PreCompact` event, so learn runs on `Stop` only. **Unverified live** — there is no Bob install on the authoring machine; the rules preamble still holds if a hook does not fire.
² **OpenClaude** is a Claude Code fork and gets Claude's hooks and verdicts verbatim, in `~/.openclaude/settings.json` (global) or `.openclaude/settings.local.json` (per repo). **Unverified live** for the same reason.
³ OpenCode's plugin hook can only allow or throw — there is no "ask the user" — so this check stops the first such write once rather than prompting.
⁴ The checks differ in shape: OpenCode's guard plugin blocks writes *to* private-key and credential files by path; the Claude-shaped hook looks at the *content* being written for credential-shaped strings (cloud keys, tokens, private-key blocks) and asks. A `.env` file is exempt on the hook side — that is where a secret is allowed to live.

## The one conditional row

The **consent before commit and push** row depends on a choice you make at build time. It enforces the rule *Consent Before Push*, which belongs to the **process** doctrine pack ([Rules](rules.md)). Build without that pack, or exclude that one rule, and the commit/push question goes away — but the gate itself stays: on Claude Code and OpenClaude the `git-gate` hook is still wired (with `--no-consent`), so destructive git is still caught. Everything else in the table is always on.

One OpenCode asymmetry: Geneseed shares `opencode.json` with you and cannot tell its own `git commit*` permission entry from one you typed, so a rebuild without the process pack leaves an existing entry in place and says so instead of deleting it.

In plain terms: [Enforced vs. asked](../understand/enforced-vs-asked.md).
