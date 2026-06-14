<!--
  Authoring a new skill (this scaffold replaces the old create-skill skill):
  1. Reuse first — if an existing skill's domain already covers the need, extend it
     instead of adding a file (universal Law V). Name the skill by its domain.
  2. Copy this file to skills/<name>.md and fill in the purpose line, trigger,
     procedure, and done-when. In an installed harness the purpose line is plain
     prose; in the Geneseed source repo it is the DESC_<NAME> token with the prose
     defined per theme.
  3. Add a row for it to the skills table in AGENT.md (the table is hand-authored;
     the skill files themselves auto-render). doctor fails if the table and the skill
     files disagree, so neither can silently drift.
  Geneseed source repo only (skip in an installed harness):
  4. Define the DESC_<NAME> token (hyphens -> underscores, uppercased) in ALL theme
     JSONs under themes/ — the parity gate fails if any theme is missing it.
  5. Bump the `skills-N` count badge in README.md (doctor checks it against the real
     file count; the test counts derive from src/ and need no edit), then run:
     python rituals/harness.py doctor --all
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

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
