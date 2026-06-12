# {{SKILL}}: debug

> {{DESC_DEBUG}}

**Trigger:** a bug, test failure, crash, or behaviour that doesn't match expectation — before proposing a fix.

## Procedure
1. Reproduce it first: find the smallest input or command that triggers the failure reliably. If you can't reproduce it, gather evidence (logs, stack trace, recent diff) until you can.
2. Isolate: binary-search the cause — narrow the input, the code path, or (for a regression) the commit range with `git bisect` (the [git-archaeology {{SKILL}}](git-archaeology.md) carries the full method). Change one variable at a time.
3. State one hypothesis that explains ALL the evidence before touching code.
4. Apply the smallest fix that addresses the root cause, not the symptom; resist fixing things the evidence doesn't implicate ({{LAW}} II).
5. Verify: run the project's checks and read the actual output (universal {{LAW}} III) — the original reproduction now passes and nothing nearby broke. Dispatch the [tester {{AGENT}}](../{{DIR_AGENTS}}/tester.md) for a focused regression check when the blast radius is unclear.

## Done when
- The failure is reproduced, root-caused, fixed at the cause, and the reproduction passes with no new breakage.
