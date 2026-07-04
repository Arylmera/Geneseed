<!--
  Authoring a new agent:
  1. Reuse first — if an existing {{AGENT}}'s capability already covers the need,
     extend it instead of adding a file (universal Law V applies to specialists too).
  2. Copy this file to agents/<name>.md and fill in every section. In an installed
     harness the purpose line is plain prose; in the Geneseed source repo it is the
     DESC_<NAME> token with the prose defined per theme.
  3. Register the new {{AGENT}} in the table in AGENT.md §2 (the table is
     hand-authored; the agent files themselves auto-render). doctor fails if the
     table and the agent files disagree, so neither can silently drift.
  Geneseed source repo only (skip in an installed harness):
  4. Define the DESC_<NAME> token (hyphens -> underscores, uppercased) in ALL theme
     JSONs under themes/ — the parity gate fails if any theme is missing it.
  5. Bump the `agents-N` count badge in README.md (doctor checks it against the real
     file count; the test counts derive from src/ and need no edit), then run:
     python rituals/harness.py doctor --all
     and python -m unittest discover -s tests.
-->
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
- Caution: the build detects the phrase "Read-only" anywhere in the file — a
  write-capable {{AGENT}}'s spec must not contain it, or its emit is locked down.

## Procedure
0. If `{{DIR_MEMORY}}/agents/<your-name>.md` exists in the harness, read it first —
   it holds your durable lessons from prior dispatches ({{LAW}} VI).
1. Step-by-step method this {{AGENT}} follows.

## Output contract
- The exact shape of what this {{AGENT}} returns to the caller (e.g. a list of
  findings with file:line, a verdict, a summary of changes made).
- Include an honest-failure line: what this {{AGENT}} returns when the contract
  cannot be fulfilled (nothing found, no data, inputs missing) — reporting the
  gap, never inventing content to fill it.

## Self-improvement

If this spec misled you — an input you needed but were not given, a boundary
that proved wrong, a step you could not execute — end your report with one line:
`spec-feedback: <what failed — the one-line fix>`. Omit it when there is no
friction. The caller weighs the feedback, folds a real flaw back into this file
with the user's assent, and records it to {{MEMORY}} only if it clears
{{LAW}} VI's bar — most reports carry no feedback at all.
