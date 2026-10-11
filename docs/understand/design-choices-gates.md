---
group: understand
order: 11
title: "Choices: gates"
kind: "concept"
section: "Why it works this way"
description: "How the hook gates decide, fail and stay out of your way, and why."
---
The gates are the one place the harness does more than ask. Part of [Why Geneseed works this way](design-choices.md); the other parts cover [the shape of the harness](design-choices-shape.md), [hosts](design-choices-hosts.md), [install and update](design-choices-install.md), and [engineering, skills and agents](design-choices-engineering.md).

- **A gate that cannot evaluate a call asks.** `guardGate` turns an unreadable payload or a bug into a prompt carrying the error, and every prompt adds a line to `notebook/gates.jsonl`. A crashed gate must never become a permissive one. See [Hook gates](../concepts/hook-gates.md) and [ADR 0007](../adr/0007-gates-fail-closed-per-host-ceiling.md).
- **On Claude Code, a gate that cannot start blocks the call.** The gate hooks carry `onFailure: "block"`, the same fail-closed rule applied by the host itself. See [ADR 0007](../adr/0007-gates-fail-closed-per-host-ceiling.md) and [Troubleshooting hooks](../reference/troubleshoot-hooks.md).
- **An argument error on a gate verb exits 0.** The hook shim is shared machine-wide, so an older `geneseed-hook` can receive a flag only a newer install knows; with `onFailure: "block"`, a refusal there would block every tool call in every session. See [ADR 0007](../adr/0007-gates-fail-closed-per-host-ceiling.md).
- **The verdict travels as JSON on stdout, the hook exits 0, and nothing else is printed.** One stray byte on stdout would turn a blocking gate silently permissive. See [ARCHITECTURE.md](../../ARCHITECTURE.md) and [SECURITY.md](../../SECURITY.md).
- **Gates stay narrow and cheap to load.** Everything the hook entry point imports is paid on every tool call of every session. See [Hook gates](../concepts/hook-gates.md).
- **One shim for the whole machine, rewritten by every build, last writer wins.** Moving a checkout and rebuilding then repairs every install at once. A checkout under the OS temp folder or in a git worktree never rewrites it (`ephemeralCheckout`), since the shim would outlive it. See [Hook gates](../concepts/hook-gates.md).
- **A global gate stands down only for a live project install that runs the same hook.** `globalHookStandingDown` checks the session's project directory for an install whose manifest records a group running the same verb, still present in its settings file. A gate goes quiet only when an equivalent gate replaces it; a doubled prompt is safe and a silenced gate is not. See [Hook gates](../concepts/hook-gates.md).
- **The destructive-git list is closed.** It covers the irreversible acts Deletion Is Deliberate names, so the gate adds no policy the law does not state. See [Hooks](../concepts/hooks.md).
- **A recursive scan rooted at a filesystem root asks on Claude Code and OpenClaude, and blocks on Bob and OpenCode.** Hosts with no ask tier must block, or the scan starts anyway. The remote half of an `ssh` command is exempt, since it runs on the remote machine. See [ADR 0010](../adr/0010-root-scan-guard.md).
- **On OpenCode, a push to a `loop/*` branch is allowed.** A loop branch is never `main` or `master`; a force push, an extra refspec or a delete still asks, and so does every commit. See [LOOP.md, trailers and the loop branch](../concepts/loop-branch.md).
- **The OpenCode guard plugin allows the call when its own code fails.** OpenCode has no ask tier, so failing closed there would lock the session with nothing to answer it. See [The guard plugin](../reference/plugin-guard.md) and [ADR 0007](../adr/0007-gates-fail-closed-per-host-ceiling.md).
- **Geneseed's hook groups are appended after yours.** A merge keeps your own `PreToolUse` entries in place and adds its groups at the end, so it never reorders hooks you wrote. See [Hook gates](../concepts/hook-gates.md).
- **`learn` runs on `Stop`, `SubagentStop` and `PreCompact`, and moving it to a session-end event was turned down.** It distils the tail of the transcript, which a session-end event does not reliably leave it. See [Hooks](../concepts/hooks.md) and [Memory](../concepts/memory.md).
