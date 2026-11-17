---
name: ci-fix
description: Fix the failing CI check named in the card.
effect: mutate
skill: debug
outcomes: pass, fail
---
Load the debug skill for the general procedure; where this install has no debug skill (the
superpowers kit is off), load the superpowers plugin's systematic-debugging skill instead. The
CI-specific steps are here, so they hold either way. Work against the failing check the card names:

1. Read its actual log, not a guess from the check's title, before changing anything. Find the
   first failing job and step, and the command that produced the error.
2. Classify before touching anything: a real failure, an environment difference (version, path,
   line endings, a binary missing in CI), an infra flake, or a gate on the report itself.
3. Reproduce under CI's own conditions (its script, flags and toolchain). Green locally and red in
   CI has not reproduced yet. Never retry a run blindly.
4. Fix at the cause. Make the repo deterministic rather than CI more permissive; fix a flake at
   its source or quarantine it with an issue and an owner, never skip it silently.

Touch only what that failure requires; this is a repair, not a chance to improve the pipeline
along the way.

Report `pass` once the named check is fixed and green LOCALLY — CI itself is re-read after the
push, not here.

Report `fail` if the check cannot be fixed from this repo alone (an infra outage, a flake with no
reproducible cause, a required secret that is missing), naming why.
