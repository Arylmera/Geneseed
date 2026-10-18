# 0002 — No spawn on the generator, two on the hook path, declared ones in the CLI

- **Status:** Accepted
- **Date:** 2026-08-22 (`5c970dc9`, when the Node generator became `bin/build-driver.mjs`)

## Context

Geneseed was a Python tool before 2.0. The port to Node kept one lesson from it: a process that can
spawn an interpreter will, sooner or later, depend on one being on `PATH`. The generator runs on
locked-down corporate machines and inside CI images without Python. The hook entry runs on every
tool call of every agent session, where a spawn costs time and a console window on Windows.

## Decision

- `bin/build-driver.mjs`, the generator, reaches **no** child-process module, transitively: not in
  its own source, and not in anything it imports.
- `bin/geneseed-hook.mjs` has exactly **one** spawn site: `js/hosts/hooks-learn.mjs`, which runs the
  user's model CLI (`$GENESEED_LLM`) because that is the whole `learn` verb. No gate verb spawns.
- **Amended 2026-10-17** (Law IV calibrated to real loss): the git gate gains **one** spawn site,
  `js/hosts/loss.mjs`, which runs `git` itself (`shell: false`, a timeout, no optional locks, no
  fsmonitor) to learn whether a tree is dirty, which files are untracked, and whether a branch's
  commits live elsewhere. None of these can be read off disk at a sane cost. It is reached only
  after a destructive-looking command matched the gate's prefilter, so an ordinary tool call
  still spawns nothing. If git is missing or fails, the gate asks. The one exception that is not
  destructive-looking: a plain `git checkout <x>` while `main`, `master` or the default branch is
  checked out runs `git rev-parse` to tell a branch switch from a path discard.
- `bin/geneseed-cli.mjs`, the user-facing CLI, spawns only from modules on a declared allow-list
  (`ALLOWED_SPAWNS`), each row naming the exact argv it may start — `git` for update, `node --check`
  for doctor, the web daemon relaunching this program, and so on. A new spawn is a new row with its
  argument, never a quiet import.
- `doctor --probe` (2026-10-17, #290) adds one row. It runs each live install's own **gate**
  command, as recorded in that install's settings, through the shell the host would use (`sh -c`,
  Git Bash `-c`, `powershell -NoProfile -NonInteractive -Command`, or `cmd /d /s /c` for Bob). It
  feeds the command a canned payload on stdin, from an empty temp directory. It runs only a command
  carrying `geneseed-hook`, a gate verb and `--root`, and never anything else found in a settings
  file. It is opt-in, because it is the one doctor spawn that executes installed code rather than
  the checkout's.

## Consequences

- `tests/unit/hook_cli.test.mjs` walks each entry's import closure: it refuses any `child_process`
  reference in the generator's, pins the hook's two spawn sites (one call each; the gate's behind
  its prefilter), and holds the CLI's spawning modules equal to the allow-list.
- Every capturing spawn that does exist must hide its console (`tests/unit/spawn_hygiene.test.mjs`).
- A gate's verdict in the user's own shell is observable on demand. Doctor's environment is still
  not the host app's, so a pass means "refuses under this shell and this environment", not
  "refuses inside every host session".
- A feature that "just needs to run a tool" — a formatter, a scanner — is either ported to Node or
  printed as a command for the agent or the user to run.
