---
name: ci-triage
description: Read the failing CI checks for this commit and pick one code failure to fix, or stop.
effect: read
agent: explorer
outcomes: more, done
---
Key on the commit, not the branch: `gh run list --commit <HEAD sha> --json databaseId,status,conclusion`,
wait on a pending run with `gh run watch <id>`, then read `gh run view <id> --log-failed` — never
guess from a check's title. Classify each failure as code, flaky or infra. Never edit any file.
`ci-repair` needs CI to run on `loop/*` branches: with no run for HEAD, report `done` with the
note "CI does not run for <sha>" — never as green.

Write the classification, one failure per line, to a file in the OS temp directory and report
that file's path with the outcome. Report `more` with a card for ONE code failure:
{"intent": "<fix check X: cause>", "writeSet": ["<files the fix touches>"],
 "actions": ["<each of: format, imports, rename, logic, new-file, api, delete, architecture>"]}
Report `done` when CI is green for HEAD, or only flaky or infra failures remain — naming them.
