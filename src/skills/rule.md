# {{SKILL}}: rule

> {{DESC_RULE}}

**Trigger:** anything the user wants to outlive this session — a standing rule of
their own ("always…", "never…", "from now on…", "make that a rule") or a durable
fact ("remember that…", "note that…", "keep in mind…"). Also fires when a
`feedback` {{MEMORY}} lesson keeps recurring and deserves promotion, or when
`user-rules.md` needs review — a trial rule past its date, a stale rule, a bloated
set. Nothing reaches `user-rules.md` or {{MEMORY}} except through here ({{LAW}} VI).

## Procedure

### 0 — The fork
Ask first, always: **a standing rule, or a fact to remember?** Never infer it. The
two stores bind differently and the choice belongs to the user. If they hesitate,
draw the line in one sentence: a rule changes how you *act* and binds every future
session; a memory records something *true* that would otherwise be lost or
re-derived. Then take exactly one branch.

### Branch A — a fact to remember
1. Search {{MEMORY}} for a file that already covers it. If one exists, update that
   file — never mint a twin.
2. Ask which **binding force** the fact carries, in plain words, not jargon:
   *imposed by you, not mine to relax* (`constraint`) · *a choice taken among real
   alternatives* (`choice`) · *a stance I hold until evidence overturns it*
   (`conviction`) · *a constraint you deliberately relaxed* (`tempered`).
3. Infer the `type` (`user` | `feedback` | `project` | `reference`), draft the file
   per the {{MEMORY}} convention, and **show the exact content, frontmatter
   included** — so a wrong inference is visible before it is written, not after.
4. On the user's word, write the file and add its one-line entry to `MEMORY.md`.

### Branch B — a standing rule
1. **Triage.** A rule earns its place only if it is all three of: *standing
   behaviour* (how to act — a fact belongs in Branch A, a pointer to documentation
   in `context.json`), *recurring* (it will bind many future tasks, not just this
   one), and *not already covered* (not a {{LAW}}, not an existing rule — extend
   the existing rule rather than minting a twin). A failed triage goes back to the
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
   rules into the {{LAWS}} file itself: it is regenerated on every update and the
   edit would be silently lost.
5. **Destination.** Scope decides the file: a rule that holds across all the user's
   work goes to the *global* install's `user-rules.md`, a rule bound to this
   codebase to the project's. Read the target first ({{LAW}} III — the real current
   rules, not a remembered copy). The build seeds it once and never overwrites it;
   if it is genuinely absent, create it with a `# User rules` header and note that a
   rebuild would have seeded it.
6. **Draft in the file's own format**: the next free `## R<n> — Title` heading, an
   optional `(scope: user|project | source: …)` metadata line, then the rule in one
   short paragraph, plain and testable. For a promotion from {{MEMORY}}, set
   `source:` to the memory's name and add `trial until:` about a month out — a
   promoted rule starts on probation.
7. Show the exact text to the user and wait for explicit consent ({{LAW}} IV) before
   appending it. For a promotion, after the rule lands, delete or archive the source
   memory (with the same consent) so the lesson is not loaded twice.
8. **Keep the set lean.** After writing, if the file holds more than ~15 rules or
   any rule no longer changes behaviour, say so and propose merges or prunes — every
   rule is loaded every session, and a bloated set dilutes the rules that matter.

The asymmetry is deliberate: Branch A costs one question, Branch B costs several.
The price is the safeguard — make remembering cheap and legislating expensive, or
the user picks "rule" out of impatience and the set inflates.

**Review flow** (on request, or when a `trial until:` date has passed): for each rule
due, ask whether it actually fired since adoption — graduate it (drop the trial
marker), demote it back to a {{MEMORY}} fact, or delete it. Same consent gate as
adoption.

## Done when
- The fork was put to the user, and then either a {{MEMORY}} file exists carrying its
  `force`, its `type` and its `MEMORY.md` line — or a rule stands in the right
  `user-rules.md`, having survived reformulation, its own counter-example and the
  {{LAWS}}, consented to explicitly, with any promoted source memory archived. The
  {{LAWS}} file is untouched either way.

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
