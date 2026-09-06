# {{SKILL}}: deps-audit

> {{DESC_DEPS_AUDIT}}

**Trigger:** the user asks "what's outdated", "are we vulnerable", "audit the
dependencies", or to plan an upgrade round; a security advisory lands; a new
dependency is proposed; or a [migrate {{SKILL}}](migrate.md) run needs to know what
to bump first. migrate moves *one* dependency safely; this {{SKILL}} decides *which*,
*in what order*, and *whether at all*.

## Procedure
1. **Inventory from the lockfile, not the manifest** ({{LAW}} III): every direct
   dependency with its pinned version, and the transitive tree where the tooling
   exposes it. Include vendored or copied-in code the manifest does not list — it is
   a dependency with no update channel.
2. **Run what the ecosystem provides, install nothing silently:** `npm outdated` /
   `npm audit`, `pip list --outdated` / `pip-audit`, `cargo outdated` / `cargo audit`,
   `go list -m -u all` / `govulncheck`, or the host's equivalent. Read the output in
   full; an advisory's severity is the publisher's number, not yet yours.
3. **Classify each finding:** *security* (an advisory reaches code this project
   actually calls — check the path, an unreachable vuln is a note, not an emergency),
   *behind by a major* (breaking changes — read the changelog for what touches this
   codebase), *behind by a minor/patch* (usually safe, batchable), *abandoned* (no
   release, no maintainer — plan a replacement, not a bump), *unused* (imported
   nowhere — remove it, the cheapest upgrade there is).
4. **For a proposed new dependency, ask the ladder first** ({{DOCTRINE}} craft 4): does
   the stdlib or an already-installed package cover it, and is the cost of a few lines
   lower than the cost of another maintainer's release cadence, licence, and
   transitive tree? Check who publishes it, how maintained it is, its licence
   against the project's, and what it pulls in.
5. **Order the plan by risk, then blast radius:** reachable security fixes first, then
   removals, then patch/minor batches, then majors one at a time with their changelog
   notes attached. Each major is its own [migrate {{SKILL}}](migrate.md) run on its own
   branch ({{LAW}} II); never bundle unrelated bumps.
6. **Report and hand off.** A ranked table — dependency, current → target, class,
   reachable?, the note that justifies the rank — plus what was left alone and why.
   Nothing is upgraded by the audit itself; the user picks the tranche and migrate
   executes it with the checks green between each step.

## Done when
- Every dependency in the lockfile is classified with evidence, reachable advisories
  are separated from unreachable ones, unused and abandoned packages are named, and a
  risk-ordered upgrade plan exists for migrate to execute — with nothing installed or
  bumped by the audit.

<!-- INCLUDE: skills/_self-improvement.md -->
