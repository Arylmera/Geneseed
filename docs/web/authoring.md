---
group: extend
order: 0
title: "Edit the source"
kind: "concept"
---
Everything theme-independent lives under `src/` — laws, agents, skills, memory and notebook conventions, and the `AGENT.md.tmpl` entrypoint. Voice tokens live under `themes/` as one JSON file per theme. After editing, `python build.py --emit opencode-global` (or `geneseed update`) re-renders the deployed bundle. The `doctor` action verifies the result: unresolved theme tokens, dead links, hermetic escapes, theme-key parity, and that the committed bundle matches a fresh render.

Each agent and skill also carries a lifecycle status — `experimental`, `approved` or `deprecated` — recorded in `registry.json` at the repo root alongside its version, owner and add-date. The file is maintainer-side: it is never rendered into a bundle, so a status costs no session context. Adding a spec means adding its row; `doctor` fails on a spec with no row and on a row with no spec, and the catalog badges anything that is not `approved`. The same pass refuses to let a credential ship, and holds every vendored skill folder to an immutable upstream commit rather than a moving branch.
