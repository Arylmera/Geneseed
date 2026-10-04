---
name: adr-challenge
description: Attack the ADR this iteration drafted; the user reviews the ADR that survives.
effect: read
agent: skeptic
gate: human
gateOn: pass
outcomes: pass, fail
---
Read the ADR this iteration wrote as a skeptic reading it cold. Is a decision driver missing? Is
a rejected option strawmanned? Is a consequence — cost, risk, the way back — left unstated? Does
it contradict an accepted ADR in the same folder, or the code as it stands? A gate amendment in
LOOP.md's notes for this ADR is a finding: report `fail` until the ADR answers it.

Never edit any file — findings go back to `adr-draft`, which revises the ADR.

Report `fail` only on findings that would change the decision or its consequences, never on
wording or style: write each one to a file in the OS temp directory and report that file's path
with the outcome. Report `pass` otherwise — the user then reviews the ADR before the loop
continues: write its path and the decision in one line to a temp file and report that path.
