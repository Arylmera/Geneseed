# How OpenCode loads a project

A reference for what OpenCode reads at startup, how Geneseed plugs into each
mechanism, and why a file can appear **listed twice**. Field names and event lists
are confirmed against the current OpenCode plugin + SDK docs; they can still shift
between versions, and the plugins degrade quietly if one does.

## 1. Config discovery & merge

OpenCode does not read a single config — it **merges several**:

- **Global:** `~/.config/opencode/opencode.json` (on Windows, the same homedir-relative
  path: `C:\Users\<user>\.config\opencode\opencode.json`).
- **Project:** `./opencode.json` or `./.opencode/opencode.json`, found by walking up
  from the current directory to the worktree root.
- Project config **overrides** global on direct conflicts.

It also auto-loads an **`AGENTS.md`** at the project root with no config at all.

Because these sources merge rather than replace, **anything referenced in two of
them loads from each** — which is exactly why a file can show up twice (see §6).

## 2. `instructions` — the rule/context files

The `instructions` array names files loaded into **every session** as ambient
rules. It accepts:

- absolute paths,
- repo-relative paths,
- globs (`"laws/*.md"`),
- URLs.

Geneseed points it at the bundle's **`AGENT.md`** (which inlines the laws). That is
all you need there — the rest of the harness is loaded by the plugins below.

## 3. Plugins — event-driven JS/TS

Plugins are **auto-loaded** from a plugins directory at startup. **No entry in
`opencode.json` is required** (the `"plugin"` array is only for *npm-package*
plugins). Local plugin directories:

- **Global:** `~/.config/opencode/plugins/`
- **Project:** `.opencode/plugins/`

The folder is **`plugins`** (plural), both `.js` and `.ts` are accepted, and it does
**not** exist by default — create it the first time.

A plugin is an async function that receives a context object and returns hook
implementations:

```js
export const MyPlugin = async ({ client, $, directory, worktree }) => ({
  event: async ({ event }) => {
    if (event.type === "session.idle") { /* … */ }
  },
})
```

- **`event({ event })`** — the catch-all; filter on `event.type`. Session events
  include `session.created`, `session.idle`, `session.updated`, `session.compacted`,
  `session.error`, plus `message.updated`, `tool.execute.before/after`, and more.
- **`client`** — the OpenCode SDK. Read a session's transcript with
  `client.session.messages({ path: { id } })` → `{ info, parts }[]`; inject context
  **without** triggering a reply with `client.session.prompt({ path, body: { noReply: true, parts } })`.
- **`$`** — a shell executor for running commands.

## 4. Subagents, skills & commands

Subdir names are **plural** canonically (`agents/`, `skills/`, `commands/`,
`plugins/`, …); singular (`agent/`, `command/`) is back-compat only.

- `.opencode/agents/<name>.md` → a **subagent** (frontmatter: `description`,
  `mode: subagent`, optional `permission:` to deny edit/bash/webfetch — Geneseed uses
  this to make read-only agents truly read-only, shell included).
- `.opencode/skills/<name>/SKILL.md` → a **native skill** (frontmatter: `name`,
  `description`) — model-invoked via the `skill` tool, progressive disclosure.
- `.opencode/commands/<name>.md` → a **slash command** (user-invoked `/name`).

Geneseed generates subagents and native skills from `src/` via `build.py --emit
opencode` (or globally with `--emit opencode-global`) — zero drift. It maps skills
to native **skills**, not slash commands (same `SKILL.md` shape as Claude Code).

## 5. How Geneseed maps onto OpenCode

| OpenCode mechanism | Geneseed piece |
| --- | --- |
| `instructions` → `AGENT.md` | the rules, loaded every session |
| `.opencode/agents/`, `.opencode/skills/` | capability agents and native skills |
| plugin on `session.created` | **context plugin (v2)** — auto-discovers & injects the repo's `eager` docs |
| plugin on `experimental.session.compacting` | **context plugin** — re-pushes the `eager` docs so they survive compaction |
| plugin on `session.idle` | **learn plugin** — distils memory into `memory/` (debounced to fire once, at session end) |
| plugin on `tool.execute.before` | **guard plugin** — blocks secret-file writes and catastrophic shell (Laws I & IV; `GENESEED_GUARD=off\|warn`) |
| plugin registering a custom tool | **workflow plugin** — the `workflow` tool runs saved orchestration scripts from `workflows/` |
| `context.json` / `.harness/` (manifest) | *optional* override when discovery doesn't fit |

## 6. "Why is `context.json` (or `AGENT.md`) listed twice?"

Because OpenCode **merges every `opencode.json` it finds** — global, project, and
any discovered while walking up the tree. If the same file is named in two
`instructions` arrays, it is loaded once **per source**. This is harmless (just
duplicated context), but to clean it up, name each file in **one** config only.

Geneseed's emit lists **only `AGENT.md`** in `instructions` (never `context.json` —
the context plugin handles project docs by auto-discovery), so the classic
"manifest listed twice" no longer happens. Keep:

```json
{ "instructions": ["/abs/path/to/AGENT.md"] }
```

If you still see `AGENT.md` loaded twice, it is named in two merged `opencode.json`
files — find and de-dup:

```bash
for f in ~/.config/opencode/opencode.json ./opencode.json ./.opencode/opencode.json; do
  echo "== $f =="; cat "$f" 2>/dev/null; echo
done
```

### The PROJECT CONTEXT block twice

The modern cause of a *doubled injection* is **two copies of the context plugin**
(global `~/.config/opencode/plugins/` + a leftover project `.opencode/plugins/`) —
OpenCode dedups plugins by npm name+version only, so two local `.js` files both
load. The v2 plugin guards against this with a transcript marker
(`<!-- geneseed-context:v2 -->`) — it skips a session that already carries it — but
the clean fix is a single install. Remove the stray project copy:

```bash
rm -rf .opencode/plugins .opencode/agents .opencode/skills .opencode/command .opencode/agent
```
