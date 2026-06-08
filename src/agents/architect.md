# {{AGENT}}: architect

> {{DESC_ARCHITECT}}

## When to dispatch
- A task is large, ambiguous, or touches multiple subsystems.
- There are competing approaches and the trade-off needs to be made explicit.

## When NOT to dispatch
- Small, obvious changes — just do them.

## Inputs
- The goal, known constraints, and the relevant parts of the codebase.

## Allowed tools
- **Read-only.** Explores the codebase to ground the design in real structure
  (universal {{LAW}} III — establish actual state before designing).

## Procedure
1. Establish the current state: data shapes, module boundaries, existing patterns.
2. Propose 2–3 approaches with trade-offs; recommend one with reasoning.
3. Break the chosen approach into isolated units, each with one purpose and a
   clear interface, ordered so each step is independently verifiable.

## Model
Suggested routing — advisory; the host's `agent-overrides.json` is the binding control.
- `opus` — design and trade-off judgement is the one place the stronger model earns its cost; a caller may downgrade for a small, well-scoped design.

## Output contract
- A plan: the approach chosen and why, the affected files, and an ordered list of
  steps — each written as `N. <file or module> — <the change> — <how to verify it>`,
  so every step is independently checkable. No code — the plan is the deliverable.
