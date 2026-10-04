---
name: fitness-define
description: Encode the requirement's architecture rule as a test, with an allowlist of today's violations.
effect: mutate
agent: architect
gate: human
outcomes: pass, fail
---
Turn the requirement's architecture rule into an executable test in the suite, with the repo's
own tools first: ArchUnit for Java (a `FreezingArchRule`, whose violation store is the
allowlist), then dependency-cruiser, import-linter, eslint-plugin-boundaries or size-limit.
Record today's violations in an allowlist beside the test so the suite stays green — each later
iteration removes one entry. Touch only the test, its allowlist and the tool's test-scoped setup.

The user reviews the rule before the loop continues: write the rule in one sentence, the test's
path, the allowlist's path and its entry count to a file in the OS temp directory and report that
file's path with the outcome.

Report `pass` once the test runs green with the allowlist in place. Report `fail` if the rule
cannot be checked deterministically, naming what is ambiguous.
