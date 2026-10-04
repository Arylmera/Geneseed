---
name: ci-triage
description: Read the failing CI checks on this branch and pick one code failure to fix, or stop.
effect: read
agent: explorer
outcomes: more, done
---
Read the failing checks' LOGS for the current branch (`gh run view --log-failed`), waiting for a
pending run to finish — never guess from a check's title. Classify each failure as code, flaky or
infra. Never edit, create or delete any file: this brick only reads.

Write the classification, one failure per line, to a file in the OS temp directory and pass it
as `--note-file <path>` with the outcome.
Report `more` with a card for ONE code failure, passed as `--card`: {"intent": "<fix check X:
cause>", "writeSet": ["<files the fix touches>"], "actions": ["<kinds>"]}.
Report `done` when CI is green, or when only flaky or infra failures remain — naming them.
