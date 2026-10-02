---
group: reference
order: 4
title: "Troubleshooting"
kind: "concept"
---
Find what you are seeing below. Each entry gives the likely cause, the fix, and how to confirm it worked. Messages in quotes are what Geneseed actually prints.

First stop for almost anything: `geneseed doctor`. It renders the harness into a temp directory and reports every problem it finds without touching your install.

```bash
geneseed doctor
```

## Installing

### `Node.js not found` or `Node vX is too old`

The one-step installer (`./install`, `install.cmd`, `install.command`) checks Node first and stops:

> `xx  Node v20.11.0 is too old — Geneseed needs 22.3 or newer.`

**Cause.** No Node on PATH, or an older one — Linux distribution packages are often behind.

**Fix.** Install the current Node.js LTS from <https://nodejs.org/> (macOS: `brew install node`; Linux: nvm or NodeSource). Open a **new** terminal, then run the installer again.

**Confirm.**

```bash
node --version
```

prints 22.3 or newer, and the installer's first line reads `ok  Node v…`.

### `setup` says it needs an interactive terminal

> `[setup] needs an interactive terminal. Non-interactive? e.g.:`
> `  geneseed build --emit opencode-global --theme neutral`

**Cause.** `geneseed setup` is a wizard and refuses to run when its input is not a terminal — in CI, through a pipe, or from a tool that runs commands without a TTY.

**Fix.** Run it from a real terminal, or skip the wizard and build directly with the flags it would have asked for:

```bash
geneseed build --emit opencode-global --theme neutral
```

See [Install](../guides/install.md) for the emit target that matches your tool.

**Confirm.** `geneseed status` lists the install.

### `setup` lists a tool as missing — or present — when it isn't

Setup opens with `AI coding tools on this machine:` and an `ok` or `--` per tool.

**Cause.** The check only asks whether the command (`opencode`, `claude`, `bob`, `openclaude`) is on your PATH. A desktop-only install with no command shows as missing; an unrelated program with the same name shows as present.

**Fix.** Nothing to fix — the line is advisory. Pick the install mode for the tool you actually use; a missing tool among several present is just a line, and you can continue without one.

**Confirm.** Open the tool and check for the readiness sigil (see "The agent never shows the readiness sigil" below).

### `Java 21+ (jdtls) missing`

Shown in setup's summary for OpenCode installs:

> `Java 21+ (jdtls) missing — install a JDK 21+ — e.g. brew install openjdk@21, SDKMAN sdk install java 21-tem, or your distro's package`

**Cause.** OpenCode's Java language server needs a JDK 21 or newer, and it is the one language server OpenCode cannot download for you. See [LSP](../concepts/lsp.md).

**Fix.** Install a JDK 21+ if you work in Java; ignore the line otherwise. Everything else works without it.

**Confirm.**

```bash
java -version
```

reports `version "21` or higher.

### `geneseed: command not found`

**Cause.** The `geneseed` launcher is not on your PATH. A git clone is not put there automatically (an `npm install -g geneseed` install is).

**Fix.** From the cloned folder:

```bash
./geneseed link
```

```bat
.\geneseed.cmd link
```

On Windows, `link` writes to `%LOCALAPPDATA%\Geneseed\bin` and adds it to your user PATH — only **new** terminals see it, so close and reopen yours.

**Confirm.**

```bash
geneseed version
```

works from any directory. See [Run anywhere](../guides/run-anywhere.md).

## Hooks, context and memory

### Hooks stopped firing

The agent loads its rules, but nothing is enforced and no memory is written — on Claude Code, Bob or OpenClaude.

**Cause.** Almost always a **stale hook shim**. Your tool's settings call `geneseed-hook` through one small script, `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows), which holds the absolute path of your Geneseed folder. Move or delete that folder and the shim points at nothing: the hooks still fire, fail, and every gate goes silently dead. `geneseed doctor` reports it as:

> `[shim] <path> pointed at <old path>, which does not exist — every hook in every install was dead (the checkout most likely moved).`

**Fix.** Re-emit from where Geneseed lives now — any build rewrites the shim:

```bash
geneseed rebuild-all
```

If you moved the shim itself with `GENESEED_HOME`, set it the same way before rebuilding.

**Confirm.** `geneseed doctor` prints no `[shim]` line, and a new session opens with the readiness sigil and your project docs in context.

### The agent never shows the readiness sigil

The first reply of a session should open with the readiness sigil (`✅` in the neutral theme) — the agent's sign that it loaded the harness.

**Cause.** The tool is not loading the root file. On OpenCode, `opencode.json` `instructions` does not point at `AGENT.md`; on another tool, its rules setting does not.

**Fix.** Rebuild the install so its config is merged again:

```bash
geneseed rebuild-all
```

For a tool Geneseed does not wire itself, point its rules setting at the bundle's `AGENT.md`.

**Confirm.** Start a **new** session; the first reply opens with the sigil. See [Verify](../guides/verify.md).

<!--harness:opencode-->
*(OpenCode only)*

### The agent doesn't load my project docs

**Cause.** The `geneseed-context` plugin is not in OpenCode's plugins directory, or injection is switched off (`GENESEED_CONTEXT_INJECT=off`).

**Fix.**

```bash
geneseed build --emit opencode-global
```

and unset `GENESEED_CONTEXT_INJECT`.

**Confirm.** `ls ~/.config/opencode/plugins/` shows the `geneseed-*.js` files, and a session started with `GENESEED_DEBUG=1` logs what the plugin discovered. See [OpenCode plugins](opencode-plugins.md).

### `PROJECT CONTEXT` appears twice

**Cause.** Two copies of the context plugin — the global one and a leftover `.opencode/plugins/` in the repo. OpenCode loads both.

