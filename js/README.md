# `js/` — the module map

Fifty-six modules in seven folders. This page is the address book: **what each one owns**, and
**which file to open first** for a given task. It is not documentation of behaviour — every module
has a docblock for that, and the docblock is the thing to read before editing.

`tests/unit/module_map.test.mjs` keeps this page honest: a module with no row here, or a row naming
a module that does not exist, is a test failure. `geneseed doctor` reports the same thing.

---

## The shape

```
bin/geneseed-cli.mjs     the `geneseed` CLI — 20+ verbs, may NOT spawn
bin/geneseed-hook.mjs    the hook entry — 4 verbs, loads on EVERY tool call (~14 ms)
bin/build-driver.mjs     `geneseed-build` — the generator's flags and emit targets

js/build/     src/ + themes/  →  rendered text  →  a bundle  →  a per-host install
js/hosts/     where it stops being a renderer and touches the machine
js/inspect/   the read-only half: doctor, status, diff, validate, catalog
js/lib/       primitives, every one a deliberate divergence from the Node default
js/maintain/  lifecycle verbs that change an install that already exists
js/ui/        what it prints at a terminal
js/web/       the `geneseed web` console
```

Dependency direction is one-way: `lib/` ← everything; `build/` ← `hosts/`; `inspect/` and `web/`
read what `build/` produced. Nothing in `lib/` imports anything above it.

---

## `js/build/` — the generator

Turns the checkout's `src/` + `themes/` into rendered text, writes that into a bundle, and emits it
as a per-host install at project or global scope.

| module | owns |
|---|---|
| `source.mjs` | Where the SOURCE is: `ROOT`/`SRC`/`THEMES`/`CONFIG`, `PACK_ORDER`, rule ids, the cfg object |
| `render.mjs` | The pure text pipeline: theme load, `INCLUDE` inlining, CATALOG blocks, `{{TOKENS}}`, dest paths |
| `bundle.mjs` | `build` — render a theme into a bundle dir, plus the source-completeness refusal. Sits UNDER both emits |
| `emit-claude.mjs` | The Claude/Bob/Copilot emit — the render half plus the settings + CLAUDE.md managed-block wire |
| `emit-opencode.mjs` | The OpenCode emits — a project's `.opencode/` and the global config dir. Deliberate twin of the above |
| `emit-common.mjs` | Constants, tree walkers, and the three writers BOTH global emits share. Decides no host |
| `stubs.mjs` | Write-once seed files: context, wiki, rules, excludes, profile, `.gitignore`, memory/notebook indexes |
| `version.mjs` | The release marker: fingerprint the sources, read/compare/write an install's version, warn on downgrade |
| `generate.mjs` | CLI verbs `build`, `prompt`, `theme`, `rebuild-all` — the thin face over `bin/build-driver.mjs` |
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
| `hosts.mjs` | The four host config dirs (opencode/claude/bob/copilot), plus `resolvePath`/`expanduser` |
| `hooks.mjs` | The verbs the emitted hooks run every session: `context`, `git-gate`, `rule-gate`, `learn` |
| `settings.mjs` | Merges into user-owned `settings.json`/`opencode.json`; owns the hook shim and the managed blocks |
| `native.mjs` | Capability specs → host-native subagents and skills. The impure half of the emit |
| `opencode.mjs` | OpenCode-only extras: colour themes, primary agent, `/commands`, plugins, overrides stub |
| `installs.mjs` | Detects deployed installs and reads back their theme, footprint, posture and mode |
| `mcp.mjs` | MCP server presets, the per-host `mcpServers` config read/write, and toggle state |
| `link.mjs` | `geneseed link`/`unlink` — the PATH shim, and the only Windows USER-Path registry edit |

**Before editing:** `hooks.mjs` **is the hook path** — the verdict travels as JSON on stdout and
every arm exits 0, so one stray printed byte turns a blocking gate silently permissive, and anything
imported here is paid on every tool call. `hosts.mjs` is shared by the generator, the CLI and the
hook path, so it must stay free of `child_process`. `installs.mjs` reads through `readMaybe`, which
folds CRLF — a bare `readFileSync` here is a bug.

## `js/inspect/` — the read-only half

Everything that inspects an already-built or already-deployed harness and reports on it.

| module | owns |
|---|---|
| `doctor.mjs` | The `geneseed doctor` **driver** only: picks themes, runs the checks, prints the verdict |
| `checks-build.mjs` | Gates over what the build PRODUCED: links, tokens, theme parity, OpenCode colours, bundle drift |
| `checks-repo.mjs` | Gates over the repo's own records: `registry.json`, committed secrets, the hook shim, vendored pins |
| `checks-authoring.mjs` | Self-consistency: law/doctrine metadata, constitution numbering, the counts README and the web quote |
| `scan.mjs` | The shared walk/sort/strip/test primitives all three `checks-*` use. Owns no judgement itself |
| `validate.mjs` | The `--validate-only` verb: renders a sandbox, scans it for tokens and dead links, own exit contract |
| `inventory.mjs` | The one catalog walk and its taxonomy tables, read by status, the TUI and the web console |
| `status.mjs` | `geneseed status` and `version` — the panel data, counts, accent colour, version verdict |
| `diff.mjs` | `geneseed diff` — what a deployed install has that a fresh render of `src/` does not |
| `excludes.mjs` | `geneseed exclude add|remove|list` — the WRITER for `excludes.json`; `hooks.mjs` only reads it |
| `registry.mjs` | `installs.json` under XDG — the persistent deploy-root list `rebuild-all` re-emits into |

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

