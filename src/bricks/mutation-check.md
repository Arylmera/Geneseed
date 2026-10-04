---
name: mutation-check
description: Prove the new tests bite, by mutation testing scoped to the code the card names.
effect: read
agent: tester
outcomes: pass, fail, unavailable
---
Run the project's mutation tool (Stryker, PIT, mutmut, cargo-mutants) scoped to the production
code the card's intent names. Never edit any file: leave `git status --porcelain` exactly as you
found it — send reports and caches (.mutmut-cache, mutants.out/, .stryker-tmp/) to the OS temp
directory through the tool's output options, or remove them before reporting.

Report `pass` if no surviving mutant sits on a line the new tests target.
Report `fail` with each survivor as `file:line`, the mutation, and the assertion that would kill
it, written to a file in the OS temp directory — report that file's path with the outcome.
Report `unavailable` only when the stack has no mutation tool configured — never as a silent
pass: write what you checked to a temp file the same way and report its path.
