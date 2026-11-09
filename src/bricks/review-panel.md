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
else the base commit to diff against), and states three rules: read only the diff and the files it
touches, never the history past the diff, `LOOP.md`, `FACTORY.md` or the holdout folder; edit no
file; return a verdict and its findings, nothing else. Never add a loop note, the developer's
reasoning or anything from the holdout folder to a brief.

Chair. These verdicts fail the panel: `reviewer` `block` or `fix-then-ship`; `security`
`fix-required`; `tester` `STATUS: OK` with a failing test or an acceptance criterion it names
without a passing test. These pass: `reviewer` `ship`, `security` `safe to ship`, `tester` `STATUS:
OK` with neither. Advisory, never failing alone: `performance` (`within budget`, `fix-recommended`
or `cannot-measure`), `steward` and `user-advocate`. No verdict: `tester` `BLOCKED`, `ERROR` or
`OUT_OF_SCOPE`, a `reviewer` or `security` seat that declines to give one, or a seat that returns
nothing. Dispatch a seat with no verdict once more; a second time without one fails the panel.

Write one file in the OS temp directory: each seat's verdict, then the findings that fail it
(`file:line`, what is wrong, what to do instead), then the advisory points. Pass on only findings
about the diff, and never quote holdout text. Report `fail` when any seat failed, else `pass`,
with that file's path.
