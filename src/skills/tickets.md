# {{SKILL}}: tickets

> {{DESC_TICKETS}}

**Trigger:** a spec or plan is too big for one session and must be split into
tracker issues that fresh sessions can pick up independently.

## Procedure
1. Work from the spec or plan already in context; explore the code enough that
   ticket titles and bodies use the project's domain vocabulary (read
   `CONTEXT.md` if it exists).
2. Cut **tracer-bullet vertical slices**: each ticket cuts a narrow but
   complete path through every layer it touches (schema, API, UI, tests), is
   demoable or verifiable on its own, and fits one fresh context window. Any
   prefactoring gets its own ticket first — make the change easy, then make
   the easy change.
3. Give every ticket its **blocking edges** — the tickets that must land
   before it can start. A ticket with no blockers can start immediately.
4. Exception — a **wide refactor** (one mechanical change whose blast radius
   spans the codebase: a rename, a shared retype) cannot land as a green
   vertical slice. Sequence it as **expand–contract**: expand (add the new
   form beside the old, nothing breaks), migrate call sites in batches sized
   by blast radius (each batch its own ticket, blocked by the expand),
   contract (delete the old form, blocked by every batch).
5. Publish to the repo's tracker (GitHub Issues by default; markdown files
   under `docs/` when the repo has none). Each implementing session then takes
   one unblocked ticket in a fresh context.

## Done when
- Every slice of the spec is a published ticket with explicit blockers, each
  sized for one session, and at least one unblocked ticket exists to start on.

<!-- INCLUDE: skills/_self-improvement.md -->
