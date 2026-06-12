# {{SKILL}}: repo-map

> {{DESC_REPO_MAP}}

**Trigger:** onboarding to a repo that has no map, or after a structural change.

## Procedure
1. If `ARCHITECTURE.md` exists, read it first — it is the cheapest orientation
   (universal {{LAW}} XV).
2. Locate the project's own documentation — a `docs/`, `doc/`, `documentation/`,
   or `wiki/` folder at the root, or the top-level README. Note where it lives and
   what it covers, and record that in the map. Read the pages relevant to the work
   at hand before changing the code they describe (universal {{LAW}} XVII) — the
   relevant pages, not the whole tree ({{LAW}} XV).
3. If `ARCHITECTURE.md` is absent or stale, build or refresh it: entry points, the
   key directories and what each holds, how to build / test / run, external
   services, and the one or two non-obvious conventions a newcomer must know.
4. Keep it short — a map, not documentation. Link out for detail.
5. Update it in the same change whenever structure shifts (universal {{LAW}} XI).

## Done when
- `ARCHITECTURE.md` reflects the current structure, and a fresh agent could orient
  from it in a single read.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
