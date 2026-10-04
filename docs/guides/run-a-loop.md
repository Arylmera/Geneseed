---
group: guides
order: 21
title: "Run a loop"
kind: "concept"
section: "Loops"
description: "Start a loop: what you need, how to ask, which template, and how much it does before it asks."
---
A **loop** works one requirement as small iterations. Each one is planned, applied, tested, reviewed, scored for risk and committed on its own branch. You ask for it in plain words. The agent drives `geneseed loop`, which decides every step, and stops for you only when a change is risky or a step needs your sign-off. The loop never merges: the branch is yours to review.

This page is the how-to. For how the engine works (rings, scoring, trailers), see [Loops](../concepts/loops.md). Once it runs, see [While a loop runs](loop-running.md) and [Finish a loop](loop-finish.md).

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
2. Picks the template you named (see [Which loop template](loop-which-template.md)). If you named none, it runs `geneseed loop check` and composes a graph from the available bricks, validated with `geneseed loop check --graph <file>`.
3. Runs `geneseed loop init --title … --requirement … --graph <template> --preset <preset>`. This writes `LOOP.md` at the worktree root and registers the loop so the console can show it.

## Trust: how far it goes before it asks

Before each change, and again after it, the loop scores its risk and compares the score with a **trust preset**:

| Preset | What gets through without asking |
| --- | --- |
| `prudent` | Little beyond renames. It also asks you to approve the graph before the first node runs. |
| `balanced` *(default)* | Logic changes and new files. API changes and deletions stop. |
| `aggressive` | Everything short of an architecture-level change. |

- **Install default.** The `--trust` choice your install was built with (`geneseed build --emit <target> --trust prudent`; see [Footprint, loop trust and changing later](setup-footprint.md)).
- **One loop.** Say it when you start: "run it prudent", "aggressive is fine for this one".
- **Mid-loop.** Pick another preset in the console under **Loops › Active**, or edit the `preset` field in `LOOP.md`. It applies from the next score, not to what already ran.

---

**Next:** [Which loop template](loop-which-template.md)
