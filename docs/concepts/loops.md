---
group: concepts
order: 11
title: "Loops"
kind: "concept"
link: {"hash": "#/docs/reference/cli", "label": "geneseed loop --help →"}
---
A **loop** is a requirement worked as small, validated, committed iterations instead of one long
turn. `geneseed loop` is the state machine: it decides every transition, ceiling, score and stop,
and hands the agent one node at a time to run. The `loop` [skill](skills.md) is the only thing
that talks to it — the agent runs the node it is given and reports the outcome, never its own
reading of the graph.

> **You already know this:** a checklist a tech lead walks through on a ticket, where some steps
> need a sign-off before continuing and others don't. The lead doesn't improvise the order; the
> checklist decides it, and only the risky steps stop for you.

## The ring

A loop is a graph of **bricks** — one node each — wired by **edges**, one per outcome a brick can
report. One cycle through the graph back to its head is an **iteration**; the graph's `loops`
array names every cycle that is allowed to exist, each with a `max` number of times a node inside
it may be re-entered. Picture it as rings: the outer ring is the iteration itself (plan, apply,
test, review, back to plan), and inner rings sit inside it for retries (apply failed its test, try
`apply` again without going all the way back around). The shipped templates that center on
`apply` — `bugfix`, `feature`, `refactor`, `tdd`, `legacy-refactor`, `deps-upgrade` — all nest a
short `apply`↔`test` retry ring inside the iteration ring, and most nest a second, wider
`review-fix` ring around that. `legacy-tests` and `ci-repair` have no `apply` at all: the first
only ever writes tests, the second repairs CI directly through `ci-fix`.

Work closes into a commit whenever the graph re-enters the iteration loop's head — so any setup
work before the loop starts (reproducing a bug, say) is its own unit, numbered iteration 0, kept
out of iteration 1's diff. For the same reason the iteration has exactly one way in: its
**head** is the first node listed in the iteration loop (normally `identify`), and every edge that
enters the iteration from outside it — and `start`, when `start` is inside it — must target that
head. `geneseed loop check` refuses a graph that enters anywhere else.

**A node's re-entry budget is not each loop's `max` added up.** Every node inside one or more
inner loops gets a single shared counter: `1 + the largest max among the inner loops that contain
it`. A node in both a `max: 5` and a `max: 3` loop gets 6 re-entries total, not 8 — the loops don't
stack, the larger one wins and the `+1` is the node's own first run. A node inside no inner loop at
all gets exactly 1 — no re-entry — which is also why **every cycle inside an iteration must be a
named inner loop** in the graph JSON: `geneseed loop check` (and `loop init`, which runs the same
check) refuses a graph with an undeclared cycle inside an iteration, before a single node runs.

## The shipped templates

| template | purpose | when to use |
|---|---|---|
| `bugfix` | reproduce, fix, test, review a defect | a reported bug with a reproduction step |
| `feature` | plan, then build and review in small iterations | new behaviour with no existing test pinning it |
| `refactor` | restructure behind the existing tests, no behaviour change | the tests already cover the code you're moving |
| `tdd` | plan, then write each failing test before the code that passes it | you want the test written first, every iteration |
| `legacy-tests` | pin undocumented behaviour with characterization tests, mutation-checked, production code untouched | code with no tests and no spec, before anyone risks changing it |
| `legacy-refactor` | pin current behaviour once with characterization tests, then refactor behind that net | the refactor target has no tests yet but will get changed |
| `deps-upgrade` | upgrade one package or group per iteration: read breaking changes, bump, adapt, audit | a dependency bump that needs to land as reviewable steps, not one big diff |
| `ci-repair` | triage failing CI checks for the current commit and fix one code failure per iteration | a red CI run on a `loop/*` branch that needs to go green |
| `architecture-decision` | draft one ADR per decision the requirement names, challenged by a skeptic brick, reviewed by the user | a design choice worth recording before (or instead of) any code changes |
| `enforce-architecture-rule` | encode an architecture rule as a test with an allowlist of today's violations, then fix one violation per iteration | a rule the codebase should hold everywhere but doesn't yet |
| `update-contract` | change an interface with live consumers as expand, migrate one consumer per iteration, contract | an API, schema or event change that can't break existing callers in one step |
| `spec-first-feature` | write the feature's spec (EARS criteria, ordered tasks) for review, then build one task per iteration | a feature whose acceptance criteria are worth pinning down before any code |
| `api-endpoint` | plan, build, test, write a Bruno request and security-review one endpoint change per iteration | an HTTP API feature where each endpoint needs its own exercised request and a security pass |
| `remove-dead-code` | confirm the suite is green, then delete one coherent group of unused code per iteration, test, review | code a tool (knip, ts-prune, vulture, PMD…) and a reference search say is unused |
| `fix-flaky-tests` | confirm flakiness by repeated runs, then fix one test's root cause per iteration — never a retry or a sleep | a test that fails only sometimes, not every run |

