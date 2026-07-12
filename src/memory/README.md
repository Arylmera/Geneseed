# {{MEMORY}} convention

> **Personal and local.** This directory is **git-ignored** — memory is private
> to each developer, never committed or shared. The convention (`README.md`) and
> the `.gitignore` are the only files tracked; your `MEMORY.md` index and all
> fact files live only on your machine. (To share knowledge with the team, put
> it in code, docs, or the project's `user-rules.md` instead.)

Durable knowledge that must survive across sessions lives here as **one fact per
file**. An agent reads `MEMORY.md` (the local index it creates) at the start of a
session and writes a new file whenever a session yields something worth keeping
(universal {{LAW}} VI).

This store is for **curated facts**, written for recall. For freeform working space
the agent shapes for itself — plans, scratch designs, working theories, with no
imposed format — see the {{NOTEBOOK}} (`../{{DIR_NOTEBOOK}}/`).

## File format

Each memory is a Markdown file with frontmatter:

```markdown
---
name: <short-kebab-case-slug>
description: <one-line summary — used to judge relevance during recall>
type: user | feedback | project | reference
force: constraint | choice | conviction | tempered   # optional
---

The fact, stated plainly. For `feedback` and `project`, follow with
**Why:** and **How to apply:** lines. Link related memories with [[their-name]].
```

`type` says what a memory *is about*; the optional `force` says how *firmly it
binds* — the two are independent axes. Leave `force` off for a plain fact; add it
when a memory is a decision or stance the agent must weigh before overriding.

## Types

- **user** — who the user is: role, expertise, stable preferences.
- **feedback** — guidance on *how to work*: corrections and confirmed approaches.
  Always include the why.
- **project** — ongoing goals or constraints not derivable from the code or git
  history. Convert relative dates to absolute.
- **reference** — pointers to external resources (URLs, dashboards, tickets).

## Binding force (optional)

When a memory records something the agent must not override lightly, tag how
firmly it binds. Absent `force`, a memory is a plain fact under the rules below.

- **constraint** — imposed from outside (the user, the environment, a hard
  requirement). The agent may not relax it on its own — only surface a conflict
  and let the user decide.
- **choice** — a decision taken among real alternatives. Revisable, but only with
  the user's consent, and the memory records what was chosen over what.
- **conviction** — a stance the agent adopted and will defend. Revisable on
  evidence, not on preference.
- **tempered** — a former `constraint` deliberately relaxed. The memory keeps the
  *why* so the relaxation is not silently re-tightened or re-loosened.

**The Bridge rule.** When new evidence contradicts a memory that carries a
`force`, never ignore it silently. Revise the file — record the supersession
inline (the date, what changed, and why) rather than deleting the history. The one
exception: a `constraint` is not the agent's to overturn — surface the
contradiction to the user and let them rule, then record their decision (often as
a `tempered` memory). A memory with no `force` follows the ordinary "delete a
memory that turns out to be wrong" rule.

## Rules

- One fact per file. Before creating, check for an existing file that covers it
  and update that instead — no duplicates.
- Delete a memory that turns out to be wrong.
- Don't store what the repo already records (code structure, git history, the
  {{LAWS}}, `user-rules.md`). Store what was *non-obvious*.
- When the same `feedback` lesson keeps recurring, propose promoting it into a
  standing rule in `user-rules.md` (the rule {{SKILL}}) — with the user's
  consent, and delete or archive the memory once promoted so the lesson is not
  loaded twice.
- After writing a file, add one line to `MEMORY.md`:
  `- [Title](file.md) — one-line hook`.
- Verify a recalled memory still matches reality before acting on it
  (universal {{LAW}} III).

## Per-{{AGENT}} memory (`agents/` subdirectory)

Beyond the shared store above, each capability {{AGENT}} may hold its own durable
lessons in `agents/<agent-name>.md` — one bullet per lesson, newest last:

```markdown
# reviewer — lessons
- 2026-07-04: this repo's tests double as docs; cite them in findings.
```

Read and write follow one rule each:

- **Read** — a dispatched {{AGENT}} reads its own file first, if it exists (its
  spec says so). This is the {{AGENT}}'s memory across dispatches.
- **Write** — mechanical, never by the {{AGENT}} itself (most run read-only). When
  a subagent run ends, the learn step distils at most one lesson into the owning
  {{AGENT}}'s file. A caller may also fold a returned `spec-feedback:` line in by
  hand.

Same bar as {{LAW}} VI: capture only how this {{AGENT}} should work *next time* —
a boundary that proved wrong, an input it always needs — never task residue. Files
are capped (oldest bullets drop) so they never grow unbounded. The `agents/`
subdirectory name is literal (not themed), because the write code addresses it
directly; the files are keyed by the {{AGENT}}'s own name.
