# Geneseed

> A portable, theme-able harness you implant once and use everywhere to grow a
> disciplined AI coding agent.

Geneseed distils an agent operating system into a generic harness built around a
single `AGENT.md`. Point your tool at it and the agent inherits a set of operating
**rules**, a roster of capability **agents**, native **skills**, a **memory**
convention, and — on OpenCode — two **plugins** that auto-load your project's docs
and capture durable memory. One source builds it; it follows you into every repo.

**New here? Start with the [Setup guide](SETUP.md).** This page is the overview.

## How it works

One canonical source in `src/` renders, via a tiny dependency-free generator
(`build.py`, stdlib only), into a ready-to-use bundle. **A theme controls only
*voice*** — how the AI responds and how the prose inside the docs reads (tagline,
greeting, descriptions). **Structure is theme-independent**: section names (Rules,
Agents, Skills, Memory…) and folder names (`laws/`, `agents/`, `skills/`, `memory/`)
are always plain English, so the scaffolding stays tool-friendly while the flavour
lives in the words.

```
python build.py                  # default theme (neutral)
python build.py --theme imperial # Warhammer 40k voice, identical structure
```

Two themes ship: **neutral** (plain professional voice) and **imperial** (40k
flavour). A theme is one JSON file in `themes/` carrying voice tokens only.

## What you get

| Piece | What it is |
| --- | --- |
| **Rules** (`laws/`) | 18 universal laws the agent obeys — secrets, scope, verify-before-assert, context economy, load-the-docs … |
| **Agents** (6) | capability specialists: `reviewer`, `tester`, `architect`, `docs`, `security`, `explorer` |
| **Skills** (17) | repeatable workflows: brainstorm · plan · tdd · debug · refactor · verify · code-review · commit · **ship** · **release** · repo-map · **ingest** · handoff · roast-me · parallel-agents · cmux · create-skill |
| **Memory** (`memory/`) | one-fact-per-file durable knowledge, indexed by `MEMORY.md` (git-ignored, personal) |
| **Context** | the project's own docs — auto-discovered on OpenCode, or via a `context.json` manifest |
| **Plugins** (OpenCode) | `geneseed-context` injects project docs every session (and across compaction); `geneseed-learn` distils memory at session end |

## Quick start (OpenCode, global)

The recommended setup — installed once into OpenCode's config dir, inherited by every
repo, nothing committed into your projects:

```
python build.py --emit opencode-global                 # add --theme imperial if wanted
export GENESEED_HARNESS="$HOME/.config/opencode"        # so the learn plugin finds memory
echo 'export GENESEED_HARNESS="$HOME/.config/opencode"' >> ~/.zshrc
```

Open OpenCode in any repo — the first reply opens with the readiness sigil and your
project's docs are already in context. **Other tools (Claude Code, plain `AGENT.md`),
per-repo installs, configuration, and troubleshooting: [SETUP.md](SETUP.md).**

## Layout

```
Geneseed/
├── build.py              generator (stdlib only)
├── upgrade.sh            self-upgrade from the published source (+ -neutral / -imperial)
├── sync-self.sh          meta-updater: refreshes the orchestration scripts themselves
├── harness.config.json   default theme + metadata
├── src/                  canonical source — edit here
│   ├── AGENT.md.tmpl     the entrypoint, rendered to AGENT.md
│   ├── laws/             governance rules
│   ├── agents/           capability specialists
│   ├── skills/           repeatable workflows
│   └── memory/           memory convention + index
├── themes/               voice token maps (neutral, imperial)
├── rituals/harness.py    optional CLI: build · doctor · context · learn · prompt · diff
├── tests/                stdlib unit tests
├── adapters/             per-tool glue (opencode/, claude-code/)
└── .github/workflows/    CI: doctor + tests
```

## Validate & test

```
python rituals/harness.py doctor          # every theme + parity + authoring + drift
python -m unittest discover -s tests      # generator + CLI unit tests (no deps)
```

`doctor` checks each theme for unresolved tokens, dead/non-hermetic links, theme-key
parity, author-time gates (every spec has a purpose line, the plugins parse, the
learn-prompt literal stays extractable), and that a committed bundle still matches a
fresh render of `src/`. CI (`.github/workflows/ci.yml`) runs both on every push and PR.

## Keeping it current

```
./upgrade.sh          # refresh from the published source; remembers theme + emit mode
./sync-self.sh        # update the upgrade scripts themselves
```

Details and precedence rules: [SETUP.md → Upgrade](SETUP.md#upgrade).

## Documentation

- **[SETUP.md](SETUP.md)** — install paths, configuration, env vars, verify, troubleshooting.
- **[DESIGN.md](DESIGN.md)** — the spec and the decisions behind the structure.
- **[adapters/opencode/](adapters/opencode/README.md)** — the OpenCode adapter in depth (plugins, native mapping).
  - [GLOBAL-HARNESS-SPEC.md](adapters/opencode/GLOBAL-HARNESS-SPEC.md) · [HOW-OPENCODE-LOADS.md](adapters/opencode/HOW-OPENCODE-LOADS.md)
- **[adapters/claude-code/](adapters/claude-code/README.md)** — the Claude Code hook adapter.
- **[src/memory/README.md](src/memory/README.md)** — the memory convention.

## License

MIT — see [LICENSE](LICENSE).
