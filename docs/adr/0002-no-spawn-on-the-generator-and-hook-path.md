# 0002 — No spawn on the generator, one on the hook path, declared ones in the CLI

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
- `bin/geneseed-cli.mjs`, the user-facing CLI, spawns only from modules on a declared allow-list
  (`ALLOWED_SPAWNS`), each row naming the exact argv it may start — `git` for update, `node --check`
  for doctor, the web daemon relaunching this program, and so on. A new spawn is a new row with its
  argument, never a quiet import.

## Consequences

- `tests/unit/hook_cli.test.mjs` walks each entry's import closure: it refuses any `child_process`
  reference in the generator's, pins the hook's single spawn site, and holds the CLI's spawning
  modules equal to the allow-list.
- Every capturing spawn that does exist must hide its console (`tests/unit/spawn_hygiene.test.mjs`).
- A feature that "just needs to run a tool" — a formatter, a scanner — is either ported to Node or
  printed as a command for the agent or the user to run.
