---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 14
title: "geneseed-guard"
description: "Blocks credential files, catastrophic commands and protected wiki writes before they run."
---
One of the [OpenCode plugins](opencode-plugins.md). [Environment variables](environment.md) points here for its switches.

**What it does.** Enforces the safety rules at the tool boundary — before a tool call runs, not after. High-confidence patterns only, so legitimate work is not caught.

- **Blocks** writes to private-key and credential files and writes whose content carries a credential (*Sealed Secrets*; an install built `--no-secrets-gate` carries `Secrets gate: off` in its `AGENT.md`, read once at load, and both stop blocking), catastrophic shell commands such as deleting the filesystem root and every command that would really lose data — a protected branch deleted or force-pushed, an unpushed unmerged branch deleted, a protected branch force-moved off commits nothing else holds, unpushed commits abandoned by `reset --hard`, uncommitted work discarded other than by `reset --hard`, a stash dropped, files git cannot restore removed — judged against the repository's state, the same decisions the Claude/Bob hook makes (*Deletion Is Deliberate*; `reflog expire` and `gc --prune` are left to the `permission.bash` ask; an install built `--no-deletion-gate` carries `Deletion gate: off` in its `AGENT.md`, which the plugin reads once at load and then stops blocking real loss — catastrophic commands still block), a recursive scan rooted at a whole filesystem such as `find /` (*Commands Must Return* — search a specific directory instead), and any change — write, move, rename, delete — under a wiki folder declared `protected` in `geneseed-wiki.jsonc`, and writes to a check listed in the project's `.geneseed/protected-checks.txt` (*External Gate* — see [Hooks](../concepts/hooks.md)).
- **Refuses once** the first write of a session in an application repo (a git root holding a build manifest) whose root `AGENTS.md` has no `## Ownership` section, so the agent proposes the [ownership](../concepts/ownership.md) setup first; the next write passes, and a sub-agent's session never triggers it. Off per repo with `mode: off` in that section; an install built `--no-ownership-gate` carries `Ownership gate: off` in its `AGENT.md`, read once at load.
- **Warns** (logged, allowed) on `.env` writes.
- **Speed-bumps** the *first* write to `user-rules.md` or a memory file: it is refused once, naming *Persist Insight* — whether something is a standing rule or a fact to remember is your call, settled through the `rule` skill. The re-issued write goes through.

It ships whole on every install, whatever [doctrine packs](../concepts/rules.md) you chose. On Claude Code and Bob the same checks are hooks, which can *ask* you instead of refusing; OpenCode's tool hook has no ask tier. Protected wiki folders are enforced only here — on the other hosts they are an instruction.

There is no DYNAMIC loop/* exemption on OpenCode — it declares a `permission.ask` plugin hook but never calls it, so this guard cannot let a loop's own commit through the way the Claude/Bob git-gate's `loopExempt` does. A loop's commit on OpenCode still gets the static `permission.bash` ask, every time. A push to a `loop/*` branch does not: pushing a loop branch is not pushing `main`/`master`, so [`js/hosts/settings.mjs`](../../js/README.md) wires a static `allow` for the exact refspec shapes the loop engine pushes (`git push [-u] <remote> HEAD:loop/<slug>`, and the `refs/heads/` spelling) — never `main`/`master`, and a force push, a `+refspec`, or a `--delete`/bare-`:` push to a `loop/*` branch still asks, through the push chain's own tiers or the blanket `git push*` ask.

**When it runs.** Before every tool call (`tool.execute.before`).

**What you see.** A refused tool call: `[geneseed-guard] blocked: <reason>`. The reason never names the switches below: the agent reads it, and a switch named there reads as leave to get round the block. The *Persist Insight* reason tells the agent to ask you and, once you answer, re-issue the same refused edit — never to write the file another way (through a shell command, say). Warnings go to stderr.

**Switches.**
- `GENESEED_GUARD=warn` — log every block, allow the call.
- `GENESEED_GUARD=off` — disable the guard.
