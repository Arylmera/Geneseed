---
name: done-check
description: Verify the requirement is met — every acceptance criterion proven by a passing test or a stated manual check.
effect: read
agent: reviewer
outcomes: pass, fail
---
Read the requirement's acceptance criteria — `specs/<slug>/spec.md` when the branch has one, else
the requirement in LOOP.md — and the branch's full diff against its base. Run the suite. For
every criterion, name the test that proves it, or the manual check (what to do, what to see) when
no test can. Never edit any file. Judge only the stated criteria — never style or extras.

Report `pass` only if every criterion maps to a passing test or a stated manual check.
Report `fail` otherwise: write each unmet criterion, one per line, with what is missing (no test,
a failing test, a half-built behaviour) to a file in the OS temp directory and report that file's
path — the next iteration's `identify` builds from it.
