---
name: compat-check
description: Confirm consumers of the old and the new interface both still work after this iteration.
effect: read
agent: tester
outcomes: pass, fail
---
Run the tests of every consumer this change can reach — those still on the old shape as well as
those already moved — and, where the repo records consumer contracts (Pact, Spring Cloud
Contract), the provider verification against them. In a contract step, where the old shape is
removed on purpose, check instead that no consumer still uses it. Never edit any file: send
reports to the OS temp directory.

Report `pass` if every consumer works. Report `fail` naming the broken consumer, the check and
its raw failure, written to a file in the OS temp directory — report that file's path with the
outcome.
