---
name: checks
description: Run the repo's done list as the base branch holds it, after refusing a diff that changes a locked path. Never trusts the branch's own copy.
effect: read
agent: tester
outcomes: pass, fail, error, none
gate: human
gateOn: error, none
---
Run `git fetch origin`, then find the base: the default branch (`gh repo view --json
defaultBranchRef`, or `git remote show origin`) and `git merge-base HEAD origin/<default>`. Never
edit or commit a file. Write every finding to a file in the OS temp directory, never inside the
worktree, and report that file's path.

List the files the branch changed: `git diff --name-only <merge-base> HEAD`. A file is locked when
it is `.geneseed/done-checks.txt`, `.gitlab-ci.yml`, or lies under `.github/workflows/`,
`.geneseed/factories/`, `.geneseed/loops/` or `.geneseed/bricks/`, or matches a path in the stage's
`protected` list. Tests are not locked. Report `error` when any changed file is locked, naming each
one: the user decides whether the run goes on.

Read the done list from the base, never from this branch: `git show
origin/<default>:.geneseed/done-checks.txt`, one command per line, `#` lines ignored. When the base
has no such file, propose one from the BASE's manifests (`git show origin/<default>:<file>`), never
this branch's: `package.json`'s `test`, `lint` and `typecheck` scripts run with the package manager
its lockfile names, `pom.xml` → `mvn test`, `build.gradle(.kts)` → `gradle test`, `pyproject.toml` →
`pytest`, `Cargo.toml` → `cargo test`, `go.mod` → `go test ./...`. Write that list and report `none`.

Otherwise list the untracked files (`git status --porcelain --untracked-files=all`), then run each
command from the worktree root, in order, each bounded under 10 minutes by your shell tool's
timeout. Afterwards delete only the untracked files the commands created. Report `fail` when a
command exits non-zero (name the first failing command and copy the last 40 lines of its output),
or when anything else is left changed (name it). Report `pass` when every command passes and the
tree is as you found it.
