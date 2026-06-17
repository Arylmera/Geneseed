# OpenCode LSP — ship code intelligence with the harness

**Date:** 2026-06-16
**Status:** draft

## Problem

The harness wires OpenCode's *context* (AGENT.md, plugins, MCP) but leaves
**code intelligence** off. OpenCode can drive Language Server Protocol (LSP)
servers — feeding real diagnostics, go-to-def, and type errors back to the
agent — but LSP is **disabled by default** and the config we emit
(`adapters/opencode/opencode.json`) has no `lsp` key. So a fresh install gets
no semantic feedback for any language.

We want a one-install experience where, after `geneseed setup`, the agent has
working LSP for the languages the user actually uses:
**Java, JavaScript, TypeScript, Python, SQL, PostgreSQL, React JS, React
Native**.

## How OpenCode LSP actually works (the constraint that shapes everything)

OpenCode splits servers into three tiers. The tier decides what *we* ship vs.
what OpenCode handles itself:

| Tier | OpenCode's behaviour | Machine prerequisite |
|---|---|---|
| **Built-in, self-downloading** | Downloads the server binary itself on first matching file-open, using its bundled runtime — unless `OPENCODE_DISABLE_LSP_DOWNLOAD=true` | none |
| **Built-in, needs a host runtime** | Downloads the server, but the server runs on a VM/runtime we must provide | that runtime |
| **Not built-in** | Nothing — we add a custom `lsp` entry **and** the binary must be on PATH | the binary |

Mapping our eight languages:

- **JavaScript · TypeScript · React JS · React Native** → **one server for all
  four**, `typescript-language-server`. Built-in, self-downloads. Its default
  extension set is `.ts .tsx .js .jsx .mjs .cjs .mts .cts` — so plain
  JavaScript and React JS (`.js/.jsx`) are covered with no `.js`-only gap, and
  React / React Native need **no separate server** (they are TS/JS, JSX
  included). **One server, zero install work.** The only case that ever needs a
  *second* JS-family server is Deno, which OpenCode deliberately routes away
  from the TS server via lockfile detection — out of scope here.
- **Python** → `pyright`. Built-in, self-downloads (runs on OpenCode's bundled
  node, so it works even without system Python). **Zero install work.**
- **Java** → `jdtls`. Built-in, OpenCode downloads the jar — but jdtls runs on
  a JVM, so the machine needs **JDK 21+**. This is the one unavoidable runtime
  prerequisite.
- **SQL + PostgreSQL** → **not built-in, and deliberately left without a
  server.** See "SQL: no LSP, on purpose" below. There is no SQL LSP in this
  spec.

**Net:** of eight languages, OpenCode auto-handles six (JS/TS/React/RN +
Python + Java) and SQL/Postgres is intentionally uncovered. The harness only
has to (a) emit the `lsp` enable flag and (b) guarantee **one thing on the
machine: a JDK 21+** (for jdtls).

## SQL: no LSP, on purpose

We considered Supabase's `postgrestools` (a Postgres-dialect LSP) for `.sql`,
then dropped it. Reasoning, recorded so it isn't re-litigated:

- **A SQL server is dialect-locked.** `postgrestools` parses with
  `libpg_query` (the actual Postgres parser), so it only understands Postgres.
  Point it at Oracle/PL-SQL and `VARCHAR2`, `NUMBER`, `DUAL`, `(+)` joins,
  `CONNECT BY`, and packages all read as syntax errors — *worse than no LSP*.
  The same is true in reverse for an Oracle server on Postgres files.
- **`.sql` can hold only one server.** OpenCode routes a server by file
  extension, and both dialects live in `.sql` with no per-file dialect signal.
  So you cannot register Postgres **and** Oracle for `.sql` — it's one or the
  other.
