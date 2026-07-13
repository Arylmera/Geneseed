# {{SKILL}}: wayfinder

> {{DESC_WAYFINDER}}

**Trigger:** a piece of work too large for one session and still in the fog —
the destination can be named but the route to it cannot; the user says
"wayfinder" or asks to chart a big effort before building anything.

## Procedure
1. Name the **destination** — what reaching the end looks like (a spec ready to
   hand off, a decision locked, a migration completed). One or two lines; every
   later session orients to it before picking work.
2. Create the **map**: a single issue on the repo's tracker (GitHub Issues by
   default; a markdown file under `docs/` when the repo has none), labelled
   `wayfinder:map`. The map is an index, not a store — it holds only the
   Destination, Notes (domain, standing preferences for the effort), and a
   Decisions-so-far list: one gist line per resolved decision, linking to the
   ticket that owns the detail. The map never restates a decision.
3. Chart **decision tickets** as child issues of the map. Each ticket is a
   question whose resolution is a *decision* — never a slice of build to
   execute. Give each its blocking edges: the tickets that must resolve first.
4. Work the **frontier** one ticket per sitting: pick an unblocked ticket,
   resolve its question — by research, a [prototype {{SKILL}}](prototype.md)
   detour, or a [council {{SKILL}}](council.md) debate, whatever the question
   needs — write the decision into the ticket, gist-and-link it on the map,
   close it. Questions surfaced along the way become new tickets.
5. In everything the user reads, refer to the map and tickets **by name**,
   never by bare issue number — the id rides inside the name's link.
6. Stop when the frontier is empty: nothing left to decide means the way is
   clear. The pull to "just build it" is the signal you have reached the map's
   edge — hand off to the [plan {{SKILL}}](plan.md) or the
   [tickets {{SKILL}}](tickets.md) for execution.

## Done when
- Every decision ticket is closed, the map indexes them all, and someone could
  pursue the destination without a single further decision.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
