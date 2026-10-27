# 🤖 IBM Bob adapter

> [← Back to README](../../README.md) · [Install guide](../../docs/guides/install-bob.md) · [Claude Code adapter](../claude-code/README.md) · [OpenCode adapter](../opencode/README.md)

[IBM Bob](https://bob.ibm.com) is **Claude-Code-shaped**: a project `.bob/`
layer, an `AGENTS.md` instructions file, `SKILL.md` skills, subagents, and a
`settings.json` for hooks. So the Bob emit **reuses the
Claude engine** verbatim — only the marker dir (`.bob`) and the instructions
filename (`AGENTS.md`) change. There is nothing to install by hand: `geneseed
setup` (or `geneseed build --emit bob` / `--emit bob-global`) writes everything.

This page documents the two verified **Bob-isms** the engine handles, and one
limitation to be aware of on a shared repo.

## What the emit writes

### Per-repo (`--emit bob`)

- **`AGENTS.md`** at the repo root — auto-loaded by Bob, carries the harness
  preamble as a delimited **managed block** (your prose around it survives a
  re-emit; the block is replaced, never stacked).
- **`.bob/`** layer:
  - `agents/<name>.md` — **Bob's agent dialect**: `name` + `description`, and for a
    read-only agent a `groups:` list of `read` (plus `execute` when the spec opts into
    bash). An editing agent states no groups and keeps Bob's default `read, edit, execute`.
    Bob ignores Claude's `disallowedTools`, and an `agent-overrides.json` value is not
    applied (Bob refuses a `model:` key).
  - `skills/<name>/SKILL.md` — **byte-identical** to every other host; skills
    are model-invoked via the `skill` tool. The one exception is the folder skills'
    own directory — see *Bob-ism 3*.
  - `rules/geneseed.md` — a **slim shadow stub** (see *Bob-ism 1* below).
  - `settings.json` — Geneseed's lifecycle hooks (gitignored by the emit's
    `.bob/.gitignore`, see the caveat below).
  - `mcp.json` — any MCP servers you wire with `geneseed mcp` / the web console.
  - `memory/`, `notebook/` stores + their indices.

### Global (`--emit bob-global` → `~/.bob`, or `$BOB_CONFIG_DIR`)

Self-contained under `~/.bob`: agents, skills, `settings.json`, memory and
notebook. **No `AGENTS.md` is written** — a global `~/.bob/AGENTS.md` is *not*
auto-loaded by Bob, so the preamble rides `rules/geneseed.md` instead (Bob's
always-injected channel). An `AGENTS.md` left by an older install is removed on
re-emit.

## Bob-ism 1 — the preamble rides `rules/geneseed.md`

Only a **project-root `AGENTS.md`** is auto-loaded; a global one is not. So:

- at **global** scope the *full* preamble is written to
  `~/.bob/rules/geneseed.md` (with `../`-prefixed pointers, since the rules file
  sits one level down from the `laws/`/`memory/` stores);
- at **project** scope the root `AGENTS.md` already carries the preamble, so
  `.bob/rules/geneseed.md` is a **slim stub** whose only job is to *shadow* the
  global rules file by filename.

This same-named workspace rule **is** Bob's project-bypasses-global mechanism:
the workspace copy wins over the global one, so a project install suppresses the
global voice without re-paying the preamble's per-turn token cost. (Because this
is filename-shadowing, Bob never needs Claude's `claudeMdExcludes` — see
*Bob-ism 2*.) A **global** emit warns, non-blocking, when project Bob installs
already exist, since both preambles may load together in those repos unless
Bob's precedence is honoured.

## Bob-ism 2 — no `claudeMdExcludes`

`claudeMdExcludes` is a Claude-Code-only knob with unknown Bob semantics, so Bob
never gets one; the `rules/geneseed.md` shadow above covers the same
project-bypasses-global need. An older Bob install that wrote a stale exclude is
**self-healed** (the entry is removed) on the next emit.

## Bob-ism 3 — a folder skill is told where it lives

