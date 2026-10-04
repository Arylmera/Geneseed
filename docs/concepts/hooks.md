---
group: concepts
order: 5
title: "Hooks (Claude Code, Bob, OpenClaude)"
kind: "concept"
section: "Harness"
description: "The commands Claude Code, Bob and OpenClaude run at fixed moments, and what each gate does."
---
A **hook** is a command your host runs at a fixed moment — when a session starts, before a tool call, when the agent finishes. On Claude Code, Bob and OpenClaude, hooks are how Geneseed does anything *in code* rather than in prose: load your project's docs, stop a risky command for your confirmation, save what was learned.

> **You already know this:** git hooks. A `pre-commit` hook runs before every commit whether or not you remember it exists, and can stop the commit. These run before and after the agent's actions the same way.

Geneseed writes its hooks into the host's settings file. Every hook calls one program, `geneseed-hook`, with a verb — not the `geneseed` CLI you type yourself. The instructions file (`CLAUDE.md`) needs no hook: the host loads it by location.

### The hooks on Claude Code

| Event | When | Command | What it does | Conditional? |
| --- | --- | --- | --- | --- |
| `SessionStart` | `startup`, `clear` | `geneseed-hook context` | injects your harness files and the repo's docs | no |
| `SessionStart` | `resume`, `compact` | `geneseed-hook context` | re-injects them after a resume or an auto-compaction summarised them away | no |
| `PreToolUse` | `Bash` | `geneseed-hook git-gate` | asks before destructive git; asks before every commit and push | the commit/push question only |
| `PreToolUse` | `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `geneseed-hook rule-gate` | asks before a secret lands in a file, or a write to your rules or memory | no |
| `Stop` | the agent finishes a reply | `geneseed-hook learn` | distils durable facts into `memory/` | needs `GENESEED_LLM` |
| `SubagentStop` | a subagent finishes | `geneseed-hook learn` | records a lesson for that agent in `memory/agents/<name>.md` | needs `GENESEED_LLM` |
| `PreCompact` | before auto-compaction | `geneseed-hook learn` | captures memory before the transcript is summarised | needs `GENESEED_LLM` |

### What each one does, and what you see

**context.** Before your first message, the agent receives your own harness files — `user-rules.md`, `PROFILE.md`, the memory index, the notebook index, your wiki declaration — skipping any still untouched since install, then the repo's docs, discovered by convention or listed in a `context.json`. Each file is capped at 16 KB and the whole injection at 48 KB; what does not fit is listed for the agent to read on demand. You see nothing, except that the agent already knows your project. See [Project context](../guides/project-context.md).

**git-gate.** Runs before every shell command and looks for `git` in it, including chained one-liners and `git -C <path>` forms.
- **Destructive git** — `reset --hard`, `clean -f`, `branch -D`, `checkout -- `, a `push --force` — always gets a confirmation prompt, citing *Deletion Is Deliberate*. That is a Rule, so it holds in every build.
- **Every `git commit` and `git push`** gets a prompt citing *Consent Before Push*. This part belongs to the **process** doctrine pack: build without it, or exclude that rule, and the hook stays wired with `--no-consent` — commits and pushes go through without asking, destructive git is still stopped ([Rules](rules.md)).
- Any other command passes untouched.

**rule-gate.** Runs before every file write.
- Content that looks like a credential (a cloud access key, a GitHub or Anthropic token, a Slack token, a private-key block) going into any file other than `.env*` gets a prompt citing *Sealed Secrets*.
- A write to `user-rules.md`, `MEMORY.md` or a file in the install's `memory/` gets a prompt citing *Persist Insight*: whether something is a standing rule or a fact to remember is your call, settled through the `rule` [skill](skills.md).
- Ordinary edits pass untouched.

**learn.** Takes the tail of the transcript and asks a model to distil what is worth keeping into one-fact-per-file entries under `memory/`, skipping duplicates. It needs `GENESEED_LLM` set to a model command, for example:

```bash
export GENESEED_LLM="claude -p"
```

Unset, `learn` does nothing useful — it prints the prompt it would have sent. Geneseed never stores or embeds an API key. See [Memory](memory.md).

### Gates fail closed, and leave a trace

If a gate cannot evaluate a call — an unreadable payload, a bug — it asks, with the error as its reason, rather than silently letting the call through. Every prompt a gate raises adds one line to `notebook/gates.jsonl` in the install: the rule and the time, never the command or content. `geneseed status` counts them by rule.

```bash
geneseed status
```

In an [excluded folder](exclusions.md), every hook of a global install exits silently. And a global install's `context` hook stands down when the repo has its own per-repo install of the same host, so nothing is injected twice.

### Where they are written

| Host | Global | Per repo |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `.claude/settings.local.json` |
| OpenClaude | `~/.openclaude/settings.json` | `.openclaude/settings.local.json` |
| Bob | `~/.bob/settings/settings.json` | `.bob/settings.json` |

Per repo, Claude Code and OpenClaude hooks go into the **local**, untracked settings file: the hook commands contain paths on your machine, and the team-shared `settings.json` would hand every teammate broken hooks.

The merge is surgical. Every other key and every hook of your own survive, and the install manifest records exactly which hook groups are Geneseed's, so an upgrade replaces and an uninstall removes only those.

### Bob and OpenClaude

**OpenClaude** is a Claude Code fork: it gets the same hooks and the same prompts, unchanged.

**Bob** has its own contract. It uses Claude's event names but ignores a hook's output before a tool call — the only way to refuse is exit code 2 — and it has no tool matcher, `SubagentStop` or `PreCompact`. So Bob gets three hooks:

- `SessionStart` → `geneseed-hook context`.
- `PreToolUse` → `geneseed-hook tool-gate`, the git gate and the rule gate fused into one command that decides from the shape of the call. It **blocks** (exit 2) only for the two Rules, secrets and destructive git. The commit/push and rule-or-memory checks become a warning line, because a hard block would leave Bob unable to commit at all.
- `Stop` → `geneseed-hook learn`.

Neither host has been verified live on the authoring machine. If a hook does not fire, the same rules still reach the agent through the instructions file.

### The hook shim

Hooks run with your project as the working directory, so each command needs an absolute path. Rather than write the Node path and the Geneseed checkout path into every settings file, every hook points at one stable file, the **hook shim**: `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows). The shim holds those two paths; your settings hold none. Set `GENESEED_HOME` to keep it somewhere other than `~/.geneseed`.

Every build rewrites the shim, so moving the checkout and running one build repairs every install at once.

**A stale shim fails silently.** Hooks report through their output and exit 0 on every path — that is what keeps a broken hook from breaking your tool calls. The flip side: if the shim points at a checkout that no longer exists, every hook on the machine stops working and nothing tells you. The agent simply stops getting project context and the gates stop asking. `geneseed doctor` checks the shim; a build repairs it.

```bash
geneseed doctor
```

See [Hook, context and memory problems](../reference/troubleshoot-hooks.md).

### Cost

The hook program is small on purpose: it adds about 14 ms to each tool call.

### Verify

Open a session in a repo and ask the agent what it knows about the project — it should answer from the repo's docs without reading them first. Ask it to commit something: you should get a prompt before the commit runs.
