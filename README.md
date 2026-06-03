# Geneseed

> A portable, theme-able harness you implant once and use everywhere to grow a
> disciplined OpenCode agent.

Geneseed distils a personal agent system into a generic harness built around a
single `AGENT.md`. Point OpenCode at it and your agent inherits a set of operating
**rules**, a roster of capability **agents**, runnable **skills**, a **memory**
convention, two **plugins** that enforce doc-loading and capture memory
automatically, and a **`context.json`** manifest that points the agent at your own
documentation, wherever it lives on the machine.

The bundle is built in one place and reused from any directory — the rules, agents,
skills, and plugins follow you into every project OpenCode opens.

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
├── upgrade.sh            self-upgrade from the published source
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
  plugin loads `context.json`, so it is not listed here — see below);
- `.opencode/agent/` — one subagent per capability agent;
- `.opencode/command/` — one command per skill;
- `.opencode/plugins/` — the **learn** and **context** plugins (see below).

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

## Use it everywhere — the OpenCode plugins

The bundle is built in one location but used from any directory. Two plugins make
that real, both shipping in `adapters/opencode/plugins/`:

- **`geneseed-context.js`** — on `session.created` it reads `context.json` and
  **injects the contents of every `eager` doc** into the new session, enforcing the
  project-context rule *before your first turn* (lazy entries are listed only).
- **`geneseed-learn.js`** — on `session.idle` it distils durable memories from the
  conversation and writes them into the bundle's `memory/`, maintaining `MEMORY.md`
  and deduping. It distils with the **same model the session already used**, so it
  needs no API key and no extra config.

Install both globally so they run in every project. **Run this from inside the
Geneseed folder** — it copies the plugins and points `$GENESEED_HARNESS` at the
sibling `../Harness` bundle, so they find your memory store and `context.json` with
no hand-typed path:

```
mkdir -p ~/.config/opencode/plugins
cp adapters/opencode/plugins/*.js ~/.config/opencode/plugins/
export GENESEED_HARNESS="$(dirname "$PWD")/Harness"               # this shell
echo "export GENESEED_HARNESS=\"$GENESEED_HARNESS\"" >> ~/.zshrc  # persist (run once)
```

To load the rules in every project too, add the bundle's `AGENT.md` (absolute path)
to the `instructions` array of your global `~/.config/opencode/opencode.json`. List
**only `AGENT.md`** — the context plugin loads `context.json`; adding it to
`instructions` as well would double-load it. Per-project, `--emit opencode` already
writes a local `opencode.json` that does this.

Full detail, env overrides, and a field-test note: [`adapters/opencode/`](adapters/opencode/).

## Upgrade in place

`upgrade.sh` refreshes an already-built bundle from the published source without
touching your host-specific state. Run it from inside the Geneseed folder:

```
./upgrade.sh                  # track main, keep the last-built theme
./upgrade.sh v0.1.0           # pin to a tag
./upgrade.sh main imperial    # track main and force a theme
```

It downloads upstream, refreshes the factory files in place, and re-renders the
bundle into a **sibling `Harness/`** (beside the Geneseed folder), preserving the
bundle's `memory/` and `context.json`. A stray bundle left *inside* the factory by
an older layout is removed — but its `context.json` and `memory/` are **rescued into
the new location first**, so migrating never wipes your manifest or learned memories.

**Theme** is resolved by precedence: explicit arg > the bundle's `.geneseed-theme`
marker > the local `harness.config.json` (captured *before* it is refreshed from
upstream) > a loud warning + the upstream default. The marker lives in the
git-ignored `Harness/`, so it does **not** travel between machines — pass the theme
explicitly the first time on a new machine (`./upgrade.sh main imperial`).

By default the upgrade emits only the plain bundle. To regenerate the OpenCode
native layer (subagents, commands, plugins, `opencode.json`) on upgrade, set
`GENESEED_EMIT=opencode`. Override locations with `GENESEED_OUT` (bundle) and
`GENESEED_ROOT` (project root). `upgrade.sh` excludes itself from the sync, so to
pick up a newer `upgrade.sh`, re-fetch it once:

```
curl -fsSL https://raw.githubusercontent.com/Arylmera/Geneseed/main/upgrade.sh -o upgrade.sh
```

## Project context — `context.json`

The harness ships no project-specific knowledge. To give the agent that knowledge,
fill in the **`context.json`** manifest beside `AGENT.md`. It is host-specific —
**git-ignore it**; the build never touches or publishes it.

```json
{
  "context": [
    { "path": "/abs/path/to/house-rules.md", "load": "eager",
      "description": "Conventions, branch policy, Definition of Done." },
    { "path": "~/work/repo/docs/ARCHITECTURE.md", "load": "lazy",
      "description": "Back-end architecture — read when touching the backend." }
  ]
}
```

- **`eager`** — read every session (small, always-relevant rules). The context
  plugin injects these for you.
- **`lazy`** — read only when the task needs it (large or occasional docs).
- `path` is absolute, or relative to `context.json`'s own directory.

This replaces baked-in project rules: point at the project's own files instead of
editing the harness.

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
