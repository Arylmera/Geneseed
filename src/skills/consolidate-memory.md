# {{SKILL}}: consolidate-memory

> {{DESC_CONSOLIDATE_MEMORY}}

**Trigger:** the {{MEMORY}} index has grown past what a session can usefully read
(~40 lines), two entries say the same or opposite things, a memory names a file, flag,
or command that no longer exists, a `feedback` lesson keeps recurring, or the user
says "clean up memory", "consolidate", "what do you actually remember". Also worth a
pass after a release or a large refactor, when many recorded facts just changed. The
[rule {{SKILL}}](rule.md) writes one memory or one rule; this {{SKILL}} tends the
whole set. The user's wiki is out of scope — that is the [wiki {{SKILL}}](wiki.md).

## Procedure
1. **Read the whole set once**: `MEMORY.md` and every file it indexes, plus any file in
   `{{DIR_MEMORY}}/` the index forgot. Build a scratch table — name, type, the claim in
   one line, the date it was written — and note which entries the current session
   already saw contradicted ({{DOCTRINE}} process 3: read to decide, not to reread).
2. **Verify against the live repo, not memory** ({{LAW}} III). For each memory that
   names a path, function, flag, command, version, PR or branch: check it still exists
   and still behaves as claimed. A `project` memory about work since merged, a
   `reference` to a moved file, a `feedback` note the code now enforces — each is a
   candidate to retire or rewrite, and the evidence goes in the table.
3. **Classify each entry**: *keep* (true, still changes behaviour, not derivable from
   the repo), *merge* (duplicates or refines another — one file survives, the other's
   `**Why**` folded in), *rewrite* (the fact drifted — fix the claim, keep the lesson),
   *promote* (a `feedback` lesson that has fired three times or more belongs in
   `user-rules.md` — hand it to the [rule {{SKILL}}](rule.md)), *retire* (wrong,
   superseded, or a fact a fresh read of the repo re-derives). When in doubt between
   keep and retire, keep and date it.
4. **Show the plan, then apply it with consent** ({{LAW}} IV — retirement is deletion).
   Merges preserve the `[[links]]` of both parents; rewrites keep the file name so
   inbound links hold; every surviving file keeps its frontmatter valid and its
   `**Why** / **How to apply**` lines where the type demands them. Nothing in the set
   ever holds a secret ({{LAW}} I) — a memory that does is retired on sight.
5. **Rebuild the index.** `MEMORY.md` gets exactly one line per surviving file, each
   with a hook that says why a future session would open it; entries the index had
   lost are added, retired ones removed, and the archive lines for old compactions kept
   short. The index carries no memory content — only pointers.
6. **Exit with a count and a diff**: kept / merged / rewritten / promoted / retired,
   and the one or two lessons the pass itself surfaced — a category that keeps
   drifting, a kind of note nobody reads — as a proposal for how memories get written
   from now on, not as another memory.

## Done when
- Every memory was verified against the live repo, duplicates are merged and stale
  facts rewritten or retired with the user's consent, recurring lessons went to the
  rule {{SKILL}}, no secret remains, and `MEMORY.md` is a one-line-per-file index that
  matches the directory exactly.

<!-- INCLUDE: skills/_self-improvement.md -->
