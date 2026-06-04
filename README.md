# Geneseed

> A portable, theme-able harness you implant once and use everywhere to grow a
> disciplined OpenCode agent.

Geneseed distils a personal agent system into a generic harness built around a
single `AGENT.md`. Point OpenCode at it and your agent inherits a set of operating
**rules**, a roster of capability **agents**, native **skills**, a **memory**
convention, and two **plugins** — one that auto-discovers and injects your project's
docs every session, one that captures durable memory automatically.

The bundle is built in one place and reused from any directory — the rules, agents,
skills, and plugins follow you into every project OpenCode opens. For a zero-per-repo
setup, `--emit opencode-global` installs the whole harness into OpenCode's config
dir; see [Global install](#global-install--zero-per-repo).

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
├── upgrade.sh            self-upgrade from the published source (refreshes content)
├── upgrade-neutral.sh    upgrade pinned to the neutral theme
├── upgrade-imperial.sh   upgrade pinned to the imperial theme
├── sync-self.sh          meta-updater: refreshes the orchestration scripts themselves
├── harness.config.json   default theme + metadata
├── src/                  canonical source — edit here
│   ├── AGENT.md.tmpl     the entrypoint, rendered to Harness/AGENT.md
│   ├── laws/             governance rules
│   ├── agents/           capability specialists
│   ├── skills/           repeatable workflows
│   └── memory/           memory convention + index
├── themes/               token → label maps (neutral, imperial)
├── rituals/harness.py    optional CLI: build · doctor · prompt · learn
└── adapters/opencode/    opencode.json + the learn & context plugins
```

## Build the bundle

`--out` / `--target` accepts an absolute path or one relative to the current
directory. Render the bundle and the OpenCode native layer in one shot with
`--emit opencode`:

```
python build.py --emit opencode --target /path/to/your-repo
```

That writes, alongside the bundle:
- `opencode.json` — points OpenCode's `instructions` at `AGENT.md` (the context
  plugin auto-discovers project docs, so no manifest is listed here — see below);
- `.opencode/agents/` — one subagent per capability agent;
- `.opencode/skills/<name>/SKILL.md` — one **native skill** per skill (model-invoked,
  not a slash command — same `SKILL.md` shape as Claude Code);
- `.opencode/plugins/` — the **learn** and **context** plugins (see below).

For "everything global, zero per-repo files," use `--emit opencode-global` instead —
it renders straight into OpenCode's config dir. See [`adapters/opencode/`](adapters/opencode/).

**Keep the bundle in a subfolder.** To contain it (e.g. in `Harness/`) instead of
spreading it across the repo root, add `--root`:

```
python build.py --emit opencode --out /path/to/your-repo/Harness --root /path/to/your-repo
```

The whole bundle — `AGENT.md`, `laws/`, **and `context.json`** — stays in
`Harness/`. Only `opencode.json` and `.opencode/` are written to the repo root,
where OpenCode discovers them, with the instruction path prefixed
(`["Harness/AGENT.md"]`). OpenCode resolves instruction paths from the project
root, so without `--root` it wouldn't be found.

The build drops an empty `context.json` beside `AGENT.md` on first run and never
overwrites it — fill it in (see **Project context** below).

**Committing the rendered bundle.** The rendered harness — `AGENT.md`, the laws,
agents, and skills — is content you can version with your project. The build also
drops a bundle-level `.gitignore` that keeps only the host-specific files out
(`context.json`, the `.geneseed-theme` marker), with personal memory excluded by
`memory/`'s own ignore — everything else is trackable. **One gotcha:** if a parent
`.gitignore` blanket-ignores the whole bundle dir (a bare `Harness/` line), git
won't descend into it and the skills can't be tracked no matter what — remove that
line and let the bundle's own `.gitignore` do the scoping.

## Use it everywhere — the OpenCode plugins

The bundle is built in one location but used from any directory. Two plugins make
that real, both shipping in `adapters/opencode/plugins/`:

- **`geneseed-context.js`** (v2) — on `session.created` it **auto-discovers the
  repo's docs by convention** and **injects the `eager` ones** into the new session,
  enforcing the project-context rule *before your first turn* (lazy entries listed
  only). No committed `context.json` needed; drop a `.harness/context.json` only to
  override. Idempotent across stray duplicate installs.
- **`geneseed-learn.js`** — on `session.idle` it distils durable memories from the
  conversation and writes them into the bundle's `memory/`, maintaining `MEMORY.md`
  and deduping. It distils with the **same model the session already used**, so it
  needs no API key and no extra config.

- **Quiet by default:** the context plugin logs nothing (OpenCode renders a plugin's
  stderr as red UI text). `GENESEED_DEBUG=1` re-enables logs; `GENESEED_CONTEXT_INJECT=off`
  disables the visible injection block and falls back to the AGENT.md Law.

Full detail, env overrides, and a field-test note: [`adapters/opencode/`](adapters/opencode/).

## Global install — zero per-repo

The recommended setup: render the whole harness straight into OpenCode's config dir,
so every repo inherits it and nothing is committed into your projects.

```
GENESEED_EMIT=opencode-global ./upgrade-imperial.sh   # or ./upgrade.sh / --theme neutral
export GENESEED_HARNESS="$HOME/.config/opencode"       # learn plugin → <cfg>/memory
echo "export GENESEED_HARNESS=\"$HOME/.config/opencode\"" >> ~/.zshrc
```

This writes — into `$OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else
`~/.config/opencode` — and builds **no sibling `Harness/`**:

- `AGENT.md`, `agents/*.md`, `skills/<name>/SKILL.md`, a single `plugins/` copy;
- the memory store at `<cfg>/memory` (always English, never themed — migrated once
  from a legacy `Harness/memory`/`anamnesis/` if present, else seeded);
- `opencode.json` merged to point `instructions` at the absolute `AGENT.md`;
- **no** `context.json` — the context plugin auto-discovers each repo's docs.

It is non-destructive: a `.geneseed-manifest.json` tracks only the files it owns and
removes stale ones on re-emit, leaving your own agents/skills/plugins and the memory
store untouched. The emit mode is remembered in `<cfg>/.geneseed-emit`, so a later
bare `./upgrade-imperial.sh` keeps deploying globally. Use `$OPENCODE_CONFIG_DIR` to
keep the global harness in a git-tracked folder.

**Per-repo instead?** `--emit opencode` writes `.opencode/{agents,skills,plugins}` +
`opencode.json` into one repo. **Manual?** copy `adapters/opencode/plugins/*.js` into
`~/.config/opencode/plugins/` and add the bundle's absolute `AGENT.md` to a global
`opencode.json`'s `instructions`.

## Upgrade in place

`upgrade.sh` refreshes an already-built install from the published source without
touching your host-specific state. Run it from inside the Geneseed folder:

```
./upgrade.sh                  # track main; keep the remembered theme + emit mode
./upgrade.sh v0.1.0           # pin to a tag
./upgrade.sh main imperial    # force a theme
./upgrade-imperial.sh         # convenience wrapper (theme pinned)
```

It downloads upstream, refreshes the factory files in place, **validates the synced
source** (a blocking doctor pass — a mid-publish download that is internally
inconsistent refuses to deploy a partial harness), then re-renders.

**Theme and emit mode are both remembered** between runs (`.geneseed-theme` and
`.geneseed-emit` markers), so you pass them once and a bare `./upgrade.sh` keeps the
same theme and keeps deploying to the same place (global config dir, per-repo, or
plain bundle). Precedence — theme: explicit arg > marker > `harness.config.json` >
upstream default; emit: `$GENESEED_EMIT` > global-config marker > bundle marker >
`files`. Markers are git-ignored, so pass them explicitly the first time on a new
machine.

Emit modes: `GENESEED_EMIT=opencode-global` (recommended — see
[Global install](#global-install--zero-per-repo)), `=opencode` (per-repo
`.opencode/` layer), or unset (`files`, plain bundle). Override locations with
`GENESEED_OUT` (bundle) and `GENESEED_ROOT` (project root).

**Updating the scripts themselves.** `upgrade.sh` and the wrappers refresh the
factory *content* but not themselves (rewriting a running script is unsafe). To pull
new versions of the orchestration layer, run the meta-updater first:

```
./sync-self.sh                # refreshes upgrade.sh, upgrade-<theme>.sh, sync-self.sh
```

## Project context — auto-discovered

The harness ships no project-specific knowledge. The context plugin gives the agent
that knowledge automatically: on session start it **discovers the current repo's docs
by convention** and injects them, so usually you configure **nothing**.

- **Eager** (injected in full, budget-capped): root `AGENTS.md`/`AGENT.md`/
  `CLAUDE.md`/`.cursorrules`, `README.md`, `CONTRIBUTING.md`.
- **Lazy** (only listed — path + heading, read on demand): `docs/`, `doc/`,
  `documentation/`, `architecture/`, `adr/`, monorepo `packages/*/README.md`, other
  root `*.md`. `node_modules`, `.git`, `dist`, … are never scanned.

**Override** only when the convention doesn't fit: drop a `.harness/context.json`
(or `./context.json`, or point `$GENESEED_CONTEXT`). Same manifest, plus glob paths,
`load: exclude`, and `"extend": true` to layer on top of discovery:

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

`path` is absolute, repo-relative, or a glob. Full schema:
[`adapters/opencode/GLOBAL-HARNESS-SPEC.md`](adapters/opencode/GLOBAL-HARNESS-SPEC.md) §3.

## Memory

Durable knowledge lives in the bundle's `memory/` as **one fact per file**, indexed
by a local `MEMORY.md`. It is git-ignored — personal to the machine, never
committed. The agent reads the index at session start and writes a new file when a
session yields a durable fact; the **learn plugin** automates that capture at
session end. Convention: [`Harness/memory/README.md`](src/memory/README.md).

`context.json` and `memory/` are distinct: `context.json` points at *bodies of
documentation maintained elsewhere*; `memory/` holds *atomic facts the agent learns
and writes itself*.

## Validate

```
python rituals/harness.py doctor                 # sweeps every theme
python rituals/harness.py doctor --theme imperial
```

Checks each theme's build for unresolved tokens, dead links, and non-hermetic links
that would escape the bundle.

## License

MIT — see [LICENSE](LICENSE).
