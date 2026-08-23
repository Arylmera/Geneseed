# Extending — what it costs to change this tool

This file is its companion: **"what does it cost to add one thing?"** — one invariant, one
doctrine rule, one skill, one plugin, one hook verb, one doc page, one theme, one screen.

It exists because the answer is never one file. Every user-visible noun in Geneseed has
*satellites* — a themed title in fourteen voices, a class in a hand-written map, a count in a
badge, a row in a ledger, a page in the console — and the gates that keep them in step are spread
across `doctor`, the Node suite and four CI jobs. A contributor who knows the satellites ships in
one pass; one who does not discovers them one red gate at a time.

The governance surface is three tiers and they cost very different amounts. **Adding a doctrine
rule is the cheap, common case** (§2a); **amending an invariant** is next (§2b); **adding an
invariant** is the most expensive single edit in the repo after the CLI surface (§2c); **adding a
whole pack** is rare and mechanical (§2d).

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
  machine until something re-emits (`js/build/emit.mjs:362` re-fingerprints, `js/inspect/status.mjs:80`
  reports the drift).
- **`docs/web/` is data, `web/src/` is code.** A new documentation page is one file and no
  rebuild. A new screen is a new hashed chunk and a mandatory `web/dist` commit.

### Counts are computed — never type one

Eight tokens are substituted at request time from the live inventory, by `docCounts` in
`js/web/docs.mjs`: `{N_LAWS}` `{N_AGENTS}` `{N_SKILLS}` `{N_PLUGINS}`, plus the four the
three-tier split added — `{N_ONTOLOGY}` (the ontology's sections), `{N_PACKS}` (packs that exist),
`{N_PACKS_ACTIVE}` (packs this install built in) and `{N_DOCTRINE_RULES}` (rules inside the active
packs). `{N_LAWS}` is the **invariant** count and nothing else; there is deliberately no token
meaning "the whole constitution", because `proseMirrorProblems` holds README and `SHIPPED.md`
prose to that same number and a token that quietly meant something wider would put the docs and
the gate at odds.

⚠ **Only a `kind: "concept"` page is substituted.** A `markdown`-kind page renders `{N_PACKS}`
literally, on the screen, as those nine characters.

Typing a literal number into a `docs/web` page is caught by `proseMirrorProblems`. The README
badges and prose, and the `N laws, N agents, N skills` line in `SHIPPED.md`, are the hand-written
exceptions — and each has its own arm in `js/inspect/doctor.mjs` (`countTableProblems` walks the five
badge keys `agents`/`skills`/`laws`/`themes`/`plugins`; `proseMirrorProblems` holds the prose).

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

- The root `package.json` has exactly one script, `lint`, and no pre-commit hook, Makefile or
  justfile exists. `npm test` at the root exits 1 with *Missing script: "test"*; the suite is run
  by hand with the glob above. `npm ci` once per clone installs the devDependencies `lint` needs
  — it pulls no runtime dependency, because there are none.
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

- **The mutation matrix itself.** `tests/mutate.mjs` — 33 rows, each a one-string edit to a
  product file with a written argument for which gate should catch it. The full run is **in no
  workflow** and should not be: it mutates the product tree 33 times and runs a gate per edit.
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

## 2 — Changing the constitution

Three tiers, four different costs. The addresses are `{{LAW}} <roman>` for an invariant and
`{{DOCTRINE}} <pack> <n>` for a doctrine rule; the ontology is cited by section name and adding a
section to it is not a checklist, it is a design change.

To count the cross-references either tier already carries, from the repo root:

```bash
grep -rhoE "\{\{LAW\}\} [IVXL]+" src/ | wc -l
grep -rhoE "\{\{DOCTRINE\}\} [a-z]+ [0-9]+" src/ | wc -l
```

On this checkout that reports 153 and 209. Both numbers move on every wave of editing, which is
why the commands are here and the answers are not load-bearing.

### 2a — Adding a DOCTRINE RULE (the common case)

Five files, none of them a count. This is the slot most new material belongs in, and it is cheap
on purpose so that the invariant slot stays scarce.

1. `src/doctrines/<pack>.md` — **append** `### {{DOCTRINE}} <pack> <n> — {{DOC_<PACK>_<n>}}` plus
   the body. Two gates in `constitutionProblems` (`js/inspect/doctor.mjs`) sit on this: the pack named in
   the *heading* is what addresses the rule (not the filename, so a rule filed in the wrong file is
   reported rather than silently renamed), and ids must run **contiguously from 1**, so appending
   at the end is the only place `n` is free. Packs are numbered independently — nothing outside
   this file renumbers.
2. `themes/_TEMPLATE.json` — add `DOC_<PACK>_<n>`. ⚠ **This file *is* gated for this key family.**
   `themeFiles()` filters `_`-prefixed names and theme parity never sees the template, but
   `constitutionProblems` reads it alongside the fourteen voices for `DOC_*` and `LEX_*`
   specifically — because it is what `--sync-themes` seeds the *next* voice from. Every other key
   family in that file is still ungated.
3. Seed the fourteen themes:

   ```bash
   node bin/build-driver.mjs --sync-themes
   ```

   ⚠ Four spellings of this command are in circulation and two of them fail — `doctor`'s own tip
   is one of the two. See §7.2 before you copy a command from anywhere else. Then restyle all
   fourteen by hand: `--sync-themes` writes the template's placeholder and only *prints*
   `RESTYLE these`; a shipped placeholder passes every gate.
4. `web/src/pages/Laws.jsx` — a `DOCTRINE_META` row keyed `'<pack>.<n>'`. Its first field is the
   **pack**, not one of `LAW_CLASSES`' six; `doctrineMetaProblems` requires an *equality* between
   that field and the key's own pack, which catches the copy error a six-way vocabulary cannot — a
   row pasted from the pack above it, keeping the wrong pack. Its second field is the one-line
   Principle, and **that copy exists nowhere else**; a rule absent here renders with a blank
   description.
5. `CHANGELOG.md`, then rebuild and commit `web/dist` (step 4 touched `web/src`).

**What a doctrine rule does *not* cost**, and each of these is a deliberate asymmetry:

- **No class entry.** There is no `LAW_CLASS` analogue: a doctrine rule's class *is* its pack, and
  there is no second taxonomy over it.
- **No count, anywhere.** No badge, no `SHIPPED.md` triple, no prose mirror. The console spends
  `{N_PACKS}` / `{N_PACKS_ACTIVE}` / `{N_DOCTRINE_RULES}`, all computed at request time.
- **No test fixture to bump**, and no renumber risk.

⚠ **Cite only downward.** An always-on tier may never reference a toggleable one:
`constitutionProblems` refuses a `{{DOCTRINE}}` token anywhere under `src/ontology/` or
`src/laws/`, because a `--doctrines craft` build would then ship an invariant pointing at text its
`AGENT.md` does not contain. Doctrine→doctrine citations are fine and stay — every pack file ships
on disk whether or not it was built in. If the build's own default is narrowed,
`constitutionProblems` emits a `[note]` naming every citation that points at a shelved pack; notes
are printed and **not** counted, because a narrowed build is a configuration its owner chose, not
a defect.

### 2b — Amending an INVARIANT

Steps 1 and 9 of §2c, plus `LAW_META` if the Principle line moved. Two cautions:

- `--footprint` defaults to **lean**, and lean keeps only the heading plus the first sentence
  (`terseBlocks` in `js/build/render.mjs`). A clause added to the second paragraph is invisible in the
  default build. Amend the first sentence, or the amendment does not exist for most installs. The
  same is true of a doctrine rule; it is **not** true of the ontology, which ships whole at both
  footprints.

### 2c — Adding an INVARIANT

Nine steps, and only the first is the rule itself. This is the expensive one, and it should be:
the bar is in `DESIGN.md` Decision 7, and most candidates belong in a doctrine pack instead.

1. `src/laws/universal.md` — **append** `### {{LAW}} <roman> — {{LEX_<roman>}}` plus the body.
   Never insert: the `{{LAW}}` cross-references counted above live all over `src/`, plus hardcoded
   citations in `js/hosts/hooks.mjs` and two OpenCode plugins, and **nothing resolves a cross-reference
   against the canon**. Renumbering silently rewires every one of them.
2. `themes/_TEMPLATE.json` — add `LEX_<roman>` in template order. Gated, as in §2a step 2:
   `constitutionProblems` holds `LEX_I..LEX_IX` as an **equality** across all fifteen files (the
   fourteen voices and the template), so both a missing key *and* a leftover one are reported. That
   arm exists because the renumber left `LEX_XXII`, `LEX_XXIII`, `LEX_XXIV` and `LEX_XXXVI` behind
   in every file and parity was silent — they were absent from nowhere.
3. `--sync-themes`, then restyle all fourteen by hand (§2a step 3).
4. `LAW_CLASS` in `js/inspect/inventory.mjs` — one of the six in `LAW_CLASSES` beside it.
5. `LAW_META` in `web/src/pages/Laws.jsx` — same class, plus the one-line Principle. Note the map
   is keyed by **arabic** number where `universal.md` heads with a Roman numeral. **This copy
   exists nowhere else**; a rule absent here renders with a blank description. It is why that one
   React file ships alone out of `web/src` in `package.json` — `doctor` regex-parses its literal.
6. `README.md` — badge `badge/laws-N` and the `N universal laws` sentence.
7. `SHIPPED.md` — the `N laws, N agents, N skills` triple.
8. `tests/unit/harness.test.mjs` — the negative fixture for the `LAW_CLASS` gate plants a rule at
   the *first free numeral*, which is `X` now that the invariants are I..IX. Bump it, or it stops
   being a fixture and starts being a duplicate.
9. `CHANGELOG.md`, then rebuild and commit `web/dist` (step 5 touched `web/src`).

⚠ While restyling, `{{LAW}}` must stay a **single word** in every theme (and so must
`{{DOCTRINE}}`). Both heading parsers match the tier noun with `\S+`, so a two-word value does not
error — the heading simply stops matching and the whole tier parses to nothing, in silence.
`constitutionProblems` refuses one, which is the only reason it is visible at all.

The carrier itself is gated: `tests/unit/emit_smoke.test.mjs` checks every rule reaches every one
of nine emit modes in order and themed, under both footprints, with a `CEILING` **and** a floor
(half the ceiling) on the rendered size. Its docblock carries the current measurement: headroom is
1,522 characters (2.8%) at full and 1,794 (4.8%) at lean, against the largest carrier — the
host-agnostic `files` bundle. Read that docblock before adding text to any tier; it is
re-measured, never nudged, and the ceiling is measured **with all four packs active**, which is
the only configuration it can speak for.

### 2d — Adding a whole PACK

Rare, and mechanical. On top of §2a for each rule the pack carries:

1. `src/doctrines/<pack>.md`, opening with its lead line — `**{{PACK_<NAME>}}** — how … .` A pack
   file `PACK_ORDER` names but cannot read, or one carrying no `### {{DOCTRINE}} <pack> <n>`
   heading at all, is a refusal.
2. `PACK_ORDER` in `js/build/source.mjs` — the registration, and the render order. It is **narrative,
   not alphabetical** (craft → rigor → ops → process); discovery sorts alphabetically and the
   renderer refuses a `.md` under `src/doctrines/` that `PACK_ORDER` does not name, rather than
   skipping it.
3. `PACK_<NAME>` in `themes/_TEMPLATE.json` and all fourteen voices. Unlike `DOC_*`, this family is
   held only by `themeParityProblems` — presence, across the voices, template excluded.
4. `DOCTRINE_BLURBS` in `js/maintain/setup.mjs` — the one-line description an installer sees in the wizard,
   and the only place a pack is ever explained to them. Missing entries fall back to the bare name.
5. `harness.config.json` if the pack should be on by default; `constitutionProblems` refuses a
   `doctrines` array naming a pack this checkout does not ship.

---

## 3 — Adding a SKILL or an AGENT

**Order matters at the first two steps.** `missingReferencedSpecs` (in `js/build/emit.mjs`) *aborts the
build* when `AGENT.md.tmpl` names a spec with no file — so the file comes before the table row, or
nothing builds at all. The refusal is clean: `tests/unit/emit_gates.test.mjs:265` proves a refused
emit leaves the prior install intact.

1. `src/skills/<name>.md` or `src/agents/<name>.md`. The shape is load-bearing: `# {{SKILL}}: <name>`,
   a blank line, then a `>` blockquote holding `{{DESC_<NAME>}}` — title, blockquote, nothing
   between. `doctor` checks both the presence of the purpose line and that the blockquote is the
   *first* block (`authoringProblems`, via `firstBlockquote` and `descBlockProblem`).
2. One row in the hand-authored table in `src/AGENT.md.tmpl` (agents `125-141`, skills `183-229`).
   Gated both ways: a row with no file, and a file with no row.
3. `DESC_<NAME>` in **all fourteen** themes. Theme parity catches a missing one; nothing catches
   an unstyled placeholder.
4. **Skills only** — `SKILL_CLASS` in `js/inspect/inventory.mjs`. Gated both ways, inside
   `countTableProblems`, which matters because the runtime fallback is silent: an unclassified
   skill renders as `build`.
5. `registry.json` — a row keyed `skills/<name>` or `agents/<name>` with `status` ∈
   {`experimental`, `approved`, `deprecated`}, a semver `version`, a non-blank `owner`, an ISO
   `added`, and `last_verified: ""`. **This is the most forgettable step**: four hand-typed fields,
   and the gate fires in both directions (`js/inspect/doctor.mjs:388-436`).
6. `README.md` — the badge, the `**🤖 Agents** (N)` / `**🛠 Skills** (N)` count, and for a skill the
   `·`-separated name in the 🛠 row (that enumeration is gated two ways, unlike the laws' one).
7. `SHIPPED.md` — the `N laws, N agents, N skills` triple.
8. `doctor --all`, then the suite.

**A vendored skill folder** (`src/skills/<name>/SKILL.md`) is a different shape: add it to
`VENDORED_SKILL_DIRS` (`js/hosts/native.mjs:37` — the literal is frozen in
`tests/unit/authoring_gates.test.mjs:312`), write a `VENDOR.md` carrying `**Upstream:**`,
`**Commit:**` (a 40-hex commit, never a moving branch) and `**License:**`, add the registry row —
and **skip steps 2, 4, 6, 7**: the flat-spec globs only see `*.md` at the top level.

Two traps worth knowing before you write the spec:

- **The word "Read-only" anywhere in an agent spec locks its emit.** It is a bare substring test
  (`js/hosts/native.mjs:148`). The escape hatch is an explicit `<!-- bash: allow -->` marker, which
  re-opens bash on all three hosts.
- **The console has a fourth, ungated copy of the skill taxonomy.** `SKILL_CATS` in
  `web/src/pages/Skills.jsx:19` mirrors `SKILL_CLASS` with nothing comparing them (contrast
  `LAW_META`, which *is* cross-checked). Inventing a new *category* means editing that file —
  which drags in the `web/dist` rebuild — and an unknown category renders as Build with no warning.


---

## 4 — Adding a PLUGIN, a HOOK verb, or a doc page

### 4a — An OpenCode plugin

The `geneseed-` prefix and the `.js` suffix are mechanically load-bearing: the badge count, the
`{N_PLUGINS}` substitution and the four-way gate all key off that glob.

1. `adapters/opencode/plugins/geneseed-<name>.js` — ESM, zero dependencies. The factory-export
   convention is real (OpenCode requires it) but **ungated**; the only generic gate on plugin
   source is `node --check` (the one spawn in `authoringProblems`).
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

The mechanical part: implement `cmd<Verb>` in `js/hosts/hooks.mjs`; wire the command string in
`claudeHookGroups` (`js/hosts/settings.mjs:434`, spelled `` `${run} <verb> …` `` — the gate scrapes that
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

## 4bis — Adding a RUNTIME DEPENDENCY

**Short answer: you vendor it, or you do not add it.** A dependency arrives as tracked source under
`js/vendor/<name>/`, imported by relative path, landing in the same `git merge --ff-only` as the
code that imports it. It never comes from a registry at install time. `tests/unit/dependency_policy.test.mjs`
gates this, and its header carries the long form.

This is not conservatism. The npm route is *unbuildable* here, for three reasons that were measured
rather than assumed:

1. **Every fixture would die at module load.** `copyCheckout` lists the tree with
   `git ls-files --cached --others --exclude-standard`, which honours `.gitignore`, and
   `.gitignore` ignores `/node_modules/`. The copy is written outside the repository, under the OS
   temp root, and the product is run out of it as a real child process — so Node's upward resolver
   walk starts in temp and finds nothing. Eleven test files build such a copy. And this is not a
   fixture defect to work around: a user's fresh `git clone` has no `node_modules` either. **The
   fixture is that clone.** Giving the fixture something the real install lacks makes it stop
   reproducing the failure it exists to catch.

2. **The clone channel cannot install, and it is the only channel that would need to.** `geneseed
   update` is `git pull` + rebuild. `npm ci` deletes `node_modules` before refetching, so a blocked
   download leaves an install whose CLI cannot start — the one outcome the update must never
   produce. `npm install` writes the tracked `package-lock.json`, so `preflight()`'s
   `git status --porcelain` then reports a dirty tree and the *next* update refuses with "You have
   local changes": a self-poisoning update. Meanwhile npm/npx installs already resolve
   `dependencies` at install time and need nothing from us. There is no overlap between the channel
   that would need a sync step and the channel where one could work.

3. **The hook path pays per tool call.** `bin/geneseed-hook.mjs` loads on every tool call of every
   agent session (~14 ms). A relative import costs no resolver walk; a bare one does.

What vendoring costs, by contrast, is almost nothing: `files[]` already carries `js/` and the
manifest partition already carries the `js/` prefix row, so a vendored subtree costs **zero**
manifest lines and zero partition lines. The existing doctor gate already covers a bad drop, because
`runDoctor` validates the pulled tree in a fresh interpreter before the rebuild.

**The one exception, and it is not a loophole.** `adapters/` does not run in this tool's process — it
ships into OpenCode's. A module the *host* provides is resolvable there and nowhere else, so
reaching for one is legitimate. But it must be a **guarded dynamic import with a working degraded
path**, never a static one: an older host that lacks it would otherwise fail the whole plugin at
load instead of losing one capability. `geneseed-workflow.js`'s `@opencode-ai/plugin` is the shape
to copy. The allow-list in the gate is two-sided — an entry nothing imports fails as loudly as an
import nothing declares.

**Before proposing one at all, price it.** At the time this was written there were 463 import
specifiers under `js/`, `bin/` and `adapters/` and exactly one was bare — the host-provided
exception above. The invariant already held; it had simply never been written down. A library that
would delete fewer lines than its vendored source adds is not a saving.

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

`NATIVE` in `tests/unit/hook_cli.test.mjs` names the verbs held to the structural rules rather
than to a per-verb gate, and the reverse check refuses an exemption for a verb neither entry point
carries — so a name that stops meaning anything fails rather than sitting there.

**To add a hook verb today:** implement `cmd<Verb>` in `js/hosts/hooks.mjs`, wire the string in
`claudeHookGroups`, add the `VERBS` entry, add the `js/cli-table.json` row, then give it an
absolute unit gate. `NATIVE` used to be duplicated across two files that read each other's source
to stay in step; there is one copy now, so there is nothing to keep in step.

### 5.2 ✅ Theme text is free to edit — resolved 2026-08-23

Seven keys (`TAGLINE`, `LOADED_SIGIL`, `VOICE`, `LEX_I`, `BENEDICTION`, `ACCENT`, `BANNER`) used to
be pinned byte-for-byte by a recording with no re-bless path, so restyling a theme's tagline was a
red gate. **That recording is gone.** Theme text is now held only by `doctor --all` — key presence,
cross-theme parity, and no unresolved tokens — which is a claim about structure, not wording.

Restyle freely. What still bites is `LOADED_SIGIL` uniqueness (§6): it is load-bearing for theme
detection and nothing checks it.

### 5.3 ⚠ The hook shim is machine-wide and last-writer-wins

`~/.geneseed/bin/geneseed-hook[.cmd]` has no per-install component. The last checkout to emit
anything owns **every** install's hooks. Emitting from a git worktree or a temp copy used to
repoint the shim at that disposable path; removing the worktree then killed hooks for every
install on the machine.

**`hookPrefix` now refuses the claim** (`js/hosts/settings.mjs`, `ephemeralCheckout`): an emit whose
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

### 5.4 ✅ Expected values are written out — resolved 2026-08-23

This section used to say that a snapshot red was a finding rather than a step: the recordings under
`tests/__snapshots__/` came from an implementation that no longer existed, there was no `--record`,
and a change that moved a recorded byte left only two honest options — revert it, or argue in
writing that the recording was wrong. The rule that fell out of it was *when a frozen recording
blocks a change, move the logic to the nearest caller that is not frozen*.

**None of that applies any more.** The recordings are retired (tag `corpus-reference-v3.1.2` is the
only way back to them), and every expected value now lives in the test file that asserts it, above
a sentence saying which decision it pins. The rule is correspondingly ordinary:

> **Change the expectation and the sentence that explains it in the same commit, and say why in
> the message.**

A red test is a step again. What it costs is an argument, in prose, that the new answer is better —
the cost that keeps the tables honest, and far cheaper than the one it replaced.

The CLI surface is no longer the most expensive thing in the repo to change. Editing a verb's help
text or flags is now an ordinary edit: `js/cli-table.json` is the owned document, and
`tests/unit/text_layout.test.mjs` renders every verb through `formatHelp` to check the layout
holds. Three hand-written equalities still converge on it and are cheap to keep in step — the
29-command count and the hidden-argument rule (`tests/unit/cli_table.test.mjs`), and
`tests/unit/docs.test.mjs`, which validates every fenced `geneseed <verb> <flags>` line in
`README.md`, `SETUP.md`, `QUICKSTART.md` and `SHIPPED.md` against the table.

---

## 6 — Hand-maintained, therefore rotting

Each of these is a copy of a decision that lives somewhere else, with no gate on its *accuracy* —
only, at best, on its presence.

| What | Where | Gated on |
|---|---|---|
| `§N` cross-references into `AGENT.md`'s anatomy | `src/skills/*`, `src/agents/*`, `adapters/**` | **range only.** `constitutionProblems` refuses a `§N` the template declares no section for — which catches a pointer past the end, the shape *removing* a section leaves. It cannot catch one that still resolves and now means something else, which is the shape *inserting* a section leaves, and is what actually happened when `## 2. Doctrines` pushed every later section down one. **Renumbering the anatomy means `grep -rn '§' src/ adapters/` and reading every hit.** Four satellites and a live OpenCode deny message shipped stale because the sweep stopped at `AGENT.md.tmpl` |
| Per-law Principle lines | `web/src/pages/Laws.jsx` | presence and class only, never accuracy |
| 504 themed constitution titles (36 keys × 14 voices) — `LEX_I..LEX_IX` (9), `DOC_<PACK>_<n>` (23), `PACK_<NAME>` (4) | `themes/*.json` | key presence only — a shipped placeholder is green. `LEX_*` and `DOC_*` are held across the template too, and in both directions; `PACK_*` only across the voices |
| The README keyword enumerations | `README.md`, `docs/web/rules.md` | nothing |
| The plugin capability enumeration | `docs/web/model.md` | nothing (the number substitutes; the list does not) |
| Section labels and page subtitles | `web/src/lib/sections.js`, `web/src/pages/Docs/index.jsx` | nothing |
| `THEME_BLURBS` (8 of 14), `ART` (8 of 14) | `js/maintain/setup.mjs`, `js/ui/anim.mjs` | nothing — missing entries fall back silently |
| `LOADED_SIGIL` uniqueness | `themes/*.json` | nothing, and it is load-bearing for theme detection |
| `adapters/claude-code/settings.json` | — | nothing compares it to what the emitter writes; **it is already divergent** |
| `NATIVE`, twice | two test files | they check each other, which is the gate that makes the duplication safe |
| The emit-size `CEILING` | `tests/unit/emit_smoke.test.mjs:54` | a hand-transcribed measurement |
| Stale docblock counts | `js/build/themes.mjs:62` ("137 values" → 140), `js/build/render.mjs:116` ("145 tokens" → 148) | nothing |

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
6. **A claim that was simply false.** `js/build/render.mjs` said `--theme` is validated against
   `choices` before anything renders, which is why its own refusal read as an unreachable nicety.
   It is not in `choicesFor`; that refusal is the only one there is, on every path.
7. **Five dead cross-references** to `tests/snapshot/no_python_in_corpus.test.mjs`, retired with
   the corpora — three test files justified their own design by pointing at a gate that is gone.
   Plus a skip message naming a `record-corpus` CI job that no longer exists.
8. **`CHANGELOG.md` said 2.0.0 was "not yet published"**, with "no tag, no release and no install
   URL"; `geneseed@2.0.0` has been on npm since 2026-08-17. And **`SETUP.md`** documented
   `geneseed upgrade v1.0.0 # pin to a tag`, which `js/maintain/update.mjs` prints is IGNORED.
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

1. **Extend the fenced-command gate to `DESIGN.md` and `docs/**/*.md` (§7.3).** One array literal.
   Today it covers four documents, and both of the pointer-to-nothing defects §7 records — the
   `DESIGN.md` authoring section and `doctor`'s theme-parity tip, since fixed — sat outside its
   reach. It keeps catching them.
2. **Decide the hook-verb question (§5.1) before it is asked under pressure.** Either mirror the
   CLI side's exemption list onto the hook half, or write down that the hook verb set is closed.
   Either answer is fine; discovering the question mid-feature is not.
3. **Write down the frozen-key list (§5.2) where a theme author will see it** — `themes/README.md`
   is the natural home. Seven keys × fifteen files is a small enough surface to name explicitly,
   and today nothing warns you before the snapshot goes red.
4. **Gate `AGENT_LESSON_PROMPT` like its sibling (§7.7), and either gate or delete
   `adapters/claude-code/settings.json` (§7.10).** Two silent failure modes, both cheap to close.
5. **Finish the `scripts` block in the root `package.json`.** `lint` landed with the ESLint
   config; the rest of what CI runs is still reassembled by hand from this file. A `verify` script
   chaining lint + suite + doctor is three lines and makes §1 executable rather than descriptive.

The list of hand-maintained satellites in §6 is the *design*, not a defect — this project
deliberately keeps tables and prose hand-written and gates them from the source tree. The
recommendations above are about the places where the gate is missing, wrong, or pointed at a file
that no longer exists.
