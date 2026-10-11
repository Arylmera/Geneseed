# 0009 — Self-update is a git pull, not a download

- **Status:** Accepted
- **Date:** 2026-07 (git-pull self-update), carried through the Node port

## Context

The clone install exists specifically for machines npm cannot reach: README.md's "long way" section
names the case as "a corporate network with no registry access", and the Windows installer is
"native, no bash, WSL, curl, unzip or PowerShell script" — a missing prerequisite is reported with
"on a managed PC: Software Center / Company Portal" as the fix, never installed by the script
itself (`README.md`, "The long way — a git checkout"; `install.cmd`/`install`). The same machine
that cannot reach the npm registry, and that blocks `curl`, `unzip` and `.ps1` scripts outright
under policy, routinely still allows `git` over HTTPS — git is how the clone was obtained in the
first place.

`js/maintain/update.mjs`'s `upgrade()` accepts a `ref` argument "for back-compat but IGNORED", and
says why in the same breath: "tag/branch pinning was removed with the zip path" — a zip-based
update route existed once and is gone, along with whatever tag/ref selection it needed
(`upgrade`, `js/maintain/update.mjs:681-691`). What replaced it is three steps, all git: `preflight()`
refuses anything that is not a clean git clone with an upstream — not a git repo, a detached HEAD,
no tracked upstream, or a dirty working tree are each their own reported precondition, never
force-updated (`preflight`, `js/maintain/update.mjs:208-220`); `pullAndValidate()` runs
`git merge --ff-only @{u}` and nothing else to move the code, rolling back with `git reset --keep`
(never `--hard`, so a tracked edit made during the doctor window is a refusal to roll back rather
than a silent loss) if the pulled source fails a `doctor --all --no-bundle` gate
(`pullAndValidate`, `runDoctor`, `js/maintain/update.mjs:418-484`); and `rebuildInstalls()` shells
out to the pulled checkout's own `geneseed-cli.mjs rebuild-all` so every registered install is
re-rendered from the code that was just validated, not the code this process had cached before the
merge (`js/maintain/update.mjs:666-678`). `docs/guides/upgrade.md` states the same three steps for
users: "a fast-forward-only `git pull`... a blocking `doctor` pass... rebuilds the bundle and every
install in place."

There is no `GENESEED_REPO` environment variable, no `--zip` flag, and no HTTP client anywhere in
`js/maintain/update.mjs` — the module's own docblock lists exactly four spawn sites
(`runDoctor`, `rebuildBundle`, `rebuildInstalls`, `git` through `gitRun`), each justified by the
same fact: the code on disk changes partway through the verb, so an in-process call would validate
and render the OLD source while reporting an upgrade. A download stack would be a fifth kind of
network call this module has deliberately never grown, on top of the three it already needs
justifying.

## Decision

Self-update, for a clone install, is `git fetch` (via `merge --ff-only`) and nothing else:

- No zip, tarball or other HTTP download path. The one that existed was deleted along with the
  tag/branch pinning it needed; `upgrade()` keeps the `ref` parameter only to warn that it is
  ignored, not to revive the route.
- No `GENESEED_REPO` knob, or any other way to point the pull at a different origin than the
  clone's own remote. `originDisplay()` and `gitRun` always operate on `ROOT`'s configured
  upstream.
- A dirty working tree, a detached HEAD, or a folder that is not a git clone is reported and the
  update stops — never force-updated, never partially applied.
- Every pull is doctor-gated before it reaches a user's installs: a pulled commit that fails
  `doctor --all --no-bundle` is rolled back (`reset --keep`), and the installs are only rebuilt
  once validation passes.

## Consequences

- `tests/unit/update_git.test.mjs` and `tests/unit/update_flow.test.mjs` run every arm against a
  private clone of a bare origin the fixture builds, with `GIT_ALLOW_PROTOCOL=file` so no cell can
  reach a real network even by accident.
- A machine with no `git` on `PATH` cannot self-update at all (`preflight`'s `no_git_exe`); `npm
  install -g geneseed@latest` plus `rebuild-all` is the parallel route for an npm install, and
  `docs/guides/upgrade.md` tells a clone user with no git to re-clone rather than offering a
  download fallback.
- Reviving zip-based updates, or adding a way to point at a different origin, needs a reason this
  record's corporate-network case does not already cover — the whole point of the git-only route
  is that it works where the alternatives are blocked by policy, not merely inconvenient.