`feature` and `spec-first-feature` both end with an independent `done-check`: before `$close`, it
maps every acceptance criterion to a passing test (or a stated manual check) and reports `fail`
with what's missing rather than trusting the iterations that already ran.

`legacy-tests` and `legacy-refactor` both open on `baseline-green` — the suite must already be
green before either template pins anything, and `baseline-green` reporting `fail` stops the loop
rather than characterizing a change no one can tell from existing breakage.

`mutation-check`, inside `legacy-tests`, needs a mutation tool on the stack (Stryker, PIT, mutmut,
cargo-mutants) to prove the new characterization tests actually bite. With none configured it
reports `unavailable` rather than a silent `pass` — and still writes a note saying what it checked,
so the gap is visible in `LOOP.md` rather than just absent from it.

`ci-repair` needs CI to actually run on `loop/*` branches; `ci-triage` keys off the HEAD commit's
checks (`gh run list --commit`), and with no run for that commit it reports `done` with a note
rather than treating a branch CI never touched as green.

`deps-upgrade` lists lockfiles under `ignoreDeletions` (`**/package-lock.json`, `**/yarn.lock`,
`**/pnpm-lock.yaml`, `**/*.lock`, `**/gradle.lockfile`): a lockfile regenerating under a bump deletes
and re-adds hundreds of lines with no risk in them, so those lines stay out of the deleted-lines
count. Everything else keeps the default `delete` weight, and a lockfile outside the iteration's
write set still escalates like any other file.

## Notes: what survives an iteration

