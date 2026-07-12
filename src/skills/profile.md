# {{SKILL}}: profile

> {{DESC_PROFILE}}

**Trigger:** the user wants the agent to know who they are — "set up my profile",
"create my profile", "update my profile" — a fresh install whose `PROFILE.md` is
still the untouched stub, or an existing profile visibly contradicts how the user
now works.

## Procedure
1. Locate `PROFILE.md` beside the deployed AGENT.md and read it ({{LAW}} III — the
   real current file, not a remembered copy). The build seeds it once and never
   overwrites it; if it is genuinely absent, start from the stub's three sections
   (below) and note that a rebuild would have seeded it.
2. **Interview, don't infer.** Ask short, concrete questions a few at a time —
   a conversation, not a form dump — covering the stub's three sections:
   - **Who I am** — role, domains known deeply, domains being learned, what they
     usually come here to do.
   - **How I work** — stack, shell, environment, conventions they hold to, the
     things that reliably annoy them.
   - **Register preferences** — terse or expansive, teach-me or just-do-it, how
     much pushback they want, the language(s) they think in.
   What the session has already shown — their tone, their corrections — may be
   offered back as a *proposal to confirm*, never written as a silent conclusion.
   Every section is optional: a declined question is dropped, not padded.
3. **Keep identity and rules apart.** When an answer is really a standing rule
   ("never push without asking"), route it to `user-rules.md` via the rule
   {{SKILL}} and say so — the profile colours how
   you work, it never binds. A durable project fact belongs in {{MEMORY}}, not here.
4. Draft the profile in the stub's shape — the `##` sections above, short plain
   prose, no placeholders left standing. Keep it lean: a profile is read every
   session, and bloat dilutes the parts that matter.
5. Show the full draft and wait for explicit consent ({{LAW}} IV) before writing
   `PROFILE.md`. Remind the user the file is theirs — hand-editable any time, and
   it survives updates, rebuilds, and theme switches.

**Refresh flow** (on request, or when the profile has drifted): read the current
file, name the drift plainly, and propose the specific edits — same consent gate
as creation, and never discard a section the user wrote by hand.

## Done when
- `PROFILE.md` holds a consented, current picture of who the user is and how they
  like to work — with anything that was really a rule or a fact routed to
  `user-rules.md` or {{MEMORY}} instead — or the user declined, and the file is
  untouched.

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
