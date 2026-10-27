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
| `PreToolUse` | `Bash`, `PowerShell` | `geneseed-hook git-gate` | asks before a command that would really lose data, and before a recursive scan of a whole filesystem; asks before every commit and push | the commit/push question only |
| `PreToolUse` | `Write`, `Edit`, `NotebookEdit` | `geneseed-hook rule-gate` | asks before a secret lands in a file, or a write to your rules or memory; stops the session's first write once in an application repo with no `## Ownership` section | no |
| `Stop` | the agent finishes a reply | `geneseed-hook learn` | distils durable facts into `memory/` | needs `GENESEED_LLM` |
| `SubagentStop` | a subagent finishes | `geneseed-hook learn` | records a lesson for that agent in `memory/agents/<name>.md` | needs `GENESEED_LLM` |
| `PreCompact` | before auto-compaction | `geneseed-hook learn` | captures memory before the transcript is summarised | needs `GENESEED_LLM` |
| `UserPromptSubmit` | you send a message | `geneseed-hook activity` | records the turn's start for the web console's Activity view; prints nothing | off with `GENESEED_ACTIVITY=off` |
| `SessionEnd` | the session closes | `geneseed-hook activity` | marks the session ended and archives it | off with `GENESEED_ACTIVITY=off` |
| `SubagentStart` | a subagent starts | `geneseed-hook activity` | records the subagent as a branch of its session, even one that only reads | off with `GENESEED_ACTIVITY=off` |

Every hook above also feeds the [Activity view](../reference/plugin-activity.md) after it has decided, unless tracking is off: one file per session under `activity/` beside the install. The gates' verdicts never wait on it.

What that file holds for the Activity garden:
- **Files.** Each changed file is stored relative to the session's git root, with `/` separators. A file outside the root, or a session outside any repo, gets no path (`path: null`) and keeps only its basename, so it never matches a file of the same name inside the repo. A path is never stored absolute. Each file also records who changed it: the session, or the subagent's `agent_id`.
- **Where the session runs.** `root` is the worktree's git root and `repo` is the main repository's root, so the linked worktrees of one repo can be grouped together. Only the session's own events set them; a subagent working in another worktree does not move them.
- **Subagents.** `agents` lists each subagent with its type and `running` or `done`.
- **Turns and context.** `turns` counts your prompts. `context` is the size of the context now, taken from the transcript's last assistant message. The window size is an estimate: 200k, or 1M once the context is past 200k.
- **Compactions.** `compactions`, `compacted_at` and `context_at_compaction` record each compaction (on `PreCompact`). After a compaction, `context` is unknown (`null`) until the next `Stop` reads it again. Claude Code's `<synthetic>` messages and messages with no input-side tokens never change it.

On Bob, a subagent's files cannot be told apart from its session's files (its hook payloads carry no subagent id), so the session is marked `attribution: false`. A compaction is counted on Bob's `SessionStart` with `source: "compact"`, and there is no context size.

## What each one does, and what you see

**context.** Before your first message, the agent receives your own harness files — `user-rules.md`, `PROFILE.md`, the memory index, the notebook index, your wiki declaration — skipping any still untouched since install, then the repo's docs, discovered by convention or listed in a `context.json`. Each file is capped at 16 KB and the whole injection at 48 KB; what does not fit is listed for the agent to read on demand. You see nothing, except that the agent already knows your project. See [Project context](../guides/project-context.md).

