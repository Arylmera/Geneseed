# Memory convention

Durable knowledge that must survive across sessions lives here as **one fact per
file**. An agent reads [`MEMORY.md`](MEMORY.md) (the index) at the start of a
session and writes a new file whenever a session yields something worth keeping
(universal Rule VI).

## File format

Each memory is a Markdown file with frontmatter:

```markdown
---
name: <short-kebab-case-slug>
description: <one-line summary — used to judge relevance during recall>
type: user | feedback | project | reference
---

The fact, stated plainly. For `feedback` and `project`, follow with
**Why:** and **How to apply:** lines. Link related memories with [[their-name]].
```

## Types

- **user** — who the user is: role, expertise, stable preferences.
- **feedback** — guidance on *how to work*: corrections and confirmed approaches.
  Always include the why.
- **project** — ongoing goals or constraints not derivable from the code or git
  history. Convert relative dates to absolute.
- **reference** — pointers to external resources (URLs, dashboards, tickets).

## Rules

- One fact per file. Before creating, check for an existing file that covers it
  and update that instead — no duplicates.
- Delete a memory that turns out to be wrong.
- Don't store what the repo already records (code structure, git history, the
  project Rules). Store what was *non-obvious*.
- After writing a file, add one line to `MEMORY.md`:
  `- [Title](file.md) — one-line hook`.
- Verify a recalled memory still matches reality before acting on it
  (universal Rule III).
