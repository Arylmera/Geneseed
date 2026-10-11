# 0009 — Self-update is a git pull, not a download

- **Status:** Accepted
- **Date:** 2026-07 (git-pull self-update), carried through the Node port

## Context

The clone install exists for machines npm cannot reach. README.md's "long way" section names the
case as a corporate network with no registry access, and the Windows installer runs natively,
with no bash, WSL, curl, unzip or PowerShell script; a missing prerequisite is reported with its
managed-PC fix (Software Center or Company Portal) rather than installed by the script itself.
The same machine that cannot reach the npm registry, and blocks `curl`, `unzip` and `.ps1` scripts
under policy, routinely still allows `git` over HTTPS, since git is how the clone was obtained.

`upgrade` in `js/maintain/update.mjs` accepts a `ref` argument "for back-compat but IGNORED," and
says why: tag and branch pinning was removed along with a zip-based update path that used to
exist. What replaced it is three git steps: `preflight` refuses anything that is not a clean git
clone with an upstream; `pullAndValidate` runs a fast-forward-only merge and nothing else to move
the code, rolling back with `reset --keep` (never `--hard`) if the pulled source fails a `doctor`
gate; and the rebuild helper shells out to the pulled checkout's own `rebuild-all`, so every
install re-renders from the code just validated rather than the code cached before the merge.
There is no `GENESEED_REPO` knob and no HTTP client anywhere in the module.

## Decision

Self-update, for a clone install, is a git fetch and fast-forward merge, and nothing else. No zip,
tarball or other download path: the one that existed was deleted along with the tag and branch
pinning it needed, and `upgrade`'s `ref` parameter survives only to warn that it is ignored. No
`GENESEED_REPO` or other way to point the pull at a different origin than the clone's own remote.
A dirty working tree, a detached HEAD, or a folder that is not a git clone is reported and the
update stops. Every pull is doctor-gated before it reaches a user's installs.

## Consequences

- `tests/unit/update_git.test.mjs` and `tests/unit/update_flow.test.mjs` run every arm against a
  private clone of a bare origin the fixture builds, with git's protocol allow-list set so no cell
  can reach a real network even by accident.
- A machine with no `git` on `PATH` cannot self-update at all; `npm install -g geneseed@latest`
  plus `rebuild-all` is the parallel route for an npm install, and a clone with no git is told to
  re-clone rather than offered a download fallback.
- Reviving zip-based updates, or a way to point at a different origin, needs a reason this
  record's corporate-network case does not already cover: the git-only route works where the
  alternatives are blocked by policy, not merely inconvenient.
