# 🦀 OpenClaude adapter

> [← Back to README](../../README.md) · [Install guide](../../docs/guides/install-openclaude.md) · [Claude Code adapter](../claude-code/README.md) · [OpenCode adapter](../opencode/README.md)

[OpenClaude](https://openclaude.gitlawb.com/) (`@gitlawb/openclaude`, binary
`openclaude`) is an open-source coding-agent CLI that "originated from the Claude
Code codebase" and talks to any model provider. Its config surfaces are Claude
Code's (`settings.json` hooks, `agents/*.md`, `skills/<name>/SKILL.md`,
`CLAUDE.md`, `claudeMdExcludes`), so the emit **reuses the Claude engine and the
Claude hook dialect verbatim**. What changes is where OpenClaude keeps its config.
There is nothing to install by hand: `geneseed setup` (or `geneseed-build --emit
openclaude` / `--emit openclaude-global`) writes everything.

**OpenClaude never reads `~/.claude`, a project `.claude/`, or `$CLAUDE_CONFIG_DIR`.**
A Claude Code install is invisible to it, so it gets its own, and neither emit
overwrites the other's files. On one machine the two coexist cleanly. In one
repo they do not fully: OpenClaude also reads the root `CLAUDE.md`/`AGENTS.md`
a Claude Code or Bob per-repo install already wrote there, on top of its own
`.openclaude/CLAUDE.md` — both harnesses load, and there is no clean exclusion
(excluding the root file would hide your own content in it too). `geneseed status`
and `geneseed doctor` warn when this is happening in your repo.

## What the emit writes

### Per-repo (`--emit openclaude`)

Everything lives under **`.openclaude/`**, except the `.geneseed-emit`/
`.geneseed-footprint` markers and `.mcp.json` below, which the driver writes at the
repo root like every other host.

- `CLAUDE.md`: the harness preamble as a delimited **managed block**. OpenClaude
  loads the root `AGENTS.md`, or the root `CLAUDE.md` only when `AGENTS.md` is
  absent, but it **always** reads `.openclaude/CLAUDE.md`. Writing there means the
  preamble loads in every repo, and a root `CLAUDE.md` owned by a Claude Code install
  (or by you) is left alone.
- `agents/<name>.md` in the Claude subagent dialect, and `skills/<name>/SKILL.md`,
  byte-identical to every other host.
- `settings.local.json`: Geneseed's hooks, plus a `claudeMdExcludes` entry for the
  global `~/.openclaude/CLAUDE.md` (project-bypasses-global, as on Claude).
  Gitignored by the emit's `.openclaude/.gitignore`, because the hook commands name
  this machine's paths.
- `memory/`, `notebook/` stores and their indices.
- MCP servers you wire with `geneseed mcp` or the web console go in the repo's
  `.mcp.json`, as on Claude.

### Global (`--emit openclaude-global` → `~/.openclaude`, or `$OPENCLAUDE_CONFIG_DIR`)

The same layout under the config dir, with `CLAUDE.md` (auto-loaded as user
memory) and `settings.json`. `$OPENCLAUDE_CONFIG_DIR` is OpenClaude's own
documented variable, so Geneseed honours it. Claude's `$CLAUDE_CONFIG_DIR` is
ignored, as OpenClaude ignores it. MCP servers go in `~/.openclaude.json`, or in
`$OPENCLAUDE_CONFIG_DIR/.openclaude.json` when the variable is set: OpenClaude's
global config file.

## Hooks

The Claude group set, unchanged: `PreToolUse` (git gate on `Bash|PowerShell`, rule gate on
writes), `SessionStart` (context on every source — one matcher-less group covers
`startup`, `resume`, `clear`, `compact` and `fork` alike), `Stop`,
`SubagentStop` and `PreCompact` (learn). OpenClaude reads Claude's
`hookSpecificOutput.permissionDecision`, so the gates **ask** where Claude asks.
The context hook carries `--host openclaude` for one reason. It tells the hook
which root file OpenClaude already loads (`AGENTS.md` when present, else
`CLAUDE.md`), so that file is not injected a second time.

## Not supported

- **Workflows.** OpenClaude ships its `WorkflowTool` disabled, so the `workflow`
  skill falls back to parallel agents, as on Bob.
- **Live verification.** The emit follows OpenClaude's source (`src/utils/envUtils.ts`,
  `src/utils/claudemd.ts`, `src/utils/config.ts`, `src/types/hooks.ts`) as of
  2026-09. It has not been run against an installed OpenClaude yet.
