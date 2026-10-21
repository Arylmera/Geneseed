# {{SKILL}}: rule

> {{DESC_RULE}}
<!-- aliases: consolidate-memory -->

{{CREDIT:mattpocock-skills-2509:skills/engineering/retro/SKILL.md}}

**Trigger:** the user says "always…", "never…", "from now on…" or "remember that…". Anything the user wants to outlive this session counts: a standing rule ("make that a
rule") or a durable fact ("note that…", "keep in mind…"). Also fires when a
`feedback` {{MEMORY}} lesson keeps recurring and deserves promotion, or when
`user-rules.md` needs review — a trial rule past its date, a stale rule, a bloated
set. Nothing reaches `user-rules.md` or {{MEMORY}} except through here ({{DOCTRINE:persist-insight}}).
It also tends the {{MEMORY}} set as a whole — run the **consolidation flow**, not the
fork — when the index outgrows one useful read (~40 lines) or holds duplicate,
contradictory or stale entries (a file, flag or command that no longer exists), after
a release or large refactor, or when the user says "clean up memory", "consolidate",
"what do you actually remember". The user's wiki is the [wiki {{SKILL}}](wiki.md)'s.

## Procedure

### 0 — The fork
Ask first, always: **a standing rule, or a fact to remember?** Never infer it. The
two stores bind differently and the choice belongs to the user. If they hesitate,
draw the line in one sentence: a rule changes how you *act* and binds every future
session; a memory records something *true* that would otherwise be lost or
re-derived. Then take exactly one branch.

### Branch A — a fact to remember
1. Search {{MEMORY}} for a file that already covers it. If one exists, merge into it —
   keep what is still true, add or correct the rest — never mint a twin. If the new
   fact proves the old one wrong, archive the old one (move it into `archive/`).
2. Ask which **binding force** the fact carries, in plain words, not jargon:
   *imposed by you, not mine to relax* (`constraint`) · *a choice taken among real
   alternatives* (`choice`) · *a stance I hold until evidence overturns it*
   (`conviction`) · *a constraint you deliberately relaxed* (`tempered`).
3. Infer the `type` (`user` | `feedback` | `project` | `reference`), draft the file
   per the {{MEMORY}} convention, and **show the exact content, frontmatter
   included** — so a wrong inference is visible before it is written, not after.
4. On the user's word, write the file and rebuild the index
   (`geneseed learn --consolidate --memory <the {{DIR_MEMORY}}/ dir's path>`) so its line
   lands in `topics/<topic>.md` and the `MEMORY.md` map recounts.

### Branch B — a standing rule
1. **Triage.** A rule earns its place only if it is all three of: *standing
   behaviour* (how to act — a fact belongs in Branch A, a pointer to documentation
   in `context.json`), *recurring* (it will bind many future tasks, not just this
   one), and *not already covered* (not a {{LAW}}, not an existing rule — extend
   the existing rule rather than minting a twin). A *mechanical* rule — a banned
   API, an import shape, a file location — belongs in a lint, hook or CI check the
   team shares, not in prose. Read the repo's own check scripts and CI workflow first —
   a check that exists but is unwired or silently broken is the finding, not a new one —
   then propose the cheapest of a custom lint rule, a pre-commit hook or a CI job; a repo
   with no such guardrail is itself a finding. A criterion that only matters when *judging* work goes to
   `REVIEW.md` through the [review-response {{SKILL}}](review-response.md), not here.
   A failed triage goes back to the
   fork, named and explained; a lean rule set is the feature, not a failure.
2. **Reformulation.** Have the user state the rule as they would to a colleague on
   their first day. Interrupt the moment they (a) use a term they cannot themselves
   unpack, (b) skip a step — it says what to do but not when it bites, or the
   reverse — or (c) simplify so far that the rule becomes false. Name which of the
   three it was, each time. Then ask only about the axes still open — scope,
   trigger, action, conflict, cost — one question at a time.
3. **The counter-example.** Always, even for a rule that came out clean: build the
   case where this rule would do harm, put it to the user, and make them choose —
   accept it ("yes, even there") or narrow the rule. A rule that cannot survive its
   own worst case was never generic, only never contradicted.
4. **Legality.** A user rule may *tighten* a {{LAW}}, never repeal or weaken one.
   If the rule conflicts — "push without asking", "skip the tests" — refuse, cite
   the {{LAW}} it would repeal, and offer the nearest compliant version. Never write
   rules into the {{ONTOLOGY}}, {{LAWS}}, or {{DOCTRINES}} files themselves: they are
   regenerated on every update and the edit would be silently lost.
5. **Destination.** Scope decides the file: a rule that holds across all the user's
   work goes to the *global* install's `user-rules.md`, a rule bound to this
   codebase to the project's. Read the target first ({{LAW:verify-before-asserting}} — the real current
   rules, not a remembered copy). The build seeds it once and never overwrites it;
   if it is genuinely absent, create it with a `# User rules` header and note that a
   rebuild would have seeded it.
6. **Draft in the file's own format**: the next free `## R<n> — Title` heading, an
   optional `(scope: user|project | source: …)` metadata line, then the rule in one
   short paragraph, plain and testable. For a rule the user stated, `source:` keeps
   their own words and the day they said them — `source: user 2026-10-16 "never push
   red"` — one sentence at most: it is what later tells a stale rule from a changed
   mind. The metadata line splits on `|`, so write any `|` inside the quote as `/` and
   say so when you show the draft. For a promotion from {{MEMORY}}, set
   `source:` to the memory's name and add `trial until:` about a month out — a
   promoted rule starts on probation.
7. Show the exact text to the user and wait for explicit consent ({{LAW:deletion-is-deliberate}}) before
   appending it. For a promotion, after the rule lands, archive the source memory into
   `archive/` (with the same consent) so the lesson is not loaded twice.
8. **Keep the set lean.** After writing, if the file holds more than ~15 rules or
   any rule no longer changes behaviour, say so and propose merges or prunes — every
   rule is loaded every session, and a bloated set dilutes the rules that matter.

The asymmetry is deliberate: Branch A costs one question, Branch B costs several.
The price is the safeguard — make remembering cheap and legislating expensive, or
the user picks "rule" out of impatience and the set inflates.

**Review flow** (on request, or when a `trial until:` date has passed): for each rule
due, ask whether it actually fired since adoption — graduate it (drop the trial
marker), demote it back to a {{MEMORY}} fact, or delete it. Same consent gate as
adoption. Two more cases are due at any time:
- **Contradicted.** The user's later words contradict a rule: the rule is the suspect.
  Quote both — its `source:` and the new words — and ask which stands.
- **Broken while only read.** A rule nothing checks but reading it, broken twice
  anyway, is step 1's mechanical case: propose the hook or check rather than
  rewording it.

**Consolidation flow** → read [rule/consolidate.md](rule/consolidate.md) and follow it.

## Done when
- For a rule or memory: the fork was put to the user, and then either a {{MEMORY}} file exists carrying its
  `force`, its `type` and its index line — or a rule stands in the right
  `user-rules.md`, having survived reformulation, its own counter-example and the
  {{LAWS}}, consented to explicitly, with any promoted source memory archived. The
  {{ONTOLOGY}}, {{LAWS}} and {{DOCTRINES}} files are untouched either way.

<!-- INCLUDE: skills/_self-improvement.md -->
