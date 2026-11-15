## Self-improvement

<!-- LEAN:begin -->
This {{SKILL}} keeps notes in two scopes. Machine notes, true in every repo:
`{{PATH_NOTES}}/skill-notes/{{SKILL_NAME}}.md`, beside `{{PATH_NOTES}}/skill-notes/_general.md`,
which every {{SKILL}} shares. Project notes, true only in this repo: the same two files under
`{{PATH_PROJECT_NOTES}}/skill-notes/` at the project root (in a linked worktree, the main
checkout's). Read the four in that order, when they exist, before the
first step — where they disagree with this file, the notes win, and the project notes
win over the machine notes. No rebuild touches them.

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. End your reply with one line that names it, at the start
  of a line and outside any code:
  `spec-feedback: [skill:{{SKILL_NAME}}] <the one-line fix> [— situation: <when it applies>] — seen: <what happened, against what you expected>`.
  `situation:` bounds where the fix holds; `seen:` is the evidence it is later
  judged by. Ask one question first: is it true in any repo, or only here? Any repo:
  `[skill:{{SKILL_NAME}}]`, or `[skill:{{SKILL_NAME}}:general]` for a fix other {{SKILLS}} need
  too. Only here: `[skill:{{SKILL_NAME}}:project]`, or `[skill:{{SKILL_NAME}}:general:project]`.
  When the turn ends, the harness hook copies the line, dated, into the notes —
  no model call, so do not write the notes file yourself. On Bob, whose hook never
  sees your reply, append it yourself: `- [skill] <the fix> … (<date>)` to the machine
  or the project `skill-notes/{{SKILL_NAME}}.md` above, or `- [general] <the fix> … ({{SKILL_NAME}}, <date>)` to
  that scope's `skill-notes/_general.md`; amend or delete a stale line before adding one, and keep
  each file under about twenty lines.
  Never edit this file: it is a rendered copy, a rebuild overwrites it. A bundled
  script that is broken is the one exception: fix it in place, and tell the user
  which file you changed. `geneseed diff` carries the notes back to the source;
  folding a note into the source is the user's call, through the skill-forge
  {{SKILL}} ({{LAW:one-intent-one-act}}).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{DOCTRINE:persist-insight}}'s bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — no line; this loop earns no ceremony. Most
  runs end here.
<!-- LEAN:else -->
Before the first step read, when they exist, the machine notes
`{{PATH_NOTES}}/skill-notes/{{SKILL_NAME}}.md` and `{{PATH_NOTES}}/skill-notes/_general.md`, then the
same two project notes under `{{PATH_PROJECT_NOTES}}/skill-notes/` at the project root (a linked
worktree: the main checkout's). Notes win over this file, project notes over machine notes.
One beat of reflection on this {{SKILL}}: a step that misled, a missing step, or a wrong
trigger is a flaw in this file — end your reply with one line, at a line start and outside any code,
`spec-feedback: [skill:{{SKILL_NAME}}] <the one-line fix> [— situation: <when it applies>] — seen: <what happened vs expected>`.
True in any repo, or only here? Any repo: `[skill:{{SKILL_NAME}}]`, or `[skill:{{SKILL_NAME}}:general]`
for a fix other {{SKILLS}} need too; only here: `[skill:{{SKILL_NAME}}:project]`, or
`[skill:{{SKILL_NAME}}:general:project]`. The hook copies it into
the notes when the turn ends; do not write them yourself, except on Bob, whose hook never
sees the reply: there append `- [skill] <the fix> … (<date>)` to the machine or the project
`skill-notes/{{SKILL_NAME}}.md`, or `- [general] <the fix> … ({{SKILL_NAME}}, <date>)` to that scope's
`skill-notes/_general.md`, pruning stale lines first. Never edit this rendered file; a broken bundled script is the one
exception: fix it in place, and tell the user which file you changed. Folding a note
into the source is the user's call ({{LAW:one-intent-one-act}}). A lesson that is not
about this file goes to {{MEMORY}} only if it clears {{DOCTRINE:persist-insight}}'s bar.
Nothing learned — no line.
<!-- LEAN:end -->