A folder skill (`explain-changes`, `token-report`, `daydream`, …) ships scripts or
prompts beside its `SKILL.md` and names them `<this-skill-directory>/…`. Claude Code
answers that placeholder itself — it gives the model each skill's base directory on load.
Bob gives the skill's text only, so the model was left with a path it could not resolve
and fell back to searching the filesystem. The Bob emit therefore writes the directory in:

- per repo, relative to the workspace root — `node .bob/skills/token-report/scripts/…` —
  which is where Bob runs commands, and stays valid in a teammate's checkout;
- globally, the absolute path under `~/.bob/skills/`.

`doctor` also requires every folder skill's `SKILL.md` to open with a frontmatter whose
`name` is the folder's and which has a `description` — what any host registers a skill from.

## Hooks — Bob's own protocol

Bob documents lifecycle hooks (its hooks page and the 2.0.2 changelog; see
`docs/reviews/bob-global-injection-2026-09.md` for the reading): **five events** —
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` — with Claude's
names but **not Claude's protocol**, and the global file at the **nested**
`~/.bob/settings/settings.json`. Two differences decide the emit:

- **stdout is read as context on `SessionStart` only.** On `PreToolUse` it is ignored
  and the one way to refuse a call is **exit code 2**. Claude's `permissionDecision:
  "ask"` on stdout is therefore invisible to Bob — the groups earlier versions wrote were
  permissive on every call.
- **`SubagentStop` is not a Bob event**, so it is not written. Bob 2.2.3 does have
  `PreCompact` and `PostCompact` (its bundle's event list and schema); Geneseed does not wire
  them yet, so `learn` still runs on `Stop` only.

What the global emit writes into `~/.bob/settings/settings.json`:

| event | verb | how the verdict travels |
| --- | --- | --- |
| `SessionStart` | `context --host bob` | plain stdout, as on Claude |
| `PreToolUse` | `tool-gate --host bob` — one group, no matcher | Laws I/IV, rigor-5 and ops-2: **exit 2**, reason on stderr — it says no chat confirmation lifts the block, since Bob has no ask tier; process 1/5: a stderr line, exit 0; the ownership gate (the session's first write in an application repo with no `## Ownership` section in its root `AGENTS.md`): **exit 2 once**, the same write then passes — off with `--no-ownership-gate` or `mode: off` |
| `Stop` | `learn` | never a verdict |
| `UserPromptSubmit` | `activity --host bob` | never a verdict; records the turn for the web console's Activity view |

Every hook also feeds the Activity view after it decides (off with `GENESEED_ACTIVITY=off`).
Bob sends no transcript, so a Bob session shows only the calls `tool-gate` sees; see
`docs/reference/plugin-activity.md`.

