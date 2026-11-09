---
name: checks
description: Run the repo's done list as the base branch holds it, then refuse a diff that changes a locked path. Never trusts the branch's own copy.
effect: read
agent: tester
outcomes: pass, fail, error, none
gate: human
gateOn: error, none
---
Never commit. Write every finding to a file in the OS temp directory, never inside the worktree,
and report that file's path. Run `git fetch origin`, then find the default branch (`gh repo view
--json defaultBranchRef`, or `git remote show origin`) and the base, `git merge-base HEAD
origin/<default>`. When the fetch fails or no default branch is found, report `fail` and mark it
`environment`.

Read the done list from the base, never from this branch: `git show
origin/<default>:.geneseed/done-checks.txt`, one command per line, `#` lines ignored. When the base
has no such file, or it holds no command, propose one from the BASE's manifests (`git show
origin/<default>:<file>`), never this branch's:
- `package.json`: its `test`, `lint` and `typecheck` scripts, each only when present, and `test`
  not when it is npm's `no test specified` stub. The first lockfile found, in this order, names
  the package manager: `bun.lockb` or `bun.lock` → `bun run test`, `bun run lint`,
  `bun run typecheck`; `pnpm-lock.yaml` → `pnpm test`, `pnpm lint`, `pnpm typecheck`;
  `yarn.lock` → `yarn test`, `yarn lint`, `yarn typecheck`; none → `npm test`, `npm run lint`,
  `npm run typecheck`.
- `pom.xml`: `mvn test`. `build.gradle` or `build.gradle.kts`: `gradle test`, as `./gradlew test`
  when the repo has the wrapper. `Cargo.toml`: `cargo test`. `go.mod`: `go test ./...`.
- `pyproject.toml`: `pytest`, only where pytest shows (a `[tool.pytest` section, `pytest.ini`,
  `conftest.py` or a `tests` folder).
- No manifest: propose nothing, and say so.
Put the proposal in the finding as one fenced block, one command per line and nothing else in it;
explain outside the block. Report `none`.

The tree is clean before you run anything. Run each command from the worktree root, in order, each
bounded under 10 minutes by your shell tool's timeout. Report `fail` when a command exits
non-zero: name the first failing command and copy the last 40 lines of its output. Report `fail`
too when a command changed a tracked file, naming each file: a lint that fixes what it finds hides
what it found. Afterwards, whatever the outcome, put the tree back: restore every tracked file the
commands changed (`git restore --staged --worktree -- <path>`) and delete every untracked file
they created, naming each one in the finding. Never touch `FACTORY.md` or `LOOP.md`: they are the
run's state, not a command's output. A command that times out, or whose
tool is missing, is a `fail` too: mark it `environment`, so the loop knows its code cannot fix it.

Only when every command passes, list the files the branch changed: `git diff --name-only
--no-renames <merge-base> HEAD` (`--no-renames` lists a rename's old path too, so moving a locked
file out of place is seen). A path is locked when it equals an entry below, or lies under an entry
that ends in `/`: `.geneseed/done-checks.txt`, `.gitlab-ci.yml`, `.github/workflows/`,
`.geneseed/factories/`, `.geneseed/loops/`, `.geneseed/bricks/`, and each entry of the stage's
`protected` list. Tests are not locked. Report `error` when any changed path is locked, naming each
one: the user decides whether the run goes on. Else report `pass`.
