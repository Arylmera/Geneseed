---
group: concepts
order: 1
title: "Hosts"
kind: "concept"
---
A **host** is the AI coding tool Geneseed installs into — OpenCode, Claude Code, Bob or OpenClaude. Geneseed does not run the model; the host does. Geneseed writes the files the host reads (the instructions file, agents, skills) and, where the host allows it, wires small programs that run around the agent's actions. The *content* is the same on every host. What differs is how much of it the host lets Geneseed **automate** — check in code before an action — rather than only **ask** of the model in prose.

> **You already know this:** one codebase, several CI providers. The pipeline does the same job everywhere, but each provider exposes different hooks, so some checks run natively on one and are a manual step on another.

### What is the same everywhere

One build renders the same text for every host: the constitution ([rules](rules.md)), the {N_AGENTS} [agents](agents.md), the {N_SKILLS} [skills](skills.md), the [memory](memory.md) and [notebook](notebook.md) conventions, and the theme's voice. No host drops an agent, a skill or the memory convention.

Each host has a **global** install (in its config directory, active in every repo) and a **per-repo** install (inside one project). There is also a portable `files` bundle — a plain `Harness/` folder with an `AGENT.md` that any tool reading an instructions file can use, with no automation at all.

### Two engines

- **OpenCode** runs its own engine: Geneseed installs JavaScript **plugins** that OpenCode loads, plus permission entries in `opencode.json`. It also gets OpenCode-only extras: colour themes, [language servers](lsp.md), a workflow runner, a primary agent and `/`-commands.
- **Claude Code**, **Bob** and **OpenClaude** share one Claude-shaped engine: Geneseed wires **hooks** into the host's `settings.json`, each calling `geneseed-hook <verb>`. See [Hooks](hooks.md).

### What each host automates

| Capability | OpenCode | Claude Code | Bob | OpenClaude |
| --- | :---: | :---: | :---: | :---: |
| Instructions file | `AGENT.md` via `opencode.json` | `CLAUDE.md` | `AGENTS.md` + `rules/geneseed.md` | `CLAUDE.md` (`.openclaude/` per repo) |
| Agents · Skills · Memory · Notebook | ✅ | ✅ | ✅ | ✅ |
| Project context loaded at session start | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 🪝 hook² |
| Memory written back at session end (learn) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 🪝 hook² |
| Destructive git (force-push, `reset --hard`…) | 🔒 permission ask | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Secrets kept out of files | ⚙️ block⁴ | 🪝 ask | 🪝 block¹ | 🪝 ask² |
| Consent before every commit and push | 🔒 permission ask | 🪝 ask | 🪝 warning¹ | 🪝 ask² |
| Rule-or-memory write needs your call | ⚙️ speed bump³ | 🪝 ask | 🪝 warning¹ | 🪝 ask² |
| Sovereign-repo exclusions | ⚙️ plugins stand down | ✅ `claudeMdExcludes` | ✅ rules shadow stub | ✅ `claudeMdExcludes` |
| MCP server wiring | ✅ `mcp` | ✅ `mcpServers` | ✅ `mcp.json` | ✅ `mcpServers` |
| Colour themes · LSP · workflow runner · primary agent · `/`-commands | ✅ | ➖ | ➖ | ➖ |

✅ native · ⚙️ OpenCode plugin · 🔒 `permission.bash` entry in `opencode.json` · 🪝 `settings.json` hook · ➖ no host mechanism (the rule still applies as prose).

¹ **Bob** has its own hook contract: Claude's event names, but it ignores a hook's output on `PreToolUse`, so the only way to refuse is exit code 2. Geneseed therefore blocks only the two always-on rules (secrets, destructive git) and turns the two consent checks into a logged warning. It has no `SubagentStop` or `PreCompact` event, so learn runs on `Stop` only. **Unverified live** — there is no Bob install on the authoring machine; the rules preamble still holds if a hook does not fire.
² **OpenClaude** is a Claude Code fork and gets Claude's hooks and verdicts verbatim, in `~/.openclaude/settings.json` (global) or `.openclaude/settings.local.json` (per repo). **Unverified live** for the same reason.
³ OpenCode's plugin hook can only allow or throw — there is no "ask the user" — so this check stops the first such write once rather than prompting.
⁴ The checks differ in shape: OpenCode's guard plugin blocks writes *to* private-key and credential files by path; the Claude-shaped hook looks at the *content* being written for credential-shaped strings (cloud keys, tokens, private-key blocks) and asks. A `.env` file is exempt on the hook side — that is where a secret is allowed to live.

### The one conditional row

The **consent before commit and push** row depends on a choice you make at build time. It enforces the rule *Consent Before Push*, which belongs to the **process** doctrine pack ([Rules](rules.md)). Build without that pack, or exclude that one rule, and the commit/push question goes away — but the gate itself stays: on Claude Code and OpenClaude the `git-gate` hook is still wired (with `--no-consent`), so destructive git is still caught. Everything else in the table is always on.

One OpenCode asymmetry: Geneseed shares `opencode.json` with you and cannot tell its own `git commit*` permission entry from one you typed, so a rebuild without the process pack leaves an existing entry in place and says so instead of deleting it.

### Where to go next

- What exactly each host writes to disk: [What lands on your machine](../understand/on-your-machine.md).
- Code-enforced versus asked-of-the-model, in plain terms: [Enforced vs. asked](../understand/enforced-vs-asked.md).
- Per-host detail for maintainers: [OpenCode](../../adapters/opencode/README.md) · [Claude Code](../../adapters/claude-code/README.md) · [Bob](../../adapters/bob/README.md) · [OpenClaude](../../adapters/openclaude/README.md).
