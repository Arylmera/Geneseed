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
| Your `user-rules.md` handed to each sub-agent | — (later) | 🪝 hook | — (no `SubagentStart`) | 🪝 hook² |
| Memory written back at session end (learn) | ⚙️ plugin | 🪝 hook | ➖ wired, inert: Bob's `Stop` carries no transcript¹ | 🪝 hook² |
| Live sessions in the web console's [Activity view](../reference/plugin-activity.md) | ⚙️ plugin | 🪝 hook, files per subagent, context size | 🪝 hook, per tool call only (no transcript, no context size, subagent files not attributed)¹ | 🪝 hook, files per subagent, context size² |
| Real data loss (force-push to `main`, discarding uncommitted work, `rm` of untracked files…) | ⚙️ block³ · 🔒 ask (reflog, gc) | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Secrets kept out of files | ⚙️ block⁴ | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Consent before every commit and push | 🔒 permission ask | 🪝 ask | 🪝 warning¹ | 🪝 ask² |
| Standing-rule write needs your call | 🔒 ask³ | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| User-only skills hidden from the model | 🔒 `permission.skill` deny | ✅ `disable-model-invocation` | ✅ `/`-command, no skill | ✅ `disable-model-invocation` |
| Sovereign-repo exclusions⁵ | ⚙️ plugins stand down | ✅ `claudeMdExcludes` | ✅ rules shadow stub | ✅ `claudeMdExcludes` |
| Subagent depth capped at two ([Foreman mode](foreman-mode.md)) | ✅ `subagent_depth` | ✅ `env` setting | ➖ undocumented | ➖ no cap in the host |
| MCP server wiring | ✅ `mcp` | ✅ `mcpServers` | ✅ `mcp.json` | ✅ `mcpServers` |
| Colour themes · LSP · workflow runner · primary agent · `/`-commands | ✅ | ➖ | ➖ | ➖ |

✅ native · ⚙️ OpenCode plugin · 🔒 `permission` entry in `opencode.json` · 🪝 `settings.json` hook · ➖ no host mechanism (the rule still applies as prose).

