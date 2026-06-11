# Geneseed

> A portable, theme-able harness you implant once and use everywhere to grow a
> disciplined AI coding agent.

Geneseed distils an agent operating system into a generic harness built around a
single `AGENT.md`. Point your tool at it and the agent inherits a set of operating
**rules**, a roster of capability **agents**, native **skills**, a **memory**
convention, and — on OpenCode — four **plugins** that auto-load your project's docs,
capture durable memory, enforce the safety laws, and run saved workflows. One source
builds it; it follows you into every repo.

**New here? Start with the [Setup guide](SETUP.md).** This page is the overview.

## How it works

One canonical source in `src/` renders, via a tiny dependency-free generator
(`build.py`, stdlib only), into a ready-to-use bundle. **A theme controls only
*voice*** — how the AI responds and how the prose inside the docs reads (tagline,
greeting, descriptions). **Structure is theme-independent**: section names (Rules,
Agents, Skills, Memory…) and folder names (`laws/`, `agents/`, `skills/`, `memory/`, `notebook/`)
are always plain English, so the scaffolding stays tool-friendly while the flavour
lives in the words.

```
python build.py                  # default theme (neutral)
python build.py --theme imperial # Warhammer 40k voice, identical structure
```

Eight themes ship — **neutral**, **imperial** (Warhammer 40k), **military**,
**pirate**, **wizard**, **cyberpunk**, **gamer**, and **sports** (play-by-play) —
and a theme is just one JSON file in `themes/` carrying voice tokens only, so adding
your own is a copy-and-edit away.

## What you get

| Piece | What it is |
| --- | --- |
| **Rules** (`laws/`) | 20 universal laws the agent obeys — secrets, scope, verify-before-assert, surface-failures, context economy, load-the-docs, tool-discovery … |
| **Agents** (16) | capability specialists: `reviewer`, `tester`, `architect`, `docs`, `security`, `explorer` — plus a debate **council** the `council` skill convenes: `advocate`, `skeptic`, `pragmatist`, `steward`, `visionary`, `user-advocate`, `framer`, `empiricist`, `operator`, `historian` |
| **Skills** (23) | repeatable workflows: brainstorm · **clarify** · plan · tdd · debug · refactor · code-review · **fresh-eyes** · **review-response** · commit · **ship** · **release** · **migrate** · **git-archaeology** · **git-rescue** · repo-map · **ingest** · **research** · handoff · roast-me · **council** · parallel-agents · **workflow** |
| **Memory** (`memory/`) | one-fact-per-file durable knowledge, indexed by `MEMORY.md` (git-ignored, personal) |
| **Notebook** (`notebook/`) | the agent's sovereign space — any medium (code, tools, data, notes), self-ruled via a seed-once charter, always git-ignored; only its `.gitignore` is build-asserted |
| **Context** | the project's own docs — auto-discovered on OpenCode, or via a `context.json` manifest |
| **Plugins** (OpenCode) | `geneseed-context` injects project docs every session (and across compaction); `geneseed-learn` distils memory at session end; `geneseed-guard` enforces the safety Laws at the tool boundary; `geneseed-workflow` registers the `workflow` tool that runs saved orchestration scripts |

## Quick start (OpenCode, global)

The recommended setup — installed once into OpenCode's config dir, inherited by every
repo, nothing committed into your projects:

```
python build.py --emit opencode-global                 # add --theme imperial if wanted
# Optional: the learn plugin auto-locates the in-config memory store. Set this only
# to pin it explicitly (or persist it to your shell rc):
export GENESEED_HARNESS="$HOME/.config/opencode"
echo 'export GENESEED_HARNESS="$HOME/.config/opencode"' >> ~/.zshrc
```

Open OpenCode in any repo — the first reply opens with the readiness sigil and your
project's docs are already in context. **Other tools (Claude Code, plain `AGENT.md`),
per-repo installs, configuration, and troubleshooting: [SETUP.md](SETUP.md).**

## Set up via the TUI (macOS & Windows)

Prefer a guided install over typing build commands? The launcher ships an interactive,
dependency-free TUI. Bare `geneseed` opens a **main menu** of every action — browse,
review local edits, refresh/set up, update, update & set up, rebuild, memory, status,
and **Settings** (MCP servers, run-from-anywhere, uninstall) — and the **setup wizard**
walks you through theme and install mode, previewing each theme's voice live before
you commit. The only prerequisite is Python 3; the harness is stdlib-only, nothing to
`pip install`.

### macOS (and Linux)

```bash
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
./geneseed                # main menu — pick "Refresh / set up"
./geneseed setup          # …or jump straight into the wizard
```

If `python3` is missing on macOS, install it via `xcode-select --install` or Homebrew.
In the wizard: pick a **theme** (previewed live as you move through the list), pick an
**install mode** — *OpenCode global* (recommended; every repo inherits it), *per-repo
`.opencode/`*, or *plain bundle* for any `AGENT.md` tool — confirm, and it builds and
offers a health check. `./geneseed tui` opens the browse panel directly.

