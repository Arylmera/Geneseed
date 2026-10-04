---
name: mutation-check
description: Prove the new tests bite, by mutation testing scoped to the code the card names.
effect: read
agent: tester
outcomes: pass, fail, unavailable
---
Run the project's mutation tool scoped to the production code the card's intent names. Java: PIT
first — `mvn test-compile org.pitest:pitest-maven:mutationCoverage -DtargetClasses=<fq.Class*>
-DreportsDirectory=<OS temp dir> -DtimestampedReports=false`, or Gradle's `pitest` task; else
Stryker, mutmut or cargo-mutants. Never edit any file — reports and caches (.mutmut-cache,
mutants.out/, .stryker-tmp/) go to the OS temp dir, or are removed.

Report `pass` if no surviving mutant sits on a line the new tests target. Report `fail` with each
survivor as `file:line`, the mutation, and the assertion that would kill it, in a file in the OS
temp directory — report its path. Report `unavailable` when no tool is configured — the pom lacks
`pitest-junit5-plugin` under JUnit 5, or Gradle does not apply `info.solidsoft.pitest`: never add
it to the build; write what you checked to a temp file and report its path.
