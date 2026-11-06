# 0011 — One shared tier per machine, reached by a fold in the emit

- **Status:** Accepted
- **Date:** 2026-11-05 (shipped in 5.0.0)

## Context

Each global install kept its own memory, `user-rules.md`, `PROFILE.md`, wiki manifest, exclude
list and notes. A survey of one real machine found the copies had drifted: four rules on Claude
Code, one on OpenCode, none on Bob, and an exclude entry missing from Bob. What a user taught one
tool never reached the others, and `$GENESEED_MEMORY` moved `learn` but not session injection, the
web console or the rule gate.

## Decision

The stores move to one folder, `$XDG_CONFIG_HOME/geneseed/` (default `~/.config/geneseed/`), beside
the install registry and the user's loop bricks. `js/lib/machine-dir.mjs` is the one home of that
path, and each OpenCode plugin carries a parity-tested copy because a plugin cannot import it.

- **Reads layer.** `user-rules.md` and `MEMORY.md` concatenate, shared first, so project over host
  over shared. `PROFILE.md` and the wiki manifest are whole files: a non-seed host file replaces
  the shared one.
- **The move is a fold in the emit** (`js/build/fold.mjs`), on a canonical global install only, so
  users reach the tier through the commands they already run. It copies, reads back, and only then
  moves the old store aside. A second run writes nothing.
- **What needs a judgement waits.** A differing rule, profile or wiki goes to
  `user-rules.draft.md`, and a drafted rule stays in force in its host file. Only the `rule` skill
  writes a decision, and `.fold-state.json` keeps it from being asked twice.
- **Project installs do not change.** `--shared-tier on` gives one a read-only view; it is off by
  default, because the tier competes with the project's docs for the hook budget.
- **Out of the tier:** the rendered constitution and kits stay per install, MCP servers stay the
  host's and are only listed, and the notebook stays per host apart from its two notes folders.

## Consequences

- Hosts cannot drift on rules, memory or exclusions, and the console has one store to show.
- A rebuild of a global install is no longer only a render. It can move user files, so
  `geneseed migrate --dry-run` previews it, and `diff` and a stray `--config-dir` never fold.
- No emit grants a directory permission. An agent write to the tier follows the host's permission
  mode, and the host canary cannot prove it because it runs no model turn.
- A downgrade is manual: restore the archived store by hand.
- Claude Code's own auto memory is not moved. An explicit import is left for a later release.

## Alternatives set aside

- **`~/.geneseed/`:** it holds machinery that `GENESEED_HOME` moves, and data does not belong there.
- **A symlink or junction per host:** file links need admin rights on Windows.
- **Moving facts by hand:** a one-off step that most machines would never run.
- **Shared over host:** a host file could then never narrow a machine-wide rule.
