- **The learn model cleans the memory store.** It reads the stored facts in batches and merges the
  copies, archives task residue and facts that are no longer true, and splits any topic of more than
  30 facts into narrower ones so a topic file stays small. The whole store is copied into
  `memory/archived-cleanup/<date>/` first, and every change goes through `archive/`. An action the
  model is unsure of waits: `geneseed memory plan` lists it, `geneseed memory apply` or `reject`
  decides it, and `geneseed memory restore <name>` brings an archived fact back. It runs by itself at
  the end of a session on a store of 60 facts or more (five batches a session), once per version of
  the cleanup; `GENESEED_CONSOLIDATE=off` turns that off. By hand, run `geneseed-hook learn
  --consolidate --merge`, adding `--dry-run` to apply nothing. `geneseed memory consolidate
  --dry-run` reports the index rebuild and the likely duplicates without writing.
