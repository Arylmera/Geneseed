---
group: concepts
kind: "concept"
section: "Loops"
order: 19
title: "Notes and rules"
description: "What survives an iteration in LOOP.md's notes, and the rules a template hands every brick."
---
Two ways words travel through a loop: the notes a brick leaves in `LOOP.md`, and the rules a template hands every brick.

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

## `description` and `rules`: what a template is for, and what every brick must do

A template's JSON carries two prose fields, and they are never confused:

- **`description`** — the catalogue blurb: what the template is for and when to pick it. The
  `loop` skill and the console read it to choose a template; no brick ever receives it.
- **`rules`** — optional, a list of one-line instructions every brick of this loop must follow
  (`["Each card's intent cites the proof it is unused: …", "Generated sources do not count as
  unused."]`). `geneseed loop check` refuses anything but a list of non-empty strings.

`geneseed loop next` hands the template's `rules` to every node — not only the iteration head that
reads `LOOP.md` — so a template-wide proviso (cite your deletion proof, a flaky test is never fixed
with a retry, contract edits stop for a human by design) is visible to whichever brick runs,
including `review`, which checks the diff against it. A graph with no `rules`, or an empty list,
omits the field; there is no fallback to `description`.

A template may also carry a **`category`** — one of `architecture`, `tests`, `development`,
`refactoring`, `day-to-day` — the shelf the console's Loops page files it under, in that order.
It is optional (a template without one is listed under *Other*); `geneseed loop check` refuses
any other value.
