# {{SKILL}}: debug

> {{DESC_DEBUG}}

**Trigger:** a bug, test failure, crash, or behaviour that doesn't match expectation — before proposing a fix.

**No fix without a root cause.** A change you cannot tie to a cause you understand is
a guess — and a guess that happens to pass is worse than a failure, because it hides.
The pressure to skip straight to a patch is highest exactly when this rule matters most
(an emergency, an "obvious" one-liner, a fix that already failed once). Systematic is
faster than thrashing; do not trade it away under pressure.

## Procedure
1. Reproduce it first: find the smallest input or command that triggers the failure reliably. If you can't reproduce it, gather evidence (logs, stack trace, recent diff) until you can. Read the error and stack trace in full — they often name the cause outright.
2. Isolate: binary-search the cause — narrow the input, the code path, or (for a regression) the commit range with `git bisect` (the [git-archaeology {{SKILL}}](git-archaeology.md) carries the full method). Change one variable at a time. In a multi-layer system (CI → build → sign, API → service → DB), instrument each boundary once to see *which* layer breaks before investigating inside it.
3. State one hypothesis that explains ALL the evidence before touching code. If you can't, you don't yet understand the failure — gather more evidence, don't guess.
4. Apply the smallest fix that addresses the root cause, not the symptom; resist fixing things the evidence doesn't implicate ({{LAW}} II). One change at a time — no bundled "while I'm here" edits, or you can't tell what worked.
5. Verify: run the project's checks and read the actual output (universal {{LAW}} III) — the original reproduction now passes and nothing nearby broke. Where a test can pin the bug, add a regression test that fails before the fix and passes after, so it can never silently return. Dispatch the [tester {{AGENT}}](../{{DIR_AGENTS}}/tester.md) for a focused regression check when the blast radius is unclear.
6. If a fix doesn't work, return to step 1 with what you learned — don't stack a second fix on top. **After three failed fixes, stop fixing:** when each attempt only shifts the symptom elsewhere, the architecture, not the line, is likely wrong. Surface that to the user and decide the approach together before trying again ({{LAW}} II).

**Diagnostic logging is scaffolding.** When you add logging to isolate a bug, use the project's real logger at a DEBUG level rather than scattered `print`/`console.log`, prefer correlation IDs over loose object dumps, and **never log secrets, tokens, or PII** ({{LAW}} I). Treat every temporary log as disposable: remove or downgrade each `print`/`console.log`/`debugger` before the change ships ({{LAW}} XXIV) — leftover debug noise in a diff is a defect, not a free comment.

## Done when
- The failure is reproduced, root-caused, fixed at the cause, and the reproduction passes with no new breakage.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
