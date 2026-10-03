---
group: reference
order: 5
title: "OpenCode plugins"
kind: "concept"
---
On OpenCode, Geneseed's automation runs as {N_PLUGINS} plugins: small JavaScript files OpenCode loads from its `plugins/` directory at startup. They are what turns a rule from *asked* into *enforced* — the context load, the safety gates, memory distillation. On Claude Code, Bob and OpenClaude the same jobs are done by hooks instead (see [Hooks](../concepts/hooks.md)).

> **You already know this:** a plugin is a git hook for your agent — code that runs on an event (session start, before a tool call, session idle), not text the model may or may not follow.

Every plugin installs in the same step as the rest of the harness: `geneseed setup`, or `geneseed build --emit opencode-global` (global, into `~/.config/opencode/plugins/`) / `--emit opencode` (per-repo, into `.opencode/plugins/`). Installing by hand is covered in [Install](../guides/install.md). Keep **one** copy of each: OpenCode loads two local copies of the same plugin twice.

Every plugin swallows its own errors — none can block or crash a session. Each variable below is also listed in [Environment variables](environment.md).

## geneseed-context

**What it does.** Puts your project's documentation (and your machine wiki) into the agent's context before your first turn, so the agent never has to be trusted to read it. It needs **no per-repo file**: it discovers docs by convention.

- **Injected in full (eager):** root `README.md`, `CONTRIBUTING.md`, `.cursorrules`, `user-rules.md`, `PROFILE.md`. Budget-capped; an oversized file is listed instead, never silently truncated. (`AGENT.md`, `AGENTS.md` and `CLAUDE.md` are not injected — OpenCode already loads them.)
- **Listed (lazy, path + first heading, read on demand):** `docs/`, `doc/`, `documentation/`, `architecture/`, `adr/`, and `packages/*/README.md` / `apps/*/README.md` in a monorepo. `node_modules`, `.git`, `dist`, `build`, `vendor` and similar are never scanned.
- **Machine wiki:** the wikis declared in `wiki.jsonc` ride in the same block, on the same budgets. See [Wiki](../guides/wiki.md).
- **Explicit manifest:** `$GENESEED_CONTEXT`, `.harness/context.json` or a root `context.json` takes over from discovery; `"extend": true` layers it on top instead. See [Project context](../guides/project-context.md).

**When it runs.** On every request: the context rides invisibly in the request's message list, so it also survives compaction. If your OpenCode build lacks that (experimental) hook, the plugin notices and falls back to one visible message at session start, re-pushed when the session compacts.

**What you see.** Normally nothing — the context is there, but not shown. With the visible fallback, a `PROJECT CONTEXT` block at the top of the session.

**Switches.**
- `GENESEED_CONTEXT_INJECT=off` — no injection; the agent is only *asked* to read the docs.
- `GENESEED_CONTEXT_VISIBLE=1` — force the visible block (legacy `GENESEED_CONTEXT_TRANSFORM=0` does the same).
- `GENESEED_EAGER_FILE_KB` / `GENESEED_EAGER_TOTAL_KB` (default 16 / 48), `GENESEED_LAZY_HEADINGS` (64), `GENESEED_WIKI_LAZY_LIMIT` (200) — budgets.
- `GENESEED_WIKI` — explicit `wiki.jsonc` path.
- `GENESEED_DEBUG=1` — log what it discovered and injected to stderr. Silence with this set means the plugin did not load.

## geneseed-guard

**What it does.** Enforces the safety rules at the tool boundary — before a tool call runs, not after. High-confidence patterns only, so legitimate work is not caught.

- **Blocks** writes to private-key and credential files (*Sealed Secrets*), catastrophic shell commands such as deleting the filesystem root (*Deletion Is Deliberate*), and any change — write, move, rename, delete — under a wiki folder declared `protected` in `wiki.jsonc`.
- **Warns** (logged, allowed) on `.env` writes and force-push.
- **Speed-bumps** the *first* write to `user-rules.md` or a memory file: it is refused once, naming *Persist Insight* — whether something is a standing rule or a fact to remember is your call, settled through the `rule` skill. The re-issued write goes through.

It ships whole on every install, whatever [doctrine packs](../concepts/rules.md) you chose. On Claude Code and Bob the same checks are hooks, which can *ask* you instead of refusing; OpenCode's tool hook has no ask tier. Protected wiki folders are enforced only here — on the other hosts they are an instruction.

A `permission.ask` hook lets through only a fixed set of commit/push forms on a `loop/*` branch with a running loop — anything else still asks, same as the Claude/Bob git-gate's loop/* exemption.

**When it runs.** Before every tool call (`tool.execute.before`), and before a static `permission.bash` ask is shown to you (`permission.ask`).

**What you see.** A refused tool call: `[geneseed-guard] blocked: <reason> — set GENESEED_GUARD=off to allow`. Warnings go to stderr.

**Switches.**
- `GENESEED_GUARD=warn` — log every block, allow the call.
- `GENESEED_GUARD=off` — disable the guard.

## geneseed-learn

**What it does.** Distils durable memories from the conversation into the install's `memory/` directory and keeps `MEMORY.md` up to date, de-duplicating against what is already stored. It is the OpenCode counterpart of the Claude Code `Stop` hook, but needs no API key and no model CLI: it distils with the **same model the session used**, through your OpenCode provider config. See [Memory](../concepts/memory.md).

