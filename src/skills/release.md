# {{SKILL}}: release

> {{DESC_RELEASE}}

**Trigger:** cutting a release — a version bump, a changelog entry, and a tag.

## Procedure
1. Decide the version from the changes since the last tag, following the project's
   scheme (semver: breaking → major, feature → minor, fix → patch). Verify the
   current version and the last tag rather than guessing (universal {{LAW}} III).
2. Update the version wherever it is declared (manifest, package metadata, a VERSION
   constant) — find *every* occurrence so they cannot drift (universal {{LAW}} XII).
3. Update the changelog: a dated section for the new version summarising the
   user-visible changes, grouped (added / changed / fixed), derived from the commits
   since the last tag.
4. Commit the version bump and changelog as one focused commit, through the
   [commit {{SKILL}}](commit.md) — summary and exact message presented for
   acceptance (universal {{LAW}} II, {{LAW}} XX).
5. Tag the release (annotated, matching the version). Tagging and publishing are
   **outward-facing** (universal {{LAW}} IV), and the push itself needs explicit
   per-push acceptance — a release lands on a shared branch, where {{LAW}} XX
   applies with extra care and grants no standing consent.
6. With that acceptance, push the commit and the tag together; trigger or verify
   the publish/release pipeline.

## Done when
- Version, changelog, and tag all name the same number, and the release is pushed
  (or staged for the pipeline) with no unrelated changes bundled in.

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
