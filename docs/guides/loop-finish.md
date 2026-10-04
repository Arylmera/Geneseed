---
group: guides
order: 18
title: "Finish a loop"
kind: "concept"
section: "Loops"
description: "How a loop ends and gets merged, how to drive one by hand, and fixes for what goes wrong."
---
How a loop ends, how to drive the engine by hand, and what to do when a loop misbehaves. To start one, see [Run a loop](run-a-loop.md).

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
