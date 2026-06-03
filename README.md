# Geneseed

> A portable, theme-able harness you implant into any repository to grow a
> disciplined AI coding agent.

Geneseed distils a personal, vault-grown agent system into a generic,
tool-agnostic harness built around a single `AGENT.md`. Implant it into a repo
and an assistant that reads it inherits a set of operating **rules**, a roster of
capability **agents**, runnable **skills**, a **memory** convention, and a
**`context.json`** manifest that points the agent at this repository's own
documentation, wherever it lives.

The entrypoint the build emits is named **`AGENT.md`**. Most coding assistants
that read a root instructions file pick it up directly. A tool that *only*
auto-loads `AGENTS.md` or `CLAUDE.md` needs a one-line pointer — rename or symlink
`AGENT.md` to that name, or reference it from the tool's config (the OpenCode
adapter does exactly this; Claude Code's SessionStart hook `cat`s it). Geneseed
does not scatter duplicate entrypoint files into your repo root.

## How it works

One canonical source in `src/` is written in neutral tokens. A tiny,
dependency-free generator (`build.py`) renders it into a themed bundle in
`Harness/`. A theme changes the prose vocabulary *and* the bundle's top-level folder
names (`laws→leges`, `agents→legati`, `skills→rites`, `memory→anamnesis`); the
`src/` tree itself always keeps neutral names. Internal links are themed to match,
so the bundle always resolves.

```
python build.py                  # default theme (neutral)
python build.py --theme imperial # Warhammer-flavoured labels
```

Two themes ship:
- **neutral** — plain professional vocabulary (Rules, Agents, Skills, Memory, Context).
- **imperial** — Warhammer 40k flavour (Codex, Legati, Rites, Anamnesis, Apocrypha).

Adding a theme is one JSON file in `themes/`.

## Layout

```
Geneseed/
├── build.py              generator (stdlib only)
├── harness.config.json   default theme + metadata
├── src/                  canonical source — edit here
│   ├── AGENT.md.tmpl     the entrypoint that gets rendered to Harness/AGENT.md
│   ├── laws/             governance rules (universal)
│   ├── agents/           capability specialists
│   ├── skills/           repeatable workflows
│   └── memory/           memory convention + index
├── themes/               token → label maps (neutral, imperial)
├── rituals/harness.py    optional CLI: build · doctor · prompt · learn
├── prompts/              self-contained install prompts (no Python needed)
└── adapters/             optional per-tool glue (Claude Code hooks, OpenCode config)
```

## Implant it into a repo

There are two ways — pick whichever fits. Both let you choose the destination.

### A. Generator (build into any folder)

`--out` / `--target` accepts an absolute path or one relative to your current
directory, so you can render straight into the repo you want:

```
python build.py --theme neutral --target /path/to/your-repo
```

The build drops an empty `context.json` for you (at the repo root); list your
repo's docs in it (see **Project context** below).

For **OpenCode**, add `--emit opencode` to also generate native subagents,
commands, and an `opencode.json` alongside the bundle:

```
python build.py --emit opencode --target /path/to/your-repo
```

**Bundle in a subfolder?** To keep the harness contained (e.g. in `Harness/`)
rather than spread across the repo root, add `--root`:

```
python build.py --emit opencode --out /path/to/your-repo/Harness --root /path/to/your-repo
```

The whole bundle — `AGENT.md`, `laws/`, **and `context.json`** — stays together in
`Harness/`. Only `opencode.json` and `.opencode/` are written to the repo root
(OpenCode discovers them there), with both instruction paths prefixed:
`["Harness/AGENT.md", "Harness/context.json"]`. OpenCode resolves instruction paths
from the project root, so without `--root` they aren't found.

### B. Prompt (no Python required)

For environments where you'd rather not run a script, use a **self-contained
install prompt**: paste it into any AI assistant (Claude, ChatGPT, Cursor…),
tell it the target folder, and it writes the whole harness verbatim.

- Ready-made, copy-paste from the repo: [`prompts/install.neutral.md`](prompts/install.neutral.md)
  or [`prompts/install.imperial.md`](prompts/install.imperial.md).
- Or regenerate fresh (always in sync with `src/`):

```
python rituals/harness.py prompt --theme neutral            # to stdout
python rituals/harness.py prompt --theme imperial --out my-prompt.md
```

The prompt asks the agent which folder to target (default: the current repo root).

### Optional automation

Wire `rituals/harness.py` to a git hook or CI, or use the
`adapters/claude-code/` hook snippet.

### Tool adapters

- **OpenCode** — [`adapters/opencode/`](adapters/opencode/): a drop-in
  `opencode.json` (loads `AGENT.md` as a rule file), plus `build.py --emit
  opencode` which generates native subagents (`.opencode/agent/`) and commands
  (`.opencode/command/`) from the same source — zero drift.
- **Claude Code** — [`adapters/claude-code/`](adapters/claude-code/): SessionStart
  + Stop hook snippet.

## Upgrade in place

`upgrade.sh` refreshes an already-implanted bundle from the published source
without touching your host-specific state. Run it from inside the Geneseed folder:

```
./upgrade.sh                  # track main, keep the last-built theme
./upgrade.sh v0.1.0           # pin to a tag
./upgrade.sh main imperial    # track main and force a theme
```

It downloads upstream, refreshes the factory files in place, and re-renders the
bundle into a **sibling `Harness/`** (beside the Geneseed folder, at the project
level), overwriting the files there while preserving the bundle's `memory/` and
`context.json`. A stray bundle left *inside* the factory by an older run is removed
— but its host-specific state (`context.json` and `memory/`) is **rescued into the
new location first**, so migrating from the old in-folder layout never wipes your
project-context manifest or learned memories.

