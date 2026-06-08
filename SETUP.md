# Geneseed — Setup Guide

From bare repository to a disciplined agent in a few minutes. You pick a **theme** —
the voice and vocabulary the harness wears — and an **install mode**; the build implants
the gene-seed and the agent wakes speaking in that voice. Pick the path that matches your
tool, then configure and verify. For the conceptual overview see the [README](README.md);
for OpenCode internals see [adapters/opencode/](adapters/opencode/README.md).

## Prerequisites

- **Python 3** — to run `build.py` / `harness.py`. Stdlib only; nothing to `pip install`.
- **git** — to obtain and upgrade the harness.
- **Your agent tool** — OpenCode (recommended), Claude Code, or anything that reads a
  root instructions file.
- *Optional:* **Node** — only to run `doctor`'s plugin syntax check while developing
  (OpenCode runs the plugins itself). **`gh`** — only for the maintainer publish flow.
- *Optional, for the `ingest` skill:* a document converter — **MarkItDown**, Pandoc,
  or Docling — if you want the agent to read PDFs/Office files (see
  [Reading non-markdown docs](#reading-non-markdown-docs)).

## Choose your path

**Easiest:** run `./geneseed setup` (or `python rituals/harness.py setup`) for a
guided, dependency-free wizard — a colored curses form on a Unix terminal (plain
text prompts elsewhere). As you move through the theme picker it **previews each
theme live** — its tagline, loaded-sigil, and voice — so you hear the flavour before
you choose; once you pick, the wizard speaks in that theme's accent through confirm
and build, and the install ends on the theme's own **banner and benediction**. It
asks for a theme and install mode, runs the right build, and offers a health check.
It works on every OS. Prefer to do it by hand?
Pick a path below. Already installed? Bare **`./geneseed`** opens an interactive
**main menu** — choose *Update & set up*, *Set up / re-theme*, *Browse*, *Health
check*, *Build*, *Diff*, or *Settings* (a submenu for MCP servers — toggle MarkItDown
& other MCP servers into your OpenCode config — the PATH install, and uninstall) and it
runs that flow. **`./geneseed bootstrap`** jumps
straight to update-then-setup; **`./geneseed setup`** straight to the wizard.

| Path | Use when |
| --- | --- |
| [A — OpenCode, global](#path-a--opencode-global-recommended) | **Recommended.** One install, every repo inherits it, nothing committed into projects. |
| [B — OpenCode, per-repo](#path-b--opencode-per-repo) | You want a committed `.opencode/` layer in one repository. |
| [C — Claude Code](#path-c--claude-code) | You drive Claude Code and want the lifecycle hooks. |
| [D — Any `AGENT.md` tool](#path-d--any-agentmd-tool) | Cursor, Aider, or any tool that reads a root instructions file. |
| [E — No Python on the target](#path-e--no-python-on-the-target) | The machine that *uses* the harness can't run Python. |

---

### Path A — OpenCode, global (recommended)

Installs the whole harness into OpenCode's config dir; every repo you open inherits it.

```
# from inside the Geneseed folder
python build.py --emit opencode-global            # add --theme imperial for the 40k voice
export GENESEED_HARNESS="$HOME/.config/opencode"  # so the learn plugin finds the memory store
echo 'export GENESEED_HARNESS="$HOME/.config/opencode"' >> ~/.zshrc
```

This writes into `$OPENCODE_CONFIG_DIR` (else `$XDG_CONFIG_HOME/opencode`, else
`~/.config/opencode`): `AGENT.md`, `agents/`, `skills/<name>/SKILL.md`, a single
`plugins/` copy, the `memory/` store, and a merged `opencode.json` pointing
`instructions` at the absolute `AGENT.md`. No `context.json` — the context plugin
auto-discovers each repo's docs.

It is **non-destructive**: a `.geneseed-manifest.json` tracks only the files it owns
and prunes stale ones on re-emit; your own agents/skills/plugins and the memory store
are never touched. Full design + checklist:
[GLOBAL-HARNESS-SPEC.md](adapters/opencode/GLOBAL-HARNESS-SPEC.md).

### Path B — OpenCode, per-repo

```
python build.py --emit opencode --target /path/to/your-repo
```

Writes `opencode.json` + `.opencode/{agents,skills,plugins}` into the repo. Commit
them or not. **Bundle in a subfolder?** add `--root` so instruction paths resolve
from the project root:

```
python build.py --emit opencode --out /path/to/repo/Harness --root /path/to/repo
```

Depth, native mapping, and the manual fallback: [adapters/opencode/](adapters/opencode/README.md).

### Path C — Claude Code

Merge [`adapters/claude-code/settings.json`](adapters/claude-code/settings.json) into
your repo's `.claude/settings.json` (paths assume the bundle is at the repo root).
It wires:

- **SessionStart** (`startup`/`clear`) — prints `AGENT.md` and injects the project
  context (`harness context`, which auto-discovers the repo's docs);
- **SessionStart** (`resume`) — refreshes the project context only, without re-printing
  the static `AGENT.md`;
- **Stop** — runs `harness learn` to capture durable memory. Opt in by setting
  `GENESEED_LLM` (e.g. `claude -p`); unset, it's a harmless no-op. Geneseed never
  embeds an API key.

Detail: [adapters/claude-code/](adapters/claude-code/README.md).

### Path D — Any `AGENT.md` tool

```
python build.py                       # renders the plain bundle to ./Harness
```

Point your tool's instructions/rules setting at `Harness/AGENT.md`. If the tool only
auto-loads a specific name, rename or symlink (`AGENT.md` → `AGENTS.md` / `CLAUDE.md`).
The rules work on agent self-discipline alone; the plugins (context, memory) are an
OpenCode convenience.

### Path E — No Python on the target

A maintainer runs, once, on a machine that *has* Python:

```
python rituals/harness.py prompt --theme neutral > install-geneseed.md
```

That emits a self-contained prompt that recreates the entire file tree verbatim.
Paste it into any capable agent on the target machine — no Python, no build step.

---

## Configure

### Theme

Choose any theme in `themes/` — `neutral` (plain), `imperial` (Warhammer 40k),
`military`, `pirate`, `wizard`, `cyberpunk`, `gamer`, or `sports` (play-by-play) —
with `--theme NAME` (the wizard lists them for you). It is remembered in a `.geneseed-theme` marker, so later
upgrades keep it. Adding your own is one JSON file of voice tokens; `doctor` checks
every theme defines the same keys.

### Project context (usually nothing)

On OpenCode the context plugin auto-discovers a repo's docs every session:

- **Eager** (injected in full, budget-capped): root `AGENTS.md`/`AGENT.md`/`CLAUDE.md`/
  `.cursorrules`, `README.md`, `CONTRIBUTING.md`.
- **Lazy** (listed, read on demand): `docs/`, `doc/`, `documentation/`, `architecture/`,
  `adr/`, monorepo `packages/*/README.md`, other root `*.md`. `node_modules`, `.git`,
  `dist`, … are never scanned.

Override only when the convention doesn't fit — drop a `.harness/context.json` (or
`./context.json`, or point `$GENESEED_CONTEXT`):

```json
{
  "extend": true,
  "context": [
    { "path": "docs/house-rules.md", "load": "eager", "description": "Branch policy, DoD." },
    { "path": "docs/**/*.md", "load": "lazy" },
    { "path": "internal/secrets.md", "load": "exclude" }
  ]
}
```

`path` is absolute, repo-relative, or a glob; `load` is `eager` | `lazy` | `exclude`;
`"extend": true` layers the manifest on top of discovery. Schema:
[GLOBAL-HARNESS-SPEC.md §3](adapters/opencode/GLOBAL-HARNESS-SPEC.md).

### Memory

Durable facts live as one-file-per-fact under the memory store, indexed by `MEMORY.md`
(git-ignored — personal to the machine). The learn plugin writes to the first that
resolves: `$GENESEED_MEMORY` → `$GENESEED_HARNESS/memory` → `./memory` or
`./Harness/memory`. For a global install, set `GENESEED_HARNESS` once (Path A).
Convention: [src/memory/README.md](src/memory/README.md).

### Reading non-markdown docs

The `ingest` skill teaches the agent to convert a PDF/Word/PPTX/Excel/HTML file or a
URL to markdown before reading it — discovery and the read-the-docs law only see
markdown. Install one converter and the skill uses it:

- **MarkItDown** (Microsoft) — broadest (`pip install markitdown`), or its MCP server
  (see [MarkItDown via MCP](#markitdown-via-mcp-opencode) below — preferred on an
  MCP-capable host: zero per-call install, one low-cost tool);
- **Pandoc** — excellent for Office/HTML (single binary);
- **Docling** (IBM) — best for complex tables / scanned PDFs.

The skill never installs a converter silently — if none is present it reports which to add.

#### MarkItDown via MCP (OpenCode)

Wire Microsoft's MarkItDown in as a **local MCP server** so the agent can convert
PDF / Word / Excel / PowerPoint / HTML → Markdown on demand, exposing a single tool
`convert_to_markdown(uri)` (`uri` accepts `file:`, `http:`, `https:`, or `data:`).
The server runs locally and, once installed, does not hit PyPI again.

**1. Install the server** (pipx keeps it in its own venv):

```
brew install pipx && pipx ensurepath        # macOS;  Debian/Ubuntu: sudo apt install pipx && pipx ensurepath
pipx install markitdown-mcp
markitdown-mcp --help                        # verify it resolves
```

Optional OCR / image / audio extras (must land in the *same* venv):
`pipx inject markitdown-mcp "markitdown[all]"` — needed for scanned/image-only PDFs,
which otherwise return empty.

**2. Corporate TLS (only on a network with SSL inspection).** pipx uses **uv** as its
backend; uv ships its own root CAs and ignores the OS trust store, so a proxy's
internal CA fails with `invalid peer certificate: UnknownIssuer`. Point uv at the OS
trust store *before* installing — don't disable verification:

```
echo 'export UV_SYSTEM_CERTS=true' >> ~/.zshrc && source ~/.zshrc   # older uv: UV_NATIVE_TLS=true
# fallback: export SSL_CERT_FILE=/path/to/corporate-root-ca.pem
```

**3. Register it in `opencode.json`** — Geneseed's
[`adapters/opencode/opencode.json`](adapters/opencode/opencode.json) already carries
this block; merge it into your config (global `~/.config/opencode/opencode.json` or
per-repo) under the `mcp` key, alongside any servers you already have:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "markitdown": { "type": "local", "command": ["markitdown-mcp"], "enabled": true }
  }
}
```

If `markitdown-mcp` is not on PATH in the shell OpenCode launches from, use the
zero-install uv form instead: `"command": ["uvx", "markitdown-mcp"]`.

Prefer not to hand-edit JSON? `./geneseed` → **Settings** → **MCP servers** toggles this exact block
into your project or global `opencode.json` (and enables/disables it) for you.

**4. Verify.** Restart OpenCode, then `opencode mcp` should list `markitdown` connected.
The `ingest` skill auto-prefers an MCP converter when one is exposed, so a prompt like
*"convert file:///path/to/spec.pdf to markdown"* now just works.

### Environment knobs

| Variable | Used by | Effect |
| --- | --- | --- |
| `GENESEED_HARNESS` | learn plugin | base whose `memory/` the plugin writes to (set for a global install) |
| `GENESEED_MEMORY` | learn plugin / CLI | explicit memory dir (overrides the above) |
| `GENESEED_CONTEXT` | context plugin / CLI | explicit `context.json` path |
| `GENESEED_ROOT` | `harness context` | repo root to discover docs from (default: cwd) |
| `GENESEED_MODEL` | learn plugin | `provider/model` fallback if the session model can't be read |
| `GENESEED_LLM` | `harness learn` (Claude) | model CLI for distillation, e.g. `claude -p` |
| `GENESEED_EMIT` | `upgrade.sh` | `opencode-global` \| `opencode` \| unset (plain bundle) |
| `GENESEED_OUT` / `GENESEED_ROOT` | `upgrade.sh` | bundle / project-root locations |
| `GENESEED_DEBUG` | context plugin | `1` re-enables discovery/inject logs |
| `GENESEED_CONTEXT_INJECT` | context plugin | `off` disables the injected block (rely on the AGENT.md law) |
| `GENESEED_EAGER_FILE_KB` / `_TOTAL_KB` | context plugin | per-file / total eager injection budget (default 16 / 48) |
| `GENESEED_LAZY_HEADINGS` | context plugin | cap on lazy-file heading reads per session (default 64) |
| `GENESEED_LEARN_DEBOUNCE_MS` | learn plugin | quiet period before distilling (default 60000) |
| `OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME` | global emit | where the global install is written |

---

## Verify it works

1. **Sigil** — the agent's first reply opens with the readiness line (the `✅`/`🧬`
   sigil for neutral/imperial). If it's missing, the instructions aren't pointed at
   `AGENT.md`.
2. **Context (OpenCode)** — start a session; with `GENESEED_DEBUG=1` the context
   plugin logs what it discovered and injected.
3. **Memory (OpenCode)** — do a little work and end the session; after the debounce
   the learn plugin logs `wrote N memory file(s)` or a skip reason to stderr. Total
   silence means it didn't load — re-check the filename, `.js` extension, and that it
   sits in the plugins dir.
4. **Harness health** — `python rituals/harness.py doctor` should print `ok`.

On a Unix terminal, `./geneseed tui` opens a two-pane, colorized panel — agents,
skills, and laws listed on the left, the selected item's full spec on the right
(PgUp/PgDn to scroll it) — and runs build/doctor/diff (and `u` to update) with a
keystroke.

### Optional: a modern panel (Textual)

The panel above is the **dependency-free** stdlib `curses` UI — it needs nothing
installed and is the default. If you want a richer, mouse-driven panel — Markdown-
rendered specs, a command palette, smoother scrolling, and (bonus) a TUI **on Windows**
too — install the optional [Textual](https://textual.textualize.io/) front-end:

```
pip install textual          # optional; the harness stays dependency-free without it
```

With Textual present, `./geneseed` and `./geneseed tui` use it automatically; remove it
(or set `GENESEED_TUI_CURSES=1`) to fall back to the classic curses panel. Either way,
`setup` / `bootstrap` / `build` / `doctor` always run on a bare `python3` — Textual only
ever powers the *browse/menu* experience, never the install path. Appearance of the
curses panel is still tunable with `GENESEED_TUI_PLAIN=1` (calm, no emoji/animation) and
`GENESEED_TUI_ASCII=1` (pure ASCII, for fonts that tofu box-drawing).

## Run `geneseed` from anywhere

By default you invoke the launcher as `./geneseed` from inside the repo. To call it
like any other command — plain `geneseed` from any directory — put it on your `PATH`:

```
./geneseed link                    # symlink into ~/.local/bin (no sudo); pass a dir to override
./geneseed link /usr/local/bin     # e.g. a system-wide bin dir (may prompt for sudo)
```

(Or, in the TUI: `./geneseed` → **Settings** → **Run from anywhere** / **Remove from PATH**.)

`link` creates a symlink to the launcher and tells you whether the target dir is on
your `PATH` (and, if not, the one line to add it). The launcher resolves symlinks, so
it still finds `rituals/harness.py` and the sibling scripts no matter where the link
lives. Once it's on `PATH`, drop the `./`:

```
geneseed            # the interactive main menu, from any directory
geneseed build      # …and every subcommand
```

Remove the symlink with `./geneseed unlink` (it clears `geneseed` links from `PATH`
and the common bin dirs). Prefer a shell function over a symlink? Add one to your rc
instead — it does the same job:

```
echo 'geneseed() { "'"$PWD"'/geneseed" "$@"; }' >> ~/.zshrc   # or ~/.bashrc
```

## Upgrade

```
./geneseed upgrade                 # track main; keep the remembered theme + emit mode
./geneseed upgrade v0.1.0          # pin to a tag
./geneseed upgrade main imperial   # force a theme
```

It downloads the published source, validates it (a blocking `doctor` pass), then
re-renders in place — leaving host state (memory, `context.json`, markers) untouched.
Theme and emit mode are remembered between runs. Or do it all in one:
`./geneseed update` chains sync-self + upgrade, and `./geneseed bootstrap` then
continues into the setup wizard. (To refresh only the launcher and upgrade scripts:
`./geneseed sync-self`.)

**Reviewing local edits** — if you tweaked the deployed harness in place and want to
see what diverged from source (to back-port):

```
./geneseed diff            # --full for line-level diffs
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No readiness sigil | Instructions not pointed at `AGENT.md` — check `opencode.json` `instructions` (or your tool's rules setting). |
| `PROJECT CONTEXT` block appears twice | Two copies of the context plugin (global + a leftover `.opencode/plugins/`). Remove the project copy. |
| Learn plugin silent / no memory written | Set `GENESEED_HARNESS` (or `GENESEED_MEMORY`); confirm the `.js` files are in the plugins dir. |
| `could not determine a model` | Set `GENESEED_MODEL=provider/model`. |
| PDFs / Office docs ignored | Use the `ingest` skill and install a converter (MarkItDown / Pandoc / Docling). |
| A "read-only" agent won't run a command | By design — read-only agents are denied `bash`. Agents that must run read-only commands (reviewer, security) allow it via a spec marker. |
| Skills not tracked in git | A parent `.gitignore` blanket-ignores the bundle dir — remove the bare `Harness/` line; the bundle's own `.gitignore` scopes correctly. |

More OpenCode-specific notes (why a file loads twice, plugin loading): [HOW-OPENCODE-LOADS.md](adapters/opencode/HOW-OPENCODE-LOADS.md).
