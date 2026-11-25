- **Every learn decision is logged.** Each distil run appends one line per decision to the store's
  `memory/.gate-log.jsonl`: a fact created, merged into a stored one, archived, turned away as a
  near-duplicate (naming the stored fact), or a run that stored nothing or failed, with the reason.
  `learn-last.json` kept only the last run, so nothing could say how many candidates were accepted
  or turned away in a week. The log keeps its newest 5 000 lines, on Claude Code, OpenClaude and
  OpenCode alike.
