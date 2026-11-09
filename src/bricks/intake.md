---
name: intake
description: Read the work item — a request, a document or an issue — and write it down as one clear item for the run, or ask the user what only they can answer.
effect: read
agent: explorer
outcomes: pass, fail, needs-info
gate: human
gateOn: needs-info
---
The stage hands you the run's `requirement` and its `input`: free text, a file path, or an issue (a
GitHub URL or `#<n>`: `gh issue view <n> --json title,body,comments,labels`; a GitLab one:
`glab issue view <n> --comments`). Read the input in full, then the code it names. Never edit any
file, and never post on the issue. On a re-run the `carry` holds the user's answers: first read
your previous finding, the `carry` of the latest `intake` entry in `FACTORY.md`'s `history`, so
each answer meets its question, then build on them.

Write the work item to a file in the OS temp directory, never inside the worktree: a one-line
title, what happens now, what should happen, how to reproduce it, the files it likely touches,
and the acceptance criteria, each one testable. Quote the source for each claim (issue comment,
document section, file:line). End it with two lines the review reads: `size: small`, `medium` or
`large` (small: a few lines in one or two files; large: several modules, a new interface or a data
migration; medium between), and `areas:` with any of `security`, `performance`, `ui`, `data`, or
`none`.

Report `pass` with that file's path. Report `needs-info` when a question blocks the work and only
the user can answer it: write the questions in that file, numbered, each with the assumption you
would build on without an answer, and report its path. Report `fail` when the input cannot be read.
