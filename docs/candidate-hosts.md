# Candidate hosts — what Codex, Cursor and Gemini CLI actually offer

*2026-09-05. Item 6 of the host-gap review. A docs check, not a design: each tool's
own reference was read for the three surfaces Geneseed emits — an instructions
carrier, skills, and hooks — so that "add host X" can be costed without re-reading
the docs. Nothing here is implemented. Sources: the Codex CLI repo
(`codex-rs/hooks`, `codex-rs/core/src/agents_md.rs`), `cursor.com/docs/{rules,skills,hooks}`,
`geminicli.com/docs/{hooks,cli/gemini-md,cli/tutorials/skills-getting-started}`.*

## The finding that changes the cost

**`.agents/skills/` is a cross-tool convention.** Cursor loads skills from
`.agents/skills/` and `~/.agents/skills/` (and, for compatibility, from `.claude/skills/`
and `.codex/skills/`); Codex from `~/.codex/skills` (`$CODEX_HOME/skills`) and
`.agents/skills`; Gemini CLI from `.gemini/skills` **or the `.agents/skills` alias**. One
`skills/` emit into `.agents/` therefore reaches all three, byte-identical to what every
current host gets. Skills are the largest surface by file count and they cost nothing new.

## Per-host contracts

| Surface | Codex CLI | Cursor | Gemini CLI |
| --- | --- | --- | --- |
| **Instructions** | `AGENTS.md` at the repo root (and nested), plus a global `~/.codex/AGENTS.md` that no size cap touches | `AGENTS.md` at the root and in subdirectories, combined; also `.cursor/rules/*.mdc` | `GEMINI.md` by default; `context.fileName` in `settings.json` accepts a list, e.g. `["AGENTS.md", "GEMINI.md"]` |
| **Skills** | `~/.codex/skills`, `.agents/skills` — `SKILL.md` + frontmatter | `.cursor/skills`, `.agents/skills`, `~/.cursor/skills`, `~/.agents/skills`, plus `.claude/skills` and `.codex/skills` for compatibility | `.gemini/skills` or `.agents/skills`; `/skills list`, `/skills reload` |
| **Hook config** | `hooks.json` in a config layer's folder, or a `[hooks]` table in `config.toml` (same schema, capitalised event names) | `.cursor/hooks.json` (project) and `~/.cursor/hooks.json` (user); plugins may ship `hooks/hooks.json` | `settings.json` `hooks` object (project `.gemini/`, user `~/.gemini/`) |
| **Hook shape** | **Claude-shaped**: event → `[{matcher, hooks: [{type: "command", command, timeout}]}]`; 11 events incl. `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop` | event → `[{command, matcher?}]`; events incl. `sessionStart`, `preToolUse`, `beforeShellExecution`, `beforeReadFile`, `afterFileEdit`, `stop`, `sessionEnd` | **Claude-shaped groups, Gemini names**: `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `PreCompact`, `SessionEnd`; matchers are regexes over tool names |
| **Gate payload** | `tool_name` / `tool_input` (Claude's field names) | `tool_name` / `tool_input`, `cwd`, `tool_use_id` | `tool_name` / `tool_input`, `session_id`, `transcript_path`, `cwd`, `hook_event_name` |
| **Gate verdict** | `hookSpecificOutput.permissionDecision`: **`allow` / `deny` / `ask`** — the ask tier exists | `permission: "allow" \| "deny"` + `user_message` / `agent_message`; **no ask** | `decision: "deny"` + `reason`, or exit code 2 with stderr as the reason; `systemMessage` shows the user a line; **no ask** |
| **Context injection** | `SessionStart` → `additionalContext` (Claude form) | `sessionStart` → `additional_context` (snake_case) | `SessionStart` → `hookSpecificOutput.additionalContext`; plain stdout is not read |
| **Learn point** | `Stop` / `SubagentStop` / `PreCompact`, transcript on stdin as on Claude | `stop` (payload not checked for a transcript path) | `AfterAgent` (turn end) and `PreCompact`; `transcript_path` is in the base schema |
| **Tool names for matchers** | Claude's (`Bash`, `Write`, `Edit`) | `Shell`, `Read`, `Write`, MCP, `Task` (generic `preToolUse`) | `run_shell_command` (`command`), `write_file` (`file_path`, `content`), `replace` (`file_path`, `old_string`, `new_string`) |
| **Subagents** | `SubagentStart`/`SubagentStop` exist; custom agents not checked | Plugins carry `agents/` | Local and remote subagents (`/agents list`, `enable`, `disable`) |

## What each would cost, against what exists

- **Codex CLI — cheapest, and the only one with an ask tier.** Its hook schema is
  Claude's with `hooks.json`/`config.toml` as the carrier, its payload field names are
  Claude's, and `permissionDecision: "ask"` exists. The Claude engine with `host: "codex"`
  covers instructions (`AGENTS.md`), skills (`.agents/skills`) and the four hook verbs
  unchanged; the only new code is the carrier writer (a `hooks.json` merge or a TOML
  table) and the config-dir resolver (`~/.codex`, `$CODEX_HOME`). Roughly the Copilot
  port minus the dialect work.

- **Gemini CLI — Claude's groups, Gemini's names.** The hook groups are Claude's
  `event → [{matcher, hooks}]` and the payload fields are Claude's, but the events are
  `BeforeTool`/`AfterAgent` and the verdict is `decision: "deny"` or a `systemMessage`.
  Bob Shell shares Gemini's *config* shape (`context.fileName`, `tools.allowed:
  ["run_shell_command(git)"]`), but Bob's documented *hook* protocol is its own —
  Claude's event names, refusal by exit code 2; see `adapters/bob/README.md` — so the two
  are not one dialect. Instructions need one settings key (`context.fileName` to include
  `AGENTS.md`) or a `GEMINI.md` carrier; skills go to `.agents/skills`. No ask tier: Laws
  I/IV deny, the consent rules become a `systemMessage`.

- **Cursor — a third verdict dialect.** `AGENTS.md` and `.agents/skills` are free; hooks
  are `hooks.json` with a `{command}` list per event and a `permission: allow|deny`
  verdict, `additional_context` in snake_case for `sessionStart`. Same block-or-warn stance
  as Copilot, one more output spelling in `js/hosts/hooks.mjs`, one more carrier writer.
  Cursor also reads `.claude/skills/`, so a Claude project install already gives a Cursor
  user the skills.

## Recommendation

If a fifth host is wanted, Codex first: it reuses the most and it is the only candidate
where the gates can *ask* rather than block. Before any of them, a `--emit agents` for
the shared `.agents/skills/` folder would give Codex, Cursor and Gemini users the whole
skill catalogue for the price of one directory name, with no host-specific code at all.
A Gemini host would be the fourth verdict spelling in `js/hosts/hooks.mjs` (after Claude's
ask, Copilot's block, Bob's exit code 2), plus a resolver and a carrier.

## Not verified

None of the three CLIs is installed on the reviewing machine. Every row above is from the
tool's own documentation as indexed on 2026-09-05; the "learn point" column for Cursor and
the Codex custom-agent surface were not checked further than noted.
