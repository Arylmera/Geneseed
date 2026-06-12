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

**Easiest:** run the guided wizard — `./geneseed setup` on macOS/Linux,
`.\geneseed.cmd setup` on Windows (or `python rituals/harness.py setup` anywhere).
It is dependency-free: a colored full-screen form on any VT-capable terminal (Unix,
or Windows Terminal / Windows 10 1809+ `conhost`), plain text prompts on older
consoles or off a TTY. It asks for a theme and an install mode, runs the right
build, and offers a health check.

As you move through the theme picker the wizard **previews each theme live** — its
tagline, loaded-sigil, and voice — so you hear the flavour before you choose; once
you pick, it speaks in that theme's accent through confirm and build, and the
install ends on the theme's own **banner and benediction**.

**Already installed?** Bare **`./geneseed`** (Windows: `.\geneseed.cmd`) opens the
interactive **main menu**: *Browse*, *Review local edits*, *Refresh / set up*,
*Update only*, *Update & set up*, *Rebuild bundle*, *Memory*, *Status*, and
*Settings* — a submenu for MCP servers (toggle the MarkItDown, GitLab, and
Filesystem presets into your OpenCode config), the PATH install, and uninstall.
**`./geneseed bootstrap`** jumps straight to update-then-setup; **`./geneseed setup`**
straight to the wizard. Prefer to do it by hand? Pick a path below.

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
# GENESEED_HARNESS is optional — the learn plugin auto-locates the in-config memory
# store. Set it only to pin the location explicitly (and persist it to your rc):
export GENESEED_HARNESS="$HOME/.config/opencode"
echo 'export GENESEED_HARNESS="$HOME/.config/opencode"' >> ~/.zshrc
```

**Windows (PowerShell)** — identical, no bash/WSL needed (`build.py` is pure Python):
```powershell
# from inside the Geneseed folder
python build.py --emit opencode-global            # add --theme imperial for the 40k voice
setx GENESEED_HARNESS "$env:USERPROFILE\.config\opencode"   # optional; pins the memory store
```
On Windows the config dir is the same homedir-relative path,
`C:\Users\<user>\.config\opencode` — OpenCode uses `~/.config/opencode` on every OS.

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
Any theme works the same way — substitute its name after `--theme`. The prompt is
always rendered fresh from `src/`, so it can never drift from the current harness.

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

**Delivery — invisible by default.** The plugin delivers the context by prepending
it to each outgoing request via OpenCode's `experimental.chat.messages.transform`
hook: nothing shows in the conversation, and the context survives compaction
inherently because it is re-sent per request. The hook is experimental — on an
OpenCode build that lacks it, the plugin notices the first time a request completes
without it and **falls back automatically** to the classic visible delivery (the
`PROJECT CONTEXT` block posted as a session message), so no build is ever left
without context; `GENESEED_DEBUG=1` logs the fallback when it engages. Prefer to
*see* what the agent received? Set `GENESEED_CONTEXT_VISIBLE=1` (persist with
`export` in your rc, or `setx` on Windows) to force the visible block up front —
legacy `GENESEED_CONTEXT_TRANSFORM=0`/`off` does the same, while `=1`, the old
opt-in, now simply matches the default. To drop injection entirely, set
`GENESEED_CONTEXT_INJECT=off` and rely on the AGENT.md law.

### Wiki — your own knowledge base (optional)

If you keep a personal knowledge base on this machine — an Obsidian vault, or any
folder of interlinked markdown — declare it once in **`wiki.jsonc`** and the agent
becomes a citizen of it: entry notes load each session (eager) or on demand (lazy),
and it reads *and writes* notes under your vault's own conventions (AGENT.md §7,
the `wiki` skill). Unlike `context.json` this is **per machine, not per repo**.

The build seeds `wiki.jsonc` beside `AGENT.md` (for a global install:
`~/.config/opencode/wiki.jsonc`) and never overwrites it. The file is **JSONC** —
comments and trailing commas are fine — and the seeded stub carries this very
example commented out, ready to copy and edit in place. Resolution:
`$GENESEED_WIKI` → `$GENESEED_HARNESS/wiki.jsonc` → beside the installed `AGENT.md`
(a `wiki.json` from an earlier install is still honoured at each location).
Fill it in:

```json
{
  "wikis": [{
    "name": "Brain",
    "path": "/home/me/Documents/Brain",
    "description": "my machine-wide knowledge base",
    "entries": [
      { "path": "ARCHITECTURE.md", "load": "eager", "description": "the root map" },
      { "path": ".", "load": "lazy" }
    ],
    "conventions": "STYLE.md",
    "inbox": "Inbox/",
    "protected": ["Journal/"]
  }]
}
```

`path` is the vault root (absolute; on Windows use forward slashes —
`C:/Users/me/Brain`); entry paths are relative to it, with the same `eager`/`lazy`
semantics as `context.json`. An entry may name a single note **or a folder**: a
folder applies its mode to every note beneath it (`"."` = the whole vault,
dot-folders like `.obsidian` skipped), a file entry overrides its folder's mode
whatever the order, and `"load": "exclude"` prunes a note or folder from the
listing. The example above is the canonical shape — root index eager, everything
else on demand. A big vault's lazy listing truncates at 200 lines with a visible
count (`GENESEED_WIKI_LAZY_LIMIT` adjusts it). `conventions` names the note the agent must read before
its first write; `inbox` is where it drops notes it cannot confidently file;
`protected` folders are write-blocked by the guard plugin at the tool boundary
(`GENESEED_GUARD` modes apply). Several wikis may be declared; an empty `wikis`
list keeps the feature off. The file may hold private paths — it is host-specific,
covered by the bundle `.gitignore`, and never committed.

On tools without the plugins (plain `AGENT.md`, Claude Code), the same contract
holds through prose: AGENT.md §7 instructs the agent to read `wiki.jsonc` at session
start and honour it.

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

### MCP servers

Beyond document conversion, Geneseed ships **four** ready-to-wire MCP servers as presets
— **MarkItDown** (below), **GitLab** (one entry per instance), and **Filesystem**. Each
is a *local* server the agent launches on demand: registering one only points the agent
at a command — *you* install the tool (or let `npx`/`pipx` fetch it) and supply any
credentials. On OpenCode they live under the `mcp` key of an `opencode.json`, each entry
shaped:

```json
"<name>": { "type": "local", "command": ["…"], "environment": {}, "enabled": true }
```

> **Never commit a real token.** The presets and the reference
> [`adapters/opencode/opencode.json`](adapters/opencode/opencode.json) carry **empty**
> `GITLAB_PERSONAL_ACCESS_TOKEN` placeholders (and a sample filesystem path) — fill them
> in your own config, never in a tracked file (universal Law I — secrets).

**Don't want to hand-edit JSON?** `./geneseed` → **Settings** → **MCP servers** toggles
any of the four presets into your project or global `opencode.json` — and enables,
disables, or removes them — for you. The reference config ships MarkItDown enabled and
the GitLab / Filesystem entries disabled, so a merge never activates a credential-less
server: fill the blanks, then flip the one(s) you want on.

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

#### GitLab (one entry per instance)

Wire GitLab in via [`@zereight/mcp-gitlab`](https://github.com/zereight/gitlab-mcp) —
repo, merge-request, issue, and CI tools over the GitLab API, run through `npx` (nothing
installed globally; the first run fetches it). It is self-hosted ready, so the same
command serves gitlab.com and any private instance.

**1. Mint a Personal Access Token** on *each* instance — User Settings → Access Tokens,
scopes `api` and `read_repository`. Treat it like a password.

**2. Register one `mcp` entry per instance** — same command, different `GITLAB_API_URL`
and token. Two instances (e.g. gitlab.com plus a self-hosted server) → two entries:

```json
{
  "mcp": {
    "gitlab": {
      "type": "local",
      "command": ["npx", "-y", "@zereight/mcp-gitlab"],
      "environment": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      },
      "enabled": true
    },
    "gitlab-2": {
      "type": "local",
      "command": ["npx", "-y", "@zereight/mcp-gitlab"],
      "environment": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.example.com/api/v4"
      },
      "enabled": true
    }
  }
}
```

The entry key is just a label — name them `gitlab` / `gitlab-2`, or after each instance
(`gitlab`, `gitlab-acme`). What separates the two is the `GITLAB_API_URL` + token pair;
keep the `/api/v4` suffix on the URL.

#### Filesystem

Give the agent scoped file access via
[`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem),
also through `npx`. The **allowed directories are command-line arguments** — the server
can touch *only* the paths you list, so grant the narrowest set that works:

