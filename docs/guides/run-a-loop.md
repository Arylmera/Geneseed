---
group: guides
order: 14
title: "Run a loop"
kind: "concept"
---
A **loop** works one requirement as small iterations. Each one is planned, applied, tested, reviewed, scored for risk and committed on its own branch. You ask for it in plain words. The agent drives `geneseed loop`, which decides every step, and stops for you only when a change is risky or a step needs your sign-off. The loop never merges: the branch is yours to review.

This page is the how-to. For how the engine works (rings, scoring, trailers), see [Loops](../concepts/loops.md).

## Before you start

| You need | Why |
| --- | --- |
| An install that carries the `loop` skill | The skill is what talks to `geneseed loop`. After upgrading Geneseed, run `geneseed rebuild-all` so every install gets the current skill. |
| A git repository with a remote named `origin` | Every iteration ends with `git push -u origin HEAD:loop/<slug>`. With no remote, the agent reports and stops. |
| A test command the agent can run | The `test` brick runs the project's suite, and most templates retry `apply` until it passes. |
| For `ci-repair`: CI that runs on `loop/*` branches, and the `gh` CLI | `ci-triage` reads the checks of the HEAD commit with `gh run list --commit`. |
| For `legacy-tests`: a mutation tool (PIT, Stryker, mutmut, cargo-mutants) | Optional. Without one, `mutation-check` reports `unavailable` and the loop carries on, with a note saying so. |

Check the catalogue the CLI sees from your repo:

```bash
geneseed loop check
```

It lists every template and brick, marks the unavailable ones and says why, and names every project or global brick that overrides a shipped one.

## Start a loop

Ask the agent, naming a template or not:

```text
run a tdd loop to add rate limiting to the /orders endpoint
run a bugfix loop for issue 412: totals round the wrong way on refunds
start a loop to remove the dead code knip reports in src/billing
run a ci-repair loop on this branch, prudent
```

The agent then:

1. Creates a worktree on a new branch, `git worktree add ../<repo>-loop-<slug> -b loop/<slug>`, and works from there. Your own checkout is not touched.
2. Picks the template you named. If you named none, it runs `geneseed loop check` and composes a graph from the available bricks, validated with `geneseed loop check --graph <file>`.
3. Runs `geneseed loop init --title … --requirement … --graph <template> --preset <preset>`. This writes `LOOP.md` at the worktree root and registers the loop so the console can show it.

### Which template

| I want to… | Template | Category |
| --- | --- | --- |
| Record a design decision as an ADR before any code changes | `architecture-decision` | architecture |
| Make a rule hold everywhere (a test with an allowlist, then one violation fixed per iteration) | `enforce-architecture-rule` | architecture |
| Change an API, schema or event that has live consumers, without breaking them | `update-contract` | architecture |
| Pin untested legacy behaviour with characterization tests, production code untouched | `legacy-tests` | tests |
| Write each failing test before the code that passes it | `tdd` | tests |
| Fix a test that fails only sometimes, at its root cause | `fix-flaky-tests` | tests |
| Fix a reported bug, starting from a failing reproduction | `bugfix` | development |
| Build a feature in planned iterations | `feature` | development |
| Pin the acceptance criteria in a spec you review first, then build it | `spec-first-feature` | development |
| Add or change HTTP endpoints, each with a Bruno request and a security pass | `api-endpoint` | development |
| Restructure code that the tests already cover | `refactor` | refactoring |
| Refactor code that has no tests yet | `legacy-refactor` | refactoring |
| Delete unused code, one coherent group per iteration | `remove-dead-code` | refactoring |
| Upgrade dependencies one package or group at a time | `deps-upgrade` | day-to-day |
| Turn a red CI run green on a `loop/*` branch | `ci-repair` | day-to-day |

The console's **Loops › Templates** shows each one as a ring, with its bricks and which of them stop for you.

## Trust: how far it goes before it asks

Before each change, and again after it, the loop scores its risk and compares the score with a **trust preset**:

| Preset | What gets through without asking |
| --- | --- |
| `prudent` | Little beyond renames. It also asks you to approve the graph before the first node runs. |
| `balanced` *(default)* | Logic changes and new files. API changes and deletions stop. |
| `aggressive` | Everything short of an architecture-level change. |

- **Install default.** The `--trust` choice your install was built with (`geneseed build --emit <target> --trust prudent`; see [Choose your setup](choose-your-setup.md)).
- **One loop.** Say it when you start: "run it prudent", "aggressive is fine for this one".
- **Mid-loop.** Pick another preset in the console under **Loops › Active**, or edit the `preset` field in `LOOP.md`. It applies from the next score, not to what already ran.

## While it runs

Each iteration is one commit on `loop/<slug>`, pushed as it lands. Work done before the first iteration, such as reproducing a bug, is its own commit, numbered iteration 0. Every change ends at one of three levels:

| Level | What you see |
| --- | --- |
| **silent** | Only the commit and its trailers. |
| **soft** | The commit lands, and the final report lists it under "to review". |
| **blocking** | The agent stops and asks you before anything is committed. |

### When it asks you

The agent ends its turn and shows you what it is waiting on:

- **A blocking score**: the change it plans (before it runs) or the staged diff (after), with the reasons for the score. One file outside the declared write set, more than 20 deleted lines, or a file that matches the loop's `contracts` is enough.
- **A human gate**: some bricks always stop for you, whatever the preset. An ADR that survived its skeptic (`adr-challenge`), an architecture rule and its allowlist (`fitness-define`), a contract migration plan (`migration-plan`) and a feature spec (`spec`) are all gated.
- **Launch**, under `prudent`: the graph it is about to run.

