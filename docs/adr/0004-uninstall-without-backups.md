# 0004 — Uninstall needs no backup, by construction

- **Status:** Accepted
- **Date:** 2026-10 (operator decision)

## Context

Geneseed writes into files its user co-owns: a root `CLAUDE.md` / `AGENTS.md`, `settings.json`,
`opencode.json`, the host's skills and agents folders, `.gitignore`. A snapshot/restore layer was
proposed so that an uninstall could put everything back.

## Decision

No snapshot or restore layer. Every write is reversible on its own terms instead:

- a user's root file gets a delimited `<!-- BEGIN/END GENESEED -->` block
  (`managedBlockWrite` / `managedBlockRemove` in `js/hosts/settings.mjs`);
- `settings.json` and `opencode.json(c)` are merged key by key, and a commented file is refused
  rather than rewritten;
- skills, agents and `.gitignore` entries are claimed on create (`claimer` in
  `js/hosts/native.mjs`), recorded in the install manifest, and uninstall deletes only
  manifest-owned paths.

## Consequences

- A user's own content is never in a file Geneseed deletes, so there is nothing to restore.
- The price is care on the write side: a pruning slip in the settings merge deletes user keys,
  which is why that code is listed in [`SECURITY.md`](../../SECURITY.md).
- Do not propose a backup layer again without a case this construction does not cover.
