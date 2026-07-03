# Changelog

All notable changes to Geneseed are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions are the human-readable
labels in `harness.config.json`. The canonical identity of an *installed* harness
is the source fingerprint in `.geneseed-version` (see `geneseed version`), not this
label. For the capability ↔ spec map, see [SHIPPED.md](SHIPPED.md).

## [Unreleased]

### Fixed
- **Bob installs now actually load the preamble/theme**: IBM Bob's only
  always-injected instruction channel is the rules folder — a global
  `~/.bob/AGENTS.md` is never auto-loaded (only a project-root one is), which left
  Bob installs with working skills but no harness voice. Both Bob emits now also
  ship the preamble as `rules/geneseed.md` (project `.bob/rules/`, global
  `~/.bob/rules/`). The Claude-only `claudeMdExcludes` key is no longer written for
  Bob (its Bob semantics are undocumented and a filename-keyed match would suppress
  the project's own `AGENTS.md`); a re-emit strips one left by an older install.
  Project-bypasses-global on Bob now rides on its native rule precedence: the
  workspace `rules/geneseed.md` shadows the same-named global rule.

### Changed
- **Bob installs stopped double-paying the preamble**: a per-repo Bob install's
  `.bob/rules/geneseed.md` is now a slim shadow stub instead of a full second copy
  of the preamble — the repo-root `AGENTS.md` (auto-loaded) carries the
  instructions, and the stub's only job is to shadow the same-named global rules
  file (Bob injects every workspace rule each turn, so the full copy doubled the
  install's fixed per-turn token cost). The global Bob emit no longer writes
  `~/.bob/AGENTS.md` at all — Bob never auto-loads a global one; `rules/geneseed.md`
  is the sole carrier — and a re-emit removes the stale copy an older install left
  behind. Existing installs heal on the next rebuild/upgrade.
- **Self-update is now `git pull`**: `geneseed upgrade`/`update`/`sync-self` fast-forward
  the install's own git origin (host-agnostic — wherever it was cloned from), doctor-gate
  the result (rolling back on failure), then rebuild — replacing the bespoke curl/urllib
  archive-zip download stack. A dirty tree or non-git checkout is reported (CLI message + a
  web info popup) instead of failing mid-run.

### Removed
- The offline `geneseed upgrade --zip <file>` path and the web "Offline package" download
  (`/api/offline-zip`) — use `git pull` directly.

### Added
- **`harness uninstall` hardening**: a global uninstall now prints an inventory of
  any surviving PROJECT installs elsewhere (each is self-contained — its hooks call
  the shared checkout by absolute path, not the global config dir being removed —
  so nothing is touched, just listed with the exact `--target` to remove it too); a
  project uninstall now checks whether another host (Claude/OpenCode/Bob) also has
  an install at the same repo root and says so. A settings.json left with a
  leftover/locked owned file (Windows-plausible) no longer silently drops its
  `.geneseed-emit` marker — the marker is kept and the run is reported INCOMPLETE
  so the install can be found and retried. After every settings.json merge/unwire
  (emit, deactivate, uninstall), a new integrity check (`_settings_integrity_check`)
  verifies the manifest's claimed hooks/excludes actually match the file and warns
  (never auto-fixes) on drift or an unrecorded Geneseed-pattern hook left behind.
- **Project bypasses global harness**: when a repo carries its own Geneseed
  install, the same host's GLOBAL harness no longer double-loads there. For
  Claude/Bob a project emit writes the global preamble into `claudeMdExcludes`
  (native, repo-scoped) and the global SessionStart context hook stands down via
  an up-walk marker check — so a session started anywhere in the repo gets the
  project harness only, and the global one elsewhere. OpenCode already scopes its
  context to the cwd (the context plugin dedups), and its `instructions[]`
  preamble double-load remains the documented harmless cost (moving it would
  strip subagents of the laws). Opt out — restore stacking — with
  `GENESEED_STACK_GLOBAL=1` (honoured at emit and in the hook).
- **Law XXI — Commands Must Return**: a non-interactive-shell law forbidding
  commands that hang on a TTY (interactive prompts, pagers, REPLs, editors,
  unbounded processes) and directing the agent to the non-interactive form
  (`--yes`, `--no-pager`, piped input, bounded long runs). Brings the law count
  to 21. (Distilled from awesome-opencode's *Shell Strategy* plugin.)
- **Context plugin — self-awareness & command discovery**: `geneseed-context`
  now surfaces the session's live model (read from the transcript, with a
  `GENESEED_MODEL` fallback) and the project's runnable command targets
  (`Makefile`, `package.json` scripts, `justfile`, `Taskfile`) in the injected
  PROJECT CONTEXT block. (Distilled from awesome-opencode's *Model Announcer* and
  *Command Inject* plugins.)
- **`geneseed-notify` plugin** (OpenCode): a fifth plugin that sends a native,
  dependency-free OS notification (macOS `osascript`, Linux `notify-send`, Windows
  PowerShell) when the agent finishes a turn — gated by `GENESEED_NOTIFY_MIN_SECONDS`
  (default 30) so only genuinely long runs ping, and skipping subagent/throwaway
  sessions. Toggle with `GENESEED_NOTIFY=off`. (Distilled from awesome-opencode's
  *Opencode Notify*.)
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
  30 skills, the one-fact-per-file memory convention, and the agent's sovereign
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