**Theme** is resolved by precedence: explicit arg > the bundle's `.geneseed-theme`
marker > the local `harness.config.json` (captured *before* it is refreshed from
upstream) > a loud warning + the upstream default. The marker lives in the
git-ignored `Harness/`, so it does **not** travel between machines — pass the theme
explicitly the first time on a new host (`./upgrade.sh main imperial`).

**OpenCode**: by default the upgrade emits only the plain bundle — point OpenCode
at the bundle's `AGENT.md` (by absolute path, from anywhere on the machine, or via
your global config) and you're done; no `opencode.json` is written. The native
layer (subagents, commands, `opencode.json` at the project root) is **opt-in only**
— set `GENESEED_EMIT=opencode`. See [`adapters/opencode/`](adapters/opencode/).

Override locations with `GENESEED_OUT` (bundle) and `GENESEED_ROOT` (project root).
`upgrade.sh` excludes itself from the sync (a running script must not overwrite
itself), so to pick up a newer `upgrade.sh`, re-fetch it once:

```
curl -fsSL https://raw.githubusercontent.com/Arylmera/Geneseed/main/upgrade.sh -o upgrade.sh
```

## Windows / PowerShell

The two scripts that do the real work — `build.py` and `rituals/harness.py` — are
**pure Python, stdlib only**, so they run identically on Windows. Use them as-is
from PowerShell (forward or back slashes both work):

```powershell
python build.py --theme neutral --target C:\path\to\your-repo
python rituals\harness.py doctor                 # sweeps every theme
python rituals\harness.py prompt --theme imperial --out my-prompt.md
```

The Claude Code adapter hooks are also cross-platform — the `learn` hook reads the
session payload from stdin (no `/dev/null` redirection), so it works unchanged on
Windows. Set `$env:GENESEED_LLM` (and, if needed, `$env:GENESEED_MEMORY`) for it
to distil.

Only `upgrade.sh` is Unix-shell-only (it uses `curl`/`unzip`). On Windows you can
run it under **Git Bash** or **WSL**, or use this PowerShell equivalent — run it
from **inside the Geneseed folder**. It mirrors the script: download upstream,
refresh the factory files in place, and re-render the bundle into a sibling
`Harness\`. Host-specific files (`context.json`, the bundle's `memory\`) are left
untouched.

```powershell
$Ref   = 'main'   # branch or tag
$Theme = ''       # '' = keep the last-built theme from the Harness marker

$Here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Out  = Join-Path (Split-Path $Here -Parent) 'Harness'
$Tmp  = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([guid]::NewGuid()))
try {
  $zip = Join-Path $Tmp 'src.zip'
  Invoke-WebRequest "https://github.com/Arylmera/Geneseed/archive/refs/heads/$Ref.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath $Tmp -Force
  $New = Get-ChildItem $Tmp -Directory | Where-Object Name -like 'Geneseed-*' | Select-Object -First 1

  if (-not $Theme) {
    $marker = Get-Content (Join-Path $Out '.geneseed-theme') -ErrorAction SilentlyContinue
    $Theme  = if ($marker) { $marker.Trim() } else { 'neutral' }
  }

  # Factory files refreshed from upstream — everything else is left alone.
  $Sync = 'build.py','rituals','src','themes','adapters','prompts',
          'harness.config.json','DESIGN.md','README.md','LICENSE','.gitignore'
  foreach ($item in $Sync) {
    $s = Join-Path $New.FullName $item
    if (Test-Path $s) {
      $d = Join-Path $Here $item
      if (Test-Path $d) { Remove-Item $d -Recurse -Force }
      Copy-Item $s $d -Recurse -Force
    }
  }

  python build.py --out $Out --theme $Theme
  python rituals/harness.py doctor --theme $Theme
} finally {
  Remove-Item $Tmp -Recurse -Force
}
```

(The bash `upgrade.sh` extras — the OpenCode opt-in via `GENESEED_EMIT` and the
stray in-folder bundle cleanup — are not reproduced here; pass `--emit opencode
--root <repo>` to `build.py` directly if you need the native layer.)

## Project context — `context.json`

The harness ships no project-specific knowledge. To give the agent that knowledge,
drop a **`context.json`** manifest at the bundle root (beside `AGENT.md`). It is
optional and host-specific — **git-ignore it**; the build never touches or
publishes it, and rebuilds leave it intact.

The build drops an empty `context.json` at the bundle root on first run (and never
overwrites it). Git-ignore it, then fill it in:

```json
{
  "context": [
    { "path": "/abs/path/to/house-rules.md", "load": "eager",
      "description": "Conventions, branch policy, Definition of Done." },
    { "path": "C:/work/repo/docs/ARCHITECTURE.md", "load": "lazy",
      "description": "Back-end architecture — read when touching the backend." }
  ]
}
```

- **`eager`** — read every session (small, always-relevant rules).
- **`lazy`** — read only when the task needs it (large or occasional docs).
- `path` is absolute (a doc anywhere on the machine) or relative to the repo root.

This replaces baked-in project rules: point at the project's own files instead of
editing the harness.

## Validate

```
python rituals/harness.py doctor            # checks both: no unresolved tokens, no dead links
python rituals/harness.py doctor --theme imperial
```

## License

MIT — see [LICENSE](LICENSE).
