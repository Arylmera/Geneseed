# {{SKILL}}: repo-map

> {{DESC_REPO_MAP}}

**Trigger:** onboarding to a repo that has no map, or after a structural change.

## Procedure
1. If `ARCHITECTURE.md` exists, read it first — it is the cheapest orientation
   (universal {{LAW}} XV).
2. If absent or stale, build or refresh it: entry points, the key directories and
   what each holds, how to build / test / run, external services, and the one or
   two non-obvious conventions a newcomer must know.
3. Keep it short — a map, not documentation. Link out for detail.
4. Update it in the same change whenever structure shifts (universal {{LAW}} XI).

## Done when
- `ARCHITECTURE.md` reflects the current structure, and a fresh agent could orient
  from it in a single read.
