# Geneseed — working in this repo

Geneseed generates agent-harness configuration — laws, doctrines, skills, agents — from `src/` and
`themes/`, and installs it into host tools (Claude Code, OpenCode, Bob, OpenClaude). It ships as an
npm package and as a plain git clone that self-updates with `git pull`.

**Start with [`js/README.md`](js/README.md)** — the module map, and the "where do I add X" table.
For what an addition *costs*, [`docs/extending.md`](docs/extending.md) is the standing answer.

---

## The three binaries, and how to tell them apart

| | |
|---|---|
| `bin/geneseed-cli.mjs` | `geneseed` — the user-facing CLI. 20+ verbs, parsed from `js/cli-table.json`. **May not spawn** (transitive `child_process` ban; doctor's `node --check` is the one allow-listed exception) |
| `bin/geneseed-hook.mjs` | `geneseed-hook` — what the emitted `settings.json` invokes **on every tool call**. Five verbs, refuses everything else by name, ~14 ms to load |
| `bin/build-driver.mjs` | `geneseed-build` — the generator. Render flags (`--emit`/`--theme`/`--footprint`/`--out`/`--sync-themes`) and the emit targets. Also under a hard `child_process` ban |

## Proving a change

There is no `npm test`. Run these by hand.

```bash
npm run lint
```

```bash
node --test --test-reporter=tap "tests/**/*.test.mjs"
```

**Quote the glob** — node expands it, not the shell — and keep `--test-reporter=tap`: CI gates on
the reported *count*, not the exit code, because `node --test` over a glob that matches nothing
prints `# tests 0` and exits 0. A gate that fails open.

```bash
node tests/shim_intact.mjs
```

Right after the suite: the only check that no test left the machine-wide hook shim pointing at a
deleted temp directory (which silently kills every hook on the machine).

```bash
node --test --test-reporter=tap "fuzz/*.fuzz.mjs"
```

Fuzzes the hook gates' stdin through the real entry point (a process per case, so it is outside
the unit glob). Run it after touching anything under `js/hosts/hooks*` or `bin/geneseed-hook.mjs`;
`FUZZ_RUNS=500` for a longer search. Coverage runs in CI (`c8`, informational).

```bash
node bin/geneseed-cli.mjs doctor --all
```

```bash
node tests/golden.mjs
```

Runs all 263 emit configurations and requires each to render without crashing. Run it after
anything that touches the emit path. Its `--idempotent` mode re-emits into the same tree and
requires the second pass to change nothing; `--deletion` covers the prune phase. All three are
self-comparisons — nothing is measured against a stored answer. `--cli` runs the ~320-cell
CLI/hook matrix against the expectations written in each cell; run it after changing anything a
verb prints. `--jobs N` (default: min(8, cores)) fans the cells out across processes.

```bash
node tests/mutate.mjs --verify
```

Answers only "does every mutation anchor still resolve", writes nothing, takes ~50 ms. **Run it
after any refactor that moves code** — a moved anchor makes a row unappliable, which the matrix
scores as a SURVIVOR. `--all` runs the real 33-row matrix and takes minutes; an interrupted run
leaves the product tree **mutated**, so check `git status` before doing anything else.

## What bites

**Expected values are written out, not recorded.** Every table in `tests/` states its answers in
the file — `tests/unit/text_layout.test.mjs` and `tests/unit/settings_jsonc.test.mjs` are the
pattern. There is no snapshot directory and no `--record`: if a change makes a row wrong, change
the row *and* the sentence above it explaining the rule, in the same commit, and say why in the
message. A test whose expectation nobody can defend in words is a test nobody can maintain.

**`web/dist/` is tracked, and must be rebuilt and committed whenever `web/src/` changes.** It ships
in `files[]` so an install never has to build the UI. `git diff` alone is not enough to check —
vite content-hashes every chunk, so a new lazy chunk is an *untracked* file `git diff` cannot see.
After a rebuild, `geneseed web restart`, not a browser refresh: the daemon serves the `index.html`
it launched with.

**Runtime dependencies must be vendored, never installed.** `js/vendor/<name>/`, tracked source,
relative import. `tests/unit/dependency_policy.test.mjs` gates it and `docs/extending.md` §4bis says
why — the short version is that fixtures run from the OS temp root and cannot resolve a bare
specifier, and neither can a fresh `git clone`. devDependencies are fine.

