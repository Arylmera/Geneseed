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
4. Commit the version bump and changelog as one focused commit (universal {{LAW}} II).
5. Tag the release (annotated, matching the version). Tagging and publishing are
   **outward-facing** — confirm before pushing the tag or publishing unless already
   authorized (universal {{LAW}} IV).
6. Push the commit and the tag together; trigger or verify the publish/release
   pipeline.

## Done when
- Version, changelog, and tag all name the same number, and the release is pushed
  (or staged for the pipeline) with no unrelated changes bundled in.
