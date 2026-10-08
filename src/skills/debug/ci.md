# {{SKILL}}: debug — CI branch, a red run

Needs the CI log: the host's CI tool, `gh run view --log-failed` or equivalent, or the log pasted by the user.
1. **Read the log, not the badge.** Find the first failing job and its first failing step. Read the error and the command that produced it in full ({{LAW:verify-before-asserting}}); note the runner's OS, toolchain versions and exact invocation.
2. **Classify before touching anything:** a *real failure* (code or test wrong), an *environment difference* (a version, path, line endings, missing binary, a test skipped locally but not in CI), an *infra flake* (network, runner, cache, timeout), or a *gate on the report itself* (a coverage or count threshold, a lint the local hook skips).
3. **Reproduce under CI's own conditions** — the workflow's script, flags and a matching toolchain. Green locally and red in CI has not reproduced yet: close the gap (the env var, `--frozen-lockfile`, the reporter, the binary not on PATH) until it fails the same way. Never retry a run blindly.
4. **Fix at the cause** through steps 2–6 of the debug procedure. For an environment difference, make the *repo* deterministic (pin, normalise, declare) rather than CI more permissive. A flake is fixed at its source — the race, the timeout, the unpinned resource — or quarantined *with an issue and an owner*, never silently skipped ({{LAW:cure-the-cause}}). A fix to CI config itself is its own commit ({{LAW:one-intent-one-act}}), noted in the PR.
5. **Prove it the way CI will:** run CI's command locally once more and read the output, push with the user's per-push consent ({{DOCTRINE:consent-before-push}}), and watch the re-run to green; the gate that reported it verifies the fix. Report what failed, its class, what changed, and the green run.

## Done when
- The debug {{SKILL}}'s own Done-when holds, and the run was reproduced under CI's conditions and the same CI run was re-run and read green — no retry-until-green, no test quietly skipped.
