# 🤖 IBM Bob adapter

> [← Back to README](../../README.md) · [Setup guide](../../SETUP.md) · [Claude Code adapter](../claude-code/README.md) · [OpenCode adapter](../opencode/README.md)

[IBM Bob](https://bob.ibm.com) is **Claude-Code-shaped**: a project `.bob/`
layer, an `AGENTS.md` instructions file, `SKILL.md` skills, subagents, and a
`settings.json` that also carries `mcpServers`. So the Bob emit **reuses the
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
  - `agents/<name>.md` — the **Claude subagent dialect** verbatim (`name` +
    `description` + a `disallowedTools:` denylist for read-only agents).
  - `skills/<name>/SKILL.md` — **byte-identical** to every other host; skills
    are model-invoked via the `skill` tool.
  - `rules/geneseed.md` — a **slim shadow stub** (see *Bob-ism 1* below).
  - `settings.json` — Geneseed's lifecycle hooks + any `mcpServers` you wire.
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
- **`SubagentStop` and `PreCompact` are not Bob events**, so they are not written.

What the global emit writes into `~/.bob/settings/settings.json`:

| event | verb | how the verdict travels |
| --- | --- | --- |
| `SessionStart` | `context --host bob` | plain stdout, as on Claude |
| `PreToolUse` | `tool-gate --host bob` — one group, no matcher | Laws I/IV: **exit 2**, reason on stderr; process 1/5: a stderr line, exit 0 |
| `Stop` | `learn` | never a verdict |

No matcher on `PreToolUse` because Bob's tool names are undocumented (its IDE and its
Shell differ); `tool-gate` reads the payload's shape instead — a `command` field gets
the git checks, a path gets the rule checks — and defers on anything it does not
recognise. Bob has **no "ask the user" tier**, so the two Laws that admit no judgement
call are refused outright and the two consent rules become a warning. Because that
warning is all process 5 can be here, the `process` pack toggle changes nothing in
Bob's hooks: the one group only ever exits 2 for Laws I and IV, which every build carries.

**Migration.** A re-emit over an older install unwires Geneseed's groups from the flat
`~/.bob/settings.json` (your own keys there are kept) and writes the new set to the
nested file. `geneseed mcp` targets the nested file too.

**Unverified live.** There is no Bob install on the authoring machine; this is Bob's
documented contract, with the payload field names assumed to be Claude's. If a field
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
still inherits hooks pointing at a path they do not have. **Add
`.bob/settings.json` to `.gitignore`** on a team repo, or keep the Bob install
personal/global.

## MCP

MCP servers are wired at runtime by `geneseed mcp` into the `mcpServers` key of
the relevant `settings.json` (`.bob/settings.json` per-repo, `~/.bob/settings.json`
global) — see [`geneseed mcp`](../../README.md) and `rituals/_harness_mcp.py`.

## What Bob does not get

Bob rides the Claude engine, so — like Claude — it has no OpenCode-only extras:
colour themes, JS plugins, the saved-workflow runner, the primary-agent
orchestrator, LSP enablement, or the `/`-command layer. Those capabilities have
no analogue on a Claude-shaped host; the harness discipline is carried by the
preamble and skills instead. See the [host matrix](../../README.md#-supported-harnesses).
