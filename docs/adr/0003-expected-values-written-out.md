# 0003 — Expected values are written out, never recorded

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

During the Python-to-Node port, tests compared the new implementation against recordings taken
from the old one (`tests/__snapshots__/`). Once the old implementation was gone, a red snapshot
could not be answered: there was no `--record`, and the recording came from code that no longer
existed. A recorded value also says nothing about *why* it is right.

## Decision

Every expected value lives in the test file that asserts it, above a sentence saying which decision
it pins. There is no snapshot directory and no record mode. When a change makes a row wrong, the
row **and** the sentence explaining it change in the same commit, and the commit message says why.

## Consequences

- The recordings are retired; tag `corpus-reference-v3.1.2` is the only way back to them.
- A red test is a normal step again, and its cost is an argument in prose that the new answer is
  better.
- `tests/unit/text_layout.test.mjs` and `tests/unit/settings_jsonc.test.mjs` are the pattern to copy.
- The golden matrix (`tests/golden.mjs`) compares an implementation with itself — render, re-emit,
  prune — never with a stored answer.
