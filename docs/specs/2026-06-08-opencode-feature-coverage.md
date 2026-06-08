# Spec — OpenCode feature-coverage audit

> Generated 2026-06-08 from a multi-agent workflow: 4 docs-research agents
> (config/agents/permissions · commands/skills/plugins/hooks · MCP/tools/LSP ·
> TUI/themes/share/models) + 3 code-audit agents (build.py emit · the 3 plugins'
> hooks · opencode.json + spec docs) → 1 synthesis. 8 agents, ~397k tokens.
> Verified against the actual source; the audit was accurate on spot-check,
> including that **build.py never emits the `mcp` key** (the markitdown block in the
> static `adapters/opencode/opencode.json` is an illustrative sample, not emitted).

## Verdict

The adapter is a **deliberately tight, principle-disciplined subset** of OpenCode's
surface — not a thin one. It exploits roughly the entire harness-relevant surface:
native subagents (`mode: subagent`), native skills (`SKILL.md` progressive
disclosure), per-agent read-only permission gating, a **non-destructive merge** of
`instructions` + `permission` into `opencode.json`, three plugins on the five hooks
that matter, `OPENCODE_CONFIG_DIR`-aware global emit with an owned-manifest, and
opt-in primary agent / slash-commands / per-agent model+temperature overrides.

Most "unused" features are the **right omissions** — host-specific keys (`shell`,
`username`, API keys, `server`), UX preferences (`keybinds`, `lsp`, `formatter`,
`autoupdate`), and npm-dependent paths (`plugin[]` array, custom tools needing the
SDK/Zod) all correctly stay out to preserve hermeticity, no-deps, and
non-destructiveness. The genuinely worthwhile unused features are few and all
additive/hermetic.

## Coverage matrix

| Feature | Status | Evidence / reason |
|---|---|---|
| opencode.json `$schema` | used | `_merge_opencode_json` |
| `instructions` (AGENT.md) | used | merge + per-emit path (repo-relative / absolute) |
| `instructions` globs/URLs | partial | documented; only the single AGENT.md path emitted (laws inlined) |
| Global `permission` block | used | written only when absent (non-destructive) |
| `permission.bash` patterns | used | `rm -rf *`, `git push*`/`--force`/`-f` → ask |
| `permission.edit` per-agent | used | read-only agents → deny |
| `permission.webfetch` per-agent | used | read-only agents → deny |
| Per-agent bash gate (`<!-- bash: allow -->`) | used | bash → ask for opted-in read-only agents |
| `permission.skill` wildcard | unused | not emitted (defaults allow) |
| `external_directory` / `doom_loop` perms | deliberately-skipped | default `ask` is correct |
| Agent Markdown defs | used | `.opencode/agents/<name>.md` |
| Agent `mode: subagent` | used | every capability agent |
| Agent `mode: primary` | used | opt-in `GENESEED_PRIMARY` |
| Agent `model` / `temperature` | used | from `agent-overrides.json` when set |
| Agent `top_p` / `steps` / `variant` | unused | not in overrides schema |
| Agent `description` | used | from first blockquote |
| Agent `hidden` / `disable` | unused | subagent mode hides; opt-out by non-emit |
| Agent `color` | unused | theme accent tokens not mapped to color |
| Agent `prompt {file:}` | deliberately-skipped | body inlined (the file *is* the agent) |
| Built-in agent overrides | partial | possible via overrides, none default |
| Native skills (SKILL.md) | used | `skills/<name>/SKILL.md` (name/desc/compatibility) |
| Skill license/allowed-tools/metadata fm | deliberately-skipped | unenforced / unneeded |
| Custom commands | used | opt-in `GENESEED_COMMANDS` (7-command hot set) |
| Command `description` fm | used | from first blockquote |
| Command agent/model/subtask fm | unused | only description emitted |
| Command `$ARGUMENTS`/`` !`cmd` ``/`@file` | unused | body is plain skill text |
| `mcp` servers | deliberately-skipped | host-specific; never emitted (left to user) |
| Local JS plugins | used | `_copy_plugins` (context/learn/guard) |
| `plugin[]` npm array | deliberately-skipped | needs Bun/npm — violates no-deps |
| Custom tools (`.opencode/tools/`) | deliberately-skipped | needs SDK/Zod runtime |
| Hook `session.created` | used | context.js — inject doc block |
| Hook `experimental.session.compacting` | used | context.js — re-push eager docs |
| Hook `experimental.chat.messages.transform` | used | context.js (opt-in) |
| Hook `session.idle` | used | learn.js — debounced distil |
| Hook `tool.execute.before` | used | guard.js — block secret writes / catastrophic shell |
| Hook `tool.execute.after` | unused | opportunity: secret-audit of received output |
| Hook `session.deleted` / `session.error` | unused | could cancel learn's debounce |
| Hook `permission.ask` (mutable) | deliberately-skipped | would defeat the ask-gates |
| Hook `shell.env` | unused | not needed |
| Full event bus (message/lsp/tui/todo) | partial | only `session.*` consumed |
| `client.session.{prompt,messages,get}` | used | noReply distil / transcript / session gating |
| plugin `package.json` + bun | deliberately-skipped | `node:` stdlib only |
| `OPENCODE_CONFIG_DIR` | used | global-dir resolution |
| Global config-dir auto-load | used | `emit_opencode_global` |
| Config MERGE semantics | used | preserves all existing keys |
| `AGENTS.md` zero-config | partial | documented; emits `AGENT.md` + wiring |
| `OPENCODE_CONFIG_CONTENT` / `_PERMISSION` env | unused | CI-injection, not the file-emit model |
| `experimental.policies` | unused | no current need |
| `share` | unused | could emit `disabled` if-absent for privacy |
| `small_model` | unused | per-agent override pins model instead |
| `theme` / custom theme JSON | partial | wizard selects theme; no `themes/<name>.json` emitted |
| `username` / `shell` | deliberately-skipped | host/identity-specific |
| `lsp` / `formatter` / `keybinds` / `logLevel` | deliberately-skipped | user/UX preference |
| `snapshot` / `autoupdate` / compaction / watcher | deliberately-skipped | defaults correct |
| `server` / web UI / enterprise | deliberately-skipped | team infra, out of scope |
| `opencode run` / serve / attach (headless CI) | unused | SETUP.md doc gap, not an emit gap |
| GitHub Actions / IDE / Zen provider | deliberately-skipped | host/provider-specific |
| `agent-overrides.json` git-ignored stub | used | host bridge, empty default |
| Global owned-manifest | used | owns AGENT.md/agents/skills/plugins, excludes memory |
| Capability/skill link stripping | used | applied at both native emits |

