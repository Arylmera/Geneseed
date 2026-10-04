---
group: guides
order: 17
title: "MarkItDown (MCP)"
kind: "concept"
section: "Set up"
description: "Convert PDF and Office files to markdown: uvx or pipx, OCR extras, corporate TLS."
---
One of the [MCP server](mcp.md) presets. Where each host keeps the config, and how to check the server connected, are on that page.

[MarkItDown](https://github.com/microsoft/markitdown) (Microsoft) converts PDF, Word, Excel, PowerPoint and HTML to markdown. It exposes one tool, `convert_to_markdown(uri)`, which accepts `file:`, `http:`, `https:` and `data:` URIs.

**1. Make the command resolve.**

- **`uvx` (recommended, nothing to install).** If you have [uv](https://docs.astral.sh/uv/), `uvx markitdown-mcp` fetches and caches the server on first use. This is the command the preset uses.
- **`pipx`.** Without uv, run `pipx install markitdown-mcp`, then use `markitdown-mcp` alone as the command (OpenCode: `["markitdown-mcp"]`; Claude: `"command": "markitdown-mcp"`, no args).

```
uvx markitdown-mcp --help                       # uv route: confirm it resolves
pipx install markitdown-mcp && markitdown-mcp --help   # pipx route
```

For scanned or image-only PDFs, which otherwise come back empty, add the OCR extras: `uvx --with "markitdown[all]" markitdown-mcp`, or `pipx inject markitdown-mcp "markitdown[all]"`.

**2. Corporate TLS (only behind an SSL-inspecting proxy).** uv ships its own root certificates and ignores the OS trust store, so a proxy's internal certificate fails with `invalid peer certificate: UnknownIssuer`. Point uv at the OS store rather than turning verification off:

```
export UV_SYSTEM_CERTS=true      # older uv: UV_NATIVE_TLS=true
# fallback: export SSL_CERT_FILE=/path/to/corporate-root-ca.pem
```

**3. Register it**, with the console toggle or one of the blocks in [MCP servers](mcp.md). Then restart your agent.

---

**Next:** [Reading non-markdown docs](read-non-markdown.md)
