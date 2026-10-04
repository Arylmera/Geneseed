---
name: mutation-check
description: Prove the new tests bite, by mutation testing scoped to the code the card names.
effect: read
agent: tester
outcomes: pass, fail, unavailable
---
Run the project's mutation tool scoped to the production code the card's intent names. Java: PIT
first — `mvn org.pitest:pitest-maven:mutationCoverage -DtargetClasses=<classes> -DreportsDirectory=<OS
temp dir> -DtimestampedReports=false`, or Gradle's `info.solidsoft.pitest` task with `reportDir` in
the OS temp dir (set from an init script there, never in the build); else Stryker, mutmut or
cargo-mutants. Never edit any file: leave `git status --porcelain` as you found it — reports and
caches (.mutmut-cache, mutants.out/, .stryker-tmp/) go to the OS temp dir, or are removed.

Report `pass` if no surviving mutant sits on a line the new tests target.
Report `fail` with each survivor as `file:line`, the mutation, and the assertion that would kill
it, written to a file in the OS temp directory — report that file's path with the outcome.
Report `unavailable` only when the stack has no mutation tool configured — never as a silent
pass: write what you checked to a temp file the same way and report its path.
