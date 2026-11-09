---
name: review-panel
description: Review the branch's change with a panel of seats sized to the work item, each blind to how it was built, and merge their verdicts into one.
effect: read
skill: factory
outcomes: pass, fail
---
You run this stage yourself and chair it; the seats are agents you dispatch. Never edit a file;
only put the tree back, as below.

Read `size:` and `areas:` from the latest `carry` an `intake` entry left in `FACTORY.md`'s
`history`, always; a missing or unknown size counts as `large`. That carry is also the work item,
except in `analysis-to-build`, where the work item text is the approved `specs/<slug>/spec.md`.
Pick the seats from the factory's `review.seats` in `FACTORY.md`: the list for that size, plus
the list for each area, each agent once. With no `review.seats`, seat `reviewer` alone.

Run `git fetch origin`, find the default branch (`gh repo view --json defaultBranchRef`, or `git
remote show origin`), then the base, `git merge-base HEAD origin/<default>`, and take the diff
without the engine files, which the loops commit: `git diff <merge-base> HEAD -- . ':!FACTORY.md'
':!LOOP.md'`. Dispatch every seat in one parallel batch, each in its own context.
Each brief holds the work item, the factory's `rules` and the diff (inline for a seat that has no
shell, such as `steward` or `user-advocate`; else the base commit and that diff command, engine
files excluded), and states
three rules: read only the diff and the files it touches, never the history past the diff,
`LOOP.md`, `FACTORY.md` or the holdout folder; edit no file; return a verdict and its findings,
nothing else. Never add a loop note, the developer's reasoning or anything from the holdout folder
to a brief.

Chair. These verdicts fail the panel: `reviewer` `block` or `fix-then-ship`; `security`
`fix-required`; `tester` `STATUS: OK` with a failing test or an acceptance criterion it names
without a passing test. These pass: `reviewer` `ship`, `security` `safe to ship`, `tester` `STATUS:
OK` with neither. Advisory, never failing alone: `performance` (`within budget`, `fix-recommended`
or `cannot-measure`), `steward` and `user-advocate`. No verdict: `tester` `BLOCKED`, `ERROR` or
`OUT_OF_SCOPE`, a `reviewer` or `security` seat that declines to give one, or a seat that returns
nothing. Dispatch a seat with no verdict once more; a second time without one fails the panel.

Before you record, put the tree back as it was: restore every tracked file a seat changed (`git
restore --staged --worktree -- <path>`) and delete every untracked file a seat created (a test
run's output), naming each one in the finding. Never touch `FACTORY.md` or `LOOP.md`: they are
the run's state. Write one file in the OS temp directory: each
seat's verdict, then the findings that fail it (`file:line`, what is wrong, what to do instead),
then the advisory points. Pass on only findings about the diff, and never quote holdout text.
Report `fail` when any seat failed, else `pass`, with that file's path.
