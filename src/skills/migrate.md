# {{SKILL}}: migrate

> {{DESC_MIGRATE}}

**Trigger:** upgrading a dependency, framework, language version, or moving code
onto a new API.

## Procedure
1. Read the upstream migration guide and changelog *first* ({{DOCTRINE}} process 4);
   list the breaking changes that actually touch this codebase.
2. Work on a dedicated branch, never directly on a shared one, so a failed
   migration rolls back cleanly ({{DOCTRINE}} process 5 applies its shared-branch
   care to anything that does land there).
3. Migrate one dependency — or one breaking change — at a time. Never batch
   unrelated bumps into a single step (universal {{LAW}} II).
4. Run the project's checks after *each* step. A green suite between steps is what
   lets you bisect a later failure to the exact change that caused it
   (universal {{LAW}} III).
5. Keep the version bump itself a separate commit from any code changes it forces,
   each through the [commit {{SKILL}}](commit.md) ({{DOCTRINE}} process 5), so each
   diff is reviewable in isolation.

**Schema migrations stay backward-compatible.** For a database or stored-format
change, move in expand → backfill → contract phases so every migration is
compatible with the currently running code, and never bundle a destructive schema
change into the same deploy as the code that depends on it (universal {{LAW}} II,
{{LAW}} IV) — the old code must keep working until the new code is live.

## Done when
- The dependency or API is on the target version, every check passes, and the
  changelog / lockfile reflect the new state with its docs updated
  ({{DOCTRINE}} craft 3).

<!-- INCLUDE: skills/_self-improvement.md -->
