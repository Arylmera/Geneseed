---
group: reference
order: 2
title: "Loop actions"
kind: "concept"
section: "CLI & environment"
description: "The geneseed loop actions, one line each."
---
The actions of `geneseed loop`, the state machine behind [Loops](../concepts/loops.md). The `loop` skill calls them for you; [Finish a loop](../guides/loop-finish.md) shows how to drive one by hand.

| action | what it does |
|---|---|
| `check` | lists templates and every brick (available, unavailable, overridden); validates one graph file (`--graph`) or one brick file (`--brick`) |
| `init` | writes a fresh `LOOP.md` from a template or graph file, under a title, requirement and trust preset |
| `next` | the only driver of the cycle — returns the next thing to do: run a node, score a card, answer an `awaiting`, or a terminal |
| `score` | scores a declared card (`--declared`) before a mutate node runs, or the real diff (`--diff`, numstat piped on stdin) before a commit |
| `record` | records a brick's reported outcome and advances the graph; `--note` or `--note-file <path>` carries a finding (a read brick's plan or review findings) into `LOOP.md`'s notes so it survives the unit |
| `decide` | answers an `awaiting` validation with a verdict and a note |

Run `geneseed loop --help` for the full flag list.
