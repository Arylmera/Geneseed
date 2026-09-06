# {{SKILL}}: domain-modeling

> {{DESC_DOMAIN_MODELING}}

**Trigger:** pinning down domain terminology, recording an architectural
decision, or a design conversation keeps stumbling over ambiguous terms.

## Procedure
1. Before designing, read `CONTEXT.md` at the repo root (the domain glossary)
   and the ADRs under `docs/adr/` in the area being touched; use their
   vocabulary verbatim in code, tests, and prose.
2. When a term is ambiguous, or two words compete for one concept, challenge
   it: propose one canonical term, test it against edge-case scenarios, and
   record it in `CONTEXT.md` the moment it crystallises. Create files lazily —
   the first resolved term creates the glossary.
3. When a structural decision lands (storage choice, event model, seam
   placement per the [codebase-design {{SKILL}}](codebase-design.md)), write an
   ADR at `docs/adr/NNNN-<slug>.md`: context, decision, consequences. One
   decision per file.
4. Never re-litigate an existing ADR silently — a changed mind gets a new,
   superseding ADR that links the one it replaces.

## Done when
- The glossary and ADRs reflect every term and decision that crystallised this
  session, and no two names compete for one concept.

<!-- INCLUDE: skills/_self-improvement.md -->
