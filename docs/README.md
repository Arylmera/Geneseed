# Geneseed documentation

[← Back to README](../README.md)

**New to agent harnesses?** Read **Understand** first — a short track, about ten minutes, that every other page assumes. The same pages open the **Docs** tab of the web console (`geneseed web`), which groups each part into sections, adds an interactive map of your own install, and filters host-specific passages to the tool you use.

## 1 · Understand

**Start here** — [What a harness is](understand/harness.md): git hooks + CI + a runbook, but for your AI agent.

**On your machine** — [What lands on your machine](understand/on-your-machine.md) · [On OpenCode](understand/machine-opencode.md) · [On Claude Code and OpenClaude](understand/machine-claude.md) · [On Bob, or any AGENT.md tool](understand/machine-bob.md) · [Taking it back out](understand/take-it-out.md): every file and hook an install writes, what it does for you, what it costs, how to turn it off.

**Day to day** — [A day with the harness](understand/a-day.md): the moments you will actually meet · [Enforced vs. asked](understand/enforced-vs-asked.md): what is guaranteed by code, and what the model is only asked to do.

## 2 · Guides

| Section | Guide | When |
| --- | --- | --- |
| Install | [Install](guides/install.md) | First time — one command, and the page for each host |
| Install | [From a clone](guides/install-clone.md) | npm is out of reach, or you want to change the harness |
| Install | [OpenCode](guides/install-opencode.md) · [Claude Code](guides/install-claude-code.md) · [OpenClaude](guides/install-openclaude.md) · [IBM Bob](guides/install-bob.md) · [Any AGENT.md tool](guides/install-agent-md.md) | Installing for one host, global or per repo |
| Install | [Without the wizard](guides/install-scripted.md) | A script, a CI job, a shell with no terminal |
| Install | [Run geneseed from anywhere](guides/run-anywhere.md) | Putting the CLI on your PATH from a clone |
| Set up | [Choose your setup](guides/choose-your-setup.md) | Theme, doctrine packs, one rule at a time, footprint, posture, mode |
| Set up | [Verify it works](guides/verify.md) | Right after installing, or when something feels off |
| Set up | [Project context](guides/project-context.md) | Choosing which of a repo's docs the agent loads |
| Set up | [Connect your wiki](guides/wiki.md) | Giving the agent your own notes, machine-wide |
| Set up | [MCP servers](guides/mcp.md) | MarkItDown, GitLab, Filesystem — and reading non-markdown docs |
| Loops | [Run a loop](guides/run-a-loop.md) · [While a loop runs](guides/loop-running.md) · [Finish a loop](guides/loop-finish.md) | Working a requirement as small, validated, committed iterations |
| Keep it running | [Upgrade](guides/upgrade.md) | Getting a new version onto every install |
| Keep it running | [Migrate from a clone to npm](guides/migrate.md) | Moving an old clone install to the npm package |
| Keep it running | [Start the web console at login](guides/autostart.md) | Keeping the console running |
| Keep it running | [Uninstall](guides/uninstall.md) | Removing an install — and what stays behind |
| OpenCode extras | [Run in CI / headless](guides/headless.md) | OpenCode without a terminal |
| OpenCode extras | [Add git-worktree isolation](guides/worktree.md) | OpenCode, optional third-party add-on |

## 3 · Concepts

**Harness** — [Hosts](concepts/hosts.md) · [Rules](concepts/rules.md) · [Agents](concepts/agents.md) · [Skills](concepts/skills.md) · [Hooks](concepts/hooks.md)

**Memory** — [Memory](concepts/memory.md) · [Notebook](concepts/notebook.md)

**Configuration** — [Footprint](concepts/footprint.md) · [Themes](concepts/themes.md) · [Exclusions](concepts/exclusions.md) · [Code intelligence (LSP)](concepts/lsp.md)

**Working together** — [Collaboration](concepts/collaboration.md) · [Foreman mode](concepts/foreman-mode.md)

**Loops** — [Loops](concepts/loops.md) · [Templates](concepts/loop-templates.md) · [Bricks and their origins](concepts/loop-bricks.md) · [Notes and rules](concepts/loop-notes.md) · [Risk, trust and validation levels](concepts/loop-risk.md) · [Human gates](concepts/loop-gates.md) · [Contracts and ignored deletions](concepts/loop-contracts.md) · [LOOP.md, trailers and the loop branch](concepts/loop-branch.md)

## 4 · Reference

**CLI & environment** — [CLI](reference/cli.md) · [Loop actions](reference/loop-actions.md) · [Environment variables](reference/environment.md)

**Troubleshooting** (by symptom) — [Overview](reference/troubleshooting.md) · [Install](reference/troubleshoot-install.md) · [Hooks, context and memory](reference/troubleshoot-hooks.md) · [Updating](reference/troubleshoot-update.md) · [Doctor findings](reference/troubleshoot-doctor.md) · [Web console](reference/troubleshoot-web.md)

**OpenCode plugins** — [Overview](reference/opencode-plugins.md) · [context](reference/plugin-context.md) · [guard](reference/plugin-guard.md) · [learn](reference/plugin-learn.md) · [workflow](reference/plugin-workflow.md) · [notify](reference/plugin-notify.md) · [ponytail](reference/plugin-ponytail.md) · [activity](reference/plugin-activity.md)

**Glossary & about** — [Glossary](reference/glossary.md) · [About](reference/about.md)

## For contributors

[Extending Geneseed](extending.md) — what each kind of addition costs · [DESIGN.md](../DESIGN.md) · [Design history](design-history.md) · [Token footprint](token-footprint.md) · [Web console internals](web-ui.md) · [OpenCode plugin wiring](opencode-plugin-setup.md) · [Candidate hosts](candidate-hosts.md) · adapters: [OpenCode](../adapters/opencode/README.md), [Claude Code](../adapters/claude-code/README.md), [Bob](../adapters/bob/README.md), [OpenClaude](../adapters/openclaude/README.md)
