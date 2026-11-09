---
name: review-panel
description: Review the branch's change with a panel of seats sized to the work item, each blind to how it was built, and merge their verdicts into one.
effect: read
skill: factory
outcomes: pass, fail
---
You run this stage yourself and chair it; the seats are agents you dispatch. Never edit a file.

The work item is the latest `carry` an `intake` entry left in `FACTORY.md`'s `history` (in
`analysis-to-build`, the approved `specs/<slug>/spec.md`). Read its `size:` and `areas:` lines; a
missing or unknown size counts as `large`. Pick the seats from the factory's `review.seats` in
`FACTORY.md`: the list for that size, plus the list for each area, each agent once. With no
`review.seats`, seat `reviewer` alone.

Find the base as `checks` does and take the diff: `git diff <merge-base> HEAD`. Dispatch every seat
in one parallel batch, each in its own context. Each brief holds the work item, the factory's
`rules` and the diff (inline for a seat that has no shell, such as `steward` or `user-advocate`;
else the base commit to diff against), and asks for the seat's own verdict. Nothing else: never a
loop note, `LOOP.md`, the developer's reasoning, or anything from the holdout folder.

Chair: `reviewer`'s `block` or `fix-then-ship`, `security`'s `fix-required`, `performance`'s
`fix-recommended`, and a `tester` that names an acceptance criterion without a passing test each
fail the panel. `steward` and `user-advocate` are advisory: their points go in, and never fail it
alone. A seat that returns no verdict is dispatched once more; a second silence fails the panel.
Write one file in the OS temp directory: each seat's verdict, then the findings that fail it
(`file:line`, what is wrong, what to do instead), then the advisory points. Report `fail` when any
seat failed, else `pass`, with that file's path.
