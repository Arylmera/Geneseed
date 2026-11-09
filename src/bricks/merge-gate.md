---
name: merge-gate
description: Wait for the pull request's CI, at most 30 minutes, and report green, red, or no verdict (no CI, or none readable). Never merges.
effect: read
agent: tester
gate: human
gateOn: none
outcomes: pass, fail, none
---
Wait with a command that returns by itself, never a foreground `sleep`: `gh pr checks <pr> --watch
--interval 30`, or `glab ci status --wait --branch <this branch>`. Bound each call under 10
minutes, by your shell tool's timeout or `timeout 540` in a POSIX shell, and repeat it up to 30
minutes in all. Then read the verdict once: `gh pr checks <pr> --json name,bucket,link` (exit 8:
pending), or `glab ci status --branch <this branch>`. A PR pushed moments ago may show no checks
yet, and a watch then returns at once: re-check for about 2 minutes before you conclude it has
none. Never merge, re-run or cancel a check, and never edit any file.

Report `pass` when every check is green. Report `fail` when one is red — for each failing check,
its name and the cause read from its log (`gh run view <id> --log-failed`), never guessed from its
title. Report `none` when the repo runs no CI on this PR: the user decides whether the run goes
on. Report `none` too, with the finding starting `environment:` and the cause, when no verdict
can be read: checks still pending after 30 minutes, or `gh`/`glab` missing or failing. An
environment failure is never a `fail`: a `fail` goes back to the loop, whose code cannot fix it,
and `none` holds for the user. Write the findings to a file in the OS temp directory and report
that file's path.
