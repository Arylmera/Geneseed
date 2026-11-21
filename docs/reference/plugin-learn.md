---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 15
title: "geneseed-learn"
description: "Distils durable facts into the memory store once a session goes quiet."
---
One of the [OpenCode plugins](opencode-plugins.md). Its switches are also listed in [Context and memory variables](env-context.md).

**What it does.** Distils durable memories from the conversation into the memory store and keeps its two-level index (`MEMORY.md` and `topics/`) up to date. It never writes a twin of a stored fact: it updates that fact with the merged text instead (keeping the old version in `memory/archive/`), and moves one the session proved obsolete into `memory/archive/`. It is the OpenCode counterpart of the Claude Code `Stop` hook, but needs no API key and no model CLI: it distils with the **same model the session used**, through your OpenCode provider config. See [Memory](../concepts/memory.md).

**When it runs.** After the session goes quiet. OpenCode signals "idle" after every turn, so each idle re-arms a timer and the distil runs once nothing has happened for `GENESEED_LEARN_DEBOUNCE_MS` (default 60 s). Each distil reads only the messages after the last successful one of that session (a per-session cursor kept in memory, so an OpenCode restart mines a reopened session once more), plus the two messages before them as marked context; new text under 200 characters is skipped. The model is shown the ten newest stored facts and the best BM25 matches for the new turns, inside 8 000 characters; a new fact that is a near-duplicate of a stored one is skipped and logged as `<slug>: near-duplicate of <stored>, skipped`.

**What you see.** `wrote N memory file(s): …` (or `updated` / `archived`), or `skipped: <reason>`: in OpenCode's own log on OpenCode 1 (service `geneseed-learn`), on stderr as `[geneseed-learn] …` on OpenCode 2. Total silence in that place means it did not load.

**Where it writes** — the first that resolves:
1. `GENESEED_MEMORY` — an explicit memory dir;
2. `$GENESEED_HARNESS/memory`;
3. the install's own target: a global install uses the shared store, `<machine dir>/memory`, when
   it exists, else the `memory/` beside the plugin; a project install uses its own `memory/`;
4. `./memory` or `./Harness/memory` in the repo, last, so a repo's own `memory/` folder never
   takes the facts of a global session.

The Stop hook of a global install passes `--memory <cfg>/memory` and `learn` swaps in the shared
store when it exists. A `--memory` you type yourself is never swapped: the swap applies only to a
hook call, which names its event. The plugin counts an install as global when its marker says so
or when it is the host's own config dir, as the hook does.

So a global install needs nothing set. `GENESEED_HARNESS` and `GENESEED_MEMORY` are deprecated, with removal planned for 6.0. If none resolves, it logs `no memory dir — this install has no memory/ folder, and neither does the shared tier or this repo.` and does nothing.

**A finished child session.** For a child session that names its agent, the plugin first copies the report's `spec-feedback:` lines into `agent-notes/<name>.md`, then appends one line to the install's `notebook/agent-runs.jsonl`: the day, the agent, its spec hash, its tool calls and refused calls, its feedback lines and whether it reported. The done-gate fields stay empty, because that gate is in the context plugin. The tool counts read the session's `tool` parts: on OpenCode 1 the whole child session; on OpenCode 2 the shape of `session.context()` tool parts is UNVERIFIED against a live host, so when no tool part it knows is seen, both counts are empty rather than 0. A refused call is one whose error opens with `[geneseed-guard] blocked:` (OpenCode 1) or `No tool named "BLOCKED, not a missing tool:` (OpenCode 2). It writes once per child session, at its first quiet period in each OpenCode process, only when that `notebook/` exists, and not with `GENESEED_NO_USAGE` set or a `.usage-off` file in the install. The install's `notebook/` is beside `plugins/` for a global install (`<config dir>/notebook`) and at the repo root for a project install (`<repo>/notebook`, not `<repo>/.opencode/notebook`). The spec-feedback notes follow each line's scope, as the Claude hook does: a machine line to the tier's `notes/`, a project line (`[agent:project]`, `[general:project]`, `[skill:<name>:project]`, `[skill:<name>:general:project]`) to `<project>/notebook/`, where the project is `<repo>` for a project install and the session root's git root for a global one. When a global and a project install both load, only one of them records a run, as for `usage.jsonl`. `geneseed catalog agents --scores` reads it. See [Agents](../concepts/agents.md).

**A skill's feedback line.** At the end of every turn (`session.idle` on OpenCode 1, `session.execution.succeeded` on OpenCode 2), not after the quiet period, the plugin reads the session's last reply and copies each `spec-feedback: [skill:<name>]` line into `skill-notes/<name>.md` (`[skill:<name>:general]` into `skill-notes/_general.md`) in the machine notes, or a `[skill:<name>:project]` line into the project's `notebook/skill-notes/<name>.md`, as for the agents' notes. A line counts only for a skill the install serves under that name (`skills/<name>/SKILL.md` beside `plugins/` names its own notes file); an untagged, `[agent]` or plain `[general]` line in a reply is a relayed sub-agent line and is not copied. On OpenCode 1 the turn's capture reads ONE message: the newest assistant message a `message.updated` event named, by `session.message`; only when no such event was seen (a plugin loaded mid-turn) does it read the session's messages once. On OpenCode 2 it reads `session.context()`, the messages since the last compaction, once per turn: V2 offers no single-message read the plugin knows of. Nothing is read in an install with no `skills/` folder or in an excluded folder. A line already in the notes is not added again. With a global and a project install both loaded, both copies resolve the same two notes files, so a line lands once: the duplicate check runs under the file lock (on Claude Code the global hook stands down instead). See [Skills](../concepts/skills.md).

**Switches.**
- `GENESEED_MODEL=provider/model` — fallback when the session's model can't be read. Without it you get `could not determine a model`.
- `GENESEED_LEARN_DEBOUNCE_MS` — the quiet period.
