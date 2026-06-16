# {{SKILL}}: ponytail

> {{DESC_PONYTAIL}}

**Trigger:** the user says "ponytail", "be lazy", "lazy mode", "simplest/minimal solution", "yagni", "do less", or "shortest path", or complains about over-engineering, bloat, boilerplate, or needless dependencies. Sets a build *mode* that persists across the session, not a one-shot edit — off by default until invoked. Off again on "stop ponytail" / "normal mode". For restructuring code that already exists use [refactor](refactor.md); to critique an artifact use [roast-me](roast-me.md).

## Procedure
1. Set the intensity. Ponytail is **off by default**; invoking it turns it on at **full** unless a level is named. **lite** — build what's asked, name the lazier alternative in one line, user picks. **full** — the ladder enforced, shortest diff, shortest explanation. **ultra** — YAGNI extremist, ship the one-liner and challenge the rest of the requirement in the same breath. Switch any time with `/ponytail lite|full|ultra|off` (on OpenCode this command persists the level for the geneseed-ponytail plugin; `off` stops it).
2. Before writing code, climb the ladder and stop at the first rung that holds — it is a reflex, not a research project: ① does this need to exist at all? Speculative need → skip it, say so in one line ({{LAW}} on scope). ② stdlib does it? ③ native platform feature covers it (`<input type="date">` over a picker lib, CSS over JS, a DB constraint over app code)? ④ an already-installed dependency solves it — never add a new one for what a few lines do? ⑤ can it be one line? ⑥ only then the minimum code that works.
3. Build the lazy version: no abstraction with one implementation, no scaffolding "for later", deletion over addition, fewest files, shortest working diff. Reuse before authoring ({{LAW}} on reuse).
4. Mark each deliberate simplification with a `ponytail:` comment naming the ceiling and upgrade path — `# ponytail: global lock, per-account locks if throughput matters` — so the shortcut reads as intent, not ignorance.
5. Leave the check non-trivial logic needs (a branch, loop, parser, money/security path): one runnable `assert`-based self-check or one small `test_*.py`, the smallest thing that fails if the logic breaks. Trivial one-liners need none. **Never** simplify away input validation at trust boundaries, error handling that prevents data loss, security, accessibility basics, hardware calibration knobs, or anything explicitly requested — if the user insists on the full version, build it without re-arguing.
6. Output code first, then at most three short lines — `[code] → skipped: X, add when Y.` If the explanation runs longer than the code, cut it; prose defending a simplification is complexity smuggled back in. Explanation the user explicitly asked for is not debt — give it in full.

## Done when
- The shipped solution sits on the highest ladder rung that works, deliberate shortcuts carry a `ponytail:` comment with their upgrade path, non-trivial logic has one runnable check, and nothing on the never-simplify list was cut.

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
