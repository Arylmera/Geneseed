# {{MEMORY}} convention

> **Personal and local.** This directory is **git-ignored** — memory is private
> to each developer, never committed or shared. The convention (`README.md`) and
> the `.gitignore` are the only files tracked; your `MEMORY.md` index and all
> fact files live only on your machine. (To share knowledge with the team, put
> it in code, docs, or the project's `user-rules.md` instead.){{SHARED_STORE_NOTE}}

Durable knowledge that must survive across sessions lives here as **one fact per
file**. An agent reads `MEMORY.md` (the local index map) at the start of a session,
and opens the topic file a task needs (see *The index* below). The agent writes a new fact
here on its own, with no prompt, following Branch A of the rule {{SKILL}}; the user sees every
memory afterwards in the web console ({{DOCTRINE:persist-insight}}). A standing rule is different:
it goes to the user first, through the same {{SKILL}}. The `learn` hook writes here too, where the
host runs it: a distiller the user opted into at install.

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

The fact in one or two sentences (see *Writing a fact*). For `feedback` and `project`, follow with
**Why:** and **How to apply:** lines. Link related memories with [[their-name]].
```

`type` says what a memory *is about*; the optional `force` says how *firmly it
binds* — the two are independent axes. Leave `force` off for a plain fact; add it
when a memory is a decision or stance the agent must weigh before overriding.

## Writing a fact

Every fact is read again in later sessions, and its `description` loads with its topic
file, so each word costs on every recall.

- **Durable only.** Store what stays true and useful at the start of an unrelated later
  task: a preference, a convention, a decision and its reason, a trap and its fix. Never
  store task residue: what this session did, fixed, merged or released, a PR or ticket
  number, a session-specific count or status such as "pending" or "next is…". The git history holds those.
- **General, not the incident.** State the principle the incident taught. Name a file,
  function or command only when the fact is about it.
- **Lean.** `description` is one line that states the claim itself, specific enough to
  tell it from its neighbours: it is the index hook, and the only field `learn` reads to
  choose between update and create. A bare label ("Plugin panels") is too vague. The body
  holds the fact in one or two sentences; **Why:** and **How to apply:** take one line
  each. No narrative, no story of how it was found, no repeat of the description. Keep a
  date only when the fact depends on it, and write it absolute.
- **Too long for this is documentation.** Put it in the project's docs and store a
  one-line `reference` pointer to it.

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
- When facts sit in `misc` (no `topic:` and no `type:`), the session context says so in
  one line; the memory-curator {{AGENT}} then assigns topics, merges and archives in
  bulk, and proposes deletions for approval. The size of a topic never raises it: a large
  store is read through its topic files, not curated for its size.
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

- `MEMORY.md` — the map: one line per topic, `- [<topic>](topics/<topic>.md) — <N> facts`,
  for the 25 largest topics (and `misc`), then one line counting the rest. It stays under
  about 2 KB however many topics the store grows.
- `topics/<topic>.md` — one line per fact in that topic,
  `- [Title](../file.md) — one-line hook`. Every topic keeps its file, listed or not.

To reach a fact the map does not list, search: `geneseed memory search "<words>"`
(best matches first, `--limit n`), or the `memory_search` tool on OpenCode.

A fact's topic is its `topic:`, else its `type:`, else `misc`, normalised to
lowercase `[a-z0-9-]`. Both levels are generated from the fact files:
`geneseed memory consolidate --memory <this dir>` rebuilds them (refreshing each
hook from its `description`), and the `learn` hook rebuilds them after every fact it
writes, updates or archives. Only top-level fact files are indexed; `archive/` and
`agents/` never are.

**The gate log.** Each `learn` run appends one JSON line per decision to `.gate-log.jsonl` in this
folder: `created`, `merged`, `archived`, `duplicate` (a new fact too close to a stored one, which it
names), `nothing` or `failed`, with the reason. It is not a fact and is never indexed; the newest
5 000 lines are kept.

**A top-level file whose name is all capitals is a store document, not a fact:** `MEMORY.md`,
`README.md`, `ARCHIVE-INDEX.md`. It is never indexed, never filed under `misc`, never shown to
`learn`, and `geneseed memory rm` refuses it. Name a fact in lower case.

**A build moves a flat index to this layout, once, in every store it manages** — each install's
and the machine tier's. It keeps each pointer's own title and hook and
every other line of the old `MEMORY.md` (headings, prose, a pointer to a store document), and it
never touches a fact file. The hand-written headings that grouped the old fact lines now sit above
nothing; delete them once if they bother you.

**Rules the old index loaded every session become drafts.** A flat index was cut by position at
session start, so what sat in its first 3 072 characters loaded by accident. At the move, a
`feedback` fact whose line sat there, any fact with `force: constraint`, and a `feedback` fact whose
description says *always* or *never* (*toujours*, *jamais*) are written to `user-rules.draft.md`
(at most 30), exactly as the fold drafts a rule; `user-rules.md` is never written without your
decision. A draft does not load until you approve it, in the console or with the rule {{SKILL}}:
an approved draft moves into `user-rules.md`, which loads; a rejected one is dropped. Until then
a one-line reminder at session start says how many wait. A second build drafts nothing new.

## The cleanup

The `learn` model also cleans the store it writes to. It reads the facts in batches of up to 40,
one topic's facts together, and answers with three kinds of action: **merge** facts that say the
same thing (the kept one is rewritten, the others archived), **archive** a fact that is task
residue or no longer true, and **split** a topic of more than 30 facts into narrower ones, so a
topic file stays small enough to open whole. It never acts on a fact with a `force:`, and never
creates one.

- **Nothing is lost.** Before the first change, the whole store is copied into
  `archived-cleanup/<date>/` in this folder, and every merge or archive goes through `archive/`.
  `geneseed memory restore <name>` brings an archived fact back.
- **Only the doubtful waits for you.** An action the model is unsure of is kept in
  `.consolidate-plan.json`. `geneseed memory plan` lists them, and `geneseed memory apply <name>`
  or `geneseed memory reject <name>` (or `--all`) decides them. An action whose fact changed since
  it was judged is dropped, not applied.
- **When it runs.** By itself, at the end of a session, on a store of 60 facts or more that was
  never cleaned by this version of Geneseed, or that has gathered many unjudged facts since: five
  batches per session until the store is through. `GENESEED_CONSOLIDATE=off` turns that off. By
  hand: `geneseed-hook learn --consolidate --merge --memory <this dir>`, and `--dry-run` applies
  nothing, so every action waits for you to confirm.
- `geneseed memory consolidate --dry-run` needs no model: it reports what the index rebuild would
  change and the pairs of facts in one topic that look like duplicates.

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
  {{AGENT}}'s file. It needs `$GENESEED_LLM`; without one, this file is not written.

The `spec-feedback:` lines an {{AGENT}} ends its report with are a second, distinct
value, with one writer of their own: the same hook copies them, with no model call,
into the machine notes `{{PATH_NOTES}}/agent-notes/<agent-name>.md` (a `general` line into
`agent-notes/_general.md` there), or a line true only in this repo (`[agent:project]`,
`[general:project]`) into the same two files under `{{PATH_PROJECT_NOTES}}/agent-notes/` at the
project root; one dated bullet each, duplicates skipped. They are
capped: 100 bullets in an {{AGENT}}'s file, 30 in `_general.md`, 8 000 characters a file.
The {{AGENT}} reads all five files at step 0. Neither the caller nor this store holds a
copy, except on a host with no subagent-finished hook (Bob), where the caller copies the
line into the same file by hand. Folding a note into an {{AGENT}}'s source is the user's call.

Same bar as {{DOCTRINE:persist-insight}}: capture only how this {{AGENT}} should work *next time* —
a boundary that proved wrong, an input it always needs — never task residue. Files
are capped (oldest bullets drop) so they never grow unbounded. The `agents/`
subdirectory name is literal (not themed), because the write code addresses it
directly; the files are keyed by the {{AGENT}}'s own name.
