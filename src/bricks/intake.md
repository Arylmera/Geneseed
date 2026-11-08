---
name: intake
description: Read the work item — a request, a document or an issue — and write it down as one clear item for the run.
effect: read
agent: explorer
outcomes: pass, fail
---
The stage hands you the run's `requirement` and its `input`: free text, a file path, or an issue (a
GitHub URL or `#<n>`: `gh issue view <n> --json title,body,comments,labels`; a GitLab one:
`glab issue view <n> --comments`). Read the input in full, then the code it names. Never edit any
file, and never post on the issue.

Write the work item to a file in the OS temp directory, never inside the worktree: a one-line
title, what happens now, what should happen, how to reproduce it, the files it likely touches,
and the acceptance criteria, each one testable. Quote the source for each claim (issue comment,
document section, file:line). Report `pass` with that file's path. Report `fail` when the input
cannot be read, or says too little to state one testable criterion — list the open questions in
such a file and report its path.
