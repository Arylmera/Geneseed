# Extending — what it costs to change this tool

`docs/limits.md` is the standing answer to *"what does this tool not prove about itself?"*.
This file is its companion: **"what does it cost to add one thing?"** — one law, one skill, one
plugin, one hook verb, one doc page, one theme, one screen.

It exists because the answer is never one file. Every user-visible noun in Geneseed has
*satellites* — a themed title in fourteen voices, a class in a hand-written map, a count in a
badge, a row in a ledger, a page in the console — and the gates that keep them in step are spread
across `doctor`, the Node suite and four CI jobs. A contributor who knows the satellites ships in
one pass; one who does not discovers them one red gate at a time.

Written after the Python migration completed (2026-08-18), against `main`. Verified: every
file:line below was opened, and the commands were run.

---

## 0 — The frame

Three seams, and almost every question about "where do I edit?" resolves to one of them.

| Seam | Source of truth | How it reaches a user | Rebuild needed |
|---|---|---|---|
| **Harness content** | `src/` (laws, agents, skills, memory/notebook conventions, `AGENT.md.tmpl`) + `themes/*.json` for voice | rendered into a bundle by `geneseed build` / `update` / `rebuild-all` | yes — every active install must be re-emitted |
| **Console docs** | `docs/web/*.md` + `docs/web/_groups.json` | read off disk at request time by `js/web/docs.mjs:101` | no — not even a daemon restart for content |
| **Console app** | `web/src/**` | built by vite into the **tracked** `web/dist/` | yes — rebuild *and commit* dist, then `geneseed web restart` |

Two rules follow from the table and they cause most of the surprises:

- **Nothing propagates by itself.** A bundle is a *render*. Editing `src/` changes nothing on any
  machine until something re-emits (`js/emit.mjs:362` re-fingerprints, `js/status.mjs:80`
  reports the drift).
- **`docs/web/` is data, `web/src/` is code.** A new documentation page is one file and no
  rebuild. A new screen is a new hashed chunk and a mandatory `web/dist` commit.

### Counts are computed — never type one

`{N_LAWS}` `{N_AGENTS}` `{N_SKILLS}` `{N_PLUGINS}` are substituted at request time from the live
inventory (`js/web/docs.mjs:169-172`). Typing a literal number into a `docs/web` page is caught by
`proseMirrorProblems` (`js/doctor.mjs:715-737`). The README badges and prose, and the
`N laws, N agents, N skills` line in `SHIPPED.md`, are the hand-written exceptions — and each has
its own doctor arm (`js/doctor.mjs:676`, `:739`, `:822-829`).

---

## 1 — The baseline, and the five commands that reproduce CI

Verified on this checkout: `doctor --all` green on 14 themes; the Node suite reports
**1033 tests, 1029 pass, 4 skipped, 0 fail**.

CI is **four jobs expanding to six runs** (`.github/workflows/ci.yml`): `validate` and
`node-cells` on Linux *and* Windows, plus `package-no-python` and `web` on Linux. From the repo
root — never from a worktree, see §5:

```bash
node bin/geneseed-cli.mjs doctor --all
```

```bash
node --test --test-reporter=tap "tests/**/*.test.mjs"
```

```bash
node tests/golden.mjs --idempotent
```

```bash
node tests/golden.mjs --deletion
```

```bash
node tests/mutate.mjs --verify
```

```bash
cd web && npm ci && npm run lint && npm run format:check && npm test && npm run build
```

Notes that matter:

- The root `package.json` has **no `scripts` key**, and no pre-commit hook, Makefile or justfile
  exists either. `npm test` at the root exits 1 with *Missing script: "test"*; the suite is run by
  hand with the glob above.
- `--test-reporter=tap` is not decoration. Both workflows gate on the *count* (`# tests N ≥ 500`)
  because `node --test` over a glob that matches nothing prints `# tests 0` and **exits 0**. Node's
  default reporter changed between majors, which is how a green 1043-test suite once reported zero.
- `--deletion` is the only thing that exercises the write-before-delete prune. Anyone renaming or
  removing a plugin, a skill or an emitted file needs it.
- **A local pass is weaker than CI.** ~18 tests in `tests/unit/package_manifest.test.mjs` carry
  `{ skip: NO_NPM }` (`:83`) — every tarball, install and rename gate. On a machine without `npm`
  on PATH they report *skipped* and the run is green.
