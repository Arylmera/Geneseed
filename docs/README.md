# Geneseed documentation

[← Back to README](../README.md)

**New to agent harnesses?** Read **Understand** first — four short pages, about ten minutes, and every other page assumes them. The same pages open the **Docs** tab of the web console (`geneseed web`), which adds an interactive map of your own install and filters host-specific passages to the tool you use.

## 1 · Understand

1. **[What a harness is](understand/harness.md)** — git hooks + CI + a runbook, but for your AI agent.
2. **[What lands on your machine](understand/on-your-machine.md)** — every file and hook an install writes, what it does for you, what it costs, how to turn it off.
3. **[A day with the harness](understand/a-day.md)** — the moments you will actually meet: a push that asks first, a skill, a delegation, a memory.
4. **[Enforced vs. asked](understand/enforced-vs-asked.md)** — what is guaranteed by code, and what the model is only asked to do.

## 2 · Guides

| Guide | When |
| --- | --- |
| [Install](guides/install.md) | First time — npx, a clone, or a specific host |
| [Choose your setup](guides/choose-your-setup.md) | Theme, doctrine packs, one rule at a time, footprint, posture, mode |
| [Verify it works](guides/verify.md) | Right after installing, or when something feels off |
| [Upgrade](guides/upgrade.md) | Getting a new version onto every install |
| [Uninstall](guides/uninstall.md) | Removing an install — and what stays behind |
| [Project context](guides/project-context.md) | Choosing which of a repo's docs the agent loads |
| [Connect your wiki](guides/wiki.md) | Giving the agent your own notes, machine-wide |
| [MCP servers](guides/mcp.md) | MarkItDown, GitLab, Filesystem — and reading non-markdown docs |
| [Run geneseed from anywhere](guides/run-anywhere.md) | Putting the CLI on your PATH from a clone |
| [Start the web console at login](guides/autostart.md) | Keeping the console running |
| [Run in CI / headless](guides/headless.md) | OpenCode without a terminal |
| [Add git-worktree isolation](guides/worktree.md) | OpenCode, optional third-party add-on |
| [Migrate from a clone to npm](guides/migrate.md) | Moving an old clone install to the npm package |

## 3 · Concepts

[Hosts](concepts/hosts.md) · [Rules](concepts/rules.md) · [Agents](concepts/agents.md) · [Skills](concepts/skills.md) · [Hooks](concepts/hooks.md) · [Memory](concepts/memory.md) · [Notebook](concepts/notebook.md) · [Footprint](concepts/footprint.md) · [Collaboration](concepts/collaboration.md) · [Foreman mode](concepts/foreman-mode.md) · [Exclusions](concepts/exclusions.md) · [Themes](concepts/themes.md) · [Code intelligence (LSP)](concepts/lsp.md)

## 4 · Reference

[CLI](reference/cli.md) · [Environment variables](reference/environment.md) · [Glossary](reference/glossary.md) · [Troubleshooting](reference/troubleshooting.md) (by symptom) · [OpenCode plugins](reference/opencode-plugins.md) · [About](reference/about.md)

## For contributors

[Extending Geneseed](extending.md) — what each kind of addition costs · [DESIGN.md](../DESIGN.md) · [Design history](design-history.md) · [Token footprint](token-footprint.md) · [Web console internals](web-ui.md) · [OpenCode plugin wiring](opencode-plugin-setup.md) · [Candidate hosts](candidate-hosts.md) · adapters: [OpenCode](../adapters/opencode/README.md), [Claude Code](../adapters/claude-code/README.md), [Bob](../adapters/bob/README.md), [OpenClaude](../adapters/openclaude/README.md)
