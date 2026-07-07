# {{SKILL}}: rule

> {{DESC_RULE}}

**Trigger:** the user wants a standing rule of their own ("always…", "never…", "from now on…", "make that a rule"), a `feedback` {{MEMORY}} lesson keeps recurring and deserves promotion, or `user-rules.md` needs review — a trial rule past its date, a stale rule, a bloated set.

## Procedure
1. Locate `user-rules.md` beside the deployed AGENT.md and read it ({{LAW}} III — the
   real current rules, not a remembered copy). The build seeds it once and never
   overwrites it; if it is genuinely absent, create it with a `# User rules` header
   and note that a rebuild would have seeded it.
2. **Triage before drafting** — a rule earns its place only if it is all three of:
   *standing behaviour* (how to act, not a fact — a fact belongs in {{MEMORY}}, a
   pointer to documentation belongs in `context.json`), *recurring* (it will bind
   many future tasks, not just this one), and *not already covered* (not a {{LAW}},
   not an existing rule — extend the existing rule rather than minting a twin).
   When the request fails triage, route it to the right store, say where it went
   and why, and stop — a lean rule set is the feature, not a failure.
3. **Check it against the {{LAWS}}**: a user rule may *tighten* a {{LAW}}, never
   repeal or weaken one. If the proposed rule conflicts — "push without asking",
   "skip the tests" — refuse, cite the {{LAW}} it would repeal, and offer the
   nearest compliant version. Never write rules into the {{LAWS}} file itself: it
   is regenerated on every update and the edit would be silently lost.
4. **Draft in the file's own format**: the next free `## R<n> — Title` heading, an
   optional `(scope: user|project | source: …)` metadata line, then the rule in one
   short paragraph, plain and testable. For a promotion from {{MEMORY}}, set
   `source:` to the memory's name and add `trial until:` about a month out — a
   promoted rule starts on probation.
5. Show the exact text to the user and wait for explicit consent ({{LAW}} IV) before
   appending it. For a promotion, after the rule lands, delete or archive the source
   memory (with the same consent) so the lesson is not loaded twice.
6. **Keep the set lean.** After writing, if the file holds more than ~15 rules or
   any rule no longer changes behaviour, say so and propose merges or prunes — every
   rule is loaded every session, and a bloated set dilutes the rules that matter.

**Review flow** (on request, or when a `trial until:` date has passed): for each rule
due, ask whether it actually fired since adoption — graduate it (drop the trial
marker), demote it back to a {{MEMORY}} fact, or delete it. Same consent gate as
adoption.

## Done when
- The rule stands in `user-rules.md` in the standard shape, consented to explicitly,
  with any promoted source memory archived — or the request was routed to {{MEMORY}}
  or `context.json` with the reason stated. The {{LAWS}} file is untouched either way.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
