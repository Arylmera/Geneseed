---
group: lsp
order: 0
title: "Code intelligence (LSP)"
kind: "concept"
link: {"hash": "#/docs/adapters-opencode", "label": "OpenCode adapter →"}
---
OpenCode can drive Language Server Protocol servers so the agent sees real diagnostics, type errors, and go-to-definition — not just text. Geneseed turns this on for every language OpenCode ships a server for.

### What's covered out of the box

| Language | Server | You install? |
|---|---|---|
| JavaScript / TypeScript / React / React Native | typescript-language-server | No — OpenCode self-downloads |
| Python | pyright | No — OpenCode self-downloads |
| Java | jdtls | **JDK 21+** (OpenCode downloads jdtls itself) |
| SQL / PostgreSQL / Oracle | *none — by design* | — |

One server covers JavaScript, TypeScript, React, and React Native — they are all TS/JS, so no extra server is needed.

### The one prerequisite the harness can't self-install

OpenCode downloads the JS-runtime servers automatically on first use. It cannot install a JVM, and jdtls needs one — so the setup wizard checks for it and prints an install hint if missing:

- **Java 21+** — `brew install openjdk@21`, SDKMAN `sdk install java 21-tem`, or your distro's JDK.

### Why no SQL server

A SQL language server is dialect-locked — a Postgres server flags Oracle SQL as errors and vice versa — and a `.sql` file can map to only one server, with no signal for which dialect a repo uses. Rather than guess wrong for half of all SQL codebases, we ship none. A project that knows its dialect can add the matching server in its own `opencode.json` under the `lsp` key.

### How it's wired

`"lsp": true` in your emitted `opencode.json` enables every built-in server (LSP is off by default). To turn auto-download off (air-gapped machines), set `OPENCODE_DISABLE_LSP_DOWNLOAD=true` and pre-install each server.

---

**Verify:** open a `.ts` and a `.py` file in a session and ask the agent for diagnostics — the first open triggers the download.