- CI additionally re-runs the packaging suite under `npm@latest` (Linux, last in the job) and
  packs the tarball into a `node:22-slim` container with no interpreter. Neither is reproducible
  from the five commands; the container one is reachable locally through
  `tests/helpers/no-python-container.sh` with a docker daemon.
- **Two assertions in `tests/unit/claude.test.mjs` silently stand down** on any machine where an
  ancestor of the temp sandbox is a `.claude`/`.bob` install — which is every developer machine
  with Claude Code installed under `~`. They are replaced by a `t.diagnostic`, so the TAP
  `# skipped` count does **not** move. Locally you read `1035/1031/0/4` and see no sign of it.

### The gates CI does not run

- **The mutation matrix itself.** `tests/mutate.mjs` — 31 rows, each a one-string edit to a
  product file with a written argument for which gate should catch it. The full run is **in no
  workflow** and should not be: it mutates the product tree 31 times and runs a gate per edit.
  Run `node tests/mutate.mjs --all` (or `--only M7`) by hand when you change something a gate is
  supposed to be watching. ⚠ An interrupted run leaves the **product tree mutated** — check
  `git status` before doing anything else.
  Its *anchors* are now in CI (`--verify`, above): a row whose anchor a refactor has moved counts
  as a **survivor**, not a skip, and until 2026-08-19 that only showed up for whoever ran the
  matrix by hand — which nothing did.
- **Node 24.** No CI job runs it; `publish.yml` does. See §8.
- **`tests/golden.mjs`** is absent from the publish path entirely.

### Gates that fire on changes you would not expect to be gated

- **A new subprocess anywhere in `js/` or `bin/`** — `tests/unit/spawn_hygiene.test.mjs` requires
  capturing spawns to set `windowsHide` and inheriting spawns not to. (`adapters/` is *not*
  scanned, so a plugin that spawns is on its own.)
- **Editing `.github/workflows/*.yml`** — seven structural assertions in
  `tests/unit/docs.test.mjs:336-399` gate `publish.yml`'s shape, and `:422-444` discovers every
  workflow with a test-count gate and pins `--test-reporter=tap` on it. A unit test gates the CI
  files.
- **Adding any tracked file** — `tests/unit/package_manifest.test.mjs:401` demands every tracked
  path fall on exactly one side of a declared partition, *with a written reason*. Adding this very
  document required a `SHIPS` row; without one the tarball test fails, and it fails **before** the
  file is committed too, because npm packs by glob while the partition reads `git ls-files`.

---

## 2 — Adding a LAW

Ten files, of which five are pure satellites. Ground truth: `git show --stat 1b53701` (law XXXVIII)
touched 21 files, 14 of them themes.

1. `src/laws/universal.md` — **append** `### {{LAW}} <roman> — {{LEX_<roman>}}` plus the body.
   Never insert: 397 `{{LAW}} <numeral>` cross-references live in `src/`, plus hardcoded citations
   in `js/hooks.mjs` and two OpenCode plugins, and **nothing resolves a cross-reference against the
   canon**. Renumbering silently rewires every one of them.
2. `themes/_TEMPLATE.json` — add `LEX_<roman>` in template order. **Nothing gates this file**
   (`themeFiles()` filters `_`-prefixed names, `js/installs.mjs:113`), so forgetting it is green
   today and starves the *next* law's sync.
3. Seed the fourteen themes:

   ```bash
   node bin/geneseed.mjs --sync-themes
   ```

   ⚠ Four spellings of this command are in circulation and two of them fail — `doctor`'s own tip
   is one of the two. See §7.2 before you copy a command from anywhere else.
4. Restyle all fourteen by hand. `--sync-themes` writes the template's `<themed title for …>`
   placeholder and only *prints* `RESTYLE these`; a shipped placeholder passes every gate.
5. `js/inventory.mjs:40` — `LAW_CLASS`, one of the six in `LAW_CLASSES` (`:56`).
6. `web/src/pages/Laws.jsx:28` — `LAW_META`: same class, plus the one-line Principle. **This copy
   exists nowhere else**; a law absent here renders with a blank description. It is why that one
   React file ships alone out of `web/src` in `package.json` — `doctor` regex-parses its literal.
