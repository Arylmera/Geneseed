# Geneseed — Setup Guide

From zero to a working harness. Pick the path that matches your tool, then configure
and verify. For the conceptual overview see the [README](README.md); for OpenCode
internals see [adapters/opencode/](adapters/opencode/README.md).

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
guided, dependency-free wizard — it asks for a theme and install mode, runs the right
build, and offers a health check. It works on every OS. Prefer to do it by hand?
Pick a path below. Already installed and want to refresh first? **`./geneseed
bootstrap`** updates everything from upstream (sync + upgrade) and then runs the
wizard — one command, start to finish. Bare **`./geneseed`** does exactly this: it
asks for the upstream ref (default `main`), updates, and continues into setup, where
you pick the theme — so you never pass ref or theme on the command line.

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

- **MarkItDown** (Microsoft) — broadest (`pip install markitdown`), or its MCP server;
- **Pandoc** — excellent for Office/HTML (single binary);
- **Docling** (IBM) — best for complex tables / scanned PDFs.

The skill never installs a converter silently — if none is present it reports which to add.

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
