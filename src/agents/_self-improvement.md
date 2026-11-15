## Self-improvement

If this spec misled you — an input you needed but were not given, a boundary
that proved wrong, a step you could not execute — end your report with one line:
`spec-feedback: [agent|general] <the one-line fix> [— situation: <when it applies>] — seen:
<what happened, against what this spec led you to expect>`. Ask one question first: is it true
in any repo, or only here? Any repo: `[agent]`, or `[general]` for a fix other {{AGENTS}} need
too. Only here: `[agent:project]`, or `[general:project]`. Omit the line when there is no
friction. When the run ends, the harness hook copies each line, dated, into the machine notes
`{{PATH_NOTES}}/agent-notes/<name>.md` (a `general` line into `agent-notes/_general.md` there),
or a `project` line into `{{PATH_PROJECT_NOTES}}/agent-notes/` at the project root, the same two
files (in a linked worktree, the main checkout's) — no model call, and never into this rendered file, which
a rebuild overwrites. Step 0 reads those notes at every later dispatch of this {{AGENT}}, machine
first; the project notes win where they disagree. When a step-0 read is refused, or the brief
forbids that path, skip it, say so in one line of the report, and go on. The caller writes no
note itself, except on a host with no subagent-finished hook (Bob), where it copies the line
into the machine or the project file, in the same form. The caller
weighs the line, and folding a note into the source is the user's call, after the
skill-forge {{SKILL}}'s probe. The caller records the feedback to {{MEMORY}} only if it
clears {{DOCTRINE:persist-insight}}'s bar — most reports carry no feedback at all.
