---
group: concepts
kind: "concept"
section: "Loops"
order: 20
title: "Risk, trust and validation levels"
description: "How a loop scores a change, the trust presets, and the silent, soft and blocking levels."
---
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

- **silent** — nothing more than the commit trailers (see [LOOP.md, trailers and the loop branch](loop-branch.md)).
- **soft** — listed under "to review" in the run's final summary; no notification during the run.
- **blocking** — the run ends. `LOOP.md` is written with `status: awaiting`, and a person has to
  answer with `geneseed loop decide --verdict ok|no|amend`. Amending a verdict marks the decision
  `blocking (amended)` in the trailers rather than silently rewriting it to something else.
