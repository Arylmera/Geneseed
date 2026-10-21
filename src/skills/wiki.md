# {{SKILL}}: wiki

> {{DESC_WIKI}}

{{CREDIT:mattpocock-skills:skills/in-progress/chief-of-staff/SKILL.md}}

**Trigger:** a task needs the user's machine-wide knowledge base, or has produced a
durable cross-project fact worth writing back. The knowledge base is declared in
`geneseed-wiki.jsonc` (AGENT.md §8).

## Procedure

**Locate.** Read `geneseed-wiki.jsonc` — beside `AGENT.md`, or at `$GENESEED_WIKI`. No
file, or an empty `wikis` list: stop; there is no knowledge base on this
machine. Each declared wiki gives you its root `path`, its `entries`, a
`conventions` note, an `inbox`, and `protected` folders.

**Consult** (reading):
1. Start from the wiki's `entries` — the eager ones are already in context;
   open lazy ones only when the task needs them ({{DOCTRINE:context-economy}}).
2. Navigate by the wiki's own structure: follow wikilinks (`[[Note Name]]`)
   and index notes outward from the entry points rather than globbing the
   whole vault. A targeted filename/heading search is fine; reading the tree
   end-to-end is not.
3. Treat what you read as the user's knowledge, current as of when it was
   written — verify a fact against the live system before building on it
   ({{LAW:verify-before-asserting}}).

**Capture** (writing):
1. **Read the wiki's `conventions` note before your first write** in that
   wiki, and follow it over your own habits — naming, frontmatter, folder
   rules, tag style. Re-skim it if it changed since you last wrote.
2. Quality bar: durable, reusable, cross-project knowledge — not session
   detail, not task state, and **never secrets** ({{LAW:sealed-secrets}}).
   Knowledge that matters only to you belongs in {{MEMORY}}, not the wiki.
3. Search before creating ({{DOCTRINE:search-before-creating}}): if a note on the topic
   exists, extend or correct it instead of writing a duplicate.
4. **Write history, not the present** — a note cannot keep up with the system
   it describes. Date every claim ("On 2026-10-13, the user chose…"); a claim
   about code also cites the commit it held at (`owner/repo@abc1234`); never
   "currently" or "is" without one of the two beside it. To correct a claim,
   add the new dated one and mark the old one superseded — do not rewrite it.
5. Write the note as a citizen of the graph: wikilinks to the notes it
   relates to (an orphan note is a lost note), frontmatter where the house
   style carries it, the wiki's own heading and naming conventions.
6. File it where the structure says it belongs. **Not confident where that
   is? Drop it in the wiki's `inbox`** for the user to file — a misfiled note
   costs more than an unfiled one.
7. **Never write under a `protected` folder**, and never restructure the
   wiki itself — moving, renaming, or deleting notes you did not create is
   the user's call ({{LAW:deletion-is-deliberate}}).

**Promote.** When a {{MEMORY}} fact or {{NOTEBOOK}} note hardens into
knowledge the user would want across projects, capture it into the wiki via
the steps above, then link or trim the original so there is one home for the
truth.

**Lint** (when the user asks to tidy the wiki): walk the notes you were
pointed at and report contradictions, orphans, missing links, and claims a
newer source or commit has overtaken. Report, do not restructure — fixes go
through Capture, one note at a time, with the user's go.

## Done when
- The needed knowledge was found by walking entries and wikilinks — not by
  reading the vault wholesale; and
- anything written follows the wiki's `conventions`, dates its claims, links
  into the graph, sits in the right folder (or the `inbox`), and touches
  nothing `protected`.

<!-- INCLUDE: skills/_self-improvement.md -->
