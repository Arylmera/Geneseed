---
name: mutation-check
description: Prove the new tests bite, by mutation testing scoped to the card's production files.
effect: read
agent: tester
outcomes: pass, fail, unavailable
---
Run the project's mutation tool (Stryker, PIT, mutmut, cargo-mutants) scoped to the lines the new
tests target in the card's production files. Send its reports to the OS temp directory or a
gitignored path. Never edit, create or delete any file in the worktree: this brick only reads.

Report `pass` if no surviving mutant sits on a line the new tests target.
Report `fail` listing each survivor as `file:line`, the mutation, and the assertion that would
kill it — write that list to a file in the OS temp directory and run
`geneseed loop record --outcome fail --note-file <path>`, or `characterize` never sees it.
Report `unavailable` only when the stack has no mutation tool configured, and say why:
`geneseed loop record --outcome unavailable --note "no mutation tool: <what you checked>"`.
