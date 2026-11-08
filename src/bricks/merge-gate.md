---
name: merge-gate
description: Wait for the pull request's CI, at most 30 minutes, and report green, red, or no CI at all. Never merges.
effect: read
agent: tester
gate: human
gateOn: none
outcomes: pass, fail, none
---
Read the PR's checks with the form that returns at once, never a watch: `gh pr checks <pr> --json
name,bucket,link` (exit code 8 means pending), or `glab ci status --branch <this branch>`. Poll it
about once a minute, 30 minutes at most. A PR pushed moments ago may show no checks yet: poll for
about 2 minutes before you conclude it has none. Never merge, re-run or cancel a check, and never
edit any file.

Report `pass` when every check is green. Report `fail` when one is red — for each failing check,
its name and the cause read from its log (`gh run view <id> --log-failed`), never guessed from its
title — or with "CI pending after 30 minutes" when checks still run at the bound. Report `none`
when the repo runs no CI on this PR: the user decides whether the run goes on. Write the findings
to a file in the OS temp directory and report that file's path.
