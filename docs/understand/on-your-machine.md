---
group: understand
order: 2
title: "What lands on your machine"
kind: "concept"
section: "On your machine"
description: "What an install writes and wires, and the four kinds of piece: enforced, automatic, asked, on demand."
---
An install writes a handful of files into your host's config folder and, where the host allows it, wires small programs that run at fixed moments: when a session starts, before a tool call, when a session ends. The page for your host says what each piece does for you, when it runs, what it costs, and how to turn it off. Its **Kind** column uses four words:

- **enforced**: code runs before the action and can stop it. The model cannot argue past it.
- **automatic**: runs by itself at a fixed moment, such as session start or session end.
- **asked**: text the model reads every session. It usually follows it, but nothing makes it.
- **on demand**: loads only when you or the agent call it by name.

Token costs are for the default *lean* footprint. Before you type anything, a session carries about 12k tokens of harness. That is roughly 6% of a 200k window. A `--footprint full` build adds about 5k on the rules file. For a live figure on your own install, ask the agent to use the `token-report` skill.

## One page per host

<!--harness:opencode-->
*(OpenCode only)*

- [On OpenCode](machine-opencode.md): the plugins and the `opencode.json` entries, piece by piece.

<!--/harness-->
<!--harness:claude-->
*(Claude Code only)*

- [On Claude Code and OpenClaude](machine-claude.md): the hooks in `settings.json`, piece by piece.

<!--/harness-->
- [On Bob, or any AGENT.md tool](machine-bob.md): where the files go, and what is enforced there.
- [Taking it back out](take-it-out.md): what `geneseed uninstall` removes, and what it keeps.
