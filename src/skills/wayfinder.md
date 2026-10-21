# {{SKILL}}: wayfinder

> {{DESC_WAYFINDER}}

{{CREDIT:mattpocock-skills:skills/engineering/wayfinder/SKILL.md}}

**Trigger:** a piece of work too large for one session and still in the fog —
the destination can be named but the route to it cannot; the user says
"wayfinder" or asks to chart a big effort before building anything.

## Procedure
1. Name the **destination** — what reaching the end looks like (a spec ready to
   hand off, a decision locked, a migration completed). One or two lines; every
   later session orients to it before picking work. Then sweep the open questions
   breadth-first; if none turn up — the route is already clear and fits one session
   — there is no fog and no map: ask the user how to proceed.
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
   placeholder `#n` auto-links an unrelated issue. Each ticket carries one type, as a
   `wayfinder:<type>` label (or a `Type:` line), which names how it resolves:
   - **research** (agent alone) — a fact the decision waits on, from docs, an API or
     the web: a subagent runs the [research {{SKILL}}](research.md). Fire every research
     ticket in parallel as soon as the map is charted. Then stop: charting is one session's work and
     resolves no ticket itself.
   - **prototype** (with the user) — a rough artifact to react to when "how should it
     look or behave" is the question: the [prototype {{SKILL}}](prototype.md).
   - **grilling** (with the user, the default) — an interview through the
     [brainstorm {{SKILL}}](brainstorm.md), terms pinned with the
     [codebase-design {{SKILL}}](codebase-design.md); a [council {{SKILL}}](council.md)
     debate may inform it, never replace it.
   - **task** — work that decides nothing but blocks a decision (provision access,
     sign up to judge an API, move data to see its shape). Do it alone where you can,
     else hand the user an exact checklist; record what was done and the facts later
     tickets need.

   A ticket worked *with the user* resolves only through that live exchange — never
   answer the user's side yourself.
4. Work the **frontier**: claim an unblocked ticket before any work (assign it, or
   `Status: claimed`) so concurrent sessions skip it. Resolve it as its type says — read
   the label, the body never states it — write the decision into the ticket,
   gist-and-link it on the map, close it. At most one ticket per session (research
   tickets excepted). New questions become tickets; fog the answer made specifiable
   graduates to tickets and leaves **Not yet specified**; a ticket the answer invalidates
   is updated or closed, and one now past the destination is closed with an **Out of
   scope** line.
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
