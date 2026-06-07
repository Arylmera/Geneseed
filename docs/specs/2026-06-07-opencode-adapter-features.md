# Spec — OpenCode adapter feature uplift

> Exploit OpenCode capabilities Geneseed didn't use yet — invisible context injection,
> per-agent model routing, a runtime guard, default permissions, memory auto-locate,
> an opt-in primary agent, and opt-in slash commands. Non-destructive by default:
> nothing changes the machine's current agent/model behaviour unless explicitly enabled.

**Date:** 2026-06-07
**Status:** approved → implementing
**Batch:** O1, O2, O3, O5, O6 (core) + O4 (primary, opt-in) + O7 (commands, opt-in).
O8/O9 deferred.

## Guiding constraint (user)
The machine has no extra models/agents yet. Everything must **inherit the current
agent/model as-is** by default; model routing is config-driven so a **future TUI**
can wire it up. Non-destructive throughout.

## Items

### O6 — memory auto-locate (geneseed-learn.js)
Resolve the memory store relative to the plugin's own file (`import.meta.url` →
`<plugin>/..` → `memory`/`anamnesis`) so the global install no longer requires a
manual `export GENESEED_HARNESS`. Env (`GENESEED_MEMORY`/`GENESEED_HARNESS`) still
wins. Pure addition to the resolver chain.

### O1 — invisible context injection (geneseed-context.js)
Add an `experimental.chat.messages.transform` delivery path that injects the eager
docs into the request messages **without a visible session message**. **Opt-in via
`GENESEED_CONTEXT_TRANSFORM=1`; default OFF** → today's `session.created` noReply
behaviour is unchanged (non-destructive). When on, the visible-block disappears.
Experimental OpenCode hook — flagged for the user to verify on their build.

### O3 — runtime guard (new geneseed-guard.js)
`tool.execute.before`: **block** writes to private-key/credential files
(`id_rsa`, `*.pem/*.key/*.p12/*.pfx`, `.aws/credentials`, `*.kdbx`) and catastrophic
shell (`rm -rf /`, `rm -rf ~`, fork bomb) — Rules I & IV at runtime. **Warn** (log) on
`.env*` writes and `git push --force`. `GENESEED_GUARD=off` disables; `=warn` downgrades
blocks to warnings. High-confidence patterns only, to avoid false positives.

### O2 — config-driven model/temperature (build.py)
`agent-overrides.json` (host-local, git-ignored, empty stub written once) maps
`agents.<name> → {model?, temperature?}`. `_write_native_layer` emits `model:`/
`temperature:` **only when an override exists**; empty map → inherit as-is. Foundation
the future TUI edits.

### O5 — default permissions (build.py `_merge_opencode_json`)
If `opencode.json` has **no** `permission` key, add a minimal one: `ask` on
`rm -rf *` and `git push --force*`. Only when absent — never overwrites.

### O4 — primary agent (opt-in, OFF)
Static `adapters/opencode/agents/orchestrator.md`. Emitted as `mode: primary` **only
when `GENESEED_PRIMARY=1`**; default off → not written (no change to the default agent).

### O7 — slash commands (opt-in, OFF)
When `GENESEED_COMMANDS=1`, also emit `.opencode/command/<name>.md` for a hot set
(commit, plan, code-review, review-response, verify, ship, debug, research) wrapping the
rendered skill, giving `/name` triggers. Default off → not written.

## Out of scope
O8 (MCP scaffold), O9 (toasts/LSP). A TUI editor for `agent-overrides.json` (future).

## Verification
- `node --check` on all three plugins (node v22 present).
- New unit tests: `_load_agent_overrides`, override emit, command/primary gating.
- `python -m unittest discover -s tests` + `doctor --all` green.
- OpenCode-runtime behaviour (plugins, primary, commands) verified by the user on the
  work machine — cannot run OpenCode on the Windows dev box.

## Worklog
- [x] O6 learn auto-locate (PLUGIN_DIR → <cfg>/memory)
- [x] O1 context transform (opt-in GENESEED_CONTEXT_TRANSFORM, default off)
- [x] O3 guard plugin (geneseed-guard.js; GENESEED_GUARD off/warn)
- [x] node --check trio (node v22, all pass)
- [x] O2 overrides + stub + gitignore (agent-overrides.json, empty=inherit)
- [x] O5 default permission (ask on rm -rf/force-push, only if absent)
- [x] O4 primary agent (opt-in GENESEED_PRIMARY, static orchestrator.md)
- [x] O7 commands (opt-in GENESEED_COMMANDS, hot set of 8)
- [x] unit tests (63) + doctor --all + temp-emit verification green
- [x] docs (adapter README) + commit/push

## Outcome
Verified on Windows by temp-dir emit: default = zero behaviour change (no model lines,
no primary, no commands; stub written; permission added). Opt-in flags produce the
primary agent (mode: primary) and 8 commands; an override pins one agent's model while
others inherit. OpenCode-runtime behaviour (plugins firing, primary, commands) pending
user verification on the work machine.
