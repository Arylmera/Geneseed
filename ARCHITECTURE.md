# Architecture

A bird's-eye map of Geneseed, in the [matklad](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html)
sense: what the parts are, where they live, and which lines between them must not be crossed. It
points at the detail rather than repeating it — [`js/README.md`](js/README.md) is the module map,
[`DESIGN.md`](DESIGN.md) holds the product decisions, [`docs/adr/`](docs/adr/README.md) the
engineering ones, and [`docs/extending.md`](docs/extending.md) what an addition costs.

## The problem

Geneseed turns one neutral source — laws, doctrines, agents, skills, loops — into an agent harness
and installs it into a host tool (Claude Code, OpenCode, Bob, OpenClaude), in a voice chosen by a
theme. It ships as an npm package and as a plain git clone that updates itself with `git pull`.

## Code map

```
src/ + themes/ ──render──▶ bundle (Harness/) ──emit──▶ host install (.claude/, .opencode/, …)
                js/build/                     js/build/emit-*  +  js/hosts/
```

| Where | What lives there |
|---|---|
| `src/` | The harness content, authored once: `laws/`, `doctrines/`, `ontology/`, `agents/`, `skills/`, `loops/`, `bricks/`, `AGENT.md.tmpl` |
| `themes/` | One JSON file per voice; the same token keys in every file |
| `bin/` | Three entry points (below), each a thin shell over `js/` |
| `js/build/` | The generator: source → rendered text → bundle → per-host install |
| `js/hosts/` | Where it touches the machine: host config dirs, settings merges, hook verbs, the hook shim |
| `js/inspect/` | The read-only half: `doctor`, `status`, `diff`, `validate`, the catalog |
| `js/maintain/` | Lifecycle verbs that change an existing install: setup, update, uninstall, migrate |
| `js/loop/` | `geneseed loop`, the state machine over a loop file |
| `js/lib/`, `js/ui/`, `js/web/` | Primitives, terminal output, the `geneseed web` console |
| `adapters/` | Code that runs inside a host's process (OpenCode plugins) |
| `web/` | The console UI; `web/dist/` is built and committed |
| `tests/` | `node --test` units, the golden emit/CLI matrix, the mutation matrix |

**The three entry points.** `bin/geneseed-cli.mjs` is the user-facing CLI, parsed from
`js/cli-table.json`. `bin/geneseed-hook.mjs` is what an emitted `settings.json` runs on every tool
call. `bin/build-driver.mjs` is the generator.

## Invariants

Each one is enforced by a test or a doctor arm, not by convention.

- **Dependencies point one way.** `lib/` ← everything; `build/` ← `hosts/`; `inspect/` and `web/`
  read what `build/` produced. Nothing in `lib/` imports anything above it.
- **Zero runtime dependencies.** Anything needed at run time is vendored as tracked source and
  imported by relative path. → [ADR 0001](docs/adr/0001-zero-runtime-dependencies.md)
- **The generator cannot spawn, the hook path spawns in one place only, and the CLI spawns only
  what an allow-list declares.** →
  [ADR 0002](docs/adr/0002-no-spawn-on-the-generator-and-hook-path.md)
- **The hook path prints nothing but its verdict.** A verdict is JSON on stdout and every arm
  exits 0, so one stray printed byte turns a blocking gate silently permissive. Anything the hook
  entry imports is paid on every tool call (~14 ms).
- **`render.mjs` writes nothing.** It is the pure text pipeline every emit target serialises; a
  change there is visible in every theme at once.
- **One filter, one place.** `--exclude-skills` filters only in `renderAll`; every host's emit reads
  the filtered list, so a new host inherits it.
- **Install never needs a backup.** Root files get a delimited managed block, settings are merged
  key by key, skills and agents are claimed on create, and uninstall deletes only manifest-owned
  paths. → [ADR 0004](docs/adr/0004-uninstall-without-backups.md)
- **Rules are cited by id, numbered by position.** → [ADR 0005](docs/adr/0005-stable-rule-ids.md)
- **Expected values are written out.** No snapshot directory, no `--record`. →
  [ADR 0003](docs/adr/0003-expected-values-written-out.md)

## Cross-cutting concerns

- **Host parity.** A feature lands on every host in the same change; `emit-claude.mjs` and
  `emit-opencode.mjs` are deliberate twins, so edit both or neither.
- **Footprint.** What a harness costs in context is measured in
  [`docs/token-footprint.md`](docs/token-footprint.md); the context hook keeps its whole payload
  under the host's output cap.
- **Proving a change.** There is no `npm test`; the commands are in [`CLAUDE.md`](CLAUDE.md), and
  CI runs the same ones.
- **Security-critical paths** are listed in [`SECURITY.md`](SECURITY.md).
