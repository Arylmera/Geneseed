---
name: adr-challenge
description: Attack the ADR this iteration drafted, looking for what would change its decision.
effect: read
agent: skeptic
outcomes: pass, fail
---
Read the ADR this iteration wrote as a skeptic reading it cold. Is a decision driver missing? Is
a rejected option strawmanned? Is a consequence — cost, risk, the way back — left unstated? Does
it contradict an accepted ADR in the same folder, or the code as it stands?

Never edit any file — findings go back to `adr-draft`, which revises the ADR.

Report `fail` only on findings that would change the decision or its consequences, never on
wording or style: write each one to a file in the OS temp directory and report that file's path
with the outcome. Report `pass` otherwise.