```json
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": [
        "npx", "-y", "@modelcontextprotocol/server-filesystem",
        "/path/to/project", "/path/to/another/allowed/dir"
      ],
      "enabled": true
    }
  }
}
```

> **Least privilege.** Don't point it at `$HOME` or `/`. List only the dirs the task
> needs — the server refuses any path outside them.

#### Claude Code

Claude Code reads the same servers from a `.mcp.json` `mcpServers` map — note the key is
`env` (not `environment`) and the command and its args are split into `command` +
`args`:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/mcp-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
    },
    "markitdown": { "command": "markitdown-mcp", "args": [] }
  }
}
```

Register it with `claude mcp add` or by editing `.mcp.json` directly; the same
token-safety rule applies.

#### Verify

Restart your agent. On OpenCode, `opencode mcp` lists each server and whether it
connected; on Claude Code, `/mcp` shows the same. A GitLab server that won't connect is
almost always a missing / over-scoped token or the wrong `GITLAB_API_URL` (mind the
`/api/v4` suffix); a filesystem server that "sees nothing" usually has a wrong
allowed-dir path.

### Environment knobs

| Variable | Used by | Effect |
| --- | --- | --- |
| `GENESEED_HARNESS` | learn plugin | base whose `memory/` the plugin writes to (optional — the plugin auto-locates the in-config store; set to pin it) |
| `GENESEED_MEMORY` | learn plugin / CLI | explicit memory dir (overrides the above) |
| `GENESEED_CONTEXT` | context plugin / CLI | explicit `context.json` path |
| `GENESEED_WIKI` | context + guard plugins | explicit `wiki.jsonc` path (default: `$GENESEED_HARNESS/wiki.jsonc`, else beside the installed `AGENT.md`) |
| `GENESEED_ROOT` | `harness context` | repo root to discover docs from (default: cwd) |
| `GENESEED_MODEL` | learn plugin | `provider/model` fallback if the session model can't be read |
| `GENESEED_LLM` | `harness learn` (Claude) | model CLI for distillation, e.g. `claude -p` |
| `GENESEED_EMIT` | `upgrade.sh` | `opencode-global` \| `opencode` \| unset (plain bundle) |
| `GENESEED_OUT` / `GENESEED_ROOT` | `upgrade.sh` | bundle / project-root locations |
| `GENESEED_DEBUG` | context plugin | `1` re-enables discovery/inject logs |
| `GENESEED_CONTEXT_INJECT` | context plugin | `off` disables the injected block (rely on the AGENT.md law) |
| `GENESEED_EAGER_FILE_KB` / `GENESEED_EAGER_TOTAL_KB` | context plugin | per-file / total eager injection budget (default 16 / 48) |
| `GENESEED_LAZY_HEADINGS` | context plugin | cap on lazy-file heading reads per session (default 64) |
| `GENESEED_WIKI_LAZY_LIMIT` | context plugin | cap on lazy notes LISTED per wiki per session (default 200; beyond it the listing truncates with a count) |
| `GENESEED_CONTEXT_VISIBLE` | context plugin | `1` shows the classic visible `PROJECT CONTEXT` block instead of the invisible per-request delivery (see [Project context](#project-context-usually-nothing)) |
| `GENESEED_CONTEXT_TRANSFORM` | context plugin | legacy — `0`/`off` forces the visible delivery (same as `GENESEED_CONTEXT_VISIBLE=1`); `1` matches the default |
| `GENESEED_LEARN_DEBOUNCE_MS` | learn plugin | quiet period before distilling (default 60000) |
| `GENESEED_GUARD` | guard plugin | `warn` downgrades blocks to warnings; `off` disables the safety guard |
| `GENESEED_WORKFLOWS_DIR` | workflow plugin | override the directory the `workflow` tool reads saved scripts from |
| `GENESEED_PRIMARY` | `build.py` | `1` also emits the primary orchestrator agent |
| `GENESEED_COMMANDS` | `build.py` | `1` also emits the `/slash` command layer |
| `GENESEED_TUI_ASCII` / `GENESEED_TUI_PLAIN` | TUI / harness | force pure-ASCII / drop emoji + animation in the TUI |
| `GENESEED_NO_ANIM` | install animation | disable the themed install animation |
| `GENESEED_LOG` | `upgrade.sh` | override the install/upgrade log path |
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
4. **Harness health** — `python rituals/harness.py doctor` should print `ok`. To run the
   full suite the way CI does: `python -m unittest discover -s tests -p "test_*.py"` and,
   if Node is present, `node --test tests/workflow_runtime.test.mjs`.

On any VT-capable terminal (Unix, or Windows Terminal / Windows 10 1809+ `conhost`),
`./geneseed tui` opens a two-pane, colorized panel — agents, skills, and laws listed on
the left, the selected item's full spec on the right (PgUp/PgDn to scroll it) — and runs
build/doctor/diff (and `u` to update) with a keystroke.

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

**Windows** — use the native launcher `geneseed.cmd` (cmd) or `geneseed.ps1` (PowerShell),
which route to the same Python CLI with no bash:

```powershell
.\geneseed.cmd setup            # or: .\geneseed.ps1 setup
.\geneseed.cmd link             # writes a geneseed.cmd shim into %LOCALAPPDATA%\Geneseed\bin
                                # and adds that dir to your user PATH (no admin / symlink needed)
