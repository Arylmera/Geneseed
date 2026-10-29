# `js/` — the module map

Every module under `js/`, in eight folders. This page is the address book: **what each one owns**, and
**which file to open first** for a given task. It is not documentation of behaviour — every module
has a docblock for that, and the docblock is the thing to read before editing.

`tests/unit/module_map.test.mjs` keeps this page honest: a module with no row here, or a row naming
a module that does not exist, is a test failure. `geneseed doctor` reports the same thing.

---

## The shape

```
bin/geneseed-cli.mjs     the `geneseed` CLI — 20+ verbs, may NOT spawn
bin/geneseed-hook.mjs    the hook entry — 5 verbs, loads on EVERY tool call (~14 ms)
bin/build-driver.mjs     `geneseed-build` — a thin entry over js/build/driver.mjs

js/build/     src/ + themes/  →  rendered text  →  a bundle  →  a per-host install
js/hosts/     where it stops being a renderer and touches the machine
js/inspect/   the read-only half: doctor, status, diff, validate, catalog
js/lib/       primitives, every one a deliberate divergence from the Node default
js/loop/      `geneseed loop` — the state machine over LOOP.md, and what it steps through
js/maintain/  lifecycle verbs that change an install that already exists
js/ui/        what it prints at a terminal
js/web/       the `geneseed web` console
```

**Dependency direction is only partly one-way, and no test or doctor arm enforces any of it.**
`lib/` is the one true leaf: it imports only Node builtins and itself, and every other folder
imports it. A few modules sit just above it and are read from almost everywhere: `build/source.mjs`
(the source paths, the rule canon, `aliasesOf`), `hosts/hosts.mjs` (the host config dirs) and
`loop/score.mjs` (builtins only, by its docblock). Above those, the folders are domains, not
layers. These pairs import each other (relative imports between folders, measured 2026-10):

| pair | edges A→B / B→A | the smaller direction |
|---|---|---|
| build ↔ hosts | 24 / 5 | hosts reads `build/source.mjs` (`installs`, `link`, `native`, `opencode`) and `build/version.mjs` (`opencode`) |
| build ↔ inspect | 2 / 23 | `build/driver.mjs` records deploy roots in `inspect/registry.mjs`; `build/catalog.mjs` reads `inspect/inventory.mjs` |
| build ↔ loop | 4 / 1 | `loop/catalog.mjs` reads `build/source.mjs` |
| build ↔ ui | 2 / 1 | `ui/cli.mjs` reads `ROOT` from `build/source.mjs` |
| build ↔ web | 1 / 9 | `build/generate.mjs` lazily imports `web/daemon.mjs` to restart a stale console after `rebuild-all` |
| hosts ↔ inspect | 1 / 36 | `hosts/installs.mjs` reads `inspect/registry.mjs`'s deploy roots |
| ui ↔ web | 1 / 1 | `ui/menu.mjs` starts the daemon; `web/docs.mjs` renders `ui/cli.mjs`'s CLI reference |
| maintain ↔ web | 1 / 6 | `maintain/update.mjs` lazily imports `web/daemon.mjs` for the same restart |

The only gates over the import graph are the transitive closure walks in
`tests/unit/hook_cli.test.mjs`. They pin which modules the generator and CLI entries may pull
`child_process` into, not which folder imports which. Adding a cross-folder import is therefore a
review question, not a test failure.

---

## `js/build/` — the generator

Turns the checkout's `src/` + `themes/` into rendered text, writes that into a bundle, and emits it
as a per-host install at project or global scope.

| module | owns |
|---|---|
| `source.mjs` | Where the SOURCE is: `ROOT`/`SRC`/`THEMES`/`CONFIG`, `PACK_ORDER`, the rule canon (stable ids → positional numbers, citations → names), the cfg object |
| `render.mjs` | The pure text pipeline: theme load, `INCLUDE` inlining, CATALOG blocks, `{{TOKENS}}`, dest paths |
| `bundle.mjs` | `build` — render a theme into a bundle dir, plus the source-completeness refusal. Sits UNDER both emits |
| `emit-claude.mjs` | The Claude/Bob/OpenClaude emit — the render half plus the settings + CLAUDE.md managed-block wire |
| `emit-opencode.mjs` | The OpenCode emits — a project's `.opencode/` and the global config dir. Deliberate twin of the above |
| `emit-common.mjs` | Constants, tree walkers, and the three writers BOTH global emits share. Decides no host |
| `stubs.mjs` | Write-once seed files: context, wiki, rules, excludes, profile, `.gitignore`, memory/notebook indexes |
| `version.mjs` | The release marker: fingerprint the sources, read/compare/write an install's version, warn on downgrade |
| `driver.mjs` | The generator driver: the nine emit targets, per-host emit orchestration, the prune and the manifest. `bin/build-driver.mjs` is only its entry |
| `args.mjs` | The generator's flag surface: `harness.config.json` defaults, the `--emit`/`--theme`/`--footprint` parse tables and choices, `-h`, and `die` (a throw, so `rebuild-all` survives one bad install) |
| `generate.mjs` | CLI verbs `build`, `prompt`, `theme`, `rebuild-all` — the thin face over `driver.mjs` |
| `catalog.mjs` | `geneseed catalog` — prints the shipped roster. Classifies nothing itself |
| `themes.mjs` | Maintainer-only `--sync-themes`: inserts `_TEMPLATE.json`'s missing keys into the committed themes |