- **Oracle has no clean server anyway.** No OpenCode built-in; the PL/SQL
  servers that exist ([plsqllang-server](https://github.com/EwanDubashinski/plsqllang-server),
  [zabel-xyz/plsql-language](https://github.com/zabel-xyz/plsql-language)) are
  JVM/VSCode-extension-bound, not standalone auto-installing binaries — another
  JDK dependency for weak diagnostics.

**Decision:** because `.sql` can carry only one dialect's server and we can't
assume which dialect a given repo uses, **we ship none.** Picking Postgres
would silently mis-flag every Oracle codebase (and vice versa); shipping
nothing is the honest default. A project that knows its dialect can add the
matching server itself via the custom-`lsp` pattern (template in "Deliberately
skipped").

## Fix

Three changes, smallest-diff first.

### Part 1 — emit the `lsp` enable flag (config)

With no custom server to register, enabling LSP is one line. Add to
[opencode.json](../../adapters/opencode/opencode.json) as a top-level sibling
of `permission` / `mcp`:

```json
"lsp": true
```

`true` enables **all** built-in servers — which is exactly our covered set:
typescript (JS/TS/React/RN), pyright (Python), jdtls (Java). LSP defaults
**off**, so this flag is what turns it on at all. SQL stays uncovered because
there is no built-in SQL server (and we add none — see "SQL: no LSP, on
purpose"). (ponytail: one line beats an object that just re-declares the
built-ins.)

Leave `OPENCODE_DISABLE_LSP_DOWNLOAD` **unset** — that's what lets the
built-in servers self-install. Nothing to do; just don't disable it.

### Part 2 — the one machine prerequisite (check-and-hint)

OpenCode fetches the JS-runtime servers itself, but it cannot install a JVM,
and jdtls needs one. JDK 21+ is the only thing the harness must surface so a
fresh machine ends up "all present."

**Approach: check-and-hint, not auto-install.** Detect it and print a one-line
install command if missing. We do **not** build a cross-platform JDK installer
— that means owning package-manager detection, sudo, and "wrong JDK already
present" forever. (ponytail: a check plus a printed command is the lazy correct
version; auto-install is opt-in later if onboarding friction proves it.)

Add a small pure helper and surface it in the setup wizard summary
([rituals/_harness_setup.py](../../rituals/_harness_setup.py), near
`_setup_summary_lines`):

```python
def _lsp_prereqs() -> list[tuple[str, bool, str]]:
    """(label, present, install-hint) for the LSP prerequisites OpenCode cannot
    self-install. Today that's just a JDK for jdtls. Pure detection — used by
    the wizard summary and the web surface."""
    import shutil, subprocess, re
    java = shutil.which("java")
    ok = False
    if java:
        try:
            v = subprocess.run([java, "-version"], capture_output=True, text=True).stderr
            # "version "21.0.2"" or legacy "version "1.8.0"" — first number is the major
            m = re.search(r'version "(\d+)', v)
            ok = bool(m) and int(m.group(1)) >= 21
        except Exception:
            ok = False
    return [("Java 21+ (jdtls)", ok,
             "install a JDK 21+ — e.g. `brew install openjdk@21`, "
             "SDKMAN `sdk install java 21-tem`, or your distro's package")]
```

Print it in the wizard's closing summary (the hint only when it's missing; a
check mark in the theme's voice when present). The other languages need no line
— they self-install on first use, and SQL is uncovered by design, so claiming
nothing about them is honest. The function returns a list so a future prereq
(e.g. if a SQL server is ever added) drops in without changing callers.

This is **advisory**, run at setup time. The build-validation `geneseed doctor`
stays about the *build* (tokens, links, drift); LSP prerequisites are a
machine concern and belong in the setup summary, not the build check.

### Part 3 — documentation (a dedicated LSP web section)

**This part is data-only — zero `.jsx` changes.** The web docs system keys
everything (nav menu, page render, "On this page" TOC, and global Spotlight
search) off the single `DOC_GROUPS` registry. Verified against the code:

- A `kind: "concept"` page needs only `id` / `title` / `body` / optional
  `link` — [_web_docs.py:219](../../rituals/_web_docs.py). No new page kind.
- Tables render: the renderer is `marked` v12
  ([Markdown.jsx](../../web/src/components/Markdown.jsx)), GFM tables on by
  default.
- TOC is automatic when a page has ≥3 headings
  ([MarkdownPage.jsx:196](../../web/src/pages/Docs/MarkdownPage.jsx)) — the page
  below has three `###`, so it gets one free.
- The page is auto-indexed for Spotlight search
  ([useSearchIndex.js:72](../../web/src/hooks/useSearchIndex.js)) at route
  `#/docs/lsp-overview` — no extra wiring.
- The `link` field renders as a footer button
  ([MarkdownPage.jsx:218](../../web/src/pages/Docs/MarkdownPage.jsx)).
- Do **not** add a `tryActions` button — those are hardcoded per page-id and
  map to `doctor`/`build`/`update`; LSP prereqs aren't a doctor check, so a
  button there would mislead.

Add a **dedicated LSP group** to
[`DOC_GROUPS` in rituals/_web_core.py](../../rituals/_web_core.py), placed
**between the `"mcp"` group and the `"plugins"` group** so the nav reads as a
capability cluster — *MCP servers → Language servers → Plugins*, the three
things OpenCode loads:

```python
{"id": "lsp", "label": "Language servers", "pages": [
    {"id": "lsp-overview", "title": "Code intelligence (LSP)", "kind": "concept",
     "body": (
        "OpenCode can drive Language Server Protocol servers so the agent sees "
        "real diagnostics, type errors, and go-to-definition — not just text. "
        "Geneseed turns this on for every language OpenCode ships a server for.\n\n"
        "### What's covered out of the box\n\n"
        "| Language | Server | You install? |\n"
        "|---|---|---|\n"
        "| JavaScript / TypeScript / React / React Native | typescript-language-server | No — OpenCode self-downloads |\n"
        "| Python | pyright | No — OpenCode self-downloads |\n"
        "| Java | jdtls | **JDK 21+** (OpenCode downloads jdtls itself) |\n"
        "| SQL / PostgreSQL / Oracle | *none — by design* | — |\n\n"
        "One server covers JavaScript, TypeScript, React, and React Native — "
        "they are all TS/JS, so no extra server is needed.\n\n"
        "### The one prerequisite the harness can't self-install\n\n"
        "OpenCode downloads the JS-runtime servers automatically on first use. "
        "It cannot install a JVM, and jdtls needs one — so the setup wizard "
        "checks for it and prints an install hint if missing:\n\n"
        "- **Java 21+** — `brew install openjdk@21`, SDKMAN "
        "`sdk install java 21-tem`, or your distro's JDK.\n\n"
        "### Why no SQL server\n\n"
        "A SQL language server is dialect-locked — a Postgres server flags "
        "Oracle SQL as errors and vice versa — and a `.sql` file can map to "
        "only one server, with no signal for which dialect a repo uses. Rather "
        "than guess wrong for half of all SQL codebases, we ship none. A "
        "project that knows its dialect can add the matching server in its own "
        "`opencode.json` under the `lsp` key.\n\n"
        "### How it's wired\n\n"
        "`\"lsp\": true` in your emitted `opencode.json` enables every built-in "
        "server (LSP is off by default). To turn auto-download off (air-gapped "
        "machines), set `OPENCODE_DISABLE_LSP_DOWNLOAD=true` and pre-install "
        "each server.\n\n"
        "---\n\n"
        "**Verify:** open a `.ts` and a `.py` file in a session and ask the "
        "agent for diagnostics — the first open triggers the download."),
     "link": {"hash": "#/docs/adapters-opencode", "label": "OpenCode adapter →"}},
]},
```

Also, in two canonical long-form sources (kept in sync because the web slices
them):

- **`SETUP.md` → "Environment knobs"** — add a one-liner for
  `OPENCODE_DISABLE_LSP_DOWNLOAD` (the web `env-knobs` page slices this
  anchor, so it appears there for free).
- **[adapters/opencode/README.md](../../adapters/opencode/README.md)** — a
  short "Language servers (LSP)" subsection: the coverage table, the JDK
  prerequisite, the `"lsp": true` flag, and the "no SQL server" rationale. This
  is the canonical reference the web group condenses.

## Files touched

| File | Change |
|---|---|
| `adapters/opencode/opencode.json` | add `"lsp": true` (Part 1) |
| `rituals/_harness_setup.py` | `_lsp_prereqs()` + summary line (Part 2) |
| `rituals/_web_core.py` | new `"lsp"` group in `DOC_GROUPS` (Part 3) |
| `SETUP.md` | `OPENCODE_DISABLE_LSP_DOWNLOAD` under Environment knobs |
| `adapters/opencode/README.md` | "Language servers (LSP)" subsection |
| `tests/` | one test for `_lsp_prereqs()` shape + one for the emitted `lsp` flag |

## Test / verify

1. **Unit (pure):** `_lsp_prereqs()` returns one `(label, bool, hint)` tuple;
   the Java major-version parse handles both `"21.0.2"` (→ ok) and legacy
   `"1.8.0"` (→ not ok). Add to the existing harness test module.
2. **Emit check:** after `python build.py --emit opencode --target <tmp>`, the
   emitted `opencode.json` has `lsp == true`. (Add as a small assertion in the
   build test.)
3. **Live check (manual):** install, open a `.ts` and a `.py` file in OpenCode
   — confirm `typescript` and `pyright` start (first open triggers the
   download). With a JDK present, a `.java` file starts jdtls.
4. **Doctor unaffected:** `geneseed doctor` still passes — LSP is not a build
   concern, so no new doctor failures.

## Deliberately skipped

- **Any SQL server.** `.sql` maps to one server and SQL is dialect-locked, so
  shipping Postgres would mis-flag Oracle codebases and vice versa — we ship
  none. A project adds its own dialect's server if it wants one. (See "SQL: no
  LSP, on purpose".)
- **Auto-installing the JDK.** Check-and-hint is enough; revisit only if
  onboarding friction proves it. (ponytail)
- **A per-language `lsp` map.** `"lsp": true` covers every built-in in one
  line; declaring each server is redundant.
- **Extra servers** (eslint LSP, etc.). Not requested; YAGNI. A project adds
  one in its own `opencode.json` `lsp` key when it actually needs it.
- **A page per language in the web.** One overview page is the section; split
  only if it grows.

## Sources

- [OpenCode LSP docs](https://opencode.ai/docs/lsp/)
- [OpenCode config](https://opencode.ai/docs/config/)
- [OpenCode language registry (sst/opencode)](https://github.com/sst/opencode/blob/dev/packages/opencode/src/lsp/server.ts)
- Oracle LSP options (weak / not standalone): [plsqllang-server](https://github.com/EwanDubashinski/plsqllang-server), [zabel-xyz/plsql-language](https://github.com/zabel-xyz/plsql-language)