```

Open a new terminal after `link`, then call `geneseed` from any directory. Remove it
again with `.\geneseed.cmd unlink`.

## Headless / CI (OpenCode)

Once the harness is installed (Path A or B), OpenCode can run **non-interactively** —
no TUI — so the harness's agents, rules, and skills apply in scripts and pipelines:

```
opencode run "review the staged diff and list any correctness bugs"   # one-shot, prints to stdout
opencode run -m anthropic/claude-sonnet-4-5 "…"                       # pin a model for the run
cat issue.md | opencode run "triage this and propose a fix plan"      # pipe input in
```

`opencode run` loads the same `opencode.json` (so `instructions` → `AGENT.md`, the
permission gates, and any per-agent overrides all take effect) and the same
`.opencode/` agents/skills/plugins. Useful for CI checks, cron jobs, or scripting a
capability agent. Notes:

- **Permissions still gate.** The consent-before-commit/push / `rm -rf` `ask` rules
  will *block* in a non-interactive run (nothing to answer the prompt). Both
  `git commit` and `git push` are gated now (Law XX, every branch), so a CI job that
  commits must opt those commands back to `"allow"` in its own `permission.bash` map,
  or scope the run to read-only work — don't blanket-disable the guards.
- **`--pure`** runs OpenCode ignoring local/global config — handy to reproduce a bug
  without the harness in the way, or to confirm a behaviour is the harness's doing.
- The **learn** plugin (`session.idle` → memory) and **context** plugin still load in
  headless runs; set `GENESEED_GUARD=warn`/`off` or `GENESEED_DEBUG=1` per the
  [adapter README](adapters/opencode/README.md) if a run needs different behaviour.

This is a usage note, not an emitted feature — the harness writes nothing for it.

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

**Reviewing local edits** — if the deployed harness was tweaked in place (you, or the
agent's own self-improvement loops) and you want to see what diverged from source:

```
./geneseed diff                        # summary — --full for line-level diffs
./geneseed diff --out improvements.md  # export a markdown improvements file
```

The `--out` file is a self-contained back-port artifact: hand it to an agent in the
Geneseed source repo and ask it to fold the changes into `src/`. You rarely need to
run it by hand — **setup, re-theme, and upgrade auto-export one** (to `improvements/`
in the source checkout, git-ignored) whenever the harness they are about to overwrite
carries local edits, so a rebuild never silently destroys what the agent learned. The
TUI's *Review local edits* view exports the same file with the `e` key.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No readiness sigil | Instructions not pointed at `AGENT.md` — check `opencode.json` `instructions` (or your tool's rules setting). |
| `PROJECT CONTEXT` block appears twice | Two copies of the context plugin (global + a leftover `.opencode/plugins/`). Remove the project copy. |
| Full `PROJECT CONTEXT` block visible in the terminal | Either `GENESEED_CONTEXT_VISIBLE=1` (or legacy `GENESEED_CONTEXT_TRANSFORM=0/off`) is set, or your OpenCode build lacks the experimental transform hook and the plugin fell back to visible delivery — run with `GENESEED_DEBUG=1` to see which (see [Project context](#project-context-usually-nothing)). |
| Learn plugin silent / no memory written | Set `GENESEED_HARNESS` (or `GENESEED_MEMORY`); confirm the `.js` files are in the plugins dir. |
| `could not determine a model` | Set `GENESEED_MODEL=provider/model`. |
| PDFs / Office docs ignored | Use the `ingest` skill and install a converter (MarkItDown / Pandoc / Docling). |
| A "read-only" agent won't run a command | By design — read-only agents are denied `bash`. Agents that must run read-only commands (reviewer, security) allow it via a spec marker. |
| Skills not tracked in git | A parent `.gitignore` blanket-ignores the bundle dir — remove the bare `Harness/` line; the bundle's own `.gitignore` scopes correctly. |

More OpenCode-specific notes (why a file loads twice, plugin loading): [HOW-OPENCODE-LOADS.md](adapters/opencode/HOW-OPENCODE-LOADS.md).
