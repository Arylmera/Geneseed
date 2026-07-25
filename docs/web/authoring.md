---
group: extend
order: 0
title: "Edit the source"
kind: "concept"
---
Everything theme-independent lives under `src/` — laws, agents, skills, memory and notebook conventions, and the `AGENT.md.tmpl` entrypoint. Voice tokens live under `themes/` as one JSON file per theme. After editing, `python build.py --emit opencode-global` (or `geneseed update`) re-renders the deployed bundle. The `doctor` action verifies the result: unresolved theme tokens, dead links, hermetic escapes, theme-key parity, and that the committed bundle matches a fresh render.
