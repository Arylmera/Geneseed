---
group: reference
kind: "concept"
section: "Troubleshooting"
order: 6
title: "Install problems"
description: "Node missing or too old, setup without a terminal, tools not detected, command not found."
---
Each entry gives the likely cause, the fix, and how to confirm it worked. First stop for almost anything: `geneseed doctor` (see [Troubleshooting](troubleshooting.md)).

## `Node.js not found` or `Node vX is too old`

The one-step installer (`./install`, `install.cmd`, `install.command`) checks Node first and stops:

> `xx  Node v20.11.0 is too old — Geneseed needs 22.3 or newer.`

**Cause.** No Node on PATH, or an older one — Linux distribution packages are often behind.

**Fix.** Install the current Node.js LTS from <https://nodejs.org/> (macOS: `brew install node`; Linux: nvm or NodeSource). Open a **new** terminal, then run the installer again.

**Confirm.**

```bash
node --version
```

prints 22.3 or newer, and the installer's first line reads `ok  Node v…`.

## `geneseed needs Node 22.3 or newer`

Run without the installer — `npx geneseed`, a global npm install, or a hook — on an older Node, every Geneseed command stops with one sentence:

> `geneseed needs Node 22.3 or newer; this is Node 20.18.1. Install a current Node from https://nodejs.org (or your package manager), then run the command again.`

**Cause.** The `node` on PATH is older than 22.3. npm only *warns* about the engine requirement, so a global install succeeds anyway. A hook prints the same sentence and lets the tool call through rather than block it, so on Claude Code, Bob or OpenClaude the hooks are off until Node is upgraded.

**Fix.** Install the current Node.js LTS (see above), open a **new** terminal, and run the command again.

**Confirm.** `geneseed version` prints the version instead of the sentence.

## `setup` says it needs an interactive terminal

> `[setup] needs an interactive terminal. Non-interactive? e.g.:`
> `  geneseed build --emit opencode-global --theme neutral`

**Cause.** `geneseed setup` is a wizard and refuses to run when its input is not a terminal — in CI, through a pipe, or from a tool that runs commands without a TTY.

**Fix.** Run it from a real terminal, or skip the wizard and build directly with the flags it would have asked for:

```bash
geneseed build --emit opencode-global --theme neutral
```

See [Install](../guides/install.md) for the emit target that matches your tool.

**Confirm.** `geneseed status` lists the install.

## `setup` lists a tool as missing — or present — when it isn't

Setup opens with `AI coding tools on this machine:` and an `ok` or `--` per tool.

**Cause.** The check only asks whether the command (`opencode`, `claude`, `bob`, `openclaude`) is on your PATH. A desktop-only install with no command shows as missing; an unrelated program with the same name shows as present.

**Fix.** Nothing to fix — the line is advisory. Pick the install mode for the tool you actually use; a missing tool among several present is just a line, and you can continue without one.

**Confirm.** Open the tool and check for the readiness sigil (see [The agent never shows the readiness sigil](troubleshoot-hooks.md)).

## `Java 21+ (jdtls) missing`

Shown in setup's summary for OpenCode installs:

> `Java 21+ (jdtls) missing — install a JDK 21+ — e.g. brew install openjdk@21, SDKMAN sdk install java 21-tem, or your distro's package`

**Cause.** OpenCode's Java language server needs a JDK 21 or newer, and it is the one language server OpenCode cannot download for you. See [LSP](../concepts/lsp.md).

**Fix.** Install a JDK 21+ if you work in Java; ignore the line otherwise. Everything else works without it.

**Confirm.**

```bash
java -version
```

reports `version "21` or higher.

## `geneseed: command not found`

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
