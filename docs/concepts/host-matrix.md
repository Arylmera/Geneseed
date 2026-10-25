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
| Live sessions in the web console's [Activity view](../reference/plugin-activity.md) | ⚙️ plugin | 🪝 hook, files per subagent, context size | 🪝 hook, per tool call only (no transcript, no context size, subagent files not attributed)¹ | 🪝 hook, files per subagent, context size² |
| Real data loss (force-push to `main`, discarding uncommitted work, `rm` of untracked files…) | ⚙️ block³ · 🔒 ask (reflog, gc) | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Secrets kept out of files | ⚙️ block⁴ | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Consent before every commit and push | 🔒 permission ask | 🪝 ask | 🪝 warning¹ | 🪝 ask² |
| Rule-or-memory write needs your call | ⚙️ speed bump³ | 🪝 ask | 🪝 warning¹ | 🪝 ask² |
| User-only skills hidden from the model | 🔒 `permission.skill` deny | ✅ `disable-model-invocation` | ✅ `/`-command, no skill | ✅ `disable-model-invocation` |
| Sovereign-repo exclusions⁵ | ⚙️ plugins stand down | ✅ `claudeMdExcludes` | ✅ rules shadow stub | ✅ `claudeMdExcludes` |
| MCP server wiring | ✅ `mcp` | ✅ `mcpServers` | ✅ `mcp.json` | ✅ `mcpServers` |
| Colour themes · LSP · workflow runner · primary agent · `/`-commands | ✅ | ➖ | ➖ | ➖ |

✅ native · ⚙️ OpenCode plugin · 🔒 `permission` entry in `opencode.json` · 🪝 `settings.json` hook · ➖ no host mechanism (the rule still applies as prose).

¹ **Bob** has its own hook contract: Claude's event names, but it ignores a hook's output on `PreToolUse`, so the only way to refuse is exit code 2. Geneseed therefore blocks only the rules that admit no judgement call — secrets, real data loss, a recursive scan of a whole filesystem, and a write under a project's own protected-checks list — and turns the two consent checks into a logged warning. It has no `SubagentStop` event. Bob 2.2.3 does have `PreCompact` and `PostCompact`, but Geneseed does not wire them yet, so learn runs on `Stop` only. **What is verified:** the payload shape (Claude's keys plus `cwd`), the event list and the strict settings schema were read in Bob 2.2.3's shipped bundle on the authoring machine, and a live prompt on 2026-10-25 wrote an Activity snapshot from `UserPromptSubmit`. The gates' block-by-exit-code behaviour is Bob's documented contract, not yet observed live; the rules preamble still holds if a hook does not fire.
² **OpenClaude** is a Claude Code fork and gets Claude's hooks and verdicts verbatim, in `~/.openclaude/settings.json` (global) or `.openclaude/settings.local.json` (per repo). **Unverified live** for the same reason.
³ OpenCode's plugin hook can only allow or throw — there is no "ask the user" — so the rule-or-memory check stops the first such write once rather than prompting, and a real data loss is blocked outright (as on Bob) rather than asked; `GENESEED_GUARD=warn` turns the block into a logged warning.
⁴ The checks differ in shape: OpenCode's guard plugin blocks writes *to* private-key and credential files by path; the Claude-shaped hook looks at the *content* being written for credential-shaped strings (cloud keys, tokens, private-key blocks) and asks. A `.env` file is exempt on the hook side — that is where a secret is allowed to live.
⁵ A linked git worktree of an excluded repo is excluded too: the hooks and plugins follow its `.git` file back to the main repository. `claudeMdExcludes` is the exception — it lives in the gitignored `settings.local.json`, which a worktree never gets — so `geneseed exclude add` and `exclude list` print the snippet to commit yourself. See [Exclusions](exclusions.md).

## The one conditional row

The **consent before commit and push** row depends on a choice you make at build time. It enforces the rule *Consent Before Push*, which belongs to the **process** doctrine pack ([Rules](rules.md)). Build without that pack, or exclude that one rule, and the commit/push question goes away — but the gate itself stays: on Claude Code and OpenClaude the `git-gate` hook is still wired (with `--no-consent`), so destructive git is still caught. Everything else in the table is always on.

One OpenCode asymmetry: Geneseed shares `opencode.json` with you and cannot tell its own `git commit*` permission entry from one you typed, so a rebuild without the process pack leaves an existing entry in place and says so instead of deleting it. A `permission.skill` deny is different: Geneseed records each one it writes, and a rebuild or uninstall takes back only those, never a deny you set yourself.

In plain terms: [Enforced vs. asked](../understand/enforced-vs-asked.md).
