---
group: guides
order: 1
title: "Install"
kind: "concept"
---
Geneseed builds a harness (the rules, agents, skills and hooks your AI coding tool loads; see [What a harness is](../understand/harness.md)) and installs it into the tool you already use. Most people need one command.

## The 5-minute path

The only prerequisite is **Node 22.3 or newer**.

```
npx geneseed setup
```

The command is the same on macOS, Linux and Windows (cmd, PowerShell or any POSIX shell). The setup wizard lists the AI coding tools it found on your `PATH`, then asks for a theme, a posture, a mode, the doctrine packs, an install mode and a footprint. Each one has a safe default, so you can hold Enter through all of them. [Choose your setup](choose-your-setup.md) explains each question. **OpenCode global** is the recommended install mode: you install once and every repo inherits it, with nothing committed into your projects. The wizard then builds the harness and ends with a short summary: the root file your tool loads and where it was written, the hooks it wired (Claude Code, Bob and OpenClaude), whether memory learning is on, which tool to restart, and a link to what was installed. It then offers to run a health check.

To keep the command on your machine:

```
npm install -g geneseed
```

This puts three commands on your `PATH`: `geneseed` (the CLI you type), `geneseed-build` (the generator) and `geneseed-hook` (what the host tool calls on every tool use, which you never type yourself).

Next: [Verify it works](verify.md). To see what the install just wrote, read [What lands on your machine](../understand/on-your-machine.md).

## From a clone

Clone the repository when npm is out of reach (for example, a corporate network with no registry access), or when you want to change the harness rather than just use it. A clone needs **git** as well as Node 22.3 or newer. git is what updates the clone.

Each OS has a one-step installer at the root of the clone. It checks for Node and git. If one is missing, it names what to install and where to get it, then stops. **It never installs anything itself.** When the checks pass, it runs the setup wizard and offers to open the web console.

```bash
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
./install                 # macOS, Linux, or a POSIX shell on Windows
```

- **macOS**: you can also double-click `install.command` in the Finder. It opens in Terminal.
- **Windows**: double-click `install.cmd` in Explorer, or run it from cmd or PowerShell. It needs no bash, WSL or PowerShell script.

```powershell
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
.\install.cmd
```

Later, run the launcher in the clone: `./geneseed setup` (Windows: `.\geneseed.cmd setup`) re-runs the wizard, and bare `./geneseed` opens the web console. Both launchers need `node` on `PATH`. If it is not there (some version managers only patch interactive shells), set `GENESEED_NODE` to the absolute path of the Node binary.

From a clone, every `geneseed …` command on these pages is `./geneseed …` (Windows: `.\geneseed.cmd …`). To drop the `./`, see [Run geneseed from anywhere](run-anywhere.md).

## Prerequisites

