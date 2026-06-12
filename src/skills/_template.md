<!--
  Authoring a new skill (this scaffold replaces the old create-skill skill):
  1. Reuse first — if an existing skill's domain already covers the need, extend it
     instead of adding a file (universal Law V). Name the skill by its domain.
  2. Copy this file to skills/<name>.md and fill in the purpose line, trigger,
     procedure, and done-when. In an installed harness the purpose line is plain
     prose; in the Geneseed source repo it is the DESC_<NAME> token with the prose
     defined per theme.
  3. Add a row for it to the skills table in AGENT.md (the table is hand-authored;
     the skill files themselves auto-render).
  Geneseed source repo only (skip in an installed harness):
  4. Define the DESC_<NAME> token (hyphens -> underscores, uppercased) in ALL theme
     JSONs under themes/ — the parity gate fails if any theme is missing it.
  5. Bump the hard-coded skill counts in tests/test_harness.py (StatusDataTests and
     TuiInventoryTests), then run: python rituals/harness.py doctor --all
     and python -m unittest discover -s tests.
-->
# {{SKILL}}: <name>

> One-line statement of the recurring task this {{SKILL}} automates.

**Trigger:** the situation or phrase that should make the agent run this {{SKILL}}.

## Procedure
1. Ordered, concrete steps. Each step is an action the agent takes.
2. Note any verification step (run the command, read the output).

## Done when
- The observable condition that means the {{SKILL}} succeeded.