**When it runs.** After the session goes quiet. OpenCode signals "idle" after every turn, so each idle re-arms a timer and the distil runs once nothing has happened for `GENESEED_LEARN_DEBOUNCE_MS` (default 60 s). Trivial sessions are skipped.

**What you see.** On stderr: `[geneseed-learn] wrote N memory file(s): …`, or `skipped: <reason>`. Total silence means it did not load.

**Where it writes** — the first that resolves:
1. `GENESEED_MEMORY` — an explicit memory dir;
2. `$GENESEED_HARNESS/memory` (`/anamnesis` for the imperial theme);
3. the `memory/` beside the plugin's own install (the global install's store);
4. `./memory` or `./Harness/memory`, when the bundle lives in the project.

So a global install needs nothing set; use `GENESEED_HARNESS` only to pin the location. If none resolves, it logs `no memory dir — set $GENESEED_HARNESS or $GENESEED_MEMORY.` and does nothing.

**Switches.**
- `GENESEED_MODEL=provider/model` — fallback when the session's model can't be read. Without it you get `could not determine a model`.
- `GENESEED_LEARN_DEBOUNCE_MS` — the quiet period.

## geneseed-workflow

**What it does.** Registers one tool, `workflow`, that runs saved orchestration scripts. The script — not the model — drives the control flow: the deterministic counterpart of the `council` and `parallel-agents` skills.

- **Saved scripts only.** It loads `<name>.js` from the `workflows/` directory beside `plugins/`; nothing the model writes is evaluated. Shipped: `council`, `dispatch`, `research-plan-implement`, `review`.
- **Call shape:** `workflow({ name, args })`; with no name it lists what is available.
- **Isolation:** a script can run a child agent in its own git worktree on its own branch. A worktree with no change is removed; one with changes is kept, and the summary lists every kept branch and every file more than one agent changed. Nothing is merged or committed for you. Without git, such a child fails rather than falling back to the shared tree.

**When it runs.** When the agent calls the `workflow` tool — usually because you asked for one.

**What you see.** The tool's summary in the conversation. A phase-by-phase trace and the full result land in `.geneseed/workflow-runs/<runId>.log`.

**Switches.**
- `GENESEED_WORKFLOWS_DIR` — load scripts from another directory.
- `GENESEED_DEBUG=1` — log to stderr.

Ask the agent to *"list available workflows"* to check it loaded.

## geneseed-notify

**What it does.** Sends a native desktop notification when the agent finishes a long turn, so you can start a run, walk away, and be called back. macOS uses `osascript`, Linux `notify-send` (install `libnotify` if nothing appears), Windows a PowerShell balloon.

**When it runs.** When a session goes idle, and only if the turn took longer than `GENESEED_NOTIFY_MIN_SECONDS` (default 30) since your last prompt. Sub-agent sessions and the learn plugin's own sessions are skipped.

**What you see.** A notification titled `Geneseed`. With `GENESEED_DEBUG=1`, `[geneseed-notify] notified for …` on stderr.

**Switches.**
- `GENESEED_NOTIFY=off` — disable.
- `GENESEED_NOTIFY_MIN_SECONDS=N` — threshold (`0` = every turn).
- `GENESEED_NOTIFY_TITLE="…"` — the title.

## geneseed-ponytail

**What it does.** Holds an opt-in minimal-code mode: once on, it appends the "laziest solution that works" ruleset to the system prompt **every turn**, so the agent doesn't drift back to over-building mid-session. It is the sustained form of the `ponytail` skill, and it is not part of the [rules](../concepts/rules.md): nothing about it applies until you switch it on.

**When it runs.** Every turn, while a level is set. It starts `off`.

**What you see.** Replies that favour the smallest working change. Switch with `/ponytail lite|full|ultra|off` (bare `/ponytail` means `full`); the level is saved to `.geneseed-ponytail` beside OpenCode's config and applies from the next turn. On an OpenCode build without the experimental system-prompt hook it never injects; the skill still works.

**Switches.**
- `GENESEED_PONYTAIL=lite|full|ultra` — the starting level (default `off`).
- `GENESEED_DEBUG=1` — logs `[geneseed-ponytail] ponytail <level>` on each switch.

## geneseed-activity

**What it does.** Feeds the web console's **Activity** view: one small JSON file per session under `activity/` beside OpenCode's config, recording what the session is doing — phase, model, token and cost totals, files touched, plan, last error. The console reads and prunes those files; the two only meet on disk, so a crash on either side never blocks a session.

**When it runs.** On session events, for top-level sessions only (sub-agents and learn's sessions are skipped). Entries whose process died or went stale are pruned by the reader.

**What you see.** A card per live session in **Activity** (`geneseed web`).

**Switches.**
- `GENESEED_ACTIVITY=off` — kill switch at startup.
- The Activity page's own toggle writes a `.geneseed-activity` flag file, read per event — no restart needed.
- `GENESEED_DEBUG=1` — logs each write as `[geneseed-activity] …`.

## Excluded folders

`geneseed-context`, `geneseed-guard` and `geneseed-learn` go dormant inside a folder listed in the global install's `excludes.json` (managed by `geneseed exclude`). See [Exclusions](../concepts/exclusions.md).
