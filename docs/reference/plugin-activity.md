---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 19
title: "geneseed-activity"
description: "Feeds the web console's Activity view, one small file per session."
---
One of the [OpenCode plugins](opencode-plugins.md). [Environment variables](environment.md) points here for its switches.

**What it does.** Feeds the web console's **Activity** view: one small JSON file per session under `activity/` beside OpenCode's config, recording what the session is doing — phase, model, token and cost totals, files touched, plan, last error. The console only reads those files; the two only meet on disk, so a crash on either side never blocks a session.

**When it runs.** On session events, for top-level sessions only (sub-agents and learn's sessions are skipped). A session whose process died, went stale (30 minutes untouched) or ended leaves the live list and is listed as ended; the reader never deletes a file.

**Claude Code, OpenClaude and Bob.** Their hooks write the same files into `activity/` beside the install (`~/.claude/activity/`, `<repo>/.claude/activity/`, `~/.bob/activity/`). No hook is added per tool call: the writer runs after the hooks that already run — the gates, `context` and `learn` — plus `geneseed-hook activity` on `UserPromptSubmit` and, on Claude Code and OpenClaude, `SessionEnd`. So a Claude session's phase moves on the gated tools (`Bash`, `PowerShell`, `Write`, `Edit`, `NotebookEdit`, `Skill`, `Agent`, `Task`), and the rest of the turn — every tool call, the model, the token totals, the last reply — arrives at `Stop`, read from the transcript where the previous `Stop` left off (at most 2 MB per turn). Bob sends no transcript, so a Bob session shows only the calls its `tool-gate` sees, and leaves the live list by staleness alone (Bob has no `SessionEnd`). Bob's `SessionStart` is not recorded either — whether Bob pipes a payload there is unverified, and reading one that never closes would hold the session's start — so a Bob session first appears at its first prompt or tool call. These writers have no resident process, so their snapshots carry `pid: null` and stay live by staleness alone. Recorded: tool names, file basenames, line counts, todo text, and 240-character snippets of the prompt and the last reply — never a shell command, a file's content or an edit's text — and any credential the secrets gate would catch in a snippet is written as `[redacted]`. A project install's `activity/` gets its own `.gitignore` (`*`), and the writer never writes through, or sweeps, an `activity/` or `activity/archive/` that is a link. Nothing is recorded in a repo listed in `excludes.json`, or inside a model CLI that `learn` started.

**Archive.** On `SessionStart` and `SessionEnd` the hook writer moves every snapshot that is no longer live into `activity/archive/`, keeping the newest 50 and none older than 7 days. `/api/activity` returns them, with the stale and dead ones still in `activity/`, in its `ended` list — capped there by the same rule, since the OpenCode plugin never sweeps.

**What you see.** A card per live session in **Activity** (`geneseed web`).

**Switches.**
- `GENESEED_ACTIVITY=off` — kill switch: at startup for the plugin, on every call for the hooks (which then load no writer code at all).
- The Activity page's own toggle writes a `.geneseed-activity` flag file, read per event — no restart needed.
- `GENESEED_DEBUG=1` — logs each write as `[geneseed-activity] …`.
