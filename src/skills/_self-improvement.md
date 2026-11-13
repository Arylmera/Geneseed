## Self-improvement

<!-- LEAN:begin -->
This {{SKILL}} keeps its own notes in `{{PATH_NOTES}}/skill-notes/<name>.md`,
`<name>` being this {{SKILL}}'s name. When that file exists, read it before the
first step — where it disagrees with this file, the notes win. They are yours to
write, and no rebuild touches them.

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Write the exact correction (trigger, procedure, or
  done-when) into the notes file on your own, with no prompt, as one line:
  `- [skill|general] <correction> [— situation: <when it applies>] — seen: <what happened, against what you expected> (<date>)`.
  `situation:` bounds where the correction holds; `seen:` is the evidence it is
  later judged by; `general` marks one that would fix other {{SKILLS}} too. Never
  edit this file: it is a rendered copy, a rebuild overwrites it. A bundled script
  that is broken is the one exception: fix it in place, and tell the user which
  file you changed. `geneseed diff` carries the notes back to the source;
  folding a note into the source is the user's call, through the skill-forge
  {{SKILL}} ({{LAW:one-intent-one-act}}).
- Keep the notes sharp: amend or delete a line before adding one — a line with no
  `seen:`, or whose `seen:` no longer happens, goes first — and prune past about
  twenty lines.
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{DOCTRINE:persist-insight}}'s bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
<!-- LEAN:else -->
One beat of reflection on this {{SKILL}}: a step that misled, a missing step, or a
wrong trigger is a flaw in this file — write the exact correction on your own, with no
prompt, into `{{PATH_NOTES}}/skill-notes/<name>.md` (`<name>` is this {{SKILL}}'s
name) as `- [skill|general] <correction> [— situation: <when it applies>] — seen: <what happened vs expected> (<date>)`,
never into this rendered file, which a rebuild overwrites. A bundled script that is
broken is the one exception: fix it in place, and tell the user which file you
changed. Folding a note into the source is the user's call ({{LAW:one-intent-one-act}}).
Read that notes file before the first step when it exists; it wins where it disagrees.
Keep it short. A lesson that is not about this file goes to {{MEMORY}} only if it
clears {{DOCTRINE:persist-insight}}'s bar. Nothing learned — move on.
<!-- LEAN:end -->
