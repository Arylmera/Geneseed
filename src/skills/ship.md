# {{SKILL}}: ship

> {{DESC_SHIP}}

**Trigger:** the change is committed and verified, and it is time to open a pull
request or merge the branch.

## Procedure
1. Confirm the work is actually done before shipping. Find the project's Definition
   of Done — its test, lint, and build commands (often pointed at from
   `context.json`); if it is undefined, ask rather than assume. Run those checks and
   read the actual output (universal {{LAW}} III); state what you ran and its result.
   Never ship on an unproven claim.
2. Confirm the branch carries only this change's commits and is rebased/updated on
   the base branch; resolve any divergence before opening.
3. Push the branch only with the user's explicit, per-push acceptance — on every
   branch, feature branches included ({{LAW}} XX); present the change summary + commit
   message and wait, and never treat an earlier approval as consent for this push.
   Opening a PR or merging is **outward-facing** — get explicit confirmation first too,
   unless already authorized (universal {{LAW}} IV).
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

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- The run taught something durable that is *not* a flaw in this file — record it
  to {{MEMORY}} ({{LAW}} VI).
- No friction, nothing learned — move on; this loop earns no ceremony.