7. `README.md` — badge `badge/laws-N` and the `N universal laws` sentence.
8. `SHIPPED.md` — the `N laws, N agents, N skills` triple.
9. `tests/unit/harness.test.mjs:293` — the negative fixture hardcodes the *next* free numeral;
   bump it or it stops being a fixture and starts being a duplicate.
10. `CHANGELOG.md`, then rebuild and commit `web/dist` (step 6 touched `web/src`).

**Amending** a law is steps 1, 10 and — if the principle moved — 6. Two extra cautions:

- `--footprint` defaults to **lean**, and lean keeps only the heading plus the first sentence
  (`js/render.mjs:167`). A clause added to the second paragraph is invisible in the default build.
  Amend the first sentence, or the amendment does not exist for most installs.
- ⚠ **Law I is frozen.** `LEX_I` is one of seven theme keys recorded byte-for-byte in the
  primitives corpus (§5). Retitling Law I in any theme reddens a snapshot that cannot be re-blessed.

The carrier itself is gated: `tests/unit/emit_smoke.test.mjs:211-265` checks every law reaches
every one of nine emit modes in order and themed, under both footprints, with a ceiling **and** a
floor on the rendered size. Headroom measured today: ~2 100 chars full, ~1 200 lean — about three
average laws at full footprint, which is the binding one.

---

## 3 — Adding a SKILL or an AGENT

**Order matters at the first two steps.** `missingReferencedSpecs` (`js/emit.mjs:493`) *aborts the
build* when `AGENT.md.tmpl` names a spec with no file — so the file comes before the table row, or
nothing builds at all. The refusal is clean: `tests/unit/emit_gates.test.mjs:265` proves a refused
emit leaves the prior install intact.

1. `src/skills/<name>.md` or `src/agents/<name>.md`. The shape is load-bearing: `# {{SKILL}}: <name>`,
   a blank line, then a `>` blockquote holding `{{DESC_<NAME>}}` — title, blockquote, nothing
   between. `doctor` checks both the presence of the purpose line and that the blockquote is the
   *first* block (`js/doctor.mjs:899-908`).
2. One row in the hand-authored table in `src/AGENT.md.tmpl` (agents `125-141`, skills `183-229`).
   Gated both ways: a row with no file, and a file with no row.
3. `DESC_<NAME>` in **all fourteen** themes. Theme parity catches a missing one; nothing catches
   an unstyled placeholder.
4. **Skills only** — `SKILL_CLASS` in `js/inventory.mjs:59`. Gated both ways
   (`js/doctor.mjs:785-791`), which matters because the runtime fallback is silent: an unclassified
   skill renders as `build` (`js/inventory.mjs:166`).
5. `registry.json` — a row keyed `skills/<name>` or `agents/<name>` with `status` ∈
   {`experimental`, `approved`, `deprecated`}, a semver `version`, a non-blank `owner`, an ISO
   `added`, and `last_verified: ""`. **This is the most forgettable step**: four hand-typed fields,
   and the gate fires in both directions (`js/doctor.mjs:388-436`).
