# {{SKILL}}: ingest

> {{DESC_INGEST}}

**Trigger:** a task needs the *content* of a non-markdown document — a PDF, Word
(`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`), HTML, EPUB — or a web URL. This is
the read-before counterpart for documents the convention can't read directly
(universal {{LAW}} XVII): the context discovery only sees `.md`, so anything else
must be converted first.

## Procedure
1. **Don't read the binary.** Convert it to markdown first, then read the markdown —
   reading a raw PDF/Office file wastes context and garbles structure.
2. **Use the best available converter** (check what's installed; do not assume):
   - **An MCP converter**, if the tool exposes one (e.g. `markitdown-mcp`,
     `docling-mcp`) — zero install, preferred on an MCP-capable host.
   - **MarkItDown** (Microsoft) — broadest coverage (PDF, Office, HTML, images,
     URLs): `markitdown <file> -o out.md`. Fast; shallow on complex tables.
   - **Pandoc** — excellent for Office/HTML/EPUB (headings, tables preserved):
     `pandoc <file> -t gfm -o out.md`. Not for PDFs.
   - **Docling** (IBM) — when tables, formulas, multi-column, or scanned pages
     matter and the above output is garbled: `docling <file> --to md`.
   (Exact flags vary by version — confirm with `--help`; universal {{LAW}} III.)
3. **For a URL**, convert the page to markdown (MarkItDown takes a URL; or use the
   tool's own web-fetch) rather than pasting raw HTML.
4. **Never install a converter silently.** They are external dependencies and the
   host's choice. If none is available, report which one to install and stop — do
   not run `pip install`/`brew install` without the user's say-so.
5. **Read the slice you need**, not the whole dump — locate the relevant section in
   the markdown, then read it (universal {{LAW}} XV).
6. **Treat the converted file as a scratch artifact.** Don't commit it unless the
   task calls for it (universal {{LAW}} IV); prefer a temp path or `.gitignore` it.

## Done when
- The document's content is available as markdown and the slice the task needs has
  been read — without reading the binary or committing a stray conversion.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
