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
`apply` again without going all the way back around). The three shipped templates —
`bugfix`, `feature`, `refactor` — all nest a short `apply`↔`test` retry ring inside the iteration
ring, and `bugfix` nests a second, wider `apply`↔`test`↔`review` ring around that.

Work closes into a commit whenever the graph re-enters the iteration loop's head — so any setup
work before the loop starts (reproducing a bug, say) is its own unit, numbered iteration 0, kept
out of iteration 1's diff.

**A node's re-entry budget is not each loop's `max` added up.** Every node inside one or more
inner loops gets a single shared counter: `1 + the largest max among the inner loops that contain
it`. A node in both a `max: 5` and a `max: 3` loop gets 6 re-entries total, not 8 — the loops don't
stack, the larger one wins and the `+1` is the node's own first run. A node inside no inner loop at
all gets exactly 1 — no re-entry — which is also why **every cycle inside an iteration must be a
named inner loop** in the graph JSON: a cycle the author forgot to declare hits that one-shot
budget on its second pass and stops, by construction, rather than looping forever.

## Bricks, templates, and the three origins

A **brick** is a markdown file: YAML-ish frontmatter (`name`, `description`, `effect` — `read` or
`mutate` — exactly one of `agent` or `skill`, and `outcomes`) plus a 4-10 line prose body. The
model never sees the file; `geneseed loop next` hands it the body as the prompt. A **loop
template** (`bugfix`, `feature`, `refactor`, or one composed by hand) is the graph JSON that wires
bricks together.

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

## `LOOP.md` and its trailers

`LOOP.md`, at the worktree root, is both the human-readable record (title, requirement, and the
rule that you may edit `preset` or `contracts` there) and the engine's own JSON state block. Every
closing commit carries six trailers, read straight off that state:

```
Loop-Iteration: <n>
Loop-Bricks: <every brick name visited this unit, deduplicated>
Loop-Risk-Declared: <score>
Loop-Risk-Actual: <score>
Loop-Threshold: <preset> <silent>/<soft>
Loop-Decision: silent | soft | blocking[ (amended)]
Loop-Tests: <what the loop was told about test state>
```

## The `loop/*` branch, and why merge always asks

A loop runs in its own worktree, on a branch named `loop/<slug>`, created by `geneseed loop init`.
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
| `record` | records a brick's reported outcome and advances the graph |
| `decide` | answers an `awaiting` validation with a verdict and a note |

Run `geneseed loop --help` for the full flag list.

## Limits

- **No parallel nodes.** The graph runs one node at a time; there is no fan-out.
- **A per-install skill exclusion is invisible to the CLI** (see above) — the `loop` skill is
  responsible for skipping bricks it can't run, not the engine.

## Not foreman mode

A loop and a [foreman-mode](foreman-mode.md) pipeline are both "hand work off and keep going," but
they solve different problems. A pipeline is a one-shot crew for a single task, uncommitted until
you accept it. A loop is a long-running, self-scoring state machine that commits each validated
iteration on its own branch as it goes, and only stops for a person when the risk crosses a
threshold.
