# {{SKILL}}: ship

> {{DESC_SHIP}}

**Trigger:** the change is committed and verified, and it is time to open a pull
request or merge the branch.

## Procedure
1. Confirm the work is actually done before shipping — tests green, behaviour
   checked (run [verify](verify.md) if unsure; universal {{LAW}} III).
   Never ship on an unproven claim.
2. Confirm the branch carries only this change's commits and is rebased/updated on
   the base branch; resolve any divergence before opening.
3. Push the branch. Opening a PR or merging is **outward-facing** — get explicit
   confirmation first unless already authorized (universal {{LAW}} IV).
4. Open the PR with a structured body: *what* changed and *why*, *how it was
   tested*, and any risk or follow-up. Link the issue it closes; keep the title an
   imperative one-line summary.
5. If the project merges locally instead, merge into the base branch only after
   review/approval, then delete the merged branch.
6. Make sure documentation shipped with the code (universal {{LAW}} XI) — a change
   that alters behaviour without its docs is incomplete, not ready to ship.

## Done when
- The PR is open (or the branch is merged) with a body stating what / why / how it
  was tested, and nothing unrelated rides along.
