# {{SKILL}}: codebase-design

> {{DESC_CODEBASE_DESIGN}}
<!-- aliases: domain-modeling -->

**Trigger:** the user asks "where should the seam go", how to make a module testable through
its interface, or for a glossary term or ADR. Also designing or reshaping a module's interface,
a design talk that keeps stumbling over ambiguous terms, or another {{SKILL}} needing this vocabulary.

## Procedure
1. First read `GLOSSARY.md` at the repo root (`CONTEXT.md` if absent; a
   `GLOSSARY-MAP.md` means several contexts — find the one in play) and the
   area's ADRs in `docs/adr/`; use their terms verbatim in code, tests, prose.
   When the user says how something works, check the code agrees; surface any
   contradiction.
2. Use this vocabulary exactly — **module** (anything with an interface and an
   implementation, any scale), **interface** (all a caller must know: types,
   invariants, ordering, error modes, performance), **depth** (behaviour per
   unit of interface learned), **seam** (where behaviour can be altered without
   editing in place), **adapter** (a concrete thing filling a seam). Never
   "component", "service", "API", "boundary".
3. Aim for **deep modules** — much behaviour behind a small interface: callers
   get leverage, maintainers get locality. To find what to deepen, start from
   `git log` hot spots — what keeps changing.
4. Seams sparingly: the interface is the test surface. Internal seams for the
   module's own tests are fine but never exposed; a test that must reach past
   the interface means the wrong shape. One adapter is a hypothesis; a second
   makes the seam real.
5. **Deletion test** for anything suspected shallow: imagine deleting it.
   Complexity vanishes → a pass-through, fold it in; it reappears across N
   callers → it earns its keep. Once tests at the deepened interface exist,
   propose deleting the old shallow-module tests ({{LAW:deletion-is-deliberate}})
   — replace, don't layer.
6. An ambiguous term, or two words for one concept: propose one canonical
   term, test it on edge cases, add it to the glossary in use as it crystallises
   (`GLOSSARY.md`, or an existing `CONTEXT.md`; with neither, the first term
   creates `GLOSSARY.md`). Project-specific terms only: one or two
   sentences on what it *is*, rejected synonyms under `_Avoid_`, no
   implementation detail.
7. ADR only when a decision is hard to reverse, surprising without context
   AND a real trade-off: `docs/adr/NNNN-<slug>.md` numbered after the highest,
   a title plus 1–3 sentences, one decision per file. A changed mind gets a new
   ADR linking the old, whose status becomes `superseded by ADR-NNNN` — never a
   silent edit.

## Done when
- The design is stated in this vocabulary, seams are explicit and agreed, each
  module beats the rejected alternative on depth, and the glossary and ADRs
  hold every term and qualifying decision, no two names for one concept.

<!-- INCLUDE: skills/_self-improvement.md -->
