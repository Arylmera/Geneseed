---
group: understand
order: 8
title: "Enforced vs. asked"
kind: "concept"
section: "Day to day"
description: "What is guaranteed by code, and what the model is only asked to do."
---
Geneseed gives your agent two kinds of instruction, and it matters which kind you are relying on.

- **Enforced.** A hook (Claude Code, Bob, OpenClaude) or a plugin (OpenCode) runs *before* the action, looks at the command or the file about to be written, and can stop it. The model cannot talk its way past it: the check is code, not a request.
- **Asked.** Text in the root rules file (`CLAUDE.md`, `AGENT.md`, `AGENTS.md`). The model reads it every session and usually follows it. Nothing guarantees it.

> **You already know this:** a failing CI check versus a line in `CONTRIBUTING.md`. Both say "do not merge untested code". Only one of them actually blocks the merge.

Most of the harness is *asked*. A few rules, where one mistake is expensive and the bad action is easy to recognise, are also *enforced*.

### What is enforced, per host

<!--harness:claude-->
*(Claude Code only)*

On Claude Code and OpenClaude the hooks never block silently. They make the host **ask you**, with the reason shown:

- **Destructive git**: a force-push, `reset --hard`, `clean -f`, `branch -D` or `checkout --`. Wired in every build.
- **Commit and push**: every `git commit` and `git push`, including chained one-liners and `git -C <path>`. This question belongs to the **process** pack. Build without it and the git gate stays wired. Only this question goes away, and destructive git is still caught.
- **A scan of a whole filesystem**: a recursive `find`, `du`, `grep -r`, `rg` or `Get-ChildItem -Recurse` rooted at `/`, `/c` or `C:\`, which in Git Bash walks every drive for hours. Wired in every build.
- **Credentials**: a write or edit whose content looks like a real key (AWS, GitHub, Anthropic, Slack, or a private-key block), anywhere except a `.env` file.
- **Your rules and memory**: any write by the agent to `user-rules.md` or to the memory store. Whether something is a standing rule or a fact to remember is your call.

If a gate crashes, it asks instead of letting the call through. If it cannot start at all (a deleted or broken shim) or times out, Claude Code blocks the call instead: see [Troubleshoot hooks](../reference/troubleshoot-hooks.md) to recover. Other shell commands, `rm -rf` included, go through Claude Code's normal permission flow.

**Bob** runs one combined gate and has no "ask": it refuses with exit code 2, and only for the rules that admit no judgement call: credentials, destructive git, a scan of a whole filesystem, and a write under a project's own protected-checks list. The commit/push and memory checks become a log line, and the call goes through. Bob's hook wiring follows its documentation but has not been tested on a live Bob install.

<!--/harness-->
<!--harness:opencode-->
*(OpenCode only)*

On OpenCode, two mechanisms enforce rules:

- **OpenCode's own permission prompt**, which Geneseed configures in `opencode.json`. It asks you before `rm -rf`, a force-push, `reset --hard`, `clean -f`, `branch -D` and `checkout --`, and, when the **process** pack is on, before every commit and push.
- **The guard plugin**, which blocks outright: writes to key and credential files (`id_rsa`, `*.pem`, `.ssh/`, `.npmrc`…), catastrophic commands (`rm -rf /`, `rm -rf ~`, formatting or overwriting a disk), a recursive scan of a whole filesystem (`find /`, `du -sh /`, `Get-ChildItem C:\ -Recurse`), and any change inside a folder your wiki marks `protected`. It also refuses the first write to `user-rules.md` or memory once. Re-issue the write and it goes through.

The guard only warns on `.env` edits. It checks credentials by **file path**, not by content, so a key pasted into an ordinary source file is not caught here. One caveat about the process pack: if your `opencode.json` already has a `git commit*` entry, a rebuild without the pack leaves that entry in place and reports it. Geneseed cannot tell its own entry from one you typed.

<!--/harness-->

**Protected wiki folders** are blocked only on OpenCode. On Claude Code, Bob and OpenClaude they are an instruction the model reads. A **plain bundle** installs no hooks or plugins, so everything in it is asked.

Everything else, from "verify before you claim it works" to every practice in the doctrine packs, is asked on every host. In a folder you exclude with `geneseed exclude add <folder>`, the gates stand down too.

### Why not enforce everything

A gate sees one tool call: a command string, or a file path and its content. It cannot see whether the agent read the docs, checked its claim, or planned before acting. Most rules are about judgement, and no pattern can check judgement.

The patterns that do exist are deliberately narrow. A gate that fired on every hash or lockfile would get allow-listed within a day and then protect nothing. A narrow gate that fires rarely stays switched on. Each gate also costs about 14 ms per tool call, on every call.

### What the harness does not do

- **It does not make the model smarter.** It gives the same model better instructions and a few guard rails.
- **It does not check facts.** The rules tell the agent to verify before asserting. Nothing confirms that it did.
- **It does not review code on its own.** The reviewer agent runs when you or the agent ask for it, not on every change.
- **It is not a sandbox.** A destructive command that matches no pattern runs like any other. Your host's own permission settings still apply on top.

---

**Where next:** [Install it](../guides/install.md) · [The rules in detail](../concepts/rules.md) · [Glossary](../reference/glossary.md)
