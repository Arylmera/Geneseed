# {{SKILL}}: wiki

> {{DESC_WIKI}}

**Trigger:** a task needs knowledge the user keeps in their machine-wide
knowledge base (declared in `wiki.jsonc`, AGENT.md §7), or the work has produced
a durable, cross-project fact worth writing back into it.

## Procedure

**Locate.** Read `wiki.jsonc` — beside `AGENT.md`, or at `$GENESEED_WIKI`. No
file, or an empty `wikis` list: stop; there is no knowledge base on this
machine. Each declared wiki gives you its root `path`, its `entries`, a
`conventions` note, an `inbox`, and `protected` folders.

**Consult** (reading):
1. Start from the wiki's `entries` — the eager ones are already in context;
   open lazy ones only when the task needs them (universal {{LAW}} XV).
2. Navigate by the wiki's own structure: follow wikilinks (`[[Note Name]]`)
   and index notes outward from the entry points rather than globbing the
   whole vault. A targeted filename/heading search is fine; reading the tree
   end-to-end is not.
3. Treat what you read as the user's knowledge, current as of when it was
   written — verify a fact against the live system before building on it
   (universal {{LAW}} III).

**Capture** (writing):
1. **Read the wiki's `conventions` note before your first write** in that
   wiki, and follow it over your own habits — naming, frontmatter, folder
   rules, tag style. Re-skim it if it changed since you last wrote.
2. Quality bar: durable, reusable, cross-project knowledge — not session
   detail, not task state, and **never secrets** (universal {{LAW}} I).
   Knowledge that matters only to you belongs in {{MEMORY}}, not the wiki.
3. Search before creating (universal {{LAW}} XII): if a note on the topic
   exists, extend or correct it instead of writing a duplicate.
4. Write the note as a citizen of the graph: wikilinks to the notes it
   relates to (an orphan note is a lost note), frontmatter where the house
   style carries it, the wiki's own heading and naming conventions.
5. File it where the structure says it belongs. **Not confident where that
   is? Drop it in the wiki's `inbox`** for the user to file — a misfiled note
   costs more than an unfiled one.
6. **Never write under a `protected` folder**, and never restructure the
   wiki itself — moving, renaming, or deleting notes you did not create is
   the user's call (universal {{LAW}} IV).

**Promote.** When a {{MEMORY}} fact or {{NOTEBOOK}} note hardens into
knowledge the user would want across projects, capture it into the wiki via
the steps above, then link or trim the original so there is one home for the
truth.

## Done when
- The needed knowledge was found by walking entries and wikilinks — not by
  reading the vault wholesale; and
- anything written follows the wiki's `conventions`, links into the graph,
  sits in the right folder (or the `inbox`), and touches nothing `protected`.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