Answer in the agent's session, in your own words:

| You say | What happens |
| --- | --- |
| ok / go ahead | It continues. On a gate held on a failure, ok follows that failure's edge, which usually stops the loop. |
| no | The loop stops at that node. |
| amend, with a note ("keep the old field until v3") | The same brick runs again with your note added to `LOOP.md`. A gate can be amended three times per iteration; a fourth amend stops the loop. |

The agent passes your answer on as `geneseed loop decide --verdict ok|no|amend --note "<your words>"`. The console never answers for you.

### Where to watch

- **Console: Loops › Active.** Every registered loop, awaiting ones first: the branch, `iteration N / max`, the current node on its ring, what an awaiting loop waits on, and the iteration history.
- **`LOOP.md`** at the worktree root: the title, the requirement, the preset, the contracts, the notes the bricks left, and the engine's state.
- **The commits.** Each one carries the iteration, the bricks it ran, its declared and actual risk, the decision and the test state:

```bash
git log --format='%h %s%n%(trailers)' loop/<slug>
```

While a loop runs on its `loop/*` branch, the git gate lets exactly one commit-and-push shape through without asking, the one the agent uses to close each iteration. Any other git command still asks, as usual. Bob has no ask prompt, so there the commit and push gate logs a warning instead of asking.

## Stop, resume, and what ends a loop

- **Stop.** Interrupt the agent whenever you like. The state is `LOOP.md` plus the branch, so nothing is lost.
- **Resume.** Ask "resume the loop" in a session opened in the worktree, or run `geneseed loop next` there. The same goes after you answered a question in a new session.

A loop ends one of two ways:

| End | When |
| --- | --- |
| `$close` | The iteration head reports nothing left to do. Some templates first run an independent `done-check`. |
| `$stop` | A brick reported an outcome wired to stop (a red baseline in `baseline-green`, say), you answered no, a gate was amended a fourth time, two iterations in a row produced no diff, an inner retry ring ran out twice in one iteration, a read-only brick changed files, or the iteration ceiling was reached (the template's `max`, never above 20). |

On `$stop` the agent reports the reason and leaves the branch as it is.

## The end: you merge

On `$close` the agent removes `LOOP.md` in one last commit. That commit is outside the loop's exemption, so the git gate asks you: saying yes is how you close the loop. The agent then reports the iteration count, the soft iterations to review, the notes, and the branch.

**The loop never merges.** Open a pull request from `loop/<slug>`, or review the branch, and merge it yourself. Merging a loop branch always asks, with no exception. Remove the worktree when you are done (`git worktree remove ../<repo>-loop-<slug>`).

## Running one by hand (advanced)

You can drive the engine without the agent, which helps when you debug a template. Work from a worktree on a `loop/*` branch:

```bash
geneseed loop check --graph my-loop.json          # validate a graph file (keep it outside the worktree)
geneseed loop init --title "Rate limit /orders" \
  --requirement "429 after 100 requests a minute per key" \
  --graph tdd --preset prudent --contracts 'api/openapi.yaml'
geneseed loop next                                 # what to do now, as one JSON object
```

Then repeat `geneseed loop next` and act on what it prints:

| `next` prints | You run |
| --- | --- |
| `{node, validate: true}` | `geneseed loop score --declared` (or, for a setup brick, `--actions … --write-set '…' --intent …`) |
| `{node}` | the brick's prompt, then `git status --porcelain \| geneseed loop record --outcome <outcome>` (the iteration head adds `--card '<json>'` when it reports `more`) |
| `{verify, run}` | exactly the printed `run` command, which pipes the staged numstat into `geneseed loop score --diff` |
| `{awaiting}` | `geneseed loop decide --verdict ok\|no\|amend --note "…"` |
| `{commit: true, message_file}` | `git add -A && git commit -F <message_file> && git push -u origin HEAD:loop/<slug>` |
| `{terminal}` | nothing more: `$close` or `$stop` |

Every flag is in `geneseed loop --help`. The full cycle, including discards and notes, is in [Loops](../concepts/loops.md).

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| It stopped as blocking on a small change | The diff touched a file outside the iteration's declared write set, which raises the score to at least the API weight. Check the reasons it shows. Answer ok if the file belongs to the change, or amend with a note to keep it out. |
| The git gate asks on every iteration's commit | Only one exact shape is exempt. A `cd …` prefix, `git -C`, a quoted refspec (`"HEAD:loop/x"`), `git commit -m` or a message-file path with a space all fall back to asking. Make sure the session works from the worktree itself. |
| The final `close` commit asks | Expected. The loop is over, and that ask is your consent to close it. |
| `mutation-check` reported `unavailable` | No mutation tool is configured. The loop continues and records the gap in `LOOP.md`'s notes. Add PIT, Stryker, mutmut or cargo-mutants to make it bite. |
| `ci-repair` closed at once with "CI does not run for <sha>" | CI has no run for the pushed commit. Enable your pipeline on `loop/*` branches and check that `gh` is logged in. |
| `geneseed loop init` says `LOOP.md already exists` | A loop is already running in this worktree. Resume it with `geneseed loop next`, or start the new one in another worktree. |
| `init` prints `problems` | The graph fails `loop check`, for example a cycle not declared as a loop, or a brick that is missing or unavailable. Fix the graph, or pick a shipped template. |
| A loop is missing from **Loops › Active** | Only loops started with `geneseed loop init` from a version with the registry appear there. Look in the worktree's `LOOP.md` instead. |
| The agent does not know about loops | The install predates the `loop` skill. Run `geneseed rebuild-all`, then start a new session. |
