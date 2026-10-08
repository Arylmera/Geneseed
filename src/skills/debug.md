# {{SKILL}}: debug

> {{DESC_DEBUG}}
<!-- aliases: ci-fix -->

**Trigger:** a test fails, code crashes or prints a stack trace, or returns the wrong result — load this FIRST. Load it before reading code or investigating, not only before proposing a fix. Also when a CI run, pipeline job or pre-merge check is red ("CI is failing", "fix the build") — then start with the CI branch below.

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

## CI branch — a red run
Needs the CI log: the host's CI tool, `gh run view --log-failed` or equivalent, or the log pasted by the user.
1. **Read the log, not the badge.** Find the first failing job and its first failing step. Read the error and the command that produced it in full ({{LAW:verify-before-asserting}}); note the runner's OS, toolchain versions and exact invocation.
2. **Classify before touching anything:** a *real failure* (code or test wrong), an *environment difference* (a version, path, line endings, missing binary, a test skipped locally but not in CI), an *infra flake* (network, runner, cache, timeout), or a *gate on the report itself* (a coverage or count threshold, a lint the local hook skips).
3. **Reproduce under CI's own conditions** — the workflow's script, flags and a matching toolchain. Green locally and red in CI has not reproduced yet: close the gap (the env var, `--frozen-lockfile`, the reporter, the binary not on PATH) until it fails the same way. Never retry a run blindly.
4. **Fix at the cause** through steps 2–6 above. For an environment difference, make the *repo* deterministic (pin, normalise, declare) rather than CI more permissive. A flake is fixed at its source — the race, the timeout, the unpinned resource — or quarantined *with an issue and an owner*, never silently skipped ({{LAW:cure-the-cause}}). A fix to CI config itself is its own commit ({{LAW:one-intent-one-act}}), noted in the PR.
5. **Prove it the way CI will:** run CI's command locally once more and read the output, push with the user's per-push consent ({{DOCTRINE:consent-before-push}}), and watch the re-run to green; the gate that reported it verifies the fix. Report what failed, its class, what changed, and the green run.

## Done when
- The failure is reproduced by a command that went red on it, root-caused, fixed at the cause, and that command passes with no new breakage; every tagged probe is gone.
- For a red CI run: additionally, it was reproduced under CI's conditions and the same CI run was re-run and read green — no retry-until-green, no test quietly skipped.

<!-- INCLUDE: skills/_self-improvement.md -->
