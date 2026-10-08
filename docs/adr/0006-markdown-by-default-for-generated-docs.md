# 0006 — Generated docs are Markdown by default

- **Status:** Accepted (supersedes the AsciiDoc default of #205)
- **Date:** 2026-10-08 (#208, `8570c0ea`)

## Context

The documentation skills (`document-project` and the doc bricks) write a project's docs. #205 made
AsciiDoc the default for a project with no docs yet. In practice, files that change often or that
an agent reads are better in Markdown: every host and GitHub render it, and AsciiDoc grows heavy
fast. AsciiDoc earns its place for durable, human-read documentation published outside GitHub.

## Decision

Doc skills write Markdown by default. They write AsciiDoc only when the user asks for it, or when
the project's docs are already `.adoc`, and they never propose switching on their own. Agent-runtime
files (`AGENTS.md`, `CLAUDE.md`, specs and ADRs read by loops) are always Markdown.

## Consequences

- `.adoc` discovery, `[source,mermaid]` blocks and `README.adoc` auto-loading stay available for
  projects that already use AsciiDoc.
- Geneseed's own docs, including these records, are Markdown.
