# {{SKILL}}: codebase-design

> {{DESC_CODEBASE_DESIGN}}
<!-- aliases: domain-modeling -->

{{CREDIT:mattpocock-skills:skills/engineering/codebase-design/SKILL.md}}

{{CREDIT:mattpocock-skills:skills/engineering/domain-modeling/SKILL.md}}

{{CREDIT:mattpocock-skills:skills/engineering/improve-codebase-architecture/SKILL.md}}

**Trigger:** the user asks "where should the seam go", how to make a module testable through
its interface, or for a glossary term or ADR. Also designing or reshaping a module's interface,
a design talk that keeps stumbling over ambiguous terms, or another {{SKILL}} needing this vocabulary.
**Audit mode** only on an explicit ask to survey the repo — "audit the architecture",
"improve the codebase architecture", "where should we refactor"; a seam question never starts one.

## Procedure
1. First read `GLOSSARY.md` at the repo root (`CONTEXT.md` if absent; a
   `GLOSSARY-MAP.md` means several contexts — find the one in play) and the
   area's ADRs in `docs/adr/`; use their terms verbatim in code, tests, prose.
   When the user says how something works, check the code agrees; surface any
   contradiction. An ADR is settled: a proposal that contradicts one says so,
   and why the friction justifies reopening it — never silently.
2. Use this vocabulary exactly — **module** (anything with an interface and an
   implementation, any scale), **interface** (all a caller must know: types,
   invariants, ordering, error modes, performance), **depth** (behaviour per
   unit of interface learned), **seam** (where behaviour can be altered without
   editing in place), **adapter** (a concrete thing filling a seam). Never
   "component", "service", "API", "boundary".
3. Aim for **deep modules** — much behaviour behind a small interface: callers
   get leverage, maintainers get locality. To find what to deepen, start from
   `git log` hot spots — what keeps changing. Design a new or reshaped interface
   twice before choosing: 2–3 radically different shapes (in parallel fresh
   subagents, never forks, where the host runs them), compared on depth, locality and seam placement;
   recommend one — a hybrid if parts combine — never a menu.
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

## Audit mode
It proposes; it never edits code. Its only writes are the report, the glossary and ADR
edits the user agrees to, and the ticket.
1. **Scope.** Take the user's direction (a module, a pain point) if given. Else find the
   hot spots: count the paths in `git log --name-only` over a long stretch of recent
   commits and weight the ones that keep changing — deepening pays off where change is
   frequent. Scattered churn with no hot spot: widen the net. Read the glossary and ADRs (step 1).
2. **Explore** in a fresh read-only [explorer {{AGENT}}](../{{DIR_AGENTS}}/explorer.md)
   ({{DOCTRINE:context-economy}}): one concept spread across many small modules, shallow
   modules (step 5's deletion test), duplication, functions extracted for testability whose
   bugs live in the callers (no locality), coupling that leaks across a seam, code that is
   untested or hard to test through its interface.
3. **Rank** the candidates by churn × friction, each `Strong`, `Worth exploring` or
   `Speculative`. A candidate that contradicts an ADR appears only when the friction
   justifies reopening it, marked so.
4. **Report** in markdown in your {{NOTEBOOK}}, never the repo: per candidate the files,
   the problem, the change in plain words, the gain in locality, leverage and tests, a
   before/after sketch, and its strength; then the top recommendation and why. Name things
   in the glossary's terms and this vocabulary. Propose no interface yet. Offer a rendered
   page in one line, then ask which candidate to explore.
5. **The picked candidate** goes through the [brainstorm {{SKILL}}](brainstorm.md)
   interview, with steps 3, 6 and 7 inline: design it twice, pin new terms, and offer an
   ADR when the user rejects it for a reason a future audit needs. Then make it a ticket:
   a [plan {{SKILL}}](plan.md) file by default, the [wayfinder {{SKILL}}](wayfinder.md) when
   the route is still in fog; a GitHub issue only on the user's yes ({{LAW:deletion-is-deliberate}}).

## Done when
- The design is stated in this vocabulary, seams are explicit and agreed, each
  module beats the rejected alternative on depth, and the glossary and ADRs
  hold every term and qualifying decision, no two names for one concept.
- Audit mode: the report ranks every candidate in these terms, the top one is a
  ticket, and no code changed.

<!-- INCLUDE: skills/_self-improvement.md -->