**git-gate.** Runs before every shell command and looks for `git` in it, including chained one-liners and `git -C <path>` forms, and for a recursive scan of a whole filesystem.
- **A catastrophic command** gets a confirmation prompt citing *Deletion Is Deliberate* (on Bob, it is refused with exit 2) whatever the repository holds, even with the deletion gate switched off: a recursive removal of `/`, a drive root (`C:\`, `/c`) or the home directory (`~`, `$HOME`), `mkfs` on a device, `dd` over a raw disk, `format C:`, a fork bomb. It judges the program, not the text: a `sudo`, a background `&`, a subshell, `bash -c '…'` or a heredoc fed to a shell (`bash <<'EOF'`) hides nothing, and a heredoc fed to anything else (`cat`, `git commit -F -`) or a commit message that only names `rm -rf /` passes. The OpenCode guard runs the same code, plus its own stricter text match.
- **Real data loss** gets a confirmation prompt citing *Deletion Is Deliberate* — and only real loss, judged against the repository's actual state:
  - deleting or force-pushing a protected branch (`main`, `master`, or a remote's default branch), locally or on the remote;
  - `branch -D` of a branch whose commits are on no remote branch and not merged into the current one;
  - `reset --hard <target>` abandoning commits that neither the target nor any remote branch holds (an unresolvable target asks too);
  - discarding uncommitted work (`checkout -f`, `checkout -- <paths>`, `switch --discard-changes`, `restore`, `clean -f`) when the tree actually holds some;
  - on a protected branch only: `checkout <paths>` without `--` and `git rm -f` over changed files while `main`, `master` or the default branch is checked out, and `branch -f`/`checkout -B`/`switch -C` moving a protected branch off commits no remote and not the new target holds;
  - `stash drop`/`clear` while a stash exists; `reflog expire` and `gc --prune`, always;
  - removing files (`rm`, `rmdir`, `del`, `erase`, `Remove-Item`) that git cannot restore: untracked, ignored or modified files, a repository's `.git`, or anything outside a repository.

  A force push to a feature branch, the protected-branch-only forms above on a feature branch, a new branch (`checkout -b`, `switch -c`), `reset --hard` over uncommitted work or to a commit that keeps every unpushed one, `branch -D` of a pushed branch, or `rm` of a tracked, unmodified file passes. When the gate cannot tell — a glob or `$variable` it would have to expand, a `cd` it cannot follow, `sh -c`/`xargs`, git failing or missing — it asks, and says it could not verify. To read the state it runs `git` itself, only once a command already looked destructive; every other command pays nothing. That is a Rule, so it holds in every build — unless you switch its gate off for one install with `--no-deletion-gate` (or the switch on Rule IV in the console's Constitution page). The hook is then wired with `--no-deletion-gate` and this check stands down; the Rule's text still binds the agent, and the catastrophic-command check above and the root-scan and consent checks below still run ([Exclusions](exclusions.md)).
- **Every `git commit` and `git push`** gets a prompt citing *Consent Before Push*. This part belongs to the **process** doctrine pack: build without it, or exclude that rule, and the hook stays wired with `--no-consent` — commits and pushes go through without asking, real data loss is still stopped ([Rules](rules.md)).
- **A recursive scan of a whole filesystem** — `find /`, `du -sh /`, `grep -r foo /`, `rg x C:\`, `Get-ChildItem C:\ -Recurse` — gets a prompt citing *Commands Must Return* (on Bob, it is blocked). In Git Bash `/` mounts every drive and mounted share, so such a scan runs for hours, and `| head` does not stop it. The prompt tells the agent to search a specific directory instead. A deeper path (`find /c/Users/me/project`), `ls /` without `-R` (`ls -r` is reverse order, not recursion), a quoted argument (a search pattern such as `grep -rn "/" src`), a `#` comment, and the remote half of an `ssh` command pass. This check is wired in every build, whatever packs or rules you excluded: it rides inside `git-gate` with no flag of its own, because a new flag or verb would reach machines still running an older hook shim, which would refuse it — and Claude Code blocks a tool call whose gate fails.
- Any other command passes untouched.

**rule-gate.** Runs before every file write.
- Content that looks like a credential (a cloud access key, a GitHub or Anthropic token, a Slack token, a private-key block) going into any file other than `.env*` gets a prompt citing *Sealed Secrets*. An install built `--no-secrets-gate` wires the hook with that flag and this check alone stands down ([Exclusions](exclusions.md)).
- A write to `user-rules.md`, `MEMORY.md` or a file in the install's `memory/` gets a prompt citing *Persist Insight*: whether something is a standing rule or a fact to remember is your call, settled through the `rule` [skill](skills.md).
- A write to a check the project protects gets a prompt citing *External Gate* (on Bob, it is blocked). A project opts in with `.geneseed/protected-checks.txt` at its git root: one repo-relative file or folder per line, `#` for comments — the checks and tests the agent is judged by. A check the agent can edit is not a check. The list protects itself. Only file-write tools are seen: a shell `sed -i` or redirect is not, so run the same checks in CI as the boundary that holds.
- A write to `.geneseed/done-checks.txt`, the done gate's own list (below), gets the same *External Gate* prompt: emptying it would disarm the gate.
- The first write of a session in an application repo (a git root holding a build manifest) whose root `AGENTS.md` has no `## Ownership` section is refused once, the **ownership gate**. It is not a prompt for you: the reason goes to the agent, which asks you to set ownership up or proceed without (on Bob, exit 2, once). The next write passes, a sub-agent never triggers it on Claude Code and OpenClaude, and writes to `AGENTS.md` or `.geneseed/` pass. Off per repo with `mode: off` in that section, per install with `--no-ownership-gate` ([Ownership](ownership.md), [Exclusions](exclusions.md)).
- Ordinary edits pass untouched.

**The done gate.** Runs when a turn ends, inside `learn` and before it calls any model. A project opts in with `.geneseed/done-checks.txt` at its git root: one command per line, `#` for comments — the checks that prove the work, for example `npm run lint` and `node --test`. If the turn edited a file under that root and a listed check has not passed since the last edit, the turn does not end: the agent is told which checks are owed, citing *Verify Before Asserting*. A check counts when it ran as a shell command, unpiped (`npm test | tail` exits with `tail`'s code, so it proves nothing), and its result was not an error. The gate never runs a check itself. It reads the transcript from its end, back only to the prompt that opened the turn, so its cost does not grow with the session. It blocks at most once per turn; the second stop ends the turn and leaves a line in the gate ledger. Only file-write tools count as edits: a shell `sed -i` or redirect is not seen. Without the file, nothing changes. On OpenCode the gate is a reminder on the next request (OpenCode 1 only); on Bob, whose Stop carries no transcript, the turn is not judged and a log line says so. An install built `--no-done-gate` wires `learn` with that flag: the check is skipped, learning still runs ([Exclusions](exclusions.md)).

**learn.** Takes the tail of the transcript and asks a model to distil what is worth keeping into one-fact-per-file entries under `memory/`. It is shown the facts already stored, so it updates one with the merged text rather than writing a twin (the old version is kept in `memory/archive/`), and moves one the session proved obsolete into `memory/archive/`. It needs `GENESEED_LLM` set to a model command, for example:

```bash
export GENESEED_LLM="claude -p"
```

Unset, `learn` does nothing useful: on a real Stop/SubagentStop/PreCompact call it returns immediately rather than reading the transcript for nothing, and on a manual run it prints the prompt it would have sent. Geneseed never stores or embeds an API key. See [Memory](memory.md).

## Verify

Open a session in a repo and ask the agent what it knows about the project — it should answer from the repo's docs without reading them first. Ask it to commit something: you should get a prompt before the commit runs.

What happens when a gate cannot decide, where the hooks are written, and the one file they all run through: [Hook gates, settings and the shim](hook-gates.md).
