# 0005 — Rules have permanent ids; their numbers are positional

- **Status:** Accepted
- **Date:** 2026-09-30 (`df0d5272`)

## Context

Laws and doctrine rules were cited by number ("Law IX", "process 7"). Removing one rule renumbered
every rule after it and silently re-pointed every citation, in the source, in themes, and in a
user's own notes. Retiring two laws at once made the cost concrete.

## Decision

Every rule is declared with a permanent id — `### {{LAW:<id>}} <Principle>` or
`### {{DOCTRINE:<id>}} <Principle>` — and cited by that id, never by number; doctor refuses a
numeric citation. The render computes each number from the rule's position and renders a citation
as the rule's principle name. An id is never renamed; a removed id goes into `RETIRED_RULE_IDS`
(`js/build/source.mjs`) so it can never come back meaning another rule.

## Consequences

- Removing or reordering a rule rewires no citation.
- Some tables are still keyed by number (`LAW_META`, `LAW_CLASS`, `DOCTRINE_META`, exclusions, the
  hook ledger keys) and are doctor-pinned; appending in a pack is still the cheap path.
- Procedure: [`docs/extending.md` §2e](../extending.md).
