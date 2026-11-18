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
- `bin/geneseed-hook.mjs` has exactly **one** *model* spawn site: `js/hosts/hooks-learn.mjs`, which runs the
  user's model CLI (`$GENESEED_LLM`) because that is the whole `learn` verb. No gate verb spawns.
- **Amended 2026-11-18** (the learn model setting): the same module gains a **second spawn**, the detached
  worker. A `SessionEnd` hook is killed when its session ends, and a compaction must not wait 5 to 10 s for a
  model, so on `SessionEnd` and `PreCompact` `learn` writes a job file (`<install>/learn-jobs/job-*.json`:
  transcript path, memory dir, host, the model command, the sub-agents queued for a lesson) and starts the
  worker, then returns. The shape is fixed and nothing else may be spawned this way:
  `spawn(process.execPath, [<this checkout>/bin/geneseed-hook.mjs, 'learn-worker', <job file>],
  { detached: true, windowsHide: true, stdio: 'ignore' })`, then `unref()`. No shell, no `$GENESEED_LLM` word and
  no payload text in its argv. The worker (`geneseed-hook learn-worker`) accepts only a file named `job-*.json`
  inside a `learn-jobs` folder, runs the distil on it with the one model spawn above, and deletes it. Measured
  on Windows 11 (spec S1c): the hook returns in 26 ms and the worker finishes 9 s later, after the session is gone.
  The model CLI itself runs lean (`--setting-sources ""`, `--strict-mcp-config`, `--tools ""`,
  `--disable-slash-commands`, `--no-session-persistence`, a short `--system-prompt`; never `--bare`, which needs an
  API key) and, for `openclaude`, runs `openclaude --help` first, through the same one `spawnSync` call.
- **Amended 2026-10-17** (Law IV calibrated to real loss): the git gate gains **one** spawn site,
  `js/hosts/loss.mjs`, which runs `git` itself (`shell: false`, a timeout, no optional locks, no
  fsmonitor) to learn whether a tree is dirty, which files are untracked, and whether a branch's
  commits live elsewhere. None of these can be read off disk at a sane cost. It is reached only
  after a destructive-looking command matched the gate's prefilter, so an ordinary tool call
  still spawns nothing. If git is missing or fails, the gate asks. The one exception that is not
  destructive-looking: a plain `git checkout <x>` while `main`, `master` or the default branch is
  checked out runs `git rev-parse` to tell a branch switch from a path discard.
- **Amended 2026-11-18, on Windows** (F5): the one model `spawnSync` resolves the command's first word against
  `PATH` and `PATHEXT` (`resolveCommand`, `js/lib/proc.mjs`, the same function `doctor`'s PATH note uses), because an
  npm-installed CLI is a `.cmd` shim that `CreateProcess` cannot find. An `.exe` runs directly. A `.cmd` or `.bat`
  runs as `cmd.exe /d /s /c "<every word double-quoted>"` (no shell option; `windowsVerbatimArguments`), and
  **the prompt goes over stdin, never on that line**: what a session's notes hold is never read by cmd.exe. The
  words on the line are the user's own command and the fixed lean flags; a word holding a double quote, `%`, a line
  break or a trailing backslash refuses the call. Elsewhere nothing changes.
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
  reference in the generator's, pins the hook's spawning modules (`hooks-learn.mjs`: one `spawnSync` call
  and one `spawn` call in the exact shape above; `loss.mjs`: one call, behind its prefilter), and holds
  the CLI's spawning modules equal to the allow-list. `js/inspect/doctor.mjs`'s allow-list is unchanged: the
  worker is the hook's spawn, not the CLI's.
- Every capturing spawn that does exist must hide its console (`tests/unit/spawn_hygiene.test.mjs`).
- A gate's verdict in the user's own shell is observable on demand. Doctor's environment is still
  not the host app's, so a pass means "refuses under this shell and this environment", not
  "refuses inside every host session".
- A feature that "just needs to run a tool" — a formatter, a scanner — is either ported to Node or
  printed as a command for the agent or the user to run.
