# {{SKILL}}: codebase-design

> {{DESC_CODEBASE_DESIGN}}

**Trigger:** designing or reshaping a module's interface, deciding where a seam
goes, making code more testable through its interface — or another {{SKILL}}
needs the deep-module vocabulary.

## Procedure
1. Use this vocabulary exactly — **module** (anything with an interface and an
   implementation, at any scale), **interface** (everything a caller must know:
   the types plus invariants, ordering constraints, error modes, performance),
   **depth** (behaviour a caller gets per unit of interface they must learn),
   **seam** (a place where behaviour can be altered without editing in place),
   **adapter** (a concrete thing filling a seam). Avoid "component", "service",
   "API", "boundary" — consistent language is the point.
2. Aim for **deep modules**: a lot of behaviour behind a small interface. Depth
   buys callers leverage (one implementation pays back across N call sites) and
   maintainers locality (change, bugs, and knowledge concentrate in one place).
3. Place seams deliberately and sparingly — the interface is the test surface,
   and the fewer seams the better. One adapter at a seam is a hypothesis; a
   second adapter is what makes the seam real.
4. Apply the **deletion test** to anything suspected shallow (interface nearly
   as complex as its implementation): would deleting it concentrate complexity
   somewhere sensible, or just move it around? "Concentrates" → fold it in.
5. Record any structural decision this produces as the
   [domain-modeling {{SKILL}}](domain-modeling.md) prescribes.

## Done when
- The design is stated in this vocabulary, the seams are explicit and agreed,
  and each module is deeper than the alternative you rejected.

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
