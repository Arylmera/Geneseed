---
group: concepts
order: 6
title: "Hooks (Claude Code, Bob, OpenClaude)"
kind: "concept"
section: "Harness"
description: "The commands Claude Code, Bob and OpenClaude run at fixed moments, and what each gate does."
---
A **hook** is a command your host runs at a fixed moment — when a session starts, before a tool call, when the agent finishes. On Claude Code, Bob and OpenClaude, hooks are how Geneseed does anything *in code* rather than in prose: load your project's docs, stop a risky command for your confirmation, save what was learned.

> **You already know this:** git hooks. A `pre-commit` hook runs before every commit whether or not you remember it exists, and can stop the commit. These run before and after the agent's actions the same way.

Geneseed writes its hooks into the host's settings file. Every hook calls one program, `geneseed-hook`, with a verb — not the `geneseed` CLI you type yourself. The instructions file (`CLAUDE.md`) needs no hook: the host loads it by location.

## The hooks on Claude Code

| Event | When | Command | What it does | Conditional? |
| --- | --- | --- | --- | --- |
| `SessionStart` | `startup`, `resume`, `clear`, `compact`, `fork` | `geneseed-hook context` | injects your harness files and the repo's docs, or re-injects them after a resume, a fork, or an auto-compaction summarised them away | no |
| `PreToolUse` | `Bash`, `PowerShell` | `geneseed-hook git-gate` | asks before destructive git; asks before every commit and push | the commit/push question only |
| `PreToolUse` | `Write`, `Edit`, `NotebookEdit` | `geneseed-hook rule-gate` | asks before a secret lands in a file, or a write to your rules or memory | no |
| `Stop` | the agent finishes a reply | `geneseed-hook learn` | distils durable facts into `memory/` | needs `GENESEED_LLM` |
| `SubagentStop` | a subagent finishes | `geneseed-hook learn` | records a lesson for that agent in `memory/agents/<name>.md` | needs `GENESEED_LLM` |
| `PreCompact` | before auto-compaction | `geneseed-hook learn` | captures memory before the transcript is summarised | needs `GENESEED_LLM` |

## What each one does, and what you see

**context.** Before your first message, the agent receives your own harness files — `user-rules.md`, `PROFILE.md`, the memory index, the notebook index, your wiki declaration — skipping any still untouched since install, then the repo's docs, discovered by convention or listed in a `context.json`. Each file is capped at 16 KB and the whole injection at 48 KB; what does not fit is listed for the agent to read on demand. You see nothing, except that the agent already knows your project. See [Project context](../guides/project-context.md).

**git-gate.** Runs before every shell command and looks for `git` in it, including chained one-liners and `git -C <path>` forms.
- **Destructive git** — `reset --hard`, `clean -f`, `branch -D`, `checkout -- `, a `push --force` — always gets a confirmation prompt, citing *Deletion Is Deliberate*. That is a Rule, so it holds in every build.
- **Every `git commit` and `git push`** gets a prompt citing *Consent Before Push*. This part belongs to the **process** doctrine pack: build without it, or exclude that rule, and the hook stays wired with `--no-consent` — commits and pushes go through without asking, destructive git is still stopped ([Rules](rules.md)).
- Any other command passes untouched.

**rule-gate.** Runs before every file write.
- Content that looks like a credential (a cloud access key, a GitHub or Anthropic token, a Slack token, a private-key block) going into any file other than `.env*` gets a prompt citing *Sealed Secrets*.
- A write to `user-rules.md`, `MEMORY.md` or a file in the install's `memory/` gets a prompt citing *Persist Insight*: whether something is a standing rule or a fact to remember is your call, settled through the `rule` [skill](skills.md).
- A write to a check the project protects gets a prompt citing *External Gate* (on Bob, it is blocked). A project opts in with `.geneseed/protected-checks.txt` at its git root: one repo-relative file or folder per line, `#` for comments — the checks and tests the agent is judged by. A check the agent can edit is not a check. The list protects itself. Only file-write tools are seen: a shell `sed -i` or redirect is not, so run the same checks in CI as the boundary that holds.
- Ordinary edits pass untouched.

**learn.** Takes the tail of the transcript and asks a model to distil what is worth keeping into one-fact-per-file entries under `memory/`, skipping duplicates. It needs `GENESEED_LLM` set to a model command, for example:

```bash
export GENESEED_LLM="claude -p"
```

Unset, `learn` does nothing useful: on a real Stop/SubagentStop/PreCompact call it returns immediately rather than reading the transcript for nothing, and on a manual run it prints the prompt it would have sent. Geneseed never stores or embeds an API key. See [Memory](memory.md).

## Verify

Open a session in a repo and ask the agent what it knows about the project — it should answer from the repo's docs without reading them first. Ask it to commit something: you should get a prompt before the commit runs.

What happens when a gate cannot decide, where the hooks are written, and the one file they all run through: [Hook gates, settings and the shim](hook-gates.md).
