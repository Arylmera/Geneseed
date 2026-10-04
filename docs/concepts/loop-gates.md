---
group: concepts
kind: "concept"
section: "Loops"
order: 21
title: "Human gates"
description: "Bricks that hold for a person whatever the score, and how ok, no and amend answer them."
---
A brick can hold for a person regardless of preset or score, independent of the [risk machinery](loop-risk.md): its frontmatter carries `gate: human`, optionally narrowed with `gateOn: <outcomes>` (no
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

Every closing commit that passed a gate names it under `Loop-Gates` (see [LOOP.md, trailers and the loop branch](loop-branch.md)). The console's
**Active** tab shows a gated loop as `Awaiting gate at <node>`, the same way it shows a score
`awaiting`. A gate passed in a read-only setup unit leaves its approval as a note in `LOOP.md`,
not a trailer — that unit closes without a commit.
