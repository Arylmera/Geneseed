## Self-improvement

If this spec misled you — an input you needed but were not given, a boundary
that proved wrong, a step you could not execute — end your report with one line:
`spec-feedback: [agent|general] <the one-line fix> [— situation: <when it applies>] — seen:
<what happened, against what this spec led you to expect>`. `general` marks a fix other
{{AGENTS}} need too. Omit the line when there is no friction. When the run ends, the
harness hook copies each line, dated, into `{{PATH_NOTES}}/agent-notes/<name>.md`, and a
`general` line also into `agent-notes/_general.md` — no model call, and never into this
rendered file, which a rebuild overwrites. Step 0 reads those notes at every later dispatch
of this {{AGENT}}. The caller writes no note itself, except on a host with no
subagent-finished hook (Bob), where it copies the line there in the same form. It weighs the line, and folding a note
into the source is the user's call, after the skill-forge {{SKILL}}'s probe. It records the
feedback to {{MEMORY}} only if it clears {{DOCTRINE:persist-insight}}'s bar — most reports
carry no feedback at all.