A `read` brick can find something worth keeping — a plan, a review finding, a mutation gap, a
classified CI failure — that the next brick needs but the outcome string alone can't carry.
`geneseed loop record --note "<text>"` (or `--note-file <path>` for anything multi-line or that
mentions `git commit`/`push`, which a shell argument can't carry safely) appends it to `LOOP.md`'s
notes, so it survives into the next node and the next iteration instead of evaporating with the
brick's own context. The brick never records a note itself — a brick only ever reports its
outcome, plus the path to a file it wrote; the loop skill records it with `--note-file` on the
brick's behalf. This applies to `plan` and `review` as much as to the newer bricks: any `read`
brick whose finding the next brick needs writes it to a file in the OS temp directory and reports
that file's path with the outcome.

## Bricks, templates, and the three origins

A **brick** is a markdown file: YAML-ish frontmatter (`name`, `description`, `effect` — `read` or
`mutate` — exactly one of `agent` or `skill`, and `outcomes`) plus a 4-10 line prose body. The
model never sees the file; `geneseed loop next` hands it the body as the prompt. A **loop
template** — a shipped template (see the table above) or one composed by hand — is the graph JSON
that wires bricks together.

Both are looked up across three origins, each able to override the one before it **by name**:

| origin | path | who writes it |
|---|---|---|
| shipped | `src/bricks/`, `src/loops/` | Geneseed itself — read by the CLI from its own source, never emitted into an install |
| global | `$XDG_CONFIG_HOME/geneseed/{bricks,loops}` (default `~/.config/geneseed/…`) | the user, for every project on this machine |
| project | `<repo>/.geneseed/{bricks,loops}` | a team, committed and shared |

Precedence is project > global > shipped. A project or global brick named `apply` replaces the
shipped `apply` everywhere a template references it, without the template changing.
`geneseed loop check` lists every override it finds, never silently.

A per-install skill exclusion is invisible to the CLI — it has no way to know which skills your
install carries. The `loop` skill covers the gap itself: when composing a graph it skips a brick
whose `skill` it doesn't have.

To add or adapt a brick, use the `brick-forge` skill — ask it, or see
[the bricks README](https://github.com/geneseed-dev/geneseed/blob/main/src/bricks/README.md) in
the repository.

## Risk, trust, and the three validation levels

Before a `mutate` brick runs, the loop scores the card the brick's setup declared: one risk weight
per action kind it named, and the score is the **max**, not a sum — one contract change outweighs
ten trivial renames, and ten trivial renames never add up to one. After the brick runs, the loop
re-scores against the real diff, and the diff can only raise the score, never lower it:

- a file touched outside the declared write set raises the score to at least **api** (`0.8`);
- more than 20 deleted lines raises it to at least the **delete** weight;
- touching a file listed in the loop's `contracts` raises it to at least the **api** weight.

`LOOP.md` itself is excluded from every score and every diff check — it's the engine's own
bookkeeping, rewritten on every action, never part of the work being judged.

The score is checked against a **trust preset** — `--preset` on `geneseed loop init`, editable
afterward in `LOOP.md`'s `preset` field, applying from the next score on:

| preset | silent ≤ | soft ≤ | above soft |
|---|---|---|---|
| prudent | 0.1 | 0.3 | blocking |
| balanced (default) | 0.2 | 0.6 | blocking |
| aggressive | 0.4 | 0.8 | blocking |

Three levels follow from where the score lands:

- **silent** — nothing more than the commit trailers below.
- **soft** — listed under "to review" in the run's final summary; no notification during the run.
- **blocking** — the run ends. `LOOP.md` is written with `status: awaiting`, and a person has to
  answer with `geneseed loop decide --verdict ok|no|amend`. Amending a verdict marks the decision
  `blocking (amended)` in the trailers rather than silently rewriting it to something else.

## Human gates

A brick can hold for a person regardless of preset or score, independent of the risk machinery
above: its frontmatter carries `gate: human`, optionally narrowed with `gateOn: <outcomes>` (no
`gateOn` holds on every outcome the brick can report). `adr-challenge` (holds on `pass` — a
drafted ADR that survived its skeptic), `fitness-define`, `migration-plan` and `spec` all gate
this way: the loop reports `{awaiting}` with `kind: "gate"` before the edge that outcome would
normally follow is taken at all — **the gate holds the whole transition**, so nothing is scored,
committed or counted against a ring budget while it waits.

`geneseed loop decide --verdict ok|no|amend` answers it:

- **`ok`** follows the edge the brick's reported outcome actually points to. On a brick gated on
  more than one outcome, a held `fail` still routes through its own edge on `ok` — which is
  usually `$stop` — so `ok` on a held failure stops the loop, it doesn't wave it through.
- **`no`** stops the loop at that node.
- **`amend`** re-runs the same brick with your note appended to `LOOP.md`'s notes, so the next
  run of that brick sees it; the node's re-entry (ring) budget restarts, since the amendment
  changes what the unit does. A node can be amended at most 3 times per iteration — the 4th
  amend stops the loop instead: three rounds that didn't converge are a conversation, not a loop.

Every closing commit that passed a gate names it under `Loop-Gates` (see below). The console's
**Active** tab shows a gated loop as `Awaiting gate at <node>`, the same way it shows a score
`awaiting`. A gate passed in a read-only setup unit leaves its approval as a note in `LOOP.md`,
not a trailer — that unit closes without a commit.

## Contracts and ignored deletions

A template may declare `contracts`: globs for the interface or schema files whose *shape* a
change can break, not just the implementation behind it — `update-contract` and
`api-endpoint` ship defaults (OpenAPI/Swagger/AsyncAPI specs, `.proto`, `.avsc`, GraphQL schemas,
Flyway/Liquibase migrations). They're copied into `LOOP.md`'s own `contracts` at `loop init`;
`loop init --contracts <globs>` appends more, and the list is editable by hand in `LOOP.md`
afterward, applying from the next score on. Touching a file any of these globs match raises the
*actual* score to at least the **api** weight (0.8) regardless of the declared card — a contract
edit is never silent.

A template may also declare `ignoreDeletions`: globs excluded from the ">20 deleted lines"
escalation rule only. `deps-upgrade` lists lockfiles this way (`**/package-lock.json`,
`**/yarn.lock`, `**/pnpm-lock.yaml`, `**/*.lock`, `**/gradle.lockfile`) because a lockfile
regenerating under a bump deletes and re-adds hundreds of lines with no risk in them;
`remove-dead-code` ignores generated output (`**/generated/**`, `**/generated-sources/**`,
`**/target/**`, `**/build/generated/**`) for the same reason. A file matched by `ignoreDeletions`
is still subject to the write-set check — it must still be declared or match a write-set glob, it
just doesn't count toward the deletion total.

Both lists, and the write set, share one hand-rolled glob dialect (no dependency — this module
imports only node builtins): `*` and `?` stay inside one path segment, `**` crosses segments and
`**/` may match zero directories (so `**/yarn.lock` also covers the root one); there is no brace
expansion (`{a,b}`). A write-set entry is matched as a glob too, but only when it has at least one
literal (non-`*`/`?`) path segment — a wildcard-only entry like `**` or `**/*.java` would
otherwise declare the whole repo as writable, so it's left to match nothing instead and the
check fails closed.

## `rules`: the template's description, on every step

`geneseed loop next` hands the template's own `description` field to every node as `rules` — not
only the iteration head that reads `LOOP.md` — so a template-wide proviso (cite your deletion
proof, a flaky test is never fixed with a retry, contract edits stop for a human by design) is
visible to whichever brick runs, including `review`, which checks the diff against it. A graph
with no `description` omits the field rather than sending an empty one.

## Java notes for the newer bricks

- **`mutation-check`** (`legacy-tests`) prefers PIT on a Maven build: `mvn test-compile
  org.pitest:pitest-maven:mutationCoverage -DtargetClasses=<fq.Class*>
  -DreportsDirectory=<OS temp dir> -DtimestampedReports=false`, and needs `pitest-junit5-plugin`
  on the classpath under JUnit 5; on Gradle, the `info.solidsoft.pitest` plugin's `pitest` task.
  With neither configured it reports `unavailable` rather than adding the plugin itself or a
  silent `pass`.
- **`fitness-define`** (`enforce-architecture-rule`) reaches for ArchUnit first on Java — a
  `FreezingArchRule`, whose violation store doubles as the allowlist of today's violations —
  before dependency-cruiser, import-linter, eslint-plugin-boundaries or size-limit elsewhere.
- **`migration-plan`** (`update-contract`) treats Pact or Spring Cloud Contract, where the repo
  already records consumer contracts, as the check `compat-check` runs against each step rather
  than only the consumers' own test suites.

## `LOOP.md` and its trailers

`LOOP.md`, at the worktree root, is both the human-readable record (title, requirement, and the
rule that you may edit `preset` or `contracts` there) and the engine's own JSON state block. Every
closing commit carries a fixed set of trailers, read straight off that state — `Loop-Gates` only
when the unit passed at least one human gate:

```
Loop-Iteration: <n>
Loop-Bricks: <every brick name visited this unit, deduplicated>
Loop-Risk-Declared: <score>
Loop-Risk-Actual: <score>
Loop-Threshold: <preset> <silent>/<soft>
Loop-Decision: silent | soft | blocking[ (amended)]
Loop-Tests: <what the loop was told about test state>
Loop-Gates: <every node whose gate passed this unit, deduplicated>
```

## The `loop/*` branch, and why merge always asks

A loop runs in its own worktree, on a branch named `loop/<slug>` — the `loop` skill creates both
with `git worktree add -b loop/<slug>` before `geneseed loop init` writes `LOOP.md` there.
While that branch is checked out and `LOOP.md` carries the engine's state marker, the git gate lets
exactly one commit/push form through without asking:

```
git add -A && git commit -F <message_file> && git push [-u] <remote> HEAD:<loop branch>
```

Nothing else is exempt — not `git commit -m`, not a quoted refspec, not a plain `git push` with no
explicit `HEAD:<ref>` — any other shape still asks. The exemption only ever covers a `loop/*`
branch, and never a shared one (`main`, `master`, `develop`, `development`, `release/*`,
`hotfix/*`). The **final** commit of a run — the one that removes `LOOP.md` on `$close` — is
outside the exemption too, because the loop is no longer running when it lands; that ask is your
consent to close it. **Merging a loop branch into anything else always asks, with no exception.**
The loop reports the branch to merge and the iterations that landed in "to review" — it never
merges for you.

## `geneseed loop` actions

| action | what it does |
|---|---|
| `check` | lists templates and every brick (available, unavailable, overridden); validates one graph file (`--graph`) or one brick file (`--brick`) |
| `init` | writes a fresh `LOOP.md` from a template or graph file, under a title, requirement and trust preset |
| `next` | the only driver of the cycle — returns the next thing to do: run a node, score a card, answer an `awaiting`, or a terminal |
| `score` | scores a declared card (`--declared`) before a mutate node runs, or the real diff (`--diff`, numstat piped on stdin) before a commit |
| `record` | records a brick's reported outcome and advances the graph; `--note` or `--note-file <path>` carries a finding (a read brick's plan or review findings) into `LOOP.md`'s notes so it survives the unit |
| `decide` | answers an `awaiting` validation with a verdict and a note |

Run `geneseed loop --help` for the full flag list.

## Limits

- **No parallel nodes.** The graph runs one node at a time; there is no fan-out.
- **A per-install skill exclusion is invisible to the CLI** (see above) — the `loop` skill is
  responsible for skipping bricks it can't run, not the engine.

## Watching a loop

Every `geneseed loop init` upserts an identity row — root, branch, title, started — into a
**loop registry** at `$XDG_CONFIG_HOME/geneseed/loops.json` (default `~/.config/geneseed/loops.json`).
`LOOP.md` stays the only source of loop *state*; the registry just lets the console find a loop
without scanning every worktree on the machine. Only loops launched by this version or later are
registered, so a loop started before the registry existed won't appear until re-initialised.

The console's **Loops › Active** tab (`GET /api/loops/active`, polled every few seconds) reads that
registry and shows one card per loop: branch, status (`running`, `awaiting`, `done`, `stopped`,
`finished`, or `unreadable` if `LOOP.md` fails to parse), `iteration N / max`, and its current
node. A loop `awaiting` a decision is highlighted with what it's waiting on — the launch, the
declared score, the actual score, or a human gate (with its node) — but **the answer is given in the agent's session**, with
`geneseed loop decide`, never from the page. A finished loop (`LOOP.md` removed) is kept, muted,
for 7 days after first being seen finished, then dropped. Selecting a card draws its ring with the
current node filled, with the iteration history (declared, actual, decision, tests) underneath.

Each live card also carries a **preset picker** (`POST /api/loops/preset`) that rewrites
`LOOP.md`'s `preset` field — the same edit you could make by hand — applying from the next score
on, not retroactively. It's the tab's only write; there is no relaunch button.

## Not foreman mode

A loop and a [foreman-mode](foreman-mode.md) pipeline are both "hand work off and keep going," but
they solve different problems. A pipeline is a one-shot crew for a single task, uncommitted until
you accept it. A loop is a long-running, self-scoring state machine that commits each validated
iteration on its own branch as it goes, and only stops for a person when the risk crosses a
threshold.
