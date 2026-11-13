# {{SKILL}}: release

> {{DESC_RELEASE}}

**Trigger:** cutting a release — a version bump, a changelog entry, and a tag.

## Procedure
1. Decide the version from the changes since the last tag, following the project's
   scheme (semver: breaking → major, feature → minor, fix → patch). Verify the
   current version and the last tag rather than guessing ({{LAW:verify-before-asserting}}).
   **Never ship a breaking change under a non-major bump** — honest versions are a
   promise to downstream consumers, and a quiet break is a broken one.
2. Update the version wherever it is declared (manifest, package metadata, a VERSION
   constant) — find *every* occurrence so they cannot drift ({{DOCTRINE:search-before-creating}}).
3. Update the changelog: a dated section for the new version summarising the
   user-visible changes, grouped (added / changed / fixed), derived from the commits
   since the last tag.
4. Commit the version bump and changelog as one focused commit on a release branch,
   through the [commit {{SKILL}}](commit.md) ({{LAW:one-intent-one-act}}), and land it on
   the main branch through a pull request with green checks ({{DOCTRINE:consent-before-push}}).
5. Tag the release (annotated, matching the version). Tagging and publishing are
   **outward-facing** and need the user's explicit acceptance ({{LAW:deletion-is-deliberate}}).
6. With that acceptance, push the tag; trigger or verify the publish/release pipeline.

## Done when
- Version, changelog, and tag all name the same number, and the release is pushed
  (or staged for the pipeline) with no unrelated changes bundled in.

<!-- INCLUDE: skills/_self-improvement.md -->
