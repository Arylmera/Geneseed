# Changelog

All notable changes to Geneseed are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions are the human-readable
labels in `harness.config.json`. The canonical identity of an *installed* harness
is the source fingerprint in `.geneseed-version` (see `geneseed version`), not this
label. For the capability ↔ spec map, see [SHIPPED.md](SHIPPED.md).

## [Unreleased]

### Added
- Three learning skills that teach the user rather than do the work for them:
  - `crash-course` — go from zero to functional in a skill fast: what to learn
    first, what to ignore, and the one high-leverage exercise.
  - `drill` — turn shaky knowledge into reflex through Socratic practice on
    realistic mistakes, withholding the answer until the user has tried.
  - `decode` — make confusing material click via one keystone sentence, an
    everyday analogy, and a three-question comprehension check.
  These join `learning-path`, `gap-detector`, and `feynman`, bringing the
  skill count to 33.

## [1.0.0] — 2026-06-13

First stable release. The harness, its tooling, and the local web console are
feature-complete and validated by a dependency-free CI (doctor + unit/node/web
suites) on Linux and Windows.

### Harness
- One neutral `src/` rendered by a stdlib-only generator (`build.py`) into 14
  themed, tool-agnostic bundles; structure stays theme-independent.
- 20 universal laws, 16 capability agents (6 execution + a 10-seat debate council),
  33 skills, the one-fact-per-file memory convention, and the agent's sovereign
  notebook.

### Tooling
- `geneseed` launchers for bash, cmd, and PowerShell; run-from-anywhere via
  `link`/`unlink`; `bootstrap`/`upgrade`/`sync-self` with SHA-pinned, self-healing
  updates.
- `doctor` (tokens, links, theme parity, authoring gates, bundle drift), `diff` +
  improvements export, `status`/`version`, a curses TUI with a native-Windows VT
  backend, and MCP wiring.

### Web console
- Local, offline, installable (PWA) browser UI over the deployed harness: Dashboard,
  Library, Graph, Docs, Specs, Changes, Doctor, Themes, Settings, About, plus a
  Spotlight search and a streaming job console. Background daemon; `127.0.0.1`-bound
  with a per-session CSRF token on every mutation.

### Adapters
- OpenCode native agent/skill mapping and four plugins (context, learn, guard,
  workflow); a Claude Code hook adapter.

### Documentation & quality (this release)
- Added a whole-project review (`docs/reviews/`), a `SHIPPED.md` capability registry,
  and a `docs/web-ui.md` console guide; demarcated `docs/superpowers/` as an archive.
- Added `themes/_TEMPLATE.json` + a theme-authoring guide, routed every theme
  enumeration through a single `build.theme_files()` helper (scaffolds excluded).
- Tightened the safety net: fixture tests for all three emit modes, self-tests for
  the doctor parity gate, the `context_delivery` node suite wired into CI, and a
  universal `prefers-reduced-motion` pass in the web UI.
- Removed a leaked authoring note from Law VII.

### Known follow-ups
Structural refactors identified in the review remain as post-1.0 work: generating the
`AGENT.md` capability tables from `src/`, unifying the three emit paths in `build.py`,
a route table for `web.py`, and replacing the `harness.py` namespace-merge facade with
explicit imports. None affect behaviour today.

[1.0.0]: https://github.com/Arylmera/Geneseed/releases/tag/v1.0.0