**Before editing:** parse with `parseJson`, never `JSON.parse` — the latter collapses int `1` and
float `1.0` into one double, and that value gets written into a user's file. Do not swap in a diff
library for `udiff.mjs`: it is not Myers, ties resolve to the earliest match. Every function in
`paths.mjs` branches on `process.platform`, so green on one OS proves nothing about the other.

## `js/maintain/` — lifecycle

Verbs that change an install that already exists, as opposed to rendering one.

| module | owns |
|---|---|
| `update.mjs` | `upgrade`/`sync-self`/`bootstrap` — git pull, doctor gate, rebuild, each via a respawn |
| `setup.mjs` | The install wizard, and the CLI's only synchronous stdin readers (`ask`/`confirm`/`askChoice`) |
| `uninstall.mjs` | Removes or disables an install: manifest-driven reversal, plus stash deactivate/reactivate |
| `migrate.mjs` | `geneseed migrate` — all-or-nothing re-emit moving installs onto the npm install shape |
| `memory.mjs` | `geneseed memory list|rm` — CLI-side fact deletion, twin of the web DELETE endpoint |

**Before editing:** `update.mjs` is the one module that MUST spawn rather than import — the code on
disk is replaced mid-run, so an in-process call would validate the *old* source and then render it.
`setup.mjs` is the whole program's stdin layer, not just setup's. `memory.mjs` hard-unlinks user
facts with no archive path.

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
| `routes.mjs` | Route DECLARATION only: the `POST_ROUTES` table and the ported/unported/declined sets |
| `handler.mjs` | One function per request: dispatch, gzip, Host/CSRF guards, static SPA fallback |
| `api.mjs` | `WebState` plus every GET read endpoint; owns `STATE_ROUTES`, `PREFIX_ROUTES`, `NotFound` |
| `actions.mjs` | The mutating endpoints — rules, profile, memory, MCP, excludes — plus install/deploy argv |
| `daemon.mjs` | Detached web start/stop/status/restart, the `.geneseed-web.json` record, and `openUrl` |
| `jobs.mjs` | `JobManager` and the action→argv table. The only module here that spawns job children |
| `docs.mjs` | The Docs tab: the `docs/web/` page registry, `?harness=` filtering, the five page kinds |
| `graph.mjs` | `/api/graph` alone — the agent/skill/law cross-link matrix built from rendered bodies |
| `activity.mjs` | The `activity/` session files: pid-liveness prune, list, detail, and the on/off flag |

**Before editing:** `makeHandler(state, jm, token, dist, holder)`'s arity is load-bearing — three
test call sites construct one directly and drive it without a socket. Four of `routes.mjs`'s
exported sets are deliberately EMPTY and must stay declared: each is half of a partition test.
`graph.mjs` contains a literal NUL byte, so `grep`/`ripgrep` treat it as binary and skip it.

---

## Where do I add…

| I want to | open first | then |
|---|---|---|
| a doctrine rule | `src/doctrines/<pack>.md` — APPEND, ids run contiguously | `docs/extending.md` §2a — five files, `--sync-themes`, restyle 14 voices by hand |
| a law (invariant) | `src/laws/universal.md` — **APPEND, never insert** | `docs/extending.md` §2c. Amend the FIRST sentence: lean footprint keeps nothing else |
| a skill or an agent | `src/skills/<name>.md` or `src/agents/<name>.md` | `docs/extending.md` §3 — eight steps. Write the FILE before the table row or the build aborts |
| a doctor check | `js/inspect/checks-{build,repo,authoring}.mjs` | register with `ran(...)` in `doctor.mjs`, then a PLANTED FAULT in `tests/unit/harness.test.mjs` |
| a web endpoint | GET → `js/web/api.mjs`; POST → `js/web/actions.mjs` | declare it in `js/web/routes.mjs`; the partition test probes the real handler |
| a CLI verb | `js/cli-table.json` — the table IS the parser | the `VERBS` row in `bin/geneseed-cli.mjs`, the row count in `cli_table.test.mjs`, `NATIVE` in **two** test files |
| a hook verb | `js/hosts/hooks.mjs` | `claudeHookGroups` in `settings.mjs`, `VERBS` in `bin/geneseed-hook.mjs`. Keep the import graph tiny |
| a console doc page | `docs/web/<id>.md` — the stem is the id | `docs/extending.md` §4c. Only `kind: "concept"` gets `{N_*}` substitution |
| an OpenCode plugin | `adapters/opencode/plugins/geneseed-<name>.js` | `docs/extending.md` §4a — the `geneseed-` prefix is mechanically load-bearing |
| to change a `js/lib/` primitive | `tests/fixtures/pure_probe.mjs` **first** | the docblock says which Node default it deliberately departs from — change that sentence too, or the next reader restores the default |

---

## Known debris

* **`js/hosts/settings.mjs` carries a private second copy of Python's whitespace class**, duplicating
  `WHITESPACE` in `js/lib/text.mjs`. `text.mjs` is the owner.
* **`web/src/pages/Skills.jsx`'s `SKILL_CATS` is a fourth, ungated copy of the skill taxonomy** —
  nothing compares it to `SKILL_CLASS`, and an unknown category renders as Build with no warning.
