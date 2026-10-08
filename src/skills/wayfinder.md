# {{SKILL}}: wayfinder

> {{DESC_WAYFINDER}}

**Trigger:** a piece of work too large for one session and still in the fog —
the destination can be named but the route to it cannot; the user says
"wayfinder" or asks to chart a big effort before building anything.

## Procedure
1. Name the **destination** — what reaching the end looks like (a spec ready to
   hand off, a decision locked, a migration completed). One or two lines; every
   later session orients to it before picking work.
2. Create the **map** on the repo's tracker — GitHub Issues when `origin` is
   GitHub (one issue labelled `wayfinder:map`); otherwise reuse an existing map
   under `docs/` if there is one, else `.scratch/<effort>/map.md`. The map is an
   index, not a store — it holds only the Destination, Notes (domain, standing preferences for the effort), a
   Decisions-so-far list (one gist line per resolved decision, linking the
   ticket that owns the detail; the map never restates a decision), **Not yet
   specified** (fog not yet sharp enough to ticket — ticket it once you can
   state the question, not once you can answer it), and **Out of scope**
   (one line and the reason per dropped ticket, which is closed).
3. Chart **decision tickets** as children of the map (on GitHub, child issues;
   else `issues/NN-<slug>.md` beside the map file, with `Status:` and
   `Blocked by:` lines). Each ticket is a question whose resolution is a
   *decision* — never a slice of build to execute. Create every ticket first,
   then wire blocking edges and cross-references in a second pass with the
   real ids — a placeholder `#n` auto-links an unrelated issue.
4. Work the **frontier**: pick an unblocked ticket and claim it before any
   work (assign it on GitHub; `Status: claimed` in the ticket file) so concurrent
   sessions skip it. Resolve its question — by
   research, a [prototype {{SKILL}}](prototype.md) detour, or a
   [council {{SKILL}}](council.md) debate, whatever it needs — write the
   decision into the ticket, gist-and-link it on the map, close it. At most one
   ticket per session, except research tickets. Questions surfaced along the
   way become new tickets.
5. In everything the user reads, refer to the map and tickets **by name**,
   never by bare issue number — the id rides inside the name's link.
6. Stop when the frontier is empty: nothing left to decide means the way is
   clear. The pull to "just build it" is the signal you have reached the map's
   edge — hand off to the [plan {{SKILL}}](plan.md) for execution, sliced into
   thin end-to-end pieces that each stay green on their own.

## Done when
- Every decision ticket is closed, the map indexes them all, and someone could
  pursue the destination without a single further decision.

<!-- INCLUDE: skills/_self-improvement.md -->
