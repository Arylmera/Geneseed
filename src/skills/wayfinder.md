# {{SKILL}}: wayfinder

> {{DESC_WAYFINDER}}

**Trigger:** a piece of work too large for one session and still in the fog —
the destination can be named but the route to it cannot; the user says
"wayfinder" or asks to chart a big effort before building anything.

## Procedure
1. Name the **destination** — what reaching the end looks like (a spec ready to
   hand off, a decision locked, a migration completed). One or two lines; every
   later session orients to it before picking work.
2. Create the **map** — one GitHub issue labelled `wayfinder:map` when `origin` is
   GitHub; else an existing map under `docs/`, else `.scratch/<effort>/map.md`. It is
   an index, not a store: the Destination, Notes (domain, standing preferences),
   Decisions-so-far (one gist line per decision, linking the ticket that owns it),
   **Not yet specified** (fog to ticket once you can state the question, not answer
   it) and **Out of scope** (one line and the reason per closed, dropped ticket). The map
   never restates a decision.
3. Chart **decision tickets** as children of the map (GitHub child issues; else
   `issues/NN-<slug>.md` beside it, with `Status:` and `Blocked by:` lines). Each is a
   question whose resolution is a *decision* — never a slice of build. Create them all
   first, then wire blocking edges and cross-references with the real ids — a
   placeholder `#n` auto-links an unrelated issue.
4. Work the **frontier**: claim an unblocked ticket before any work (assign it, or
   `Status: claimed`) so concurrent sessions skip it. Resolve it — research, a
   [prototype {{SKILL}}](prototype.md) detour or a [council {{SKILL}}](council.md)
   debate — write the decision into the ticket, gist-and-link it on the map, close it.
   At most one ticket per session (research tickets excepted). New questions become tickets.
5. In everything the user reads, refer to the map and tickets **by name**,
   never by bare issue number — the id rides inside the name's link.
6. Stop when the frontier is empty: nothing left to decide means the way is
   clear. The pull to "just build it" is the signal you have reached the map's
   edge — hand off to the [plan {{SKILL}}](plan.md), sliced into thin end-to-end pieces that
   each stay green.

## Done when
- Every decision ticket is closed, the map indexes them all, and someone could
  pursue the destination without a single further decision.

<!-- INCLUDE: skills/_self-improvement.md -->