**The hook path costs ~14 ms per tool call.** Anything `bin/geneseed-hook.mjs` imports is paid on
every tool call of every session. And a stray `console.log` there does not warn you — the hooks
signal through stdout JSON and return 0 on every path, so a printed byte turns a blocking gate
silently permissive.

**A hook's stdout is capped by the host, not by us.** Claude Code saves a hook output past
roughly 10k characters to a file and hands the model a 2 KB preview — no warning, everything
after the cut is gone (observed 2026-10 on 16.5 KB and 25.6 KB SessionStart outputs; the exact
threshold is undocumented). So `cmdContext` keeps its *whole* payload under `OUTPUT_BUDGET`
(9 000), counting each line at +2 because stdout is `\r\n` on Windows — a line-per-entry listing
overran by its line count before that. Measure a hook change with `node bin/geneseed-hook.mjs
context --root <install> | wc -c`. The OpenCode plugin injects through the system prompt and
has no such cap, which is why its budget stays 48 KB. The Claude hook injects `geneseed-wiki.jsonc` as
raw text and never renders wiki entries; the OpenCode plugin does — a known parity gap.

**Uninstall never needs a backup, by construction.** A user's root file gets a delimited
`<!-- BEGIN/END GENESEED -->` block (`managedBlockWrite`/`managedBlockRemove`,
`js/hosts/settings.mjs`); settings and `opencode.json(c)` are merged key by key and refused when
commented; skills, agents and `.gitignore` are claim-on-create (`claimer`, `js/hosts/native.mjs`)
and uninstall deletes only manifest-owned paths. The user decided (2026-10) that this is enough —
do not add a snapshot/restore layer.

**`--exclude-skills` filters in ONE place: `renderAll`** (`js/build/render.mjs`). Every host's
emit, the command layer and the plain bundle read the filtered `items`, so a new host gets the
exclusion for free — do not add a second filter in an emitter. The marker line
(`Excluded skills:`) is written only when something is excluded, so default builds stay
byte-identical; `excludedSkillsOfDir` reads it back and `setupBuildArgs` elides an empty list.
Protected skills are *scanned*, not listed: `linkedSkillIds` (`js/build/source.mjs`) finds every
`{{DIR_SKILLS}}/<name>` link outside the §4 catalogue table, so writing a new link protects its
target automatically.

**Adding any tracked file fails the packaging suite** until it has a row, with a written reason, in
the SHIPS or WITHHELD partition of `tests/unit/package_manifest.test.mjs`.

**Rule ids are permanent; numbers are positional.** Every law and doctrine rule is declared
`### {{LAW:<id>}} <Principle>` / `### {{DOCTRINE:<id>}} <Principle>` and cited `{{LAW:<id>}}` /
`{{DOCTRINE:<id>}}` — never by number, which the doctor refuses. The render computes the number
from position and renders a citation as the principle's name, so removing a rule rewires nothing.
Never rename an id; a removed one goes into `RETIRED_RULE_IDS` (`js/build/source.mjs`) so it is
never reused. Append anyway where you can: `LAW_META`, `LAW_CLASS`, `DOCTRINE_META`, exclusions
and the hook ledger keys are still number-keyed (doctor-pinned) — `docs/extending.md` §2e.

**`--footprint` defaults to `lean`.** A law's lean text is the authored `LEAN:else` half of its
block in `src/laws/universal.md` — amend both halves, or the amendment does not exist for most
installs. A doctrine rule carries the same block in `src/doctrines/<pack>.md` — amend both
halves there too, or the amendment does not exist for most installs either.

**Counts are computed — never type one.** `{N_*}` tokens substitute at request time, and only on
`kind: "concept"` pages. README badges and `SHIPPED.md` are the hand-written exceptions, each with
its own doctor arm.

**Nothing propagates by itself.** Editing `src/` changes nothing on any machine until something
re-emits, and `geneseed rebuild-all` is best-effort by contract.

## Conventions

ESM only, `.mjs`, zero runtime dependencies. Docblocks in this repo carry *why*, not *what* — they
are the reason a maintainer can still understand a decision, and they are worth reading before
editing the code under them. When one contradicts the code, the code wins and the docblock is a bug.

**Sharpen before you add.** Skills rot really fast; keep them lean and sharp. Before adding a skill
or an agent, merge, refine or delete one; prefer a lever that already exists (`<!-- invocation:
user -->`, `--exclude-skills`, `--doctrines`) to a new mechanism; measure the gain before designing
for it. Fewer skills means a shorter always-on list, clearer routing and less to rot.
