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
  model, so on `SessionEnd` and `PreCompact` `learn` writes a job file and starts the
  worker, then returns at once. The one exception is `GENESEED_LEARN_INLINE=1` (a test, or a person debugging the
  distil), which runs the same job inside the hook process and waits for the model; nothing else runs inline, and a hook
  event that can name no install or no machine cache folder skips the distil instead of falling back to it. The job lives in the machine tier's cache, `<machine dir>/cache/learn-jobs/job-*.json`
  (`~/.config/geneseed/cache/learn-jobs`), never in an install: a project install's folder is the user's repo. A job
  is DATA: the transcript path, the memory dir, the host, the sub-agents queued for a lesson. It holds no model
  command. The shape is fixed and nothing else may be spawned this way:
  `spawn(process.execPath, [<this checkout>/bin/geneseed-hook.mjs, 'learn-worker', <job file>],
  { detached: true, windowsHide: true, stdio: 'ignore' })`, then `unref()`. No shell, no `$GENESEED_LLM` word and
  no payload text in its argv. The worker (`geneseed-hook learn-worker`) is guarded three ways, because its argument is a path an agent
  could be talked into running and a repository can ship a file of that name: the file is named `job-*.json` and the real
  path of its folder equals the real path of the machine cache's `learn-jobs` (a folder merely named that does not
  count; anything else is left untouched); the model command is the worker's own `$GENESEED_LLM`, inherited from
  the hook that started it, so a job can name none; and the job's `memory` must be the machine tier's `memory/` or
  the `memory/` of a folder holding a Geneseed install manifest, or the job is refused and deleted without being run. It then runs the distil
  with the one model spawn above, and deletes the job. Measured
  on Windows 11 (spec S1c): the hook returns in 26 ms and the worker finishes 9 s later, after the session is gone.
  The worker has no stdio, so it reports through one file: after each run (the inline path too) it writes
  `<machine dir>/cache/learn-last.json`, `{ at, ok, reason, facts }`, which `status` and `doctor` append to the learn
  line when the last run failed. No stdout, no further spawn.
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
  break or a trailing backslash refuses the call. For `claude` and `openclaude` the prompt goes over stdin on every path, native `.exe` and non-Windows included (a long
  prompt overran the 32 767-character Windows line and failed silently); any other command keeps it as its last argument.
- **Known limit, `.cmd` path on Windows:** the model call's timeout bounds the *wait*, not the child's life. `SIGKILL`
  ends `cmd.exe`, and the node process the npm shim started under it can outlive that kill. A kill-tree would be a
  new spawn (`taskkill`), which this ADR does not allow, so it is not done; an `.exe` model CLI is killed whole.
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
