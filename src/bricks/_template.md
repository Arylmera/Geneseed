<!--
  A brick template — copy this file to `<name>.md` (kebab-case, matching the `name:` field
  below) under `bricks/` at whichever level you are authoring for: shipped (this package's
  `src/bricks/`), global ($XDG_CONFIG_HOME/geneseed/bricks/), or project (<repo>/.geneseed/bricks/).
  A later level overrides an earlier one BY NAME. Leading-underscore files (like this one) and
  README.md are never loaded as bricks.

  Everything below the closing `---` is the brick's BODY: the prompt `geneseed loop next` hands
  the agent, verbatim, plus the card fields it receives. No double-brace substitution tokens in
  the body — the loop CLI reads this file raw and hands it straight to the model, unrendered.
-->
---
name: my-brick
# One line, shown wherever the catalogue is listed. Not the instructions themselves.
description: One line describing what this brick does.
# `read` never touches a file — the engine does not score or diff its iteration.
# `mutate` may change files — its diff is scored against the declared card before commit.
effect: read
# Exactly one of agent OR skill (never both, never neither) — who carries out the body below.
# `agent: <name>` names a spec under `src/agents/`.
agent: tester
# `skill: <name>` names a spec under `src/skills/` instead of an agent — delete `agent:` above
# if you use this.
# skill: some-skill
# Every outcome the body can report, comma-separated — these become the edge labels a loop
# template routes on (`{from, on: "<outcome>", to}`). A loop template's graph check requires
# exactly one edge per outcome declared here.
outcomes: pass, fail
---
Say, in direct instructions, what the agent or skill should do with the card it receives — 4 to
10 lines, no more. End with exactly how to choose between the declared outcomes, so the model's
last read is the decision it has to make.