**Before editing:** `render.mjs` writes nothing, and its output is what every emit target
serialises — a change there is visible in all 14 themes at once. `emit-claude.mjs`'s
wire half edits files the **user** co-owns — get its prior-claim pruning wrong and you delete
someone's own settings keys. `emit-opencode.mjs` is shaped as a twin on purpose: a change that
lands on one host and not the other is the historical defect here, so edit both or neither.
`stubs.mjs` bodies are compared byte-for-byte by a recording — editing prose in one is a product
change. `themes.mjs` rewrites hand-written files in the repo, and `git diff` is where you would
find out about a slip.

## `js/hosts/` — touching the machine

Resolving each host tool's config directories, writing host-native agents and skills into files the
user co-owns, and the hook verbs those emitted configs then run.

| module | owns |
|---|---|
| `hosts.mjs` | The four host config dirs (opencode/claude/bob/openclaude), their `family` (`CLAUDE_STYLE`), plus `resolvePath`/`expanduser` |
| `hooks.mjs` | The gate verbs, run on every tool call: `git-gate`, `rule-gate`, `tool-gate` (the two gates fused, for Bob), plus `ask`/the gate ledger/`guardGate`. `--host` picks the verdict dialect |
| `hooks-context.mjs` | The `context` verb — SessionStart: session files plus the repo's context docs |
| `ownership-gate.mjs` | The ownership first-write gate, last in `rule-gate`: in an application repo (git root + build manifest) whose root `AGENTS.md` has no `## Ownership` section, denies the session's first write once (a tmpdir marker per session). Builtins + `gitRootOf` only. Twin: the OpenCode guard plugin |
| `hooks-done.mjs` | The done gate (#289): on Stop, inside `learn` and before its spawn, judges a turn that edited files against the project's checks — blocks until `.geneseed/done-checks.txt`'s checks passed after the last edit; without that file, the inferred checks are advisory (a `systemMessage`, never a block) |
| `done-checks.mjs` | Where the done gate's checks come from: `.geneseed/done-checks.txt`, else inferred from the git root's manifests (package.json scripts, pom.xml, Gradle, pyproject.toml, Cargo.toml, go.mod), each a group of accepted command forms; plus `doneLine`, the SessionStart line `context` prints. Spawn-free: `context` is in the CLI's closure. Twin: the OpenCode context plugin |
| `hooks-learn.mjs` | The `learn` verb — Stop/SubagentStop/PreCompact distiller; the hook path's ONE spawn (`$GENESEED_LLM`) |
| `hooks-prims.mjs` | The Python path/text primitives the hook verbs share (`splitLines`, `readStdin`, a never-throwing `isFile`), plus the activity off switch (`activityOn`) and the do-nothing `activity` verb |
| `activity.mjs` | The hook-side activity writer and the owner of snapshot liveness: `recordActivity` (one payload into `<root>/activity/`), `readTranscriptDelta`, `sweepActivity` (archive, newest 50, 7 days). Loaded only when tracking is on; never prints |
| `usage.mjs` | The usage counter `tool-gate` runs: one `{day, kind, name}` line per Skill or subagent call into `notebook/usage.jsonl`. Hook path: builtins only, silent, never throws |
| `memory-files.mjs` | The memory store's file format — `frontmatter`, `MEMORY.md` index writes, agent lessons, consolidate. No spawn: the CLI and web console import it |
| `geneseed-dir.mjs` | The Node writers into a project's `<git root>/.geneseed/`: the personal-by-default `.gitignore` (`GENESEED_GITIGNORE`, pinned to the two OpenCode copies), and the protected-checks seed every project emit runs (`seedProtectedChecks`: seed once when absent, then the user's — never recorded, rewritten or uninstalled). Never throws, never writes through a link. Spawn-free |
| `gitref.mjs` | fs/path-only: `gitRootOf`, `gitDirOf`, `gitCommonDirOf`, `currentBranch`, `protectedBranches`, `stashExists`, `loopLaunched` — read straight off `.git`, never spawn git. Shared by `hooks.mjs`'s git-gate, `loss.mjs` and `js/loop/cli.mjs`'s commit-message writer |
| `loss.mjs` | Law IV calibrated to real loss: `lossReason` decides whether a command would really lose data (protected branch, unpushed branch, dirty tree, stash, reflog, files git cannot restore) and fails closed. The gate path's one `git` spawn, reached only after `LOSS_CANDIDATE_RE` matched. Twin: the OpenCode guard plugin |
| `settings.mjs` | Merges into user-owned `settings.json`/`opencode.json` (one `loadJsonObject` reader for all of them) and the managed blocks |
| `shim.mjs` | The machine-wide hook shim: its path, body, liveness (`shimDead`, read on every CLI run), `hookPrefix`/`hookRunnerEntry`. Kept cheap to import |
| `native.mjs` | Capability specs → host-native subagents and skills. The impure half of the emit |
| `opencode.mjs` | OpenCode-only extras: colour themes, primary agent, `/commands`, plugins, overrides stub |
| `installs.mjs` | Detects deployed installs and reads back their theme, footprint, posture, mode and loop trust preset |
| `mcp.mjs` | Reads each host's MCP config (`mcpServers`, or OpenCode's `mcp`) and where it lives — read-only since 2026-10: the user edits the file, Geneseed only shows it |
| `link.mjs` | `geneseed link`/`unlink` — the PATH shim, and the only Windows USER-Path registry edit |
| `owned.mjs` | Manifest rel -> path on disk decisions: `ownedWithin`, the containment boundary `uninstall.mjs` and the driver's prune both go through before acting on an `owned` list entry |

