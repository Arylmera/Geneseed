---
group: guides
order: 17
title: "While a loop runs"
kind: "concept"
section: "Loops"
description: "What a running loop commits, when it stops to ask you, where to watch it, and how to stop or resume it."
---
A loop started with [Run a loop](run-a-loop.md) works on its own `loop/<slug>` branch. This is what you see while it runs, and how to step in.

Each iteration is one commit on `loop/<slug>`, pushed as it lands. Work done before the first iteration, such as reproducing a bug, is its own commit, numbered iteration 0. Every change ends at one of three levels:

| Level | What you see |
| --- | --- |
| **silent** | Only the commit and its trailers. |
| **soft** | The commit lands, and the final report lists it under "to review". |
| **blocking** | The agent stops and asks you before anything is committed. |

## When it asks you

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

## Where to watch

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

---

**Next:** [Finish a loop](loop-finish.md)