6. `README.md` — the badge, the `**🤖 Agents** (N)` / `**🛠 Skills** (N)` count, and for a skill the
   `·`-separated name in the 🛠 row (that enumeration is gated two ways, unlike the laws' one).
7. `SHIPPED.md` — the `N laws, N agents, N skills` triple.
8. `doctor --all`, then the suite.

**A vendored skill folder** (`src/skills/<name>/SKILL.md`) is a different shape: add it to
`VENDORED_SKILL_DIRS` (`js/native.mjs:37` — the literal is frozen in
`tests/unit/authoring_gates.test.mjs:312`), write a `VENDOR.md` carrying `**Upstream:**`,
`**Commit:**` (a 40-hex commit, never a moving branch) and `**License:**`, add the registry row —
and **skip steps 2, 4, 6, 7**: the flat-spec globs only see `*.md` at the top level.

Two traps worth knowing before you write the spec:

- **The word "Read-only" anywhere in an agent spec locks its emit.** It is a bare substring test
  (`js/native.mjs:148`). The escape hatch is an explicit `<!-- bash: allow -->` marker, which
  re-opens bash on all three hosts.
- **The console has a fourth, ungated copy of the skill taxonomy.** `SKILL_CATS` in
  `web/src/pages/Skills.jsx:19` mirrors `SKILL_CLASS` with nothing comparing them (contrast
  `LAW_META`, which *is* cross-checked). Inventing a new *category* means editing that file —
  which drags in the `web/dist` rebuild — and an unknown category renders as Build with no warning.

Adding a spec reddens no recording: none of the surviving snapshots contains a skill or agent name.

---

## 4 — Adding a PLUGIN, a HOOK verb, or a doc page

### 4a — An OpenCode plugin

The `geneseed-` prefix and the `.js` suffix are mechanically load-bearing: the badge count, the
`{N_PLUGINS}` substitution and the four-way gate all key off that glob.

1. `adapters/opencode/plugins/geneseed-<name>.js` — ESM, zero dependencies. The factory-export
   convention is real (OpenCode requires it) but **ungated**; the only generic gate on plugin
   source is `node --check` (`js/doctor.mjs:924-941`).
2. `docs/web/plugin-<name>.md` — `group: plugins`, `title: "geneseed-<name>"`, `kind: "concept"`.
3. `docs/web/plugins.md` — a bullet. The count above it renders from `{N_PLUGINS}`.
4. `docs/web/model.md` — a second `{N_PLUGINS}` sentence whose **enumeration of the capabilities
   is hand-written and ungated**.
5. `README.md` — **three** sites: the badge, the `N plugins` prose, and the 🔌 Plugins row.
6. `SHIPPED.md` — the bare name inside `plugins (…)`; that list must equal the directory exactly,
   in both directions (`tests/unit/web_api.test.mjs:1655`).
7. `adapters/opencode/README.md` and `docs/opencode-plugin-setup.md` — spelled-out counts, in
   **word form** ("seven" → "eight"), the second file twice.
8. `tests/plugins/<name>.test.mjs`. Auto-discovered; no workflow edit.

No `registry.json` row, no `package.json` edit — `files[]` ships `adapters/` whole.

### 4b — A hook verb (claude + bob)

⚠ **Read §5 first. A fifth hook verb has no green path today.**

The mechanical part: implement `cmd<Verb>` in `js/hooks.mjs`; wire the command string in
`claudeHookGroups` (`js/settings.mjs:434`, spelled `` `${run} <verb> …` `` — the gate scrapes that
shape); add the entry to `bin/geneseed-hook.mjs:43` `VERBS` with **exactly two-space indent**; add
a row to `js/cli-table.json` with a help string over 20 characters.

### 4c — A documentation page

**One file, no rebuild, no server change.** `docs/web/<id>.md`, where the stem is the id.
Frontmatter is JSON-per-value, not YAML (`js/web/docs.mjs:63-82`):

- `group` must match an id in `_groups.json` — an unknown group is a **silent skip**.
- `kind` ∈ `markdown | concept | glossary | about | cli`; anything else 404s.
- `harness: "claude"|"opencode"` hides the page from the other host. Note the `plugins` group
  carries this at the **group** level, and `hooks` symmetrically — a Claude-relevant page dropped
  into `plugins` vanishes with no error.
- `kind: "markdown"` pulls from a repo file via `source:`, traversal-guarded, optionally sliced to
  one section with `anchor:` + `slice: true`.

Inline `<!-- harness:claude -->` blocks strip per host and **fail open** on an unbalanced marker —
the page renders, wrong, with nothing red.

---

## 5 — The four things that are genuinely hard

These are not checklist items. They are structural, and each one should be settled *before* the
change that needs it, not during.

### 5.1 ✅ A fifth hook verb — resolved 2026-08-19

**This was a hard blocker and it is now open.** Recorded here because the shape of the problem
recurs: any gate whose expected value lives in an artifact nothing can re-make will eventually
stop a legitimate change, and the fix is never to delete the artifact.

`tests/unit/hook_cli.test.mjs` asserted a strict equality between the hook verbs the frozen
matrix covers and the verbs `bin/geneseed-hook.mjs` carries. The CLI half of the same test
already exempted a named `NATIVE` list; the hook half exempted nothing — so a fifth hook verb
failed with **no green path**, since the recorder died on 2026-08-17 and the failure message
correctly forbids deleting cells to pass.

Both halves now filter through the same `NATIVE` list, and the reverse check refuses an
exemption for a verb neither entry point carries. The argument is in `docs/declined.md` — the
short version is that the reason those verbs have no cell (*the reference had nothing to compare
against*) is the same reason a verb postdating the reference has none, so it is one exemption,
not two. Nothing measurable was lost: the hook verb set is pinned twice more, from editable
sources, twelve lines above.

**To add a hook verb today:** implement `cmd<Verb>` in `js/hooks.mjs`, wire the string in
`claudeHookGroups`, add the `VERBS` entry, add the `js/cli-table.json` row, then name the verb in
`NATIVE` in **both** `tests/unit/hook_cli.test.mjs` and `tests/snapshot/cli_help.test.mjs` (they
read each other's source, so one alone fails) and give it an absolute unit gate.

### 5.2 ⚠ Seven theme keys are frozen byte-for-byte

`tests/__snapshots__/primitives/{posix,win32}.json` record `theme_preview` and `theme_flair`
answers for all fourteen themes **and the template**. Those probes read the live `themes/*.json`
at replay time, which pins:

| Probe | Frozen keys |
|---|---|
| `theme_preview` | `TAGLINE`, `LOADED_SIGIL`, `VOICE`, **`LEX_I`**, `BENEDICTION` |
| `theme_flair` | `ACCENT`, `BANNER` |

Editing any of those, in any theme, reddens a snapshot with **no re-bless path**. Adding a *new*
law is safe (only `LEX_I` is recorded). Restyling an existing theme's tagline or banner is not.

This was proven, not inferred: prefixing `marvin.json`'s `TAGLINE` turned
`tests/snapshot/pure_snapshot.test.mjs` red at `case 1275`.

### 5.3 ⚠ The hook shim is machine-wide and last-writer-wins

`~/.geneseed/bin/geneseed-hook[.cmd]` has no per-install component. The last checkout to emit
anything owns **every** install's hooks. Emitting from a git worktree or a temp copy used to
repoint the shim at that disposable path; removing the worktree then killed hooks for every
install on the machine.

**`hookPrefix` now refuses the claim** (`js/settings.mjs`, `ephemeralCheckout`): an emit whose
checkout is under the OS temp root, or is a linked git worktree (`.git` is a *file*), leaves a
shim that still resolves exactly as it is and wires the emitted hooks to it anyway. The bundle it
writes is byte-identical to a normal emit — the install simply keeps running the durable
checkout's entry, which is what last-writer-wins already handed every other install. A shim that
is **absent or already dead** is still written from anywhere, so a first emit on a fresh machine
works and the suite's own sandboxed emits are unchanged.

Two gates hold it: `tests/unit/hook_form.test.mjs` pins the rule (including the worktree arm,
reachable because `ephemeralCheckout` takes the temp root as a parameter), and
`tests/shim_intact.mjs` — a step in `ci.yml` and `publish.yml`, *after* `node --test`, because
each test file runs in its own process and the file that causes this is not the file that would
notice — fails if the suite left the shim naming anything that is not there.

This is not hypothetical — it happened while this file was being written. Several agents were
verifying gates out of copied checkouts (the `copyCheckout` fixture pattern
`tests/unit/harness.test.mjs:173` uses), one of them emitted, and the shim ended up pointing at
`…/Temp/gs-fix-8DYuJP/bin/geneseed-hook.mjs` — a directory that no longer existed. Every hook in
every install on the machine was dead and nothing said so.

The recovery is free, which is the part worth remembering: **`doctor` detects it and the run's own
emit repairs it**, reporting *"the checkout most likely moved … no further action needed"*. That
is still the answer for the case the guard cannot cover — a real checkout that genuinely moved —
so after any session that emitted from somewhere unusual, `doctor --all` from the real checkout
remains the cheapest thing to run.

Related: a stray `console.log` on a hook path silently disables a gate. Hooks signal through
stdout JSON and return 0 on every path — a printed byte is not a warning, it is a disabled gate.

### 5.4 ⚠ A snapshot red is a finding, not a step

Everything left under `tests/__snapshots__/` — the primitives, the 26 help texts, and the small
pure-function recordings — was produced by an implementation that no longer exists. There is no
`--record`. A change that moves a recorded byte leaves two honest options: revert it, or argue in
writing (in `docs/declined.md`) that the recording was wrong. `docs/limits.md` carries the full
argument and the measurement that licensed retiring the three larger corpora.

**A worked example, from the session that wrote this file.** Closing a real defect — three count
gates that go green when you *delete* the sentence they check — turned the primitives corpus red
at `case 371`: `proseMirrorProblems` is a recorded pure function, the recording holds a case that
passes an empty `shipped` string and expects `[]`, and the new absence arm answered otherwise.
Both obvious moves are wrong. Re-blessing is impossible. Abandoning the fix leaves a gate failing
open. The third move is the one to reach for: **the presence check moved up one level, into
`countTableProblems`, which is not recorded** — where it reads better anyway, beside the code that
already knows whether the file could be opened. The rule that falls out: *when a frozen recording
blocks a change, look for the nearest caller that is not frozen.* Check with

```bash
node -e "const j=require('./tests/__snapshots__/primitives/win32.json');console.log([...new Set(j.cases.map(c=>c.fn))].join('\n'))"
```

The concrete consequence for evolution: **editing the help text or the flags of any of the 26
recorded CLI verbs is a frozen surface.** New verbs have a path (`NATIVE`); changes to old ones
do not. `docs/limits.md:311-316` names this cluster as the one open standing decision.

The CLI surface is the most expensive thing in the repo to change, because four hand-written
equalities converge on it: `js/cli-table.json`'s 29-command count (`tests/unit/cli_table.test.mjs:67`),
the 5-entry hidden-argument list (`tests/snapshot/cli_help.test.mjs:219`), the 25-subparser count
(`tests/unit/docs.test.mjs:193`), and the 26 unblessable help fixtures. Plus
`tests/unit/docs.test.mjs:554`, which validates every fenced `geneseed <verb> <flags>` line in
`README.md`, `SETUP.md`, `QUICKSTART.md` and `SHIPPED.md` against the table.

---

## 6 — Hand-maintained, therefore rotting

Each of these is a copy of a decision that lives somewhere else, with no gate on its *accuracy* —
only, at best, on its presence.

| What | Where | Gated on |
|---|---|---|
| Per-law Principle lines | `web/src/pages/Laws.jsx` | presence and class only, never accuracy |
| 560 themed law titles (40 × 14) | `themes/*.json` | key presence only — a shipped placeholder is green |
| The README keyword enumerations | `README.md`, `docs/web/rules.md` | nothing |
| The plugin capability enumeration | `docs/web/model.md` | nothing (the number substitutes; the list does not) |
| Section labels and page subtitles | `web/src/lib/sections.js`, `web/src/pages/Docs/index.jsx` | nothing |
| `THEME_BLURBS` (8 of 14), `ART` (8 of 14) | `js/setup.mjs`, `js/anim.mjs` | nothing — missing entries fall back silently |
| `LOADED_SIGIL` uniqueness | `themes/*.json` | nothing, and it is load-bearing for theme detection |
| `adapters/claude-code/settings.json` | — | nothing compares it to what the emitter writes; **it is already divergent** |
| `NATIVE`, twice | two test files | they check each other, which is the gate that makes the duplication safe |
| The emit-size `CEILING` | `tests/unit/emit_smoke.test.mjs:54` | a hand-transcribed measurement |
| Stale docblock counts | `js/themes.mjs:62` ("137 values" → 140), `js/render.mjs:116` ("145 tokens" → 148) | nothing |

---

## 7 — Stale on 2026-08-18, fixed on 2026-08-19

Nine items were found while writing this file, and fixed the next day. They are recorded as a
list rather than left as a diff, because the PATTERN is the useful part: every one was a document
or a comment pointing a reader at something that is not there, and in each case the gate that
should have caught it either did not cover that file — or was itself the frozen copy of a wrong
answer.

**Fixed.**

1. **`DESIGN.md` taught the deleted Python build.** Its header promises *"the spec behind the
   harness — read this before changing structure"*, and under it sat the six-edit checklist for
   adding a Law, naming a deleted generator, `rituals/_harness_tui.py` for `LAW_CLASS`, and an
   invocation of a program that no longer exists. Worse, `tests/unit/no_python.test.mjs` exempted
   the file as a *historical record* — so the gate that hunts pointers-to-nothing was looking away
   from the one document most likely to hold one. **Split**: the 190-line standing contract keeps
   the name and is now scanned; the 1,290-line port narrative moved to
   [design-history.md](design-history.md), which is exempt on the merits, and its dead links were
   repaired because a link is a pointer whatever the prose around it says.
2. **`doctor` printed a command that errors.** The theme-parity tip named
   `./geneseed build --sync-themes`; `cmdBuild` forwards `--theme` and nothing else. The comment
   above the tip argued that spelling on a premise the port had quietly stopped satisfying. It now
   names `geneseed-build --sync-themes`, which is what README and SETUP said all along.
3. **User-facing output named a program that does not exist.** `tui` and `uninstall` told users to
   run `harness setup` / `harness uninstall` — the reference's name, dropped in P0. Five sites.
   One of them was **pinned verbatim by a test**, so a gate was holding the wrong string in place;
   that assertion is now a property — every backticked command a refusal offers must be a verb
   `js/cli-table.json` declares — which is strictly stronger and fires on the next rename too.
4. **The `tui` help promised a "full-screen curses control panel"** for a verb that returns 1 on
   every path. `docs/limits.md` listed this as permanently unfixable, on the grounds that the help
   corpus is frozen — but `formatHelp` never reads `cmd.help`, so it was an ordinary edit all
   along. The limits row went with the fix.
5. **Numbers in docblocks that had drifted** — `_TEMPLATE.json`'s "137 values" (140), "the 145
   tokens" `src/` uses (148), and "sixteen `_*_problems` checks" (fifteen — the sixteenth was
   named as `cli`, which was removed).
6. **A claim that was simply false.** `js/render.mjs` said `--theme` is validated against
   `choices` before anything renders, which is why its own refusal read as an unreachable nicety.
   It is not in `choicesFor`; that refusal is the only one there is, on every path.
7. **Five dead cross-references** to `tests/snapshot/no_python_in_corpus.test.mjs`, retired with
   the corpora — three test files justified their own design by pointing at a gate that is gone.
   Plus a skip message naming a `record-corpus` CI job that no longer exists.
8. **`CHANGELOG.md` said 2.0.0 was "not yet published"**, with "no tag, no release and no install
   URL"; `geneseed@2.0.0` has been on npm since 2026-08-17. And **`SETUP.md`** documented
   `geneseed upgrade v1.0.0 # pin to a tag`, which `js/update.mjs` prints is IGNORED.
9. **`docs/web/agents.md`** enumerated 16 agents and omitted `developer`, where README says 17 —
   the doctor arm cannot fire, because the page spells `{N_AGENTS}` and that arm only ever catches
   a literal. **`docs/web/rules.md`** called each law "a short markdown file under `src/laws/`";
   there is one file.

**Still open.**

- **`adapters/claude-code/settings.json` is divergent documentation.** It writes
  `node bin/geneseed-hook.mjs <verb>` on seven lines, including one the emitter does not produce
  at all, and carries none of the flags `claudeHookGroups` emits. Nothing compares the two; the
  only reference to it anywhere is the error message that sends users to it. Either gate it
  against the emitter, or delete it.
- **`AGENT_LESSON_PROMPT` has no drift gate.** Its sibling `LEARN_PROMPT_HEAD` is checked for
  extractability; this one's parity test was retired. Reformat the declaration in
  `geneseed-learn.js` and the per-agent lesson prompt silently degrades to a two-line fallback.
- **The fenced-command gate still covers only four documents.** `tests/unit/docs.test.mjs`
  validates every `geneseed <verb> <flags>` line against `js/cli-table.json` — but only in
  `README.md`, `SETUP.md`, `QUICKSTART.md` and `SHIPPED.md`. Adding `DESIGN.md` and the `docs/`
  tree to that array is one line, and it would have caught item 2 on the day it was written.

---

## 8 — Release

Version lives in **`harness.config.json`** (the owner) and is mirrored into `package.json` — both
gated. Every other appearance is derived at runtime (`.geneseed-version` markers,
`agent-overrides.json` `_version`), and gated as a *relationship* rather than a literal, which is
why no test pins a version string and none should.

Do not run `npm version`. Bump the two files by hand, add the `CHANGELOG` section, update
`SHIPPED.md`, rebuild `web/dist` if `web/src` moved, run the five commands from §1, push, tag,
then rehearse and fire the workflow:

```bash
gh workflow run publish.yml -f dry_run=true
```

Two structural facts worth carrying:

- **`publish.yml` deliberately runs a newer toolchain than `ci.yml`** — Node 24 and `npm@latest`,
  because trusted publishing requires them, against `ci.yml`'s Node 22. So toolchain-sensitive
  defaults break *first and only* at the release. That has now happened twice: `npm pack --json`
  changed its container between majors, and Node 24's default test reporter made the count gate
  read zero on a green suite.
- **Renaming `publish.yml` breaks publishing silently** — npm keys the trusted publisher on the
  filename.

Both known breaks have been patched at the symptom (`ci.yml` re-runs the packaging suite under
`npm@latest`; both workflows pin the TAP reporter). The *cause* is untouched: **no CI job runs
Node 24 at all**, so the release still executes a runtime nothing exercises — and `publish.yml`
never runs `tests/golden.mjs`, so the two self-comparisons are absent from the release path.

A sweep-and-replace version bump must not touch `registry.json`'s per-entity `"version": "1.0.0"`
rows, nor `web/package.json`.

---

## 9 — How an existing install picks up a change

| Install shape | Command | What it refreshes |
|---|---|---|
| git checkout | `geneseed upgrade` | export improvements → preflight → ff-only pull → `doctor` on the pulled tree → re-emit this bundle → bounce the web daemon → `rebuild-all` |
| npm | `npm install -g geneseed@latest`, then `geneseed rebuild-all` | there is no `postinstall`; the two steps are manual |
| any | `geneseed rebuild-all` | every **active** install, each re-read in its own five values (theme, emit, footprint, posture, mode) |

**Which installs get missed:** project installs that were never registered; installs disabled via
the `.geneseed-disabled` stash; registry rows whose directory is gone; and everything after the
point where a `rebuild-all` fails mid-loop — it is best-effort by contract and leaves a mixed
machine. Autostart entries are surveyed and reported, never rewritten.

**The web daemon serves the code it launched with**, plus an in-memory cache of every dist file.
After a `web/dist` rebuild the correct move is `geneseed web restart`, not a hard refresh —
otherwise the daemon serves an `index.html` naming assets that `emptyOutDir` deleted, the static
handler falls back to `index.html` at 200 with `text/html`, and the browser reports a MIME error.

⚠ A bare `geneseed web` runs in the **foreground and writes no record**, so `web stop` reports
"no running server recorded" and exits 0, and `web restart` starts a *second* daemon. Recovery is
to kill every pid on the port, then `geneseed web start`.

---

## 10 — What to settle before the next wave

Ordered by what unblocks the most work per unit of effort. Each is small; none is urgent enough to
stop a change today, and all of them cost a contributor a wrong turn until they are done.

1. **Rewrite the authoring section of `DESIGN.md` (§7.1) and fix `doctor`'s tip (§7.2).** These are
   the two documents a contributor reads *first* when adding a law, and both name programs that no
   longer exist. Half an hour, and it removes the most likely first wrong turn.
2. **Extend the fenced-command gate to `DESIGN.md` and `docs/**/*.md` (§7.3).** One array literal.
   It would have caught item 1 the day it was written, and it keeps catching it.
3. **Decide the hook-verb question (§5.1) before it is asked under pressure.** Either mirror the
   CLI side's exemption list onto the hook half, or write down that the hook verb set is closed.
   Either answer is fine; discovering the question mid-feature is not.
4. **Write down the frozen-key list (§5.2) where a theme author will see it** — `themes/README.md`
   is the natural home. Seven keys × fifteen files is a small enough surface to name explicitly,
   and today nothing warns you before the snapshot goes red.
5. **Gate `AGENT_LESSON_PROMPT` like its sibling (§7.7), and either gate or delete
   `adapters/claude-code/settings.json` (§7.10).** Two silent failure modes, both cheap to close.
6. **Consider a `scripts` block in the root `package.json`.** There is currently no single command
   that runs what CI runs; every contributor reassembles the five by hand from this file. A
   `verify` script is three lines and makes §1 executable rather than descriptive.

The list of hand-maintained satellites in §6 is the *design*, not a defect — this project
deliberately keeps tables and prose hand-written and gates them from the source tree. The
recommendations above are about the places where the gate is missing, wrong, or pointed at a file
that no longer exists.
