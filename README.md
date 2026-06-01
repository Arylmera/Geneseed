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
├── scripts/harness.py    optional CLI: build · doctor · learn
├── adapters/             optional per-tool glue (e.g. Claude Code hooks)
└── dist/                 generated bundle — this is what you port
```

## Implant it into a repo

1. `python build.py --theme neutral`
2. Copy `dist/AGENT.md`, `dist/agents/`, `dist/skills/`, `dist/memory/`, and
   `dist/laws/` into the target repository's root.
3. Fill in `laws/project.md` with that repository's conventions.
4. (Optional) wire `scripts/harness.py` to a git hook or CI, or use the
   `adapters/claude-code/` hook snippet.

## Validate

```
python scripts/harness.py doctor            # checks both: no unresolved tokens, no dead links
python scripts/harness.py doctor --theme imperial
```

## License

MIT — see [LICENSE](LICENSE).
