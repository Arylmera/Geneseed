# 0001 — Zero runtime dependencies: vendor or do without

- **Status:** Accepted
- **Date:** 2026-08-22 (`8b82b0f0`)

## Context

Geneseed is installed two ways: from npm, and as a plain git clone that updates itself with
`git pull` + rebuild. The clone has no `node_modules`. The test fixtures copy the checkout to the OS
temp root and run the product from there as a real child process, so a bare import specifier fails
at module load. That failure is the one a fresh clone would hit, which is why the fixtures copy
the checkout this way.

An install step on the clone channel would break it. `npm ci` deletes `node_modules` before
refetching, so a blocked download leaves a CLI that cannot start. `npm install` rewrites the tracked
lock file, so the next update refuses on a dirty tree. And the hook entry loads on every tool call:
a bare specifier costs a resolver walk each time.

## Decision

Nothing is installed at run time. A runtime dependency arrives as tracked source under
`js/vendor/<name>/`, imported by relative path, or it is not added. `devDependencies` (ESLint and
the like) are allowed: they are never fetched by an install and never ship. Code that runs inside a
host's process (`adapters/`) may use a module the host provides, through a guarded dynamic import
with a working degraded path.

## Consequences

- `tests/unit/dependency_policy.test.mjs` gates it, with a two-sided allow-list for the
  host-provided exception.
- A library is worth vendoring only if it deletes more lines than its source adds.
- Full argument: [`docs/extending.md` §4bis](../extending.md).
