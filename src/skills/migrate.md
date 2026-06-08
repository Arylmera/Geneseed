# {{SKILL}}: migrate

> {{DESC_MIGRATE}}

**Trigger:** upgrading a dependency, framework, language version, or moving code
onto a new API.

## Procedure
1. Read the upstream migration guide and changelog *first* (universal {{LAW}} XVII);
   list the breaking changes that actually touch this codebase.
2. Work on a dedicated branch, never directly on a shared one (universal {{LAW}} XX).
3. Migrate one dependency — or one breaking change — at a time. Never batch
   unrelated bumps into a single step (universal {{LAW}} II).
4. Run the project's checks after *each* step. A green suite between steps is what
   lets you bisect a later failure to the exact change that caused it
   (universal {{LAW}} III).
5. Keep the version bump itself a separate commit from any code changes it forces,
   so each diff is reviewable in isolation.

## Done when
- The dependency or API is on the target version, every check passes, and the
  changelog / lockfile reflect the new state with its docs updated
  (universal {{LAW}} XI).
