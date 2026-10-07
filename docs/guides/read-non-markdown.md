---
group: guides
order: 20
title: "Reading non-markdown docs"
kind: "concept"
section: "Set up"
description: "Let the agent read PDF, Word, PowerPoint, Excel and HTML through a converter."
---
The agent's doc discovery sees markdown (`.md`) and AsciiDoc (`.adoc`) only. The `ingest` skill teaches the agent to convert a PDF, Word, PowerPoint, Excel or HTML file, or a URL, to markdown before reading it. Install one converter and the skill uses it:

- **MarkItDown**: the broadest. Use [its MCP server](mcp-markitdown.md) (preferred on a host with MCP: nothing to install per call, one cheap tool), or `pip install markitdown`.
- **Pandoc**: excellent for Office and HTML, and a single binary.
- **Docling** (IBM): best for complex tables and scanned PDFs.

When an MCP converter is available, the skill prefers it. A prompt like *"convert file:///path/to/spec.pdf to markdown"* then just works. The skill never installs a converter silently. If none is present, it tells you which one to add.

Converter not found, or an MCP converter listed but not connecting? See [Model, agent and MCP problems](../reference/troubleshoot-tools.md).
