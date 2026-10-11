---
group: understand
order: 12
title: "Choices: hosts"
kind: "concept"
section: "Why it works this way"
description: "How Geneseed treats Claude Code, OpenClaude, OpenCode and IBM Bob, and why."
---
How Geneseed treats each host it installs into. Part of [Why Geneseed works this way](design-choices.md); the other parts cover [the shape of the harness](design-choices-shape.md), [gates](design-choices-gates.md), [install and update](design-choices-install.md), and [engineering, skills and agents](design-choices-engineering.md).

- **Host parity: a feature reaches every host in the same change.** A host that gets a feature before the others turns into a special case on every later feature, which is how Copilot ended. See [ADR 0008](../adr/0008-host-parity-ceiling-of-the-weakest-host.md).
- **The weakest host sets the ceiling.** If Bob, the most limited host, cannot carry a feature, the feature waits as a design note. A `PostToolUse` check hook is parked for this reason: Bob's protocol gives that event no path back to the model. See [ADR 0008](../adr/0008-host-parity-ceiling-of-the-weakest-host.md).
- **OpenClaude is treated as the Claude Code release it forked from.** `claudeHookGroups` writes it no field documented only for a newer Claude Code, since the fork cannot be shown to understand one. See [ADR 0008](../adr/0008-host-parity-ceiling-of-the-weakest-host.md).
- **Bob blocks only where no judgement call is needed.** Bob has no ask tier, so the rules in `BLOCK_RULES` exit 2 and the rest become a warning. Blocking everything would leave Bob unable to commit. See [Hook gates](../concepts/hook-gates.md) and [ADR 0007](../adr/0007-gates-fail-closed-per-host-ceiling.md).
- **Bob's gate hook has no tool matcher.** Bob's tool list drifts from its own changelog, so an allow-list would let the next new write tool through unchecked. The fused `tool-gate` reads the payload's shape instead. See [the Bob adapter](../../adapters/bob/README.md).
- **On Windows, the PowerShell form of the Claude Code hooks is written only when Git Bash is absent.** `claudeHookShell` detects Git Bash by looking at files on `PATH`, without starting a process, so nothing changes on a machine that has it. Without that form, every hook would fail to parse. See [Hooks](../concepts/hooks.md).
- **OpenCode gets a one-line managed `AGENTS.md` when that file is missing.** OpenCode falls back to `~/.claude/CLAUDE.md` when `AGENTS.md` is absent, which would load the harness twice beside a Claude install. An existing `AGENTS.md` is left alone. See [Install for OpenCode](../guides/install-opencode.md).
- **Per-repo hooks go into the untracked `settings.local.json`.** The hook commands hold paths on your machine, and the team-shared `settings.json` would hand every teammate broken hooks. See [Hook gates](../concepts/hook-gates.md).
- **The manifest records which settings file holds the hooks.** Uninstall and the gate stand-down read the manifest's `settings_file` back (`settingsFile` in `js/hosts/hosts.mjs`) rather than assume a path, since the file differs by host and scope (Bob's global one is nested). See [Hook gates](../concepts/hook-gates.md).
- **Copilot was removed in one pass.** It was never verified live, its hook output never reached the model, and it shared no surface with the other hosts. See [ADR 0008](../adr/0008-host-parity-ceiling-of-the-weakest-host.md) and [Candidate hosts](../candidate-hosts.md).
- **What belongs to the host stays with the host.** Compaction, sandboxing and the plugin runtime are each host's own territory; Geneseed configures them where a host allows and builds no replacement. See [Hosts](../concepts/hosts.md).
