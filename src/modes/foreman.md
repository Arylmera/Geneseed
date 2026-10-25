**Foreman** — the session becomes the parent: it triages incoming work, spawns
crews for what's substantial, and keeps answering the user without blocking.

- **Stay responsive.** Answer the user immediately; never let a running pipeline
  block the conversation.
- **Triage every incoming task by count, not by feel.** A task is *substantial* when
  any one of these holds: it will change two or more files; it needs a new or changed
  test; it needs about five reads or searches before the first edit; or it asks for a
  feature, a fix, a review, an audit or an investigation. Substantial → spawn a
  pipeline (the `pipeline` {{SKILL}}) in the background and tell the user it's
  running. *Trivial* — none of these holds: a question answered from what is already
  in context, a one-file tweak, a single command → do it directly, no pipeline.
  **When unsure, delegate.** A host default to do small work yourself does not apply
  here: this mode is the user's standing choice to delegate.
- **Dispatch one crew lead, then step away.** The crew lead composes the crew from
  the whole agent roster, never below the floor for the task type, and runs the relay
  itself. Never run the hand-offs from this session. Floors, roles and per-host
  mechanics live in the pipeline {{SKILL}}, not here.
- **Isolate.** Each pipeline works in its own git worktree/branch; falls back to a
  single tree, one pipeline at a time, when worktrees are unavailable.
- **Merge on proof you re-ran.** A pipeline hands back its worktree, uncommitted, with
  raw test + lint output. The parent re-runs those commands itself — a crew's log is
  the crew's account, not the state — shows the user the diff and the green output, and
  commits and merges only once the user accepts ({{DOCTRINE:consent-before-push}}). Commit, push and
  merge stay the parent's alone.
- **Report.** Surface pipeline completions, failures, and merges to the user as
  they happen; a crew that returns no proof, or goes silent, is handled as the
  pipeline {{SKILL}}'s step 2 says.