**The payload Bob actually sends.** Bob 2.2.3's hook runner (read in its shipped bundle,
`resources/app/extensions/bob-code/dist/extension.js`) writes the payload to stdin and closes
it, for every event. The keys are Claude's: `hook_event_name`, `session_id` (the root task's
id), `cwd` (the root workspace, with a lower-case drive letter on Windows), and on tool events
`tool_name`, `tool_input` (the model's raw arguments) and `tool_use_id`. Older notes describe
`{event, session_id, tool, input, output}`; the activity writer reads both shapes.
- The edit tools are `write_file`, `apply_diff`, `insert_content` and `search_and_replace`,
  each with a `path` that Bob resolves against the workspace and expands a leading `~` in. The
  writer does the same, then stores the path relative to the git root.
- `spawn_subagent` and `start_subtask` run their own task, but its tool calls fire the
  parent's hooks with the parent's `session_id` and no sub-agent id. Activity therefore shows
  such a sub-agent as a branch with no id, which the next `Stop` closes, and marks the session
  `attribution: false`: its files cannot be told from the parent's.
- After a compaction, Bob fires `SessionStart` with `source: "compact"`. The writer counts a
  compaction there; any other Bob `SessionStart` is not recorded, because the first prompt's
  `UserPromptSubmit` records the session right after it.
- Bob has no `SessionEnd`, `SubagentStart` or `SubagentStop`. Its settings schema is strict:
  one unknown event key drops the whole hooks block, so none of those is ever written.

No matcher on `PreToolUse`, deliberately: Bob's tools page already drifts from its own
changelog (`web_fetch`, the 2.1.0 Office/IBM-docs tools are undocumented there), so an
allow-list built from it would fail open on the next tool Bob adds, and a deny-list needs a
regex dialect (lookahead) the docs never confirm — bob-verdict.md O1 rates the matcher's own
upside "low, performance only", not worth either risk. `tool-gate` reads the payload's shape
instead — a `command` field gets the git checks, a path gets the rule checks — and defers on
anything it does not recognise. Bob has **no "ask the user" tier**, so the Laws and checks
that admit no judgement call — Laws I and IV, rigor-5 (External Gate, when a project
opts in) and ops-2 (Commands Must Return: a recursive scan rooted at a whole filesystem) —
are refused outright, and the two consent rules become a warning. Because that
warning is all process 5 can be here, the `process` pack toggle changes nothing in Bob's
hooks: the one group only ever exits 2 for Laws I and IV, rigor-5 and ops-2, which every build
carries.

**Migration.** A re-emit over an older install unwires Geneseed's groups from the flat
`~/.bob/settings.json` (your own keys there are kept) and writes the new set to the
nested file.

**Partly verified.** The payload field names are Claude's: Bob 2.2.3's bundle shows them,
and a live Activity check on 2026-10-25 recorded a Bob session from them. The gates' own
verdicts are still Bob's documented contract. If a field
name differs the gate defers rather than misfires, and the harness still holds through
the `rules/geneseed.md` preamble — the same behaviour-contract parity every
non-OpenCode host gets. `/hooks` in Bob Shell 2.0.2+ lists the hooks it loaded and
from which file; if Geneseed's are absent there, the path is wrong.

### ⚠️ Shared-repo caveat

At **project** scope the hooks land in `.bob/settings.json`, and Bob documents no
personal `settings.local.json` variant (Claude uses one precisely to keep this
out of shared git). Those hook commands name the **per-user hook shim**
(`~/.geneseed/bin/geneseed-hook`) — no longer this machine's interpreter and
checkout, but still a path under *your* home, and now also OS-specific (`.cmd` on
Windows, extensionless elsewhere). If you commit `.bob/settings.json`, a teammate
still inherits hooks pointing at a path they do not have. A fresh emit writes
`.bob/.gitignore` listing `settings.json`; if you already had a `.bob/.gitignore`,
add the line yourself.

## MCP

MCP servers are wired at runtime (web console, listed by `geneseed mcp`) into the
`mcpServers` key of Bob's own MCP file — `.bob/mcp.json` per-repo,
`~/.bob/settings/mcp.json` global — never `settings.json`, which Bob does not read
servers from ([Bob docs](https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob)).

## Slash commands

Bob documents `.bob/commands/*.md` (project) and `~/.bob/commands/*.md` (global), with
`description` frontmatter (bob-docs.md §6 — no use for `argument-hint` yet: no Geneseed
skill takes positional arguments). Geneseed writes one command per merged skill's OLD name
(`/old-name`, the same alias problem OpenCode's `command/` layer solves) and one per
genuinely user-only skill (host-compat O2/R1): Bob's skills page documents only
`name`/`description`, no model-invocation key, so a user-only skill gets **no** SKILL.md on
Bob at all — `/its-name` is the only way to run it, and the model never sees it in its
`use_skill` catalogue. Claim-on-create and manifest-owned like every other native file;
uninstall removes them the same way.

## What Bob does not get

Bob rides the Claude engine, so — like Claude — it has no OpenCode-only extras:
colour themes, JS plugins, the saved-workflow runner, the primary-agent orchestrator,
LSP enablement, or OpenCode's full `/`-command layer (`COMMAND_SET`, `/ponytail`) — only
the narrow alias/user-only-skill commands above. Those capabilities have no analogue on a
Claude-shaped host; the harness discipline is carried by the preamble and skills instead.
See the [host matrix](../../README.md#-supported-harnesses).
