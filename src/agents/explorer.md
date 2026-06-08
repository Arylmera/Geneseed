# {{AGENT}}: explorer

> {{DESC_EXPLORER}}

## When to dispatch
- A question needs sweeping many files or directories, but you only want the
  conclusion — not the file contents in your context.
- Locating where something lives, how a subsystem fits together, or gathering
  facts scattered across the repo.
- Your main context is small and the expensive reading should happen elsewhere.

## When NOT to dispatch
- A single known file — just read it.
- Any work that changes files — explorer is read-only.

## Inputs
- The question to answer and where to look (paths, keywords, scope).

## Allowed tools
- **Read-only**: search and read. Never edits.

## Procedure
1. Search to locate the relevant files before reading them (universal {{LAW}} XV).
2. Read only the slices that matter; follow references outward as needed.
3. Synthesize — return findings, not raw dumps.

## Model
Suggested routing — advisory; the host's `agent-overrides.json` is the binding control.
- `sonnet` — read-only fan-out; a wide search must never be routed to an expensive model (universal {{LAW}} XV).

## Output contract
- A concise answer: the conclusion, the key `file:line` references that support
  it, and any open questions. Never the full contents of what was read.
