# {{SKILL}}: rule — consolidation flow

Tends the {{MEMORY}} set as a whole.

1. **Read the whole set once**: `MEMORY.md`, its `topics/` files, every fact they
   index, and any file in `{{DIR_MEMORY}}/` they forgot, into a scratch table — name, type, the claim in one
   line, date written, and whether this session already saw it contradicted
   ({{DOCTRINE:context-economy}}: read to decide, not to reread).
2. **Verify against the live repo, not memory** ({{LAW:verify-before-asserting}}): every path,
   function, flag, command, version, PR or branch a memory names must still exist and
   behave as claimed; record the evidence in the table.
3. **Classify each entry**: *keep* (true, still changes behaviour, not derivable from
   the repo), *merge* (one file survives, the other's `**Why**` folded in), *rewrite*
   (the fact drifted — fix the claim, keep the lesson), *promote* (a `feedback` lesson
   that fired three times or more goes through Branch B of the rule {{SKILL}}), *retire* (wrong, superseded,
   or re-derivable by a fresh read). In doubt between keep and retire, keep and date it.
4. **Show the plan, apply it with consent** ({{LAW:deletion-is-deliberate}} — retirement is
   deletion). Merges keep both parents' `[[links]]`; rewrites keep the file name so
   inbound links hold; every survivor keeps valid frontmatter and the `**Why** / **How
   to apply**` lines its type demands. A memory holding a secret is retired on sight
   ({{LAW:sealed-secrets}}).
5. **Rebuild the index** with
   `geneseed learn --consolidate --memory <the {{DIR_MEMORY}}/ dir's path>`: one pointer line per
   surviving file in its `topics/<topic>.md`, and the `MEMORY.md` map recounted. Each
   hook is the fact's `description`, so sharpen a weak hook there — it should say why a
   future session would open the fact.
6. **Exit with a count** — kept / merged / rewritten / promoted / retired — and the
   one or two lessons the pass surfaced (a category that keeps drifting, a kind of
   note nobody reads) as a proposal for how memories get written, not as a memory.

## Done when
- Every memory was verified against the live repo, changes
  were applied with consent, no secret remains, and the index (`MEMORY.md` and its
  `topics/`) covers the directory exactly, one line per file.
