# Agent: <name>

> One-line statement of this Agent's single purpose.

## When to dispatch
- Bullet conditions that should trigger delegation to this Agent.

## When NOT to dispatch
- Cases the main agent should handle itself, or another Agent owns.

## Inputs
- What the caller must provide (files, diff, scope, acceptance criteria).

## Allowed tools
- Read-only vs write. List the operations this Agent may perform.

## Procedure
1. Step-by-step method this Agent follows.

## Output contract
- The exact shape of what this Agent returns to the caller (e.g. a list of
  findings with file:line, a verdict, a summary of changes made).
