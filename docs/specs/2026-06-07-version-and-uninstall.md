# Version stamp & uninstall

**Date:** 2026-06-07
**Status:** implemented

## Problem

Two lifecycle gaps in a deployed harness:

1. **No version awareness.** Markers recorded theme and emit, never *which build*.
   You couldn't tell what was installed, or whether the source you have would change
   anything if applied, without a full `diff`.
2. **No clean uninstall.** A global install writes AGENT.md, `agents/`, `skills/`,
   `plugins/`, merges `opencode.json`'s `instructions`, and seeds memory — all
   tracked in `.geneseed-manifest.json` — but there was no command to reverse it.

## Fix

### Version (`build.py` + `harness.py`)
- `build.source_fingerprint()` — a short (12-hex) SHA-256 over every file in `src/`,
  `themes/`, and the OpenCode plugins. Theme/emit-independent: it identifies *which
  Geneseed source*. Stdlib only, deterministic.
- `build.write_version(out)` stamps `<out>/.geneseed-version` (`<fp> (built <date>)`)
  in `build()` and `emit_opencode_global()` (the global marker is manifest-owned, so
  uninstall removes it). `build.read_version(dir)` reads the fingerprint token back.
- `harness version [--target]` prints the current-source fingerprint and the deployed
  install's, with a verdict (`up to date` / `differs — run update` / `none found`).
  Network-free; it compares against the source tree the CLI runs from. `upgrade`
  remains the way to pull newer source from upstream.

### Uninstall (`harness.py`)
- Scoped to the **global** install (the one with a manifest). `harness uninstall
  [--target] [--yes] [--archive-memory]`:
  - removes every manifest-`owned` file, prunes emptied `agents/`/`skills/`/`plugins/`
    (and per-skill dirs),
  - drops the `AGENT.md` entry from `opencode.json`'s `instructions`
    (`_unmerge_opencode_json`, every other key preserved),
  - deletes the markers (`.geneseed-manifest.json`, `.geneseed-theme`,
    `.geneseed-emit`, `.geneseed-version`),
  - **never deletes memory.** By default the store is kept in place; with
    `--archive-memory` it is *moved* to a sibling `archived-memory/<timestamp>/`
    (`_archive_memory`, created if absent) so learned facts are set aside, never
    lost. There is no memory-deletion path anywhere in the harness.
  - Confirms first; refuses non-interactive without `--yes`.
- Per-repo `.opencode/` installs have no manifest — documented manual removal
  (`rm -rf .opencode`, drop the instructions entry).
- Launcher (`geneseed`) routes `version` / `uninstall`; help updated.

## Tests
- `VersionTests`: fingerprint deterministic + 12-hex, write/read round-trip, absent →
  None, verdict strings.
- `UninstallTests`: a real global emit is fully removed (owned files, markers,
  `opencode.json` un-merged) with memory kept in place by default; with
  `--archive-memory` the store is moved to `archived-memory/` and a planted fact
  survives. `ArchiveMemoryTests`: `_archive_memory` moves into a timestamped sibling
  and preserves contents.

## Verified
`doctor --all` clean; 52 tests pass; CLI round-trip (emit → version "up to date" →
uninstall leaves only `memory/` + cleaned `opencode.json`).