## Worthwhile additions (each respects hermetic / no-deps / non-destructive / portable)

| # | Recommendation | Effort | Principle held |
|---|---|---|---|
| 1 | **Agent `color`** from the theme accent token (`_write_native_layer` frontmatter) — cosmetic | S | theme-independent (field neutral, value themed) |
| 2 | **Agent `steps`** loop-cap, opt-in via `agent-overrides.json` | S | non-destructive (off by default) |
| 3 | Emit a branded **`.opencode/themes/<theme>.json`** from existing tokens (`/theme`-able) | M | hermetic (self-contained JSON) |
| 4 | **`tool.execute.after`** secret-audit hook in `geneseed-guard.js` (warn-only) | M | dependency-free (`node:` regex, observe-only) |
| 5 | **`variant`** (reasoning effort) opt-in in `agent-overrides.json` | S | non-destructive (off by default) |
| 6 | Optional **`instructions` glob** for split laws behind a build flag (inlining stays default) | M | portable (relative glob) |
| 7 | Document **`opencode run` headless/CI** + `--pure` in SETUP.md (docs only) | S | all four trivially |

## Correctly NOT using (principled — right calls, not gaps)

- **`mcp` key** — endpoints/commands/API keys are host-specific; emitting would clobber the user's `mcp` block or ship a non-portable command.
- **`plugin[]` array, custom tools, plugin `package.json`** — all pull in Bun/npm or the `@opencode-ai/plugin` SDK + Zod at runtime; Geneseed's plugins are `node:`-stdlib-only verbatim JS.
- **`shell`, `username`, provider API keys, `server`/web/enterprise** — host/identity/infra-specific; would overwrite the user's environment or pin infra that doesn't travel.
- **`permission.ask` mutable auto-approve hook** — would silently auto-allow the very `rm -rf` / `git push` actions the harness intentionally gates to `ask`.
- **`lsp`, `formatter`, `keybinds`, `tui`, `snapshot`, `autoupdate`, `compaction`, `watcher`, `attachment`, `share`** — UX preferences with correct defaults; emitting risks clobbering deliberate user choices for zero harness benefit.
- **`OPENCODE_CONFIG_CONTENT`/`_PERMISSION` env, GitHub Actions, Zen provider, IDE shortcuts** — CI/host/provider integrations outside the portable file-emit model (SETUP.md mention at most).