**Fix.** Delete the project copy (`.opencode/plugins/geneseed-context.js`), or uninstall the project-scoped install.

**Confirm.** A new session shows the block at most once.

### The full `PROJECT CONTEXT` block shows in the terminal

**Cause.** Either `GENESEED_CONTEXT_VISIBLE=1` (or legacy `GENESEED_CONTEXT_TRANSFORM=0`) is set, or your OpenCode build lacks the experimental hook for invisible delivery and the plugin fell back to the visible block.

**Fix.** Unset the variable. If it still shows, your OpenCode build is the reason — update OpenCode, or live with the visible block; the context is the same.

**Confirm.** Run with `GENESEED_DEBUG=1`; the plugin's log says which delivery it used.

### No memory is written after a session

**Cause.** The learn plugin found no memory directory, or it did not load.

**Fix.** Pin the store, then restart OpenCode:

```bash
export GENESEED_HARNESS=~/.config/opencode
```

(or `GENESEED_MEMORY` for an explicit directory), and confirm the `geneseed-*.js` files are in the plugins dir.

**Confirm.** About a minute after the session goes quiet, stderr shows `[geneseed-learn] wrote N memory file(s): …` or a `skipped:` reason. Total silence means the plugin did not load.
<!--/harness-->

### `could not determine a model`

**Cause.** The learn step could not read which model the session used.

**Fix.** Give it a fallback:

```bash
export GENESEED_MODEL=provider/model
```

**Confirm.** The next session end writes memory instead of logging the message.

### A read-only agent won't run a command

**Cause.** By design: read-only agents are denied the shell. The few that must run read-only commands (the reviewer, security) are allowed it in their own spec.

**Fix.** Hand the task to an agent that can run commands, or run it yourself. See [Agents](../concepts/agents.md).

### PDFs and Office documents are ignored

**Cause.** Agents read text. Binary documents need converting first.

**Fix.** Use the `ingest` skill with a converter installed (MarkItDown, Pandoc or Docling), or wire MarkItDown as an MCP server — see [MCP servers](../guides/mcp.md).

### An MCP server is listed but won't connect

See [MCP servers](../guides/mcp.md) — each server has its own checks there.

## Updating

### `geneseed upgrade` refuses to run

The upgrade is a `git pull`, so it first checks the folder. Each refusal says what to do:

| Message | Fix |
| --- | --- |
| `git is not installed or not on PATH — install git to enable updates.` | Install git, open a new terminal, retry. |
| ``This Geneseed install isn't a git checkout — update it with `npm install -g geneseed@latest`, or re-clone it with git.`` | Use the npm command for an npm install; otherwise re-clone (`git clone https://github.com/Arylmera/Geneseed.git`). |
| `You have local changes in the Geneseed folder. Commit or stash them, then update.` | `git stash` in the Geneseed folder, upgrade, then `git stash pop`. |
| ``HEAD is detached (a tag/commit is checked out). Run `git checkout <branch>` to re-enable updates.`` | `git checkout main`. |
| ``Your branch has no upstream — set one with `git branch --set-upstream-to`.`` | `git branch --set-upstream-to=origin/main`. |

**Confirm.** `geneseed upgrade` completes and `geneseed version` shows the new version. See [Upgrade](../guides/upgrade.md).

## Doctor findings

### `unresolved token … in …`

**Cause.** A theme JSON lacks a key the templates use — usually a custom theme that fell behind.

**Fix.** Compare it with `themes/neutral.json`: every key there must exist in your theme. Then re-render:

```bash
geneseed build --theme <yours>
```

**Confirm.** `geneseed doctor --theme <yours>` is clean.

### A committed `Harness/` bundle drifted from `src/`

**Cause.** A bundle committed to a repo was rendered from an older `src/`, or was edited in place.

**Fix.** Re-render and commit it:

```bash
geneseed build
git add Harness
```

If the drift is your own edits, export them first — `geneseed diff` (or the console's **Changes** page) writes them up so they can be folded back into `src/`.

**Confirm.** `geneseed doctor` no longer reports the bundle.

### `registry.json unreadable` / `registry.json is not valid JSON`

> `[authoring] registry.json unreadable: …`

**Cause.** The Geneseed folder's `registry.json` is missing or damaged — typically a bad merge or a hand edit. The web console stays up, but every entity's status badge reads "unknown".

**Fix.** Restore the shipped copy (this discards any local edit to that one file):

```bash
git -C <geneseed folder> restore registry.json
```

**Confirm.** `geneseed doctor` no longer names `registry.json`, and the badges come back.

## Web console

### `web/dist is missing`

> `[web] web/dist is missing. Build the UI first:`
> `        cd web && npm install && npm run build`

**Cause.** The built console ships in the repo, so this only happens on a partial checkout. On an interactive terminal `geneseed web` offers to build it for you.

**Fix.** Build it from the Geneseed folder:

```bash
cd web && npm install && npm run build
```

If it instead says `web/ sources are missing`, run `geneseed upgrade` (twice on an old install).

**Confirm.** `geneseed web` opens the console.

### The console says `no deployed harness`

> `[web] no deployed harness at <dir>.`

**Cause.** Nothing is installed where the console looks. It still serves, read-only, with most actions disabled.

**Fix.**

```bash
geneseed setup
```

**Confirm.** Restart the console — `geneseed web restart` — and the warning is gone.

### Skills or agents not tracked in git

**Cause.** A parent `.gitignore` blanket-ignores the bundle directory.

**Fix.** Remove the bare `Harness/` line from the parent `.gitignore`; the bundle's own `.gitignore` already scopes what to skip.

**Confirm.** `git status` lists the bundle's files.