¹ **Bob** has its own hook contract: Claude's event names, but it ignores a hook's output on `PreToolUse`, so the only way to refuse is exit code 2. Geneseed therefore blocks exactly the rules whose Bob cell says *block* in [Rule enforcement, by host](enforcement-table.md), and turns the commit/push consent into a logged warning. It has no `SubagentStop` event. Bob 2.2.3 does have `PreCompact` and `PostCompact`, but Geneseed does not wire them. The `Stop` hook is wired and runs the [change report](hooks.md#the-change-report), but learns nothing: Bob's `Stop` payload carries no transcript, and the group is kept so that learning starts if Bob ever sends one. The rules preamble still holds if a hook does not fire. For what was checked against Bob itself, see [What is verified](#what-is-verified).
² **OpenClaude** is a Claude Code fork and gets Claude's hooks and verdicts verbatim, in `~/.openclaude/settings.json` (global) or `.openclaude/settings.local.json` (per repo). See [What is verified](#what-is-verified).
³ OpenCode's plugin hook can only allow or throw — there is no "ask the user" — so a standing-rule write gets OpenCode's own prompt, and the guard refuses a file-tool write where no prompt can run. Shell is not a boundary on any host: only parsed forms are read, and the host's command permission is the backstop. A real data loss is blocked outright (as on Bob) rather than asked; `GENESEED_GUARD=warn` turns a block into a logged warning.
⁴ The checks differ in shape: OpenCode's guard plugin blocks writes *to* private-key and credential files by path; the Claude-shaped hook looks at the *content* being written for credential-shaped strings (cloud keys, tokens, private-key blocks) and asks. A `.env` file is exempt on the hook side — that is where a secret is allowed to live.
⁵ A linked git worktree of an excluded repo is excluded too: the hooks and plugins follow its `.git` file back to the main repository. `claudeMdExcludes` is the exception — it lives in the gitignored `settings.local.json`, which a worktree never gets — so `geneseed exclude add` and `exclude list` print the snippet to commit yourself. See [Exclusions](exclusions.md).

## What is verified

This is the one place that says what was checked against each host itself, how, and when. Every other page links here and states nothing of its own; `geneseed doctor` fails a page that does.

| Host | Method | Date | Scope | Not covered |
| --- | --- | --- | --- | --- |
| Claude Code | canary: `tests/host_canary.mjs` installs the host from npm and starts it in a throwaway home | weekly in CI, at npm `latest` | `claude doctor` lists no invalid setting in the emitted `settings.json`; a logged-out `-p` run shows `SessionStart` running the context hook | hooks that need a model turn: the `PreToolUse` gates, `Stop` |
| OpenClaude | canary, the same run | weekly in CI, at npm `latest` | the emitted settings load; `SessionStart` runs the context hook. Its `doctor` checks only the auto-updater, so there is no settings verdict to read | hooks that need a model turn |
| OpenClaude | source read | 2026-09 | the config directory, the root files it loads, the settings and hook types (`src/utils/envUtils.ts`, `claudemd.ts`, `config.ts`, `src/types/hooks.ts`) | |
| Bob | bundle read: Bob 2.2.3's shipped `bob-code/dist/extension.js` | 2026-10 | the hook payload (Claude's keys plus `cwd`), the event list, the strict settings schema, the agent frontmatter reader | whether Bob lists agents to the model; a sub-agent depth cap |
| Bob | live session, Bob IDE | 2026-10-23 | a `tool-gate` refusal (exit 2) stopped the call and its reason reached the model; Bob ignores Claude's `disallowedTools`, which is why a read-only agent carries `groups:`; the first-reply override | the `Stop` hook; the ownership gate's sub-agent deferral |
| Bob | live session | 2026-10-25 | a prompt wrote an Activity snapshot from `UserPromptSubmit` | |
| Bob | canary | never | nothing: IBM does not publish Bob Shell on npm, so the canary reports Bob as `skip` | everything above is a one-time read, not a standing check. [Verify it works](../guides/verify.md) has the by-hand steps |
| OpenCode V1 | canary | weekly in CI, at npm `latest` (log lines measured 2026-10-12) | no `failed to load plugin` line names a Geneseed plugin, and the workflow plugin's banner shows `.server` ran | the guard's refusal, which needs a model turn |
| OpenCode V2 | canary | weekly in CI, at npm `latest` (log lines measured 2026-10-12) | no `failed to load plugin` line names a Geneseed plugin, and a `loading plugin` line is logged for each | the guard's refusal, which needs a model turn |

No check on any host calls a model. `geneseed doctor --probe` covers the other half on your own machine: it runs the installed gates through each host's shell on calls they must refuse and calls they must let through.

## The one conditional row

The **consent before commit and push** row depends on a choice you make at build time. It enforces the rule *Consent Before Push*, which belongs to the **process** doctrine pack ([Rules](rules.md)). Build without that pack, or exclude that one rule, and the commit/push question goes away — but the gate itself stays: on Claude Code and OpenClaude the `git-gate` hook is still wired (with `--no-consent`), so destructive git is still caught. The standing-rule row is conditional the same way: it enforces *Persist Insight*, also in the process pack, and excluding it (or the pack) drops that hook on every host ([Exclusions](exclusions.md)). Everything else in the table is always on.

One OpenCode asymmetry: Geneseed shares `opencode.json` with you, so it removes only what it recorded writing. The manifest lists the `permission.bash` gates it added (`bash_gates`), and a rebuild without the process pack, or with `--no-deletion-gate`, takes back those that still read as it wrote them. An entry that was already there, one you changed, and every gate on an install made before 5.2.0 (which has no record) stays and is named in a warning; `--prune-gates` on one build removes the last kind. A `permission.skill` deny works the same way. Uninstall takes back both: every recorded deny and every recorded `permission.bash` gate that still reads as Geneseed wrote it. A gate you changed, and one with no record, stays.

In plain terms: [Enforced vs. asked](../understand/enforced-vs-asked.md).
