---
name: checks
description: Run the repo's done list as the base branch holds it, then refuse a diff that changes a locked path. Never trusts the branch's own copy.
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

Read the done list from the base, never from this branch: `git show
origin/<default>:.geneseed/done-checks.txt`, one command per line, `#` lines ignored. When the base
has no such file, or it holds no command, propose one from the BASE's manifests (`git show
origin/<default>:<file>`), never this branch's:
- `package.json`: its `test`, `lint` and `typecheck` scripts, each only when present, and `test`
  not when it is npm's `no test specified` stub. Run them with the package manager the lockfile
  names: `pnpm test`, `pnpm lint`, `pnpm typecheck` (`pnpm-lock.yaml`); `yarn test`, `yarn lint`,
  `yarn typecheck` (`yarn.lock`); `bun run test`, `bun run lint`, `bun run typecheck`
  (`bun.lock`); else `npm test`, `npm run lint`, `npm run typecheck`.
- `pom.xml`: `mvn test`. `build.gradle` or `build.gradle.kts`: `gradle test`, as `./gradlew test`
  when the repo has the wrapper. `Cargo.toml`: `cargo test`. `go.mod`: `go test`.
- `pyproject.toml`: `pytest`, only where pytest shows (a `[tool.pytest` section, `pytest.ini`,
  `conftest.py` or a `tests` folder).
- No manifest: propose nothing, and say so.
Write the proposal and report `none`.

List the untracked files (`git status --porcelain --untracked-files=all`), then run each command
from the worktree root, in order, each bounded under 10 minutes by your shell tool's timeout.
Afterwards delete only the untracked files the commands created. Report `fail` when a command
exits non-zero (name the first failing command and copy the last 40 lines of its output), or when
anything else is left changed (name it). A command that times out, or whose tool is missing, is a
`fail` too: mark it `environment` in the finding, so the loop knows its code cannot fix it.

Only when every command passes, list the files the branch changed: `git diff --name-only
--no-renames <merge-base> HEAD` (`--no-renames` lists a rename's old path too, so moving a locked
file out of place is seen). A path is locked when it equals an entry below, or lies under an entry
that ends in `/`: `.geneseed/done-checks.txt`, `.gitlab-ci.yml`, `.github/workflows/`,
`.geneseed/factories/`, `.geneseed/loops/`, `.geneseed/bricks/`, and each entry of the stage's
`protected` list. Tests are not locked. Report `error` when any changed path is locked, naming each
one: the user decides whether the run goes on. Else report `pass`.
