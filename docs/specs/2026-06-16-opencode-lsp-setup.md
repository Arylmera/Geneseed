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
- **SQL + PostgreSQL** → **not built-in.** One server covers both: Supabase's
  [postgres-language-server](https://github.com/supabase-community/postgres-language-server)
  (`postgrestools`, a single static Rust binary, Postgres-dialect-aware).
  Needs a custom `lsp` entry **and** the binary on PATH.

**Net:** of eight languages, OpenCode auto-handles six. The harness only has to
(a) emit the right config and (b) guarantee **two things on the machine: a
JDK 21+ and the `postgrestools` binary.**

## Fix

Three changes, smallest-diff first.

### Part 1 — emit the `lsp` block (config)

Add an `lsp` key to `adapters/opencode/opencode.json`. Object form *merges*
with OpenCode's built-in defaults, so the built-ins (typescript, pyright,
jdtls) stay enabled and we only declare the one server OpenCode doesn't ship:

```json
"lsp": {
  "postgres": {
    "command": ["postgrestools", "lsp-proxy"],
    "extensions": [".sql"]
  }
}
```

Place it as a top-level sibling of `permission` / `mcp` in
[opencode.json](../../adapters/opencode/opencode.json). This single key is what
flips LSP on at all (it defaults off).

> **Verify the merge assumption.** OpenCode merges `lsp` over its built-in
> defaults — an object key adds/overrides one server and leaves the rest on.
> Confirm in the test below by opening a `.ts` and a `.py` file and checking
> the server starts. **If** a future OpenCode build *replaces* instead of
> merges, the fallback is to declare the built-ins explicitly too:
>
> ```json
> "lsp": {
>   "typescript": { "command": ["typescript-language-server", "--stdio"],
>                   "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"] },
>   "pyright":    { "command": ["pyright-langserver", "--stdio"],
>                   "extensions": [".py", ".pyi"] },
>   "jdtls":      { "command": ["jdtls"], "extensions": [".java"] },
>   "postgres":   { "command": ["postgrestools", "lsp-proxy"], "extensions": [".sql"] }
> }
> ```
>
> Prefer the one-line merge form; only fall back if the test proves it
> necessary. (ponytail: don't pre-declare what OpenCode already ships.)

Leave `OPENCODE_DISABLE_LSP_DOWNLOAD` **unset** — that's what lets the
built-in servers self-install. Nothing to do; just don't disable it.

### Part 2 — the two machine prerequisites (check-and-hint)

OpenCode will fetch the JS-runtime servers itself, but it cannot install a JVM
or the `postgrestools` binary. The harness must surface those two so a fresh
machine ends up "all present."

**Approach: check-and-hint, not auto-install.** Detect each prerequisite and
print a one-line install command if missing. We do **not** build a
cross-platform installer for two binaries — that means owning package-manager
detection, sudo, and "wrong JDK already present" forever. (ponytail: a check
plus a printed command is the lazy correct version; auto-install is opt-in
later if onboarding friction proves it.)

Add a small pure helper and surface it in the setup wizard summary
([rituals/_harness_setup.py](../../rituals/_harness_setup.py), near
`_setup_summary_lines`):

```python
def _lsp_prereqs() -> list[tuple[str, bool, str]]:
    """(label, present, install-hint) for the two LSP prerequisites OpenCode
    cannot self-install. Pure detection — used by the wizard summary and the
    web Doctor surface."""
    import shutil, subprocess
    out = []
    # Java 21+ for jdtls
    java = shutil.which("java")
    ok = False
    if java:
        try:
            v = subprocess.run([java, "-version"], capture_output=True, text=True).stderr
            # "version "21.0.2"" or "version "1.8.0"" — first dotted number is the major
            import re
            m = re.search(r'version "(\d+)', v)
            ok = bool(m) and int(m.group(1)) >= 21
        except Exception:
            ok = False
    out.append(("Java 21+ (jdtls)", ok,
                "install a JDK 21+ — e.g. `brew install openjdk@21`, "
                "SDKMAN `sdk install java 21-tem`, or your distro's package"))
    # postgres-language-server for SQL/Postgres
    pg = shutil.which("postgrestools")
    out.append(("postgrestools (SQL/Postgres)", bool(pg),
                "install the Postgres language server — "
                "`npm i -g @postgrestools/postgrestools` or see "
                "https://pgtools.dev"))
    return out
```

Print it in the wizard's closing summary (only the missing ones need a hint;
present ones get a check mark in the theme's voice). The other six languages
need no line — they self-install on first use, so claiming nothing about them
is honest.

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
        "Geneseed turns this on and ships config for the languages most "
        "projects use.\n\n"
        "### What's covered out of the box\n\n"
        "| Language | Server | You install? |\n"
        "|---|---|---|\n"
        "| JavaScript / TypeScript / React / React Native | typescript-language-server | No — OpenCode self-downloads |\n"
        "| Python | pyright | No — OpenCode self-downloads |\n"
        "| Java | jdtls | **JDK 21+** (OpenCode downloads jdtls itself) |\n"
        "| SQL / PostgreSQL | postgrestools | **postgrestools binary** |\n\n"
        "React and React Native need no extra server — they are TS/JS, handled "
        "by the TypeScript server.\n\n"
        "### Two prerequisites the harness can't self-install\n\n"
        "OpenCode downloads the JS-runtime servers automatically on first use. "
        "It cannot install a JVM or the Postgres binary, so the setup wizard "
        "checks for these and prints an install hint if either is missing:\n\n"
        "- **Java 21+** — `brew install openjdk@21`, SDKMAN "
        "`sdk install java 21-tem`, or your distro's JDK.\n"
        "- **postgrestools** — `npm i -g @postgrestools/postgrestools` "
        "(see pgtools.dev).\n\n"
        "### How it's wired\n\n"
        "The `lsp` key in your emitted `opencode.json` enables LSP (off by "
        "default) and registers the Postgres server. The built-ins stay on by "
        "default. To turn auto-download off (air-gapped machines), set "
        "`OPENCODE_DISABLE_LSP_DOWNLOAD=true` and pre-install each server.\n\n"
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
  short "Language servers (LSP)" subsection: the tier table, the two
  prerequisites, the JSON block. This is the canonical reference the web group
  condenses.

## Files touched

| File | Change |
|---|---|
| `adapters/opencode/opencode.json` | add the `lsp` key (Part 1) |
| `rituals/_harness_setup.py` | `_lsp_prereqs()` + summary lines (Part 2) |
| `rituals/_web_core.py` | new `"lsp"` group in `DOC_GROUPS` (Part 3) |
| `SETUP.md` | `OPENCODE_DISABLE_LSP_DOWNLOAD` under Environment knobs |
| `adapters/opencode/README.md` | "Language servers (LSP)" subsection |
| `tests/` | one test for `_lsp_prereqs()` shape + one for the emitted `lsp` key |

## Test / verify

1. **Unit (pure):** `_lsp_prereqs()` returns two `(label, bool, hint)` tuples;
   the Java major-version parse handles both `"21.0.2"` and legacy `"1.8.0"`
   (→ not ok). Add to the existing harness test module.
2. **Emit check:** after `python build.py --emit opencode --target <tmp>`, the
   emitted `opencode.json` contains `lsp.postgres.command == ["postgrestools",
   "lsp-proxy"]`. (Add as a small assertion in the build test.)
3. **Live merge check (manual, the one assumption to confirm):** install with
   the merge-form config, open a `.ts` and a `.py` file in OpenCode — confirm
   `typescript` and `pyright` still start (proves object-form merges, not
   replaces). If they don't, switch to the explicit fallback block in Part 1.
4. **SQL check (manual):** with `postgrestools` on PATH, open a `.sql` file —
   the `postgres` server starts and reports diagnostics.
5. **Doctor unaffected:** `geneseed doctor` still passes — LSP is not a build
   concern, so no new doctor failures.

## Deliberately skipped

- **Auto-installing JDK / postgrestools.** Check-and-hint is enough; revisit
  only if onboarding friction proves it. (ponytail)
- **A per-language `lsp` map.** The merge default covers six languages in one
  line; declaring each server is redundant unless the merge assumption breaks.
- **Extra servers** (eslint LSP, a second SQL dialect server, etc.). Not
  requested; YAGNI. Add when a user actually needs one — the custom-server
  pattern in Part 1 is the template.
- **A page per language in the web.** One overview page is the section; split
  only if it grows.

## Sources

- [OpenCode LSP docs](https://opencode.ai/docs/lsp/)
- [OpenCode config](https://opencode.ai/docs/config/)
- [postgres-language-server](https://github.com/supabase-community/postgres-language-server) · [pgtools.dev](https://pgtools.dev)
