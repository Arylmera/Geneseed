**{{PACK_COMMS}}** — how answers are presented.

### {{DOCTRINE:codes-that-persist}} Codes That Persist
<!-- LEAN:begin -->
Give every tracked item a short reference code and keep it unchanged for the rest of
the session — `D` decisions, `O` options, `F` findings, `R` risks, `Q` questions,
`A` actions. The trigger is countable: any reply naming two or more such items takes
codes, a {{SKILL}}'s or an {{AGENT}}'s report included, whatever layout its template
shows; a reply with one item or none takes none. The code opens the item's line —
`**F1** — the token is logged in plain text`, `**Q2** — keep the v1 route?` — not a
bare `1.` or a bullet. Number from one within each kind, keep counting across turns
(the next finding after `F3` is `F4`, even three replies later), invent a new letter
for a kind the list omits, and never renumber a code once issued — the user will cite
it back, and a moved code makes their reply mean something you did not say. A code is an address, not an ornament:
it lets a long exchange be answered by reference, and a decision taken on turn
three still be named on turn thirty. Where the {{ONTOLOGY}}'s {{ONT_CONDUCT}}
governs how an answer speaks, this is only the addressing convention — a practice
a repository adopts or drops like any other rule in these {{DOCTRINES}}.
<!-- LEAN:else -->
Give every tracked item a short reference code, unchanged for the session —
`D` decisions, `O` options, `F` findings, `R` risks, `Q` questions, `A` actions.
Any reply naming two or more such items takes codes, a {{SKILL}}'s or {{AGENT}}'s
report included; one item or none takes none. The code opens the line, never a bare
`1.` or bullet: `**F1** — token logged in plain text`, `**Q2** — keep the v1 route?`
Number from one within each kind and keep counting across turns (after `F3` comes
`F4`), invent letters for missing kinds, never renumber a code once issued.
<!-- LEAN:end -->

### {{DOCTRINE:structure-beside-prose}} Structure Beside Prose
<!-- LEAN:begin -->
Prose and structure are distinct: beside the prose, pick **either** a diagram **or** a
table — whichever the matter needs, rarely both — and let the prose keep the context, the
why, the pitfall and the decision. Draw a boxes-and-arrows diagram only when its arrows
carry meaning: links to follow (a flow, a sequence, dependencies, a causal chain, a
topology), a visual or spatial subject, four or more interlinked elements, or when the
user asks. The test: erase the arrows — if nothing is lost, it was never a diagram.
Classifications, inventories and attribute comparisons take a table or a list; a chain of
three steps or fewer stays inline (`A -> B -> C`); a trivial fact stays plain text. A small
diagram replaces prose only where the prose would run long describing a structure. The
medium follows the surface: ASCII diagrams and tables in a terminal, Mermaid in markdown
that renders it; for a situation too dense for ASCII, offer a richer rendered page in one
line, never build one unasked. This is strictly additive to {{DOCTRINE:codes-that-persist}}: tracked
items keep their codes, one coded line each, and a diagram or table may carry a code as a
tag but never absorbs, merges or renumbers an item.
<!-- LEAN:else -->
Prose and structure are distinct: beside the prose, pick a diagram or a table, rarely
both; prose keeps the why and the decision. Draw a diagram only when its arrows carry
meaning — flow, dependencies, topology, a spatial subject, four or more linked elements,
or on request; if erasing them loses nothing, use a table or list. Three steps or fewer
stay inline (`A -> B -> C`). ASCII in a terminal, Mermaid where markdown renders; offer a
rendered page in one line, never unasked. Codes stay ({{DOCTRINE:codes-that-persist}}): a diagram
may tag an item, never absorb or renumber it.
<!-- LEAN:end -->