**Before editing:** `hooks*.mjs` **are the hook path** — the verdict travels as JSON on stdout and
every arm exits 0, so one stray printed byte turns a blocking gate silently permissive, and anything
`hooks.mjs` or `hooks-prims.mjs` imports is paid on every tool call. `bin/geneseed-hook.mjs` loads
one verb's module per process, so keep context and learn code out of the gate module. `hosts.mjs` is shared by the generator, the CLI and the
hook path, so it must stay free of `child_process`. `installs.mjs` reads through `readMaybe`, which
folds CRLF — a bare `readFileSync` here is a bug.

## `js/inspect/` — the read-only half

Everything that inspects an already-built or already-deployed harness and reports on it.

| module | owns |
|---|---|
| `doctor.mjs` | The `geneseed doctor` **driver** only: picks themes, runs the checks, prints the verdict |
| `checks-build.mjs` | Gates over what the build PRODUCED: links, tokens, theme parity, OpenCode colours, bundle drift |
| `checks-repo.mjs` | Gates over the repo's own records: `registry.json`, committed secrets, the hook shim, vendored pins and folder skills, skill aliases and side files, this module map, the host tables, the scorecard ratchet |
| `checks-authoring.mjs` | `authoringProblems`, the aggregate self-consistency gate: spec purpose lines, the learn-prompt literal, `node --check` over the plugins (the doctor's one default spawn), then the groups below |
| `checks-probe.mjs` | `doctor --probe` (opt-in): runs each live install's own gate command through the host's shell on a must-refuse and a must-pass payload — the doctor's second spawn; the OpenCode guard plugin is imported and called in-process instead, through both plugin APIs |
| `checks-constitution.mjs` | The constitution: rule declarations and citations, LEAN blocks, `HOOK_PINNED`, theme vocabulary, the per-rule summaries (`ruleSummaryProblems`) |
| `checks-counts.mjs` | The hand-written counts: AGENT.md tables, README badges and prose, `SHIPPED.md`, held against `src/` |
| `scan.mjs` | The shared walk/sort/strip/test primitives every `checks-*` uses. Owns no judgement itself |
| `validate.mjs` | The `validate` verb (the generator's old `--validate-only`): renders a sandbox, scans it for tokens and dead links, own exit contract |
| `inventory.mjs` | The one catalog walk and its taxonomy tables, read by status, the TUI and the web console |
| `status.mjs` | `geneseed status` and `version` — the panel data, counts, accent colour, version verdict |
| `cost.mjs` | What one install injects every session, by part (root file, skill and agent lists, session files), in characters; owns `CARRIER_CEILING`, which the smoke test gates and the console draws |
| `diff.mjs` | `geneseed diff` — what a deployed install has that a fresh render of `src/` does not |
| `excludes.mjs` | `geneseed exclude add|remove|list` — the WRITER for `excludes.json`; `hooks.mjs` only reads it |
| `registry.mjs` | `installs.json` under XDG — the persistent deploy-root list `rebuild-all` re-emits into |
| `scorecard.mjs` | `geneseed scorecard` — a port of the AI Harness Scorecard (upstream pinned in its docblock): the repo walk, the CI-YAML parsing, `assessRepo`, the text/JSON renderers. Pure: no spawn, no network |
| `scorecard-yaml.mjs` | The YAML 1.1 subset the scorecard reads CI configs with, plus Python's `str()`/`bool()` over its values; `scorecard.mjs` re-exports it. Its ceiling is in its `ponytail:` note |
| `scorecard-svg.mjs` | The scorecard as an SVG card for a README (`geneseed scorecard --svg`): grade plus one bar per pillar, deterministic so doctor can compare the committed card byte for byte |
| `scorecard-checks.mjs` | The scorecard's 31 checks in five pillars, ported line for line — ids, points, partial scores, evidence and fixes as upstream writes them |

**Before editing:** every check returns an array of problem strings, empty when clean — and since
deleting any check leaves a clean run **byte-identical**, each one is gated by a PLANTED FAULT, not
by a comparison. `scan.mjs`'s `TOKEN_RE` must stay in step with `render.mjs`'s. `registry.mjs`
swallows its own errors on purpose: a registry hiccup must never fail a build.

## `js/lib/` — the primitives

Zero dependencies. **Every function here exists because the Node default is wrong for this tool** —
each one's docblock says which default, and why. Change a rule and you change what the tool writes
into files users have committed, so change the test that states it in the same commit.

| module | owns |
|---|---|
| `fs.mjs` | All disk and stdout/stderr writes. The single owner of the `\n` → `os.linesep` translation |
| `json.mjs` | The int/float-preserving parser (`JsonNumber`) plus every dumps/repr renderer |
| `paths.mjs` | Case folding, ordering, containment, spelling, PATH lookup — the platform-shaped rules |
| `text.mjs` | String primitives: `codePointLength`, `WHITESPACE`, `parseIntStrict`, `percentDecode` |
| `udiff.mjs` | `geneseed diff`'s own difflib clone — the alignment IS the printed hunks — plus `splitLines` |
| `proc.mjs` | One constant: the `windowsHide` flag every spawn in `js/` must reuse |
| `prompt.mjs` | The line-mode stdin readers — `ask`, `promptLine`, `confirm`, `askChoice` — read a byte at a time so they stop where Enter stops. Shared by `setup`, `uninstall` and `web` without dragging in the wizard |
| `node-floor.mjs` | The first import of all three binaries: below Node 22.7, one sentence on stderr and exit 1 (0 in the hook) instead of a stack trace |

**Before editing:** parse with `parseJson`, never `JSON.parse` — the latter collapses int `1` and
float `1.0` into one double, and that value gets written into a user's file. Do not swap in a diff
library for `udiff.mjs`: it is not Myers, ties resolve to the earliest match. Every function in
`paths.mjs` branches on `process.platform`, so green on one OS proves nothing about the other.

## `js/loop/` — the loop engine

`geneseed loop` — a state machine over a brick graph, persisted as a JSON block in `LOOP.md` at
the git root. The model only ever runs the node it is handed and reports an outcome; every
transition, score and stop is computed here.

| module | owns |
|---|---|
| `graph.mjs` | `checkGraph` — the rules a loop graph must satisfy before a node runs: nodes name real bricks, edges cover every outcome, `$close` is reachable, every cycle is inside a declared loop |
| `score.mjs` | The risk arithmetic: `WEIGHTS`, `PRESETS`, `declaredRisk`/`actualRisk`/`decide`, `parseNumstat`. Pure — no import but node builtins |
| `catalog.mjs` | `loadCatalog` — bricks and loop templates from shipped/global/project origins, later overrides earlier BY NAME |
| `state.mjs` | The engine itself: `initState`, `nextStep`, `scoreDeclared`/`scoreDiff`, `recordOutcome`, `decideAwaiting`, `renderLoopFile`/`parseLoopFile` |
| `cli.mjs` | `geneseed loop check\|init\|next\|score\|record\|decide` — the only face either a model or a human reaches this engine through |
| `registry.mjs` | `loops.json` under XDG — the launched-loop identity list `loop init` records into and the Active tab's `activeLoops`/`setLoopPreset` read and rewrite |

**Before editing:** `score.mjs` is imported by the build driver (the `--trust` choices), so it must
stay free of every import but node builtins and `graph.mjs`. `state.mjs` excludes `LOOP.md` itself
(and its own atomic-write sibling, `LOOP.md.tmp`) from every score and every read-brick porcelain
check — it is the engine's own bookkeeping, never part of the work being scored. Every LOOP.md
write goes through `state.mjs`'s `writeLoopFile`, never a bare `writeText`, so a killed process
cannot leave a torn file. `cli.mjs` may not spawn: git output is piped in on stdin by the model,
never read by this entry. `registry.mjs` swallows its own errors on `recordLoop`/`activeLoops` on
purpose, like `js/inspect/registry.mjs` — a registry hiccup must never fail `loop init` or a
read — but `setLoopPreset` does not: a preset change the caller asked for must be reported when it
fails. `activeLoops` saves the registry back only when the kept set actually changed (a pruned
root, a loop newly seen finished or seen running again) — a routine poll from the Active tab must
never be a write.

## `js/maintain/` — lifecycle

Verbs that change an install that already exists, as opposed to rendering one.

| module | owns |
|---|---|
| `update.mjs` | `upgrade`/`sync-self`/`bootstrap` — git pull, doctor gate, rebuild, each via a respawn |
| `setup.mjs` | The install wizard. Its prompts go through `js/lib/prompt.mjs`'s stdin readers |
| `uninstall.mjs` | Removes or disables an install: manifest-driven reversal, plus stash deactivate/reactivate |
| `migrate.mjs` | `geneseed migrate` — all-or-nothing re-emit moving installs onto the npm install shape |
| `memory.mjs` | `geneseed memory list|rm` — CLI-side fact removal (archive by default, `--purge` deletes), twin of the web delete endpoint |

**Before editing:** `update.mjs` is the one module that MUST spawn rather than import — the code on
disk is replaced mid-run, so an in-process call would validate the *old* source and then render it.
The stdin readers are not here: they live in `js/lib/prompt.mjs`, shared by `setup.mjs`,
`uninstall.mjs` and `js/web/server.mjs`. `memory.mjs` deletes user facts: `rm` moves a fact into
`archive/` by default, but `--purge` unlinks it and nothing can bring it back.

## `js/ui/` — the terminal

| module | owns |
|---|---|
| `cli.mjs` | The whole CLI surface as data (`js/cli-table.json`) plus `--help` rendering and text wrapping |
| `menu.mjs` | Entry points for a bare `geneseed` and for `menu` — the web-vs-terminal fork |
| `tui.mjs` | The `tui` verb plus the panel's pure layout half: display width, glyphs, fit/truncate, rows |
| `anim.mjs` | Per-theme install ASCII art and its line animation — the only ANSI-emitting file here |

**Before editing:** there is no argument-parser *definition* in the code — every verb, flag, default
and help string lives in `js/cli-table.json`, and the table IS the parser. Most of `tui.mjs`'s
exports have no caller inside it: they are the curses-free half of a panel that does not exist.

## `js/web/` — the console

A dependency-free localhost HTTP daemon that serves the built React UI from `web/dist` and exposes
the deployed harness as JSON.

| module | owns |
|---|---|
| `server.mjs` | `serve()`/`cmdWeb`: UI-build precheck, socket bind, token mint, daemon record wiring |
| `routes.mjs` | The route tables — `STATE_ROUTES`, `PREFIX_ROUTES`, `POST_ROUTES` (+ its 409 column) — and the inline lists |
| `handler.mjs` | One function per request: dispatch, gzip, `requestGuard` (Host+port, Origin/Sec-Fetch-Site on `/api`, constant-time CSRF token) and body cap (before the body is read), `securityHeaders` (CSP nonce, framing), static SPA fallback |
| `state.mjs` | `webState` — the resolved install view every endpoint reads, with its cached inventory and doctor |
| `catalog.mjs` | The Library read model: inventory, constitution tiers, memory/notebook/wiki/config items, `apiCatalog`/`apiItem`, `NotFound` |
| `api.mjs` | The dashboard and settings reads: overview, recent, themes, setup, doctor, diff, installs, excludes, loops |
| `update-check.mjs` | Is a newer release on npm? Answers from memory, refreshes in the background (a day when it got an answer, an hour when it did not), `null` on any failure, never asked under `node --test` |
| `gates-api.mjs` | `GET /api/gates`: gate asks per rule per day over 30 days, read off every installed harness's `notebook/gates.jsonl` (the Overview's sparklines) |
| `usage-api.mjs` | `GET /api/usage`: the 30-day skill and agent call counts across every installed harness, the never-fired list, a fleet-wide `names` list (per-name 30-day counts, installs, daily series, last day seen), and skips lines older than 90 days in each `notebook/usage.jsonl` |
| `user-files.mjs` | The fingerprint-guarded editors for `user-rules.md` (incl. memory promotion) and `PROFILE.md`, read and write |
| `actions.mjs` | The other mutating endpoints — memory delete, MCP, excludes, installs, view, restore — plus install/deploy argv |
| `daemon.mjs` | Detached web start/stop/status/restart, the `.geneseed-web.json` record, and `openUrl` |
| `jobs.mjs` | `JobManager` and the action→argv table. The only module here that spawns job children |
| `docs.mjs` | The Docs tab: the `docs/<folder>/` page registry, `?harness=` filtering, link rewriting, the six page kinds |
| `activity.mjs` | The `activity/` session files: pid-liveness prune, list, detail, and the on/off flag |

**Before editing:** `makeHandler(state, jm, token, dist, holder)`'s arity is load-bearing — three
test call sites construct one directly and drive it without a socket. `routes.mjs`'s tables
and inline lists are held against a surface list written out in
`tests/unit/web_server.test.mjs` — growing or shrinking the API edits both, in one commit.

---

## Where do I add…

| I want to | open first | then |
|---|---|---|
| a doctrine rule | `src/doctrines/<pack>.md` — `### {{DOCTRINE:<id>}} <Principle>`; the number is its position | `docs/extending.md` §2a — five files, `--sync-themes`, restyle 14 voices by hand. Author BOTH LEAN halves |
| a law (invariant) | `src/laws/universal.md` — `### {{LAW:<id>}} <Principle>`; cite by id, never by number | `docs/extending.md` §2c. Author both LEAN halves: the lean footprint ships nothing else |
| to remove or retire a rule | `docs/extending.md` §2e | `RETIRED_RULE_IDS` in `js/build/source.mjs` — a retired id is never reused |
| a skill or an agent | `src/skills/<name>.md` or `src/agents/<name>.md` | `docs/extending.md` §3 — eight steps. Write the FILE before the table row or the build aborts |
| a doctor check | `js/inspect/checks-{build,repo,authoring,constitution,counts}.mjs`; `checks-probe.mjs` for a check that runs a live install's gates | wire it in one of two ways. Give it its own `ran(...)` group in `doctor.mjs`, as the module map and the host tables have. Or append it to `authoringProblems`, which is how the constitution and count checks run. Then add a PLANTED FAULT in `tests/unit/harness.test.mjs` (`tests/unit/doctor_probe.test.mjs` for the probe) |
| a web endpoint | GET → `js/web/api.mjs`; POST → `js/web/actions.mjs` | declare it in `js/web/routes.mjs`; the partition test probes the real handler |
| a CLI verb | `js/cli-table.json` — the table IS the parser | the `VERBS` row in `bin/geneseed-cli.mjs`, the row count in `cli_table.test.mjs`, and, for a Node-native verb with no recorded cell, `NATIVE` in `tests/unit/hook_cli.test.mjs` |
| a hook verb | `js/hosts/hooks.mjs` (a gate) or its own `js/hosts/hooks-<verb>.mjs` | `claudeHookGroups` in `settings.mjs`, the `VERBS` row (with its `load`) in `bin/geneseed-hook.mjs`. Keep the import graph tiny |
| a console doc page | `docs/<understand|guides|concepts|reference>/<id>.md` — the stem is the id | `docs/extending.md` §4c. Only `kind: "concept"` gets `{N_*}` substitution |
| an OpenCode plugin | `adapters/opencode/plugins/geneseed-<name>.js` | `docs/extending.md` §4a — the `geneseed-` prefix is mechanically load-bearing |
| to change a `js/lib/` primitive | `tests/unit/lib_primitives.test.mjs` **first** | the docblock says which Node default it deliberately departs from — change that sentence too, or the next reader restores the default |
