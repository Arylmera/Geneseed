# Geneseed

> A portable, theme-able harness you implant into any repository to grow a
> disciplined AI coding agent.

Geneseed distils a personal, vault-grown agent system into a generic,
tool-agnostic harness built around a single `AGENT.md`. Implant it into a repo
and any assistant that reads `AGENT.md` / `AGENTS.md` / `CLAUDE.md` inherits a
set of operating **rules**, a roster of capability **agents**, runnable
**skills**, a **memory** convention, and a **`context.json`** manifest that points
the agent at this repository's own documentation, wherever it lives.

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
├── adapters/             optional per-tool glue (Claude Code hooks, OpenCode config)
└── Harness/              generated bundle — this is what you port
```

## Implant it into a repo

There are two ways — pick whichever fits. Both let you choose the destination.

### A. Generator (build into any folder)

`--out` / `--target` accepts an absolute path or one relative to your current
directory, so you can render straight into the repo you want:

```
python build.py --theme neutral --target /path/to/your-repo
```

Then give the agent your repo's knowledge — copy `context.example.json` to
`context.json` and list your docs (see **Project context** below).

For **OpenCode**, add `--emit opencode` to also generate native subagents,
commands, and an `opencode.json` alongside the bundle:

```
python build.py --emit opencode --target /path/to/your-repo
```

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
