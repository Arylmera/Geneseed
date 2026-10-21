## Self-improvement

If this spec misled you — an input you needed but were not given, a boundary
that proved wrong, a step you could not execute — end your report with one line:
`spec-feedback: [agent|general] <the one-line fix> — seen: <what happened, against
what this spec led you to expect>`. `general` marks a fix other {{AGENTS}} need too.
Omit the line when there is no friction. The caller weighs the feedback and, with the
user's assent, writes a real flaw, dated, into `{{DIR_NOTEBOOK}}/agent-notes/<name>.md`
— never into this rendered file, which a rebuild overwrites — and hands those notes
to every later dispatch of this {{AGENT}}. It records the feedback to {{MEMORY}} only if it clears
{{DOCTRINE:persist-insight}}'s bar — most reports carry no feedback at all.
