# {{MEMORY}} convention

> **Personal and local.** This directory is **git-ignored** — memory is private
> to each developer, never committed or shared. The convention (`README.md`) and
> the `.gitignore` are the only files tracked; your `MEMORY.md` index and all
> fact files live only on your machine. (To share knowledge with the team, put
> it in code, docs, or the project's `user-rules.md` instead.)

Durable knowledge that must survive across sessions lives here as **one fact per
file**. An agent reads `MEMORY.md` (the local index map) at the start of a session,
and opens the topic file a task needs (see *The index* below). A new fact is written through the rule {{SKILL}}, which settles with the user
whether it is a fact for here or a standing rule ({{DOCTRINE:persist-insight}}) — never on the
agent's own initiative. The one automatic writer is the `learn` hook, where the host
runs it: a distiller the user opted into at install, not an agent's judgement call.

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
topic: <kebab-case-slug>                               # optional; index group, defaults to type
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
a `tempered` memory). A memory with no `force` follows the ordinary "archive a
memory that turns out to be wrong" rule. The `learn` hook never updates or archives a
memory that carries a `force`; revising one stays with the agent and the user.

## Rules

- One fact per file. Before creating, check for an existing file that covers it
  and update that instead, merging in what is new and keeping what is still true —
  no duplicates. The `learn` hook does the same: it is shown every stored fact and
  updates one (`action: update`) rather than writing a twin. It sees only each
  fact's description, so it first moves the old version into `archive/`: every
  update can be undone.
- Archive a memory that turns out to be wrong or obsolete: move it into `archive/`
  (`learn` does it with `action: archive`). An archived fact leaves the index but
  stays on disk, under a `-2`, `-3`, … name if `archive/` already holds one of that
  name. `geneseed memory rm <name>` archives the same way. Deleting a file from
  `archive/` needs the user's consent ({{LAW:deletion-is-deliberate}}):
  `geneseed memory list --archived`, then `geneseed memory rm <name> --archived --purge`.
  `archive/` is part of this git-ignored store.
- When the store outgrows one careful read — a topic over 40 facts, or facts in
  `misc` — the session context says so in one line; the memory-curator {{AGENT}} then
  merges, assigns topics and archives in bulk, and proposes deletions for approval.
- Don't store what the repo already records (code structure, git history, the
  {{LAWS}}, `user-rules.md`). Store what was *non-obvious*.
- When the same `feedback` lesson keeps recurring, propose promoting it into a
  standing rule in `user-rules.md` (the rule {{SKILL}}) — with the user's
  consent, and archive the memory once promoted so the lesson is not loaded twice.
- After writing a file, rebuild the index (*The index* below) rather than editing it
  by hand — its counts are derived.
- Verify a recalled memory still matches reality before acting on it
  ({{LAW:verify-before-asserting}}).

## The index

The index has two levels, so the part loaded every session stays small however many
facts the store holds:

- `MEMORY.md` — the map: one line per topic, `- [<topic>](topics/<topic>.md) — <N> facts`.
- `topics/<topic>.md` — one line per fact in that topic,
  `- [Title](../file.md) — one-line hook`.

A fact's topic is its `topic:`, else its `type:`, else `misc`, normalised to
lowercase `[a-z0-9-]`. Both levels are generated from the fact files:
`geneseed learn --consolidate --memory <this dir>` rebuilds them (refreshing each
hook from its `description`), and the `learn` hook rebuilds them after every fact it
writes, updates or archives. Only top-level fact files are indexed; `archive/` and
`agents/` never are. A build moves a flat, one-line-per-fact `MEMORY.md` from an older install to
this layout once, keeping each line's own title and hook; it never touches a fact file.

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

Same bar as {{DOCTRINE:persist-insight}}: capture only how this {{AGENT}} should work *next time* —
a boundary that proved wrong, an input it always needs — never task residue. Files
are capped (oldest bullets drop) so they never grow unbounded. The `agents/`
subdirectory name is literal (not themed), because the write code addresses it
directly; the files are keyed by the {{AGENT}}'s own name.
