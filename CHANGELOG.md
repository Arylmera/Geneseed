# Changelog

All notable changes to Geneseed are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions are the human-readable
labels in `harness.config.json`. The canonical identity of an *installed* harness
is the source fingerprint in `.geneseed-version` (see `geneseed version`), not this
label. For the capability ↔ spec map, see [SHIPPED.md](SHIPPED.md).

## [Unreleased]

### Added
- **GitHub Copilot host — `--emit copilot` / `--emit copilot-global`**: the fourth
  first-class host, riding the Claude-shaped emit engine. Per-repo: root `AGENTS.md`
  (auto-loaded by the Copilot CLI, coding agent, and VS Code agent mode) + a layer in
  the shared `.github/` dir — `agents/<name>.agent.md` in Copilot's custom-agent
  dialect (`tools:` allowlist for read-only agents, sibling links rewritten to the
  `.agent.md` extension) and byte-identical `skills/` (Copilot Agent Skills).
  Personal: `~/.copilot` (`$COPILOT_CONFIG_DIR` relocates) with the preamble as a
  managed block in `copilot-instructions.md`, which the CLI auto-loads — no Bob-style
  rules-folder workaround needed. Copilot has no settings.json or hook mechanism, so
  the settings/hooks/excludes stage is skipped entirely (memory rides the preamble's
  instructions); with no exclude mechanism either, the global emit warns when project
  installs exist (both preambles stack). Writing into `.github/` is safe by
  construction: the ownership manifest + claim-on-create never touch user files.
  Full lifecycle parity — setup wizard/TUI rows, web console deploy option +
  Harnesses rows, MCP wiring (`~/.copilot/mcp-config.json`, `mcpServers` with the
  CLI's required `type`/`tools` keys, global-only), doctor per-repo emit validation,
  rebuild-all, diff/restore, deactivate/reactivate/uninstall, footprint dial, and
  theme detection via the `copilot-instructions.md` sigil fallback.
- **User rules — `user-rules.md`**: a seed-once file beside AGENT.md for the user's
  own standing rules, obeyed with the same force as the laws (they may tighten a
  law, never repeal one). Same host-state contract as `context.json`: every emit
  seeds it once, never overwrites it, never records it in an owned manifest — so
  user governance survives updates, reinstalls, and theme switches; unlike
  `context.json` it is committable, so project rules can travel with a repo and
  bind the team. Named `user-rules.md` (not `rules.md`) because the neutral theme
  renders the laws themselves as "Rules". The context plugin and Claude hook
  eager-load it in discovery mode. A new **rule skill** drafts and triages rules
  (rule vs memory vs `context.json` vs already-covered), refuses law conflicts,
  promotes recurring feedback memories into trial rules with consent, and runs
  the review flow (graduate / demote / delete). Memory and notebook READMEs now
  route "share with the team" there instead of the regenerated laws.
- **Web console Rules page** (`#/rules`, right under Laws in the rail): list your
  rules with scope and trial chips, add/edit/retire them, graduate a trial rule,
  and watch a budget meter that turns amber as the always-loaded set grows. A
  **Promote to rule** control on memory facts turns a recurring lesson into a
  trial rule with provenance and deletes the source fact. Backed by
  `GET/POST /api/rules` + `/api/rules/promote` (token-gated); every write carries
  a content fingerprint and 409s when an agent session edited the file
  concurrently, and mutations splice one rule's block — the rest of the user's
  file is never regenerated.

### Fixed
- **Claude/Bob emits no longer ship dead skill-table links**: CLAUDE.md/AGENTS.md's
  per-row skill/agent links (e.g. `.claude/skills/council.md`) were dead — the
  native layer writes each skill as a folder (`.claude/skills/council/SKILL.md`).
  `_strip_capability_links` already ran on this path, but `CAPABILITY_LINK_RE`
  only matched a BARE `agents/`/`skills/` prefix; the claude/bob project-scope
  render re-prefixes those tokens (`.claude/`, `.bob/`, `../`), which slid straight
  past the regex. It now tolerates an optional relative-path prefix (never
  `http(s)://` or a leading `/`), so the existing strip catches every prefixed form
  too — same fix benefits the OpenCode emits' own prefixed edge cases. `doctor`
  gained a matching check (`_claude_bob_emit_problems`): it previously validated
  the `files` build and the opencode-global emit but never the claude/bob per-repo
  emits, which is why this shipped unnoticed; `--validate-only --emit claude`/`bob`
  are clean again, and the stale SETUP.md "known limitation" note is removed.
- **Renamed DIR_* dirs in the portable bundle no longer orphan**: the bundle's
  owned dirs (`laws`/`agents`/`skills`, in their themed form) are wiped and
  rebuilt each run, but the wipe was keyed only to the CURRENT theme's dir name —
  if a theme ever renamed one of them between two builds into the same target,
  the old dir was never targeted and lingered forever. A new local marker
  (`.geneseed-srcdirs.json`) now remembers which dir name was actually used last
  time, so a rename is also pruned. (Shipped themes don't currently vary DIR_*, so
  this is future-proofing rather than an active drift; the global/Claude/Bob
  scopes' equivalent case — a lean-footprint standalone laws dir surviving a
  switch back to full — is already covered by the owned-file manifest.)
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
- **`docs/specs/`, `docs/reviews/`, and `docs/superpowers/` are local working docs
  now**: untracked from git and added to `.gitignore`. They are per-machine work
  artifacts (dated specs are drafted, executed, then dropped — the existing
  lifecycle); the repo's prose (README, DESIGN, SHIPPED) no longer links them as
  distributed folders, and SHIPPED.md states its spec links are historical
  pointers into that local record.
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
- **Per-agent memory** — each capability agent now keeps durable lessons in
  `memory/agents/<name>.md`. Every agent spec reads its own file first at dispatch
  (step 0 of its procedure); the write-back is mechanical and lands on **all three
  hosts equally**: the OpenCode `geneseed-learn` plugin distils a finished subagent
  session into one per-agent lesson, and the claude/bob emits gain a `SubagentStop`
  hook that routes to the same Python path (`learn` reads the payload's
  `hook_event_name`). Unresolvable subagent name → silent no-op, never a wrong write.
- **`learn --consolidate`** — rebuilds `MEMORY.md` from the fact files on disk:
  re-indexes orphaned facts, prunes dead index lines, and reports duplicate
  descriptions for the user to merge (never auto-merged).
- **`dispatch` workflow** — a saved OpenCode workflow that decomposes a multi-domain
  goal, routes each subtask to its owning capability agent, and converges the
  results. Where a host has no `workflow` tool, the same shape runs model-driven via
  the parallel-agents skill. The **handoff envelope** (subtask goal, inputs, output
  contract; no commit/push — Law XX stays with the caller; gaps reported, never
  invented) is now written into `AGENT.md` for every emit, the OpenCode orchestrator,
  the parallel-agents skill, and the agent template.
- **Downgrade warning + stale-overrides notice**: re-emitting over an existing
  install now compares the deployed release (stamped in `.geneseed-version`
  alongside the fingerprint) against the source tree's `harness.config.json`
  version and prints a loud, warn-only notice when the deployed build is newer
  ("did you forget git pull?") — never blocks, since a deliberate downgrade must
  stay possible. `agent-overrides.json` is now stamped with `_version` at
  creation; the file itself is never rewritten on re-emit, but if it carries real
  overrides and its `_version` no longer matches the source, a one-line notice
  points you at reviewing them against the updated agent specs.
- **`build.py --validate-only`**: a dry run — full render, all doctor validations,
  and a sandboxed emit of the requested target, written to a temp dir and
  discarded. Exits non-zero on any problem, writes nothing real. (Note: `--emit
  claude|bob` currently reports known pre-existing dead skill-link problems;
  that fix is tracked separately.)
- **`build.py --sync-themes`**: fills any key `themes/_TEMPLATE.json` has but a
  theme JSON is missing — surgical line insertion in template order (no file
  churn), never removes extras, and exits 1 when it changed files so CI can use
  it as a check. The doctor's parity failure now points at it.
- **`AGENT_COLORS` theme key**: the OpenCode agent→colour-slot map moved from a
  hardcoded table in the emitter into `themes/_TEMPLATE.json` (and all shipped
  themes), so a theme can restyle agent UI grouping. Unknown slot values warn
  and fall back to `secondary`; themes missing the key fall back to the old
  built-in map.
- **Ask-tier bash for research agents**: `explorer` and `empiricist` now carry
  the same marker `historian` already had — OpenCode emits `bash: ask` (instead
  of deny) and Claude Code leaves Bash to its own permission prompts, so
  read-only searches (grep, git log) no longer dead-end. Every other read-only
  agent keeps the blanket deny.
- **`.opencode/` re-emits stopped wiping user files**: the project OpenCode emit
  now tracks what it owns in `.opencode/.geneseed-manifest.json` and prunes only
  stale owned files (write-before-delete), skipping user-authored files with a
  warning — the same claim-on-create model the Claude path always had. The first
  re-emit over a pre-manifest install treats existing files as yours and says so.
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
