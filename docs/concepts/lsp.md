---
group: concepts
order: 11
title: "Code intelligence (LSP, OpenCode)"
kind: "concept"
section: "Configuration"
description: "Language servers on OpenCode, so the agent sees real diagnostics."
---
OpenCode can run **language servers** — the same Language Server Protocol servers your editor uses — so the agent sees real diagnostics, type errors and definitions, not just text. Geneseed turns this on for every language OpenCode ships a server for.

> **You already know this:** the red squiggles in your editor. With LSP on, the agent gets the same squiggles before it tells you a change is done.

### What is covered

| Language | Server | You install |
| --- | --- | --- |
| JavaScript, TypeScript, React, React Native | typescript-language-server | nothing — OpenCode downloads it |
| Python | pyright | nothing — OpenCode downloads it |
| Java | jdtls | a **JDK 21+** (OpenCode downloads jdtls itself) |
| SQL | none, on purpose | — |

One server covers JavaScript, TypeScript, React and React Native: they are all TS/JS.

### The one prerequisite: Java 21+

OpenCode downloads the servers that run on Node by itself on first use. It cannot install a JVM, and jdtls needs one, so `geneseed setup` checks for Java 21+ and prints an install hint if it is missing. Any JDK 21 works, for example:

```bash
brew install openjdk@21
```

```bash
sdk install java 21-tem
```

### Why no SQL server

A SQL language server is tied to one dialect — a PostgreSQL server flags Oracle SQL as errors and the other way round — and a `.sql` file can map to only one server, with nothing telling OpenCode which dialect a repo uses. Rather than be wrong for half of all SQL codebases, Geneseed ships none. If your project knows its dialect, add the matching server under the `lsp` key of the project's own `opencode.json`.

### How it is wired

The install adds `"lsp": true` to your `opencode.json` (LSP is off in OpenCode by default). If you already have an `lsp` key, Geneseed leaves yours alone.

On an air-gapped machine, stop the downloads and pre-install each server yourself:

```bash
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
```

### Verify

Open a `.ts` and a `.py` file in a session and ask the agent for diagnostics. The first open triggers the download.
