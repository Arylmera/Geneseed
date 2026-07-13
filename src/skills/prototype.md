# {{SKILL}}: prototype

> {{DESC_PROTOTYPE}}

**Trigger:** a design question needs a runnable answer — "does this state
model feel right?" or "what should this look like?" — before committing to a
real implementation.

## Procedure
1. Name the question the prototype answers; the question decides the shape. A
   logic or state question → a tiny interactive terminal app that pushes the
   state machine through the cases that are hard to reason about on paper. A
   UI question → several radically different variations on one route,
   switchable at runtime. If ambiguous, pick from the surrounding code
   (backend module → logic; page or component → UI) and state the assumption.
2. Throwaway from day one, and marked as such: place it near the code it
   prototypes for, but name it so a casual reader sees it is not production.
   No persistence (state lives in memory), no tests, no error handling beyond
   what makes it runnable, no abstractions ({{LAW}} XXV).
3. One command to run, using the project's existing task runner — the user
   must be able to start it without thinking.
4. Surface the full relevant state after every action or variant switch, so
   the user sees exactly what changed.
5. When the question is answered: fold the validated decision into the real
   code, record the verdict and the question it settled (issue comment, ADR,
   or commit message), park the prototype on a throwaway branch, and keep the
   main branch clean of prototype code.

## Done when
- The question has a recorded verdict, the decision lives in the real code,
  and no prototype code remains on the main branch.

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