- **Node 22.3 or newer.** This is the only hard requirement. Geneseed has zero runtime dependencies, and nothing it installs needs a second interpreter.
- **Your agent tool**: OpenCode (recommended), Claude Code, IBM Bob, OpenClaude, or any tool that reads a root instructions file.
- **git**, for a clone only. A clone updates itself with `git pull`.
- *Optional:* a document converter (MarkItDown, Pandoc or Docling) if you want the agent to read PDFs and Office files. See [MCP servers](mcp.md#reading-non-markdown-docs).

## Without the wizard

`setup` needs an interactive terminal. In a script, a CI job, or any shell without one, it stops with exit code 1 and prints the build command to run instead:

```
geneseed build --emit opencode-global --theme neutral
```

`geneseed build` takes the same flags as the generator `geneseed-build`. `--emit` picks the host and its scope: `files`, `opencode`, `opencode-global`, `claude`, `claude-global`, `bob`, `bob-global`, `openclaude` or `openclaude-global`. A `-global` emit writes into the tool's own config directory. A project emit writes into the repo you name with `--out <repo> --root <repo>`. All the other flags (`--theme`, `--footprint`, `--posture`, `--mode`, `--doctrines`, `--exclude-rules`) are covered in [Choose your setup](choose-your-setup.md).

To test a build before writing anything, use `geneseed validate` with the same flags. See [Verify](verify.md).

## Install paths, one per host

The wizard runs one of these for you. Use them directly when you script an install, or when you want a scope the wizard did not offer you.

### OpenCode, global (recommended)

```
geneseed build --emit opencode-global
```

This writes into OpenCode's config directory: `$OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode` (on Windows too: `C:\Users\<you>\.config\opencode`). The install contains `AGENT.md`, `agents/`, `skills/`, the plugins, the `memory/` store, and a merged `opencode.json` whose `instructions` key points at `AGENT.md`. Every repo you open in OpenCode inherits it. You do not need a per-repo file, because the context plugin finds each repo's docs by itself (see [Project context](project-context.md)).

The install is non-destructive. A manifest (`.geneseed-manifest.json`) records the files Geneseed owns. A rebuild replaces and prunes only those files, and never touches your own agents, skills, plugins or memory.

### OpenCode, per repo

```
geneseed build --emit opencode --out /path/to/repo --root /path/to/repo
```

This writes the bundle (`AGENT.md`, `agents/`, `skills/`, `memory/`, `notebook/`) and OpenCode's own layer (`opencode.json` and `.opencode/`) into one repository. You can commit them or not. To keep the bundle in a subfolder, point `--out` at the subfolder and keep `--root` on the repo, so instruction paths resolve from the project root:

```
geneseed build --emit opencode --out /path/to/repo/Harness --root /path/to/repo
```

### Claude Code

```
geneseed build --emit claude-global                                  # ~/.claude, every repo
geneseed build --emit claude --out /path/to/repo --root /path/to/repo   # one repo
```

The install writes `CLAUDE.md`, `agents/`, `skills/`, `memory/` and `notebook/`, plus hooks in Claude Code's `settings.json`. Hooks are commands Claude Code runs around each tool call. They gate risky actions and load project context (see [Hooks](../concepts/hooks.md)). For a project install the hooks go into `.claude/settings.local.json`, which stays out of git because it names a path on your machine.

Every hook calls `geneseed-hook <verb>` through one stable file, the **hook shim** at `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows). The shim knows where Node and Geneseed live. If you move or replace Geneseed, one rebuild rewrites the shim and every install works again. `GENESEED_HOME` moves the shim's folder.

### OpenClaude

```
geneseed build --emit openclaude-global                                   # ~/.openclaude
geneseed build --emit openclaude --out /path/to/repo --root /path/to/repo # one repo
```

[OpenClaude](https://openclaude.gitlawb.com/) is a fork of Claude Code that can drive any model. You get the same agents, skills and hooks as Claude Code, under a different config directory. OpenClaude never reads `~/.claude` or a project `.claude/`, so the two installs can sit side by side. The differences:

- Per repo, the preamble is written to `.openclaude/CLAUDE.md` rather than a root file, and the hooks go into `.openclaude/settings.local.json`.
- `$OPENCLAUDE_CONFIG_DIR` moves the global directory (default `~/.openclaude`).

OpenClaude support has not yet been verified against a live install.

### IBM Bob

```
geneseed build --emit bob-global                                   # ~/.bob
geneseed build --emit bob --out /path/to/repo --root /path/to/repo # one repo
```

Bob is shaped like Claude Code, so it gets the same agents and skills. Per repo, the preamble goes into a root `AGENTS.md` and the rest into `.bob/`. Globally, everything goes under `~/.bob` (`$BOB_CONFIG_DIR` moves it), and the preamble rides `rules/geneseed.md`, because Bob does not auto-load a global `AGENTS.md`. Bob's hooks refuse an action with exit code 2, and Bob has no `SubagentStop` or `PreCompact` events. Bob support has not yet been verified against a live install.

### Any AGENT.md tool

```
geneseed build            # renders the plain bundle into ./Harness
```

Point your tool's instructions or rules setting at `Harness/AGENT.md`. If the tool only loads one specific filename, rename or symlink the file (`AGENT.md` to `AGENTS.md` or `CLAUDE.md`). The rules then rest on the agent's own discipline, because these tools have no hooks or plugins to enforce anything (see [Enforced vs. asked](../understand/enforced-vs-asked.md)).

Some of these tools also load skills. Their own docs list where:

- **Codex CLI** loads a root `AGENTS.md` and `~/.codex/AGENTS.md`, and skills from `~/.codex/skills` or `.agents/skills`.
- **Cursor** loads `AGENTS.md`, and skills from `.cursor/skills`, `.agents/skills` or `.claude/skills`.
- **Gemini CLI** reads `GEMINI.md` by default. Set `context.fileName` in its `settings.json` to include `AGENTS.md`. Skills load from `.gemini/skills` or `.agents/skills`.

Copy or symlink the bundle's `skills/` to `.agents/skills/` and all three of them see it.

### No runtime on the target machine

If the machine that will use the harness cannot run Node, run this once on a machine that can:

```
npx geneseed prompt --theme neutral > install-geneseed.md
```

This produces one self-contained prompt that recreates the whole file tree. Paste it into any capable agent on the target machine. There is nothing to install and no build step. Any theme works the same way.

---

**Next:** [Verify it works](verify.md) · [Choose your setup](choose-your-setup.md) · [What lands on your machine](../understand/on-your-machine.md)
