# 🤖 IBM Bob adapter

> [← Back to README](../../README.md) · [Setup guide](../../SETUP.md) · [Claude Code adapter](../claude-code/README.md) · [OpenCode adapter](../opencode/README.md)

[IBM Bob](https://bob.ibm.com) is **Claude-Code-shaped**: a project `.bob/`
layer, an `AGENTS.md` instructions file, `SKILL.md` skills, subagents, and a
`settings.json` that also carries `mcpServers`. So the Bob emit **reuses the
Claude engine** verbatim — only the marker dir (`.bob`) and the instructions
filename (`AGENTS.md`) change. There is nothing to install by hand: `geneseed
setup` (or `build.py --emit bob` / `--emit bob-global`) writes everything.

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

## Hooks — best-effort

The `settings.json` hooks use the **Claude dialect** (a `PreToolUse:Bash`
git-gate for Rule XX consent, `SessionStart` context injection, and
`Stop`/`SubagentStop` learn/memory capture — the same three `harness.py`
subcommands the OpenCode plugins drive). Bob's hook execution is **unverified**:
if Bob honours Claude-shaped hooks they fire; if not, they are inert and the
harness still works fully through the `AGENTS.md`/`rules` preamble prose. This is
the same behaviour-contract parity every non-OpenCode host gets — the mechanism
differs, the discipline does not.

### ⚠️ Shared-repo caveat

At **project** scope the hooks land in `.bob/settings.json`, and Bob documents no
personal `settings.local.json` variant (Claude uses one precisely to keep this
out of shared git). Those hook commands embed **machine-absolute paths** (this
machine's Python interpreter + checkout). If you commit `.bob/settings.json`, a
teammate inherits hooks pointing at *your* filesystem. **Add `.bob/settings.json`
to `.gitignore`** on a team repo, or keep the Bob install personal/global.

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