### Windows

Everything runs natively — no bash, WSL, curl, or unzip:

```powershell
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
.\geneseed.cmd            # main menu — works from cmd or PowerShell
.\geneseed.cmd setup      # …or jump straight into the wizard
# PowerShell-native alternative: .\geneseed.ps1 / .\geneseed.ps1 setup
```

The launcher finds Python by itself (the `py` launcher, else `python` on PATH). The
full-screen TUI needs a VT-capable console — **Windows Terminal**, or Windows 10 1809+
`conhost` — via a stdlib-only ANSI backend; on an older console it falls back to the
same wizard as plain text prompts. The screens are identical to macOS: theme →
install mode → confirm → build → health check.

### After the wizard

- **Run it from anywhere** — `./geneseed link` (symlinks into `~/.local/bin`) or
  `.\geneseed.cmd link` (writes a shim into `%LOCALAPPDATA%\Geneseed\bin` and adds it
  to your user PATH; open a new terminal). Then plain `geneseed` works from any directory.
- **Verify** — `./geneseed doctor` (or `.\geneseed.cmd doctor`) should print `ok`;
  the agent's first reply should open with the readiness sigil.
- **Stay current** — main menu → *Update & set up*, or `./geneseed update`.

## Layout

```
Geneseed/
├── build.py              generator (stdlib only)
├── geneseed              launcher (bash): bare `./geneseed` = interactive main menu; + subcommands
│                         (`./geneseed link` puts it on PATH so `geneseed` runs from anywhere)
├── geneseed.cmd          native Windows launcher (cmd.exe) — same subcommands, no bash
├── geneseed.ps1          native Windows launcher (PowerShell) — same subcommands, no bash
├── bootstrap             one-shot: update everything (sync + upgrade), then run setup
├── upgrade.sh            self-upgrade from the published source
├── sync-self.sh          meta-updater: refreshes the launcher + upgrade scripts
├── harness.config.json   default theme + metadata
├── src/                  canonical source — edit here
│   ├── AGENT.md.tmpl     the entrypoint, rendered to AGENT.md
│   ├── laws/             governance rules
│   ├── agents/           capability specialists
│   ├── skills/           repeatable workflows
│   ├── memory/           memory convention + index
│   └── notebook/         the agent's own freeform space — convention + index
├── themes/               voice token maps (8: neutral, imperial, military, pirate, wizard, cyberpunk, gamer, sports)
├── rituals/harness.py    optional CLI: menu · setup · tui · build · doctor · diff · context · learn · prompt · status · version · bootstrap · uninstall
├── tests/                stdlib unit tests + a Node workflow-runtime test
├── docs/specs/           dated implementation specs — design rationale + history
├── adapters/             per-tool glue (opencode/, claude-code/)
└── .github/workflows/    CI: doctor + tests
```

## Validate & test

```
python rituals/harness.py doctor                      # every theme + parity + authoring + drift
python -m unittest discover -s tests -p "test_*.py"   # generator + CLI unit tests (no deps)
node --test tests/workflow_runtime.test.mjs           # workflow-runtime tests (needs Node)
```

`doctor` checks each theme for unresolved tokens, dead/non-hermetic links, theme-key
parity, author-time gates (every spec has a purpose line, the plugins parse, the
learn-prompt literal stays extractable), and that a committed bundle still matches a
fresh render of `src/`. CI (`.github/workflows/ci.yml`) runs all three on every push and PR.

## Keeping it current

```
./geneseed update      # everything in one: refresh the scripts + content, then rebuild
./geneseed bootstrap   # update everything, then drop into the setup wizard
./geneseed upgrade     # just the content refresh (remembers theme + emit mode)
```

Details and precedence rules: [SETUP.md → Upgrade](SETUP.md#upgrade).

## Documentation

- **[SETUP.md](SETUP.md)** — install paths, configuration, env vars, verify, troubleshooting.
- **[DESIGN.md](DESIGN.md)** — the spec and the decisions behind the structure.
- **[adapters/opencode/](adapters/opencode/README.md)** — the OpenCode adapter in depth (plugins, native mapping).
  - [GLOBAL-HARNESS-SPEC.md](adapters/opencode/GLOBAL-HARNESS-SPEC.md) · [HOW-OPENCODE-LOADS.md](adapters/opencode/HOW-OPENCODE-LOADS.md)
- **[adapters/claude-code/](adapters/claude-code/README.md)** — the Claude Code hook adapter.
- **[src/memory/README.md](src/memory/README.md)** — the memory convention.
- **[src/notebook/README.md](src/notebook/README.md)** — the agent's own freeform-space convention.
- **[docs/specs/](docs/specs/)** — dated implementation specs: the rationale and history behind each feature.

## License

MIT — see [LICENSE](LICENSE).
