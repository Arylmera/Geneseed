# {{AGENT}}: <name>

> One-line statement of this {{AGENT}}'s single purpose.

## When to dispatch
- Bullet conditions that should trigger delegation to this {{AGENT}}.

## When NOT to dispatch
- Cases the main agent should handle itself, or another {{AGENT}} owns.

## Inputs
- What the caller must provide (files, diff, scope, acceptance criteria).

## Allowed tools
- Read-only vs write. List the operations this {{AGENT}} may perform.
- Say "**Read-only.**" here for a non-mutating agent: the OpenCode emit then denies
  edit, webfetch, and bash. If it must run read-only commands (tests, linters,
  scanners), add the marker `<!-- bash: allow -->` in this section to gate bash to
  "ask" instead of denying it outright.

## Procedure
1. Step-by-step method this {{AGENT}} follows.

## Output contract
- The exact shape of what this {{AGENT}} returns to the caller (e.g. a list of
  findings with file:line, a verdict, a summary of changes made).
