# {{SKILL}}: security-audit

> {{DESC_SECURITY_AUDIT}}

**Trigger:** a change touches the security surface — authentication, authorisation,
session or token handling, input from outside the trust boundary, file or shell
access, cryptography, secrets, a new dependency, a network-facing endpoint — or the
user asks for a "security review", "threat model", or "is this safe". The
[geneseed-code-review {{SKILL}}](geneseed-code-review.md) reviews a diff for
correctness first; this one asks a different question of the same diff: *how would
this be attacked, and what does it leak*. Run both before shipping anything on the
surface.

## Procedure
1. **Draw the surface.** From the diff and the code it lands in, name the trust
   boundaries the change crosses (user input, another service, the filesystem, a
   subprocess, the network), what an attacker controls on each, and the assets behind
   them (data, credentials, the host). No boundary crossed → say so, verdict *not on
   the surface*, stop.
2. **Dispatch the [security {{AGENT}}](../{{DIR_AGENTS}}/security.md)** with the surface
   from step 1 and the diff — read-only, in its own context so the main one stays
   clean ({{DOCTRINE}} process 3). It runs the passes below; for a small change you may
   run them yourself.
3. **Pass 1 — the classic classes**, each checked against the actual code, not
   assumed: injection (SQL, shell, path, template), broken auth or missing authz on
   a new route, unsafe deserialisation, SSRF, insecure defaults, missing rate or size
   limits, error messages that leak internals. Verify by reading the handling at the
   boundary and, where a test can exercise it, by running one ({{LAW}} III).
4. **Pass 2 — secrets and data.** Nothing sensitive in code, config, logs, fixtures,
   or the commit itself ({{LAW}} I); PII handled and logged to the project's policy;
   tokens scoped and expiring. Grep the diff for key-shaped strings, and check what the
   new code *logs*.
5. **Pass 3 — the supply chain.** A new or bumped dependency: who publishes it, how
   maintained, what it pulls in transitively, any advisory against the pinned version
   (the [deps-audit {{SKILL}}](deps-audit.md) carries the tooling). A destructive
   capability exposed to an agent or a tool: its guard is enforced server-side, at the
   boundary the call crosses, never left to the caller's judgement ({{DOCTRINE}} rigor 5).
6. **Report, don't fix.** Each finding as `file:line — attack — impact — fix`, ranked
   critical → high → medium → note, with the evidence that made it a finding. Then the
   verdict — **ship / fix-then-ship / block** — and, for anything above medium, the
   test that would pin the fix. Applying fixes is a [develop {{SKILL}}](develop.md)
   task on its own commit ({{LAW}} II); a review that quietly edits the code it judges
   has stopped being a review.

## Done when
- The trust boundaries the change crosses are named, each class was checked against
  the real code with evidence, no secret or unguarded destructive path rides along,
  and a ranked findings list ends in a ship / fix-then-ship / block verdict — with no
  code changed by the review itself.

<!-- INCLUDE: skills/_self-improvement.md -->
