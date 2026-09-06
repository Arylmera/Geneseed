# {{SKILL}}: ci-fix

> {{DESC_CI_FIX}}

**Trigger:** a CI run, pipeline job, or pre-merge check is red — on a PR you opened, a
branch you are on, or one the user points you at — or the user says "CI is failing",
"fix the build", "why is the pipeline red". The [debug {{SKILL}}](debug.md) drives
the root-causing once the failure reproduces locally; this {{SKILL}} gets it there and
gets the fix back through the same gate.

**Requires:** access to the CI logs — the host's CI tool, a `gh run view --log-failed`
/ equivalent, or the log pasted by the user.

## Procedure
1. **Read the log, not the badge.** Find the first failing job and the first failing
   step inside it — later failures are usually consequences. Read the actual error and
   the command that produced it in full ({{LAW}} III); note the runner's OS, toolchain
   versions, and the exact invocation.
2. **Classify before touching anything:** a *real failure* (the code or test is
   wrong), an *environment difference* (a version, a path, line endings, a missing
   binary, a skipped-locally test that CI does not skip), an *infra flake* (network,
   runner, cache, timeout), or a *gate on the report itself* (a coverage or count
   threshold, a lint the local hook skips). Each has a different fix; a wrong class
   wastes the afternoon.
3. **Reproduce locally with CI's own command and conditions** — the same script from
   the workflow file, the same flags, a matching toolchain version where it can be
   selected. A test that is green locally and red in CI has not reproduced yet: close
   the gap (the env var, the `--frozen-lockfile`, the reporter, the `npm` that is not on
   PATH) until it fails the same way. Never `retry` a run blindly.
4. **Root-cause and fix through the [debug {{SKILL}}](debug.md)** — one cause, the
   smallest fix, a regression test where one can pin it. For an environment
   difference, prefer making the *repo* deterministic (pin, normalise, declare) over
   making CI more permissive. A flake is fixed at its source — the race, the timeout,
   the unpinned resource — or quarantined *with an issue and an owner*, never
   silently skipped ({{LAW}} VIII).
5. **Prove it the way CI will.** Run CI's command locally once more and read the
   output; then push with the user's per-push consent ({{DOCTRINE}} process 5) and
   watch the re-run to green — a fix is verified by the gate that reported the
   failure, not by a local pass.
6. **Exit.** Say what failed, which class it was, what changed, and the run that is
   now green. If the failure was a gate misconfiguration or a flake in CI itself,
   leave the fix to CI config as its own commit ({{LAW}} II) and note it in the PR.

## Done when
- The first real failure was reproduced locally under CI's conditions, fixed at its
  cause with a test where one applies, and the same CI run that reported it has been
  re-run and read green — with no retry-until-green and no test quietly skipped.

<!-- INCLUDE: skills/_self-improvement.md -->
