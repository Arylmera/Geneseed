# {{SKILL}}: debug

> {{DESC_DEBUG}}
<!-- aliases: ci-fix -->

**Trigger:** a test fails, code crashes or prints a stack trace, or returns the wrong result — load this FIRST. Load it before reading code or investigating, not only before proposing a fix. Also when a CI run, pipeline job or pre-merge check is red ("CI is failing", "fix the build") — then start with the CI branch.

**No fix without a root cause.** A change you cannot tie to a cause you understand is
a guess — and a guess that happens to pass is worse than a failure, because it hides.
The pressure to skip straight to a patch is highest exactly when this rule matters most
(an emergency, an "obvious" one-liner, a fix that already failed once). Systematic is
faster than thrashing; do not trade it away under pressure.

## Procedure
1. **Build one command that goes red on *this* bug** before reading code for a theory. It asserts the user's exact symptom (not "didn't crash"), gives the same verdict every run, takes seconds and runs unattended; run it and show the output. Read the error and stack trace in full. For a flaky bug, raise the reproduction rate until it is debuggable. If you cannot build it, say so, list what you tried and ask for access or a captured artifact — no command, no hypothesis. Read `GLOSSARY.md` (or `CONTEXT.md`) and the ADRs in the area for the domain's vocabulary.
2. **Minimise, then isolate.** Cut inputs and steps one at a time until every remaining element is load-bearing. Then binary-search the cause — the code path, or for a regression the commit range with `git bisect` (the [git-history {{SKILL}}](git-history.md) carries the method). Change one variable at a time. In a multi-layer system (CI → build → sign, API → service → DB), instrument each boundary once to see *which* layer breaks before investigating inside it. For a performance regression, take a baseline measurement and bisect; don't log.
3. **Rank 3–5 falsifiable hypotheses** ("if X is the cause, changing Y removes the bug") — list them in your reply, then test the top one without waiting. Proceed only on one that explains ALL the evidence — else gather more evidence, don't guess.
4. Apply the smallest fix that addresses the root cause, not the symptom; resist fixing things the evidence doesn't implicate ({{LAW:one-intent-one-act}}). One change at a time — no bundled "while I'm here" edits.
5. Verify: run the project's checks and read the actual output ({{LAW:verify-before-asserting}}) — the step-1 command now passes and nothing nearby broke. Where a test can pin the bug at a seam that reproduces the real call chain, add a regression test that fails before the fix and passes after. If no such seam exists, record that as a finding rather than writing a shallow test. Name the confirmed hypothesis in the commit message. Dispatch the [tester {{AGENT}}](../{{DIR_AGENTS}}/tester.md) for a focused regression check when the blast radius is unclear.
6. If a fix doesn't work, return to step 1 with what you learned — don't stack a second fix on top. **After three failed fixes, stop fixing:** when each attempt only shifts the symptom elsewhere, the architecture, not the line, is likely wrong. Surface that to the user and decide the approach together before trying again ({{LAW:one-intent-one-act}}).

**Diagnostic logging is scaffolding.** When you add logging to isolate a bug, use the project's real logger at a DEBUG level rather than scattered `print`/`console.log`, and **never log secrets, tokens, or PII** ({{LAW:sealed-secrets}}). Tag every probe with one unique prefix (`[DEBUG-a4f2]`) so cleanup is a single grep, and remove or downgrade each probe, `print`/`console.log`/`debugger` before the change ships ({{LAW:cure-the-cause}}).

**CI branch (a red run)** → read [debug/ci.md](debug/ci.md) and follow it.

## Done when
- The failure is reproduced by a command that went red on it, root-caused, fixed at the cause, and that command passes with no new breakage; every tagged probe is gone.

<!-- INCLUDE: skills/_self-improvement.md -->
