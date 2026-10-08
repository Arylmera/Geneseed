# {{SKILL}}: dependencies

> {{DESC_DEPENDENCIES}}
<!-- aliases: deps-audit, migrate -->

**Trigger:** the user asks "what's outdated", "are we vulnerable", "audit the dependencies",
or to plan or run an upgrade; a security advisory lands; a new dependency is proposed; or
code needs to move onto a new API, framework, or language version.

## Procedure
1. **Inventory from the lockfile, not the manifest** ({{LAW:verify-before-asserting}}): every
   direct dependency with its pinned version, and the transitive tree where the tooling
   exposes it. Include vendored or copied-in code the manifest does not list — it is a
   dependency with no update channel.
2. **Run what the ecosystem provides, install nothing silently:** `npm outdated` / `npm audit`,
   `pip list --outdated` / `pip-audit`, `cargo outdated` / `cargo audit`, `go list -m -u all` /
   `govulncheck`, or the host's equivalent. Read the output in full; an advisory's severity is
   the publisher's number, not yet yours.
3. **Classify each finding:** *security* (an advisory reaches code this project actually calls
   — check the path, an unreachable vuln is a note, not an emergency), *behind by a major*
   (breaking changes — read the changelog for what touches this codebase), *behind by a
   minor/patch* (usually safe, batchable), *abandoned* (no release, no maintainer — plan a
   replacement, not a bump), *unused* (imported nowhere — remove it, the cheapest upgrade
   there is).
4. **For a proposed new dependency, ask the ladder first** ({{DOCTRINE:search-before-creating}}):
   does the stdlib or an already-installed package cover it, and is the cost of a few lines
   lower than the cost of another maintainer's release cadence, licence, and transitive tree?
   Check who publishes it, how maintained it is, its licence against the project's, and what it
   pulls in.
5. **Order the plan by risk, then blast radius:** reachable security fixes first, then
   removals, then patch/minor batches, then majors one at a time with their changelog notes
   attached. Each major — and any framework, language-version, or API move — gets its own run
   of steps 7–9 on its own branch ({{LAW:one-intent-one-act}}); never bundle unrelated bumps.
6. **Report and stop.** Present the ranked table — dependency, current → target, class,
   reachable?, the note that justifies the rank — plus what was left alone and why, then
   STOP for the user to pick the tranche — unless they already named what to move.
   Nothing is upgraded by the audit itself.
7. **Before executing any bump, read the upstream migration guide and changelog first**
   ({{DOCTRINE:read-the-docs-first}}); list the breaking changes that actually touch this
   codebase. Work on a dedicated branch, never directly on a shared one, so a failed migration
   rolls back cleanly ({{DOCTRINE:consent-before-push}} applies its shared-branch care to
   anything that does land there).
8. **Execute one change at a time** — one dependency, or one breaking change — never batching
   unrelated bumps into a single step ({{LAW:one-intent-one-act}}). Run the project's checks
   after *each* step: a green suite between steps is what lets you bisect a later failure to
   the exact change that caused it ({{LAW:verify-before-asserting}}).
9. **Keep the version bump its own commit**, separate from any code changes it forces, each
   through the [commit {{SKILL}}](commit.md) ({{DOCTRINE:consent-before-push}}), so each diff
   is reviewable in isolation.

**Schema migrations stay backward-compatible.** For a database or stored-format change, move
in expand → backfill → contract phases so every migration is compatible with the currently
running code, and never bundle a destructive schema change into the same deploy as the code
that depends on it ({{LAW:one-intent-one-act}}, {{LAW:deletion-is-deliberate}}) — the old code
must keep working until the new code is live.

## Done when
- Every dependency in the lockfile is classified with evidence, reachable advisories are
  separated from unreachable ones, unused and abandoned packages are named, and a risk-ordered
  plan exists, presented to the user with nothing installed or bumped by the audit.
- When the user chose a tranche to execute: whatever the plan or trigger asked to move — a dependency, a framework, a language version,
  or an API — is on the target version, every check passes, and the changelog / lockfile
  reflect the new state with its docs updated ({{DOCTRINE:documentation-in-step}}).

<!-- INCLUDE: skills/_self-improvement.md -->
