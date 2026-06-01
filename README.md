# Geneseed

> A portable, theme-able harness you implant into any repository to grow a
> disciplined AI coding agent.

Geneseed distils a personal, vault-grown agent system into a generic,
tool-agnostic harness built around a single `AGENT.md`. Implant it into a repo
and any assistant that reads `AGENT.md` / `AGENTS.md` / `CLAUDE.md` inherits a
set of operating **rules**, a roster of capability **agents**, runnable
**skills**, and a **memory** convention.

## How it works

One canonical source in `src/` is written in neutral tokens. A tiny,
dependency-free generator (`build.py`) renders it into a themed bundle in
`dist/`. A theme changes only *terminology*, never structure — so the output
stays drop-in compatible with any tool.

```
python build.py                  # default theme (neutral)
python build.py --theme imperial # Warhammer-flavoured labels
```

Two themes ship:
- **neutral** — plain professional vocabulary (Rules, Agents, Skills, Memory).
- **imperial** — Warhammer 40k flavour (Codex, Legati, Rites, Anamnesis).

Adding a theme is one JSON file in `themes/`.

## Layout

```
Geneseed/
├── build.py              generator (stdlib only)
├── harness.config.json   default theme + metadata
├── src/                  canonical source — edit here
│   ├── AGENT.md.tmpl     the entrypoint that gets rendered to dist/AGENT.md
│   ├── laws/             governance rules (universal + project stub)
│   ├── agents/           capability specialists
│   ├── skills/           repeatable workflows
│   └── memory/           memory convention + index
├── themes/               token → label maps (neutral, imperial)
├── scripts/harness.py    optional CLI: build · doctor · prompt · learn
├── prompts/              self-contained install prompts (no Python needed)
├── adapters/             optional per-tool glue (Claude Code hooks, OpenCode config)
└── dist/                 generated bundle — this is what you port
```

## Implant it into a repo

There are two ways — pick whichever fits. Both let you choose the destination.

### A. Generator (build into any folder)

`--out` / `--target` accepts an absolute path or one relative to your current
directory, so you can render straight into the repo you want:

```
python build.py --theme neutral --target /path/to/your-repo
```

Then fill in `laws/project.md` with that repo's conventions.

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
python scripts/harness.py prompt --theme neutral            # to stdout
python scripts/harness.py prompt --theme imperial --out my-prompt.md
```

The prompt asks the agent which folder to target (default: the current repo root).

### Optional automation

Wire `scripts/harness.py` to a git hook or CI, or use the
`adapters/claude-code/` hook snippet.

### Tool adapters

- **OpenCode** — [`adapters/opencode/`](adapters/opencode/): a drop-in
  `opencode.json` (loads `AGENT.md` as a rule file), plus `build.py --emit
  opencode` which generates native subagents (`.opencode/agent/`) and commands
  (`.opencode/command/`) from the same source — zero drift.
- **Claude Code** — [`adapters/claude-code/`](adapters/claude-code/): SessionStart
  + Stop hook snippet.

## Validate

```
python scripts/harness.py doctor            # checks both: no unresolved tokens, no dead links
python scripts/harness.py doctor --theme imperial
```

## License

MIT — see [LICENSE](LICENSE).
