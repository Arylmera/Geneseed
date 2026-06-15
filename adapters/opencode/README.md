# 🔌 OpenCode adapter

> [← Back to README](../../README.md) · [Setup guide](../../SETUP.md) · [How OpenCode loads](HOW-OPENCODE-LOADS.md) · [Global harness spec](GLOBAL-HARNESS-SPEC.md)

[OpenCode](https://opencode.ai) is `AGENTS.md`-native and has first-class
**subagents** and **commands**, so Geneseed fits it cleanly. Pick the depth you
want — the baseline is a 30-second drop-in; the native mapping turns Geneseed's
agents and skills into real OpenCode primitives.

> New to how OpenCode discovers config, instructions, and plugins — or wondering
> why a file shows up twice? See [**HOW-OPENCODE-LOADS.md**](HOW-OPENCODE-LOADS.md).

## Baseline (instant intake)

After implanting the harness into your repo (so `AGENT.md`, `agents/`, `skills/`,
`laws/`, `memory/` are at the root):

- Copy [`opencode.json`](opencode.json) to the repo root (or merge its
  `instructions` array into an existing `opencode.json`). It points OpenCode's
  `instructions` field at `AGENT.md` (which inlines the laws) — so every session
  starts bound by the harness. The project-context manifest `context.json` is **not**
  listed here; the [context plugin](#doc-enforcement--the-context-plugin-v2-convention-glob) loads it,
  and listing it in two configs would double-load it.

That's it. OpenCode loads `AGENT.md` as a rule file on every run; the plugins handle
context and memory.

> **Alternative, zero-config:** OpenCode auto-loads `AGENTS.md` (plural) with no
> config at all. If you prefer that, rename the harness entrypoint
> `AGENT.md` → `AGENTS.md` when you implant it and skip `opencode.json` entirely.

## Native mapping (recommended) — generated, zero drift

Turn Geneseed's capability agents into OpenCode **subagents** and its skills into
native **skills**, so they're dispatchable rather than just described in prose. The
generator produces all of it from the same `src/`, so it never drifts:

```
python build.py --emit opencode --target /path/to/your-repo
```

That writes, on top of the normal bundle (note the **plural** dir names — canonical
in OpenCode; singular `agent/`/`command/` is back-compat only):

```
your-repo/
├── opencode.json              instructions → AGENT.md (context auto-discovered by plugin)
└── .opencode/
    ├── agents/                one subagent per capability agent
    │   ├── reviewer.md  architect.md  security.md   (read-only: write/edit denied)
    │   ├── tester.md    docs.md                      (may edit files)
    ├── skills/                one native skill per skill (dir-per-skill)
    │   ├── commit/SKILL.md  code-review/SKILL.md  create-skill/SKILL.md  …
    └── plugins/               context + learn plugins
```

- Read-only agents (their spec says *Read-only*) get an OpenCode `permission` block
  — `edit: deny`, `webfetch: deny`, and `bash: deny`, so a read-only agent can't
  mutate via the shell either. One that must run read-only commands (tests, linters,
  scanners) declares `<!-- bash: allow -->` in its spec, which gates bash to `ask`
  instead. The rest keep edit access.
- OpenCode invokes a subagent via the task tool, e.g. `subagent_type: "reviewer"`.
- **Skills are native, not slash commands** — model-invoked via the `skill` tool
  with progressive disclosure (the agent sees each skill's `description` and loads
  the body on demand). This is the *same `SKILL.md` shape Claude Code uses*, so the
  one artifact serves both tools. Trade-off: no `/name` slash trigger and no
  per-skill `agent:`/`model:` pin (a skill runs in the current agent context). See
  [GLOBAL-HARNESS-SPEC.md](GLOBAL-HARNESS-SPEC.md) §9.1.
- Theming: the *scaffolding* is always plain English — folder names
  (`agents/`/`skills/`/`memory/`), link paths, section layout, and law numbers stay
  fixed so `AGENT.md`'s links match the dirs OpenCode fixes (every emit, not just
  OpenCode). A theme changes the AI's **voice** *and* the prose **vocabulary**: the
  core nouns are themed (imperial reads *Dictates*/*Adepts*/*Rites*, with a themed
  banner and sigil), while **neutral keeps the plain words** (Rules/Agents/Skills). So
  `--theme imperial` flavours both the tone and the page over the same neutral
  scaffolding. The only OpenCode-specific touch is rewriting `AGENT.md`'s skill links
  to the nested `skills/<name>/SKILL.md` form.
- **Bundle in a subfolder?** OpenCode resolves `instructions` paths from the
  *project root*, not from `opencode.json`'s folder. So if the bundle lives in a
  subfolder, add `--root <repo>` — `opencode.json` and `.opencode/` are written to
  the repo root while the whole bundle (incl. `context.json`) stays in `--out`, and
  the instruction path is prefixed (`["Harness/AGENT.md"]`):
  `python build.py --emit opencode --out repo/Harness --root repo`.

### Keeping it in sync — `upgrade.sh`

By default `upgrade.sh` emits only the **plain bundle** (rendered to a sibling
`Harness/`). If you reference the bundle's `AGENT.md` directly — including by
absolute path from anywhere on the machine, or through OpenCode's global config —
that's all you need; **no `opencode.json` is written**.

```
cd Geneseed
./upgrade.sh                  # plain bundle, keeps the last-built theme
./upgrade.sh main imperial    # force a theme while upgrading
```

The native layer is **opt-in**. To (re)generate subagents, native skills, and an
`opencode.json` on upgrade, set `GENESEED_EMIT=opencode` (or
`GENESEED_EMIT=opencode-global` for the global install):

```
GENESEED_EMIT=opencode ./upgrade.sh main imperial
```

That writes `opencode.json` + `.opencode/` to the project root (the Geneseed
folder's parent), keeps the bundle in `Harness/`, and prefixes the instruction
paths — `["Harness/AGENT.md", "Harness/context.json"]`. Override the locations
with `GENESEED_OUT` (bundle) and `GENESEED_ROOT` (project root).

### Manual mapping (fallback)

If you'd rather not run the generator, create each file by hand:
`.opencode/agents/<name>.md` with frontmatter `description`, `mode: subagent`, and
(for read-only agents) a `permission:` block (`edit: deny`, `webfetch: deny`, and
`bash: deny` — or `bash: ask` if it runs read-only commands), body = the agent spec. Skills become native skills at `.opencode/skills/<name>/SKILL.md` with
frontmatter `name` + `description` (+ optional `compatibility: opencode`), body =
the skill spec. (Plural dir names are canonical; singular `agent/`/`command/` are
back-compat aliases.)

## Memory loop — the `learn` plugin

OpenCode's session-end event is `session.idle`; Geneseed hooks it with a **plugin**
— [`plugins/geneseed-learn.js`](plugins/geneseed-learn.js). On every session end it
distils durable memories from the conversation and writes them into the bundle's
`memory/`, maintaining `MEMORY.md` and deduping against what is already stored.

It is **self-contained**: it distils with the *same model the session already
used* (read from the transcript), so it inherits your OpenCode provider config —
no API key, no separate model CLI, nothing to set for the model. Trivial sessions
are skipped and any error is swallowed, so it never blocks or disturbs a session.

### Install

OpenCode auto-loads any plugin file from its plugins directory at startup — the
folder is **`plugins`** (plural), files are loaded automatically with **no entry
in `opencode.json`** (that `"plugin"` array is only for npm-package plugins), and
both `.js` and `.ts` are accepted. The directory does **not** exist by default, so
create it the first time.

- **Global (recommended — the bundle is used everywhere):** **run this from inside
  the Geneseed folder.** It installs all five plugins — learn, the
  [context plugin](#doc-enforcement--the-context-plugin-v2-convention-glob), guard, workflow, and notify
  (the `*.js` glob) — and
  points `$GENESEED_HARNESS` at the sibling bundle `upgrade.sh` builds at
  `../Harness` — so the plugins find your memory store and `context.json` with no
  hand-typed path:

  ```
  mkdir -p ~/.config/opencode/plugins
  cp adapters/opencode/plugins/*.js ~/.config/opencode/plugins/
  export GENESEED_HARNESS="$(dirname "$PWD")/Harness"                  # this shell
  echo "export GENESEED_HARNESS=\"$GENESEED_HARNESS\"" >> ~/.zshrc     # persist (run once)
  ```

  Using a non-default bundle location (`GENESEED_OUT`)? Set `GENESEED_HARNESS` to
  that path instead of `../Harness`.

- **Per-project:** `build.py --emit opencode` (and `GENESEED_EMIT=opencode
  ./upgrade.sh`) creates `.opencode/plugins/` in the repo and drops it in for you.

**Verify it loaded:** start a session, do a little work, end it. On `session.idle`
the plugin logs to stderr — either `[geneseed-learn] wrote N memory file(s): …` or
a `[geneseed-learn] …` skip reason. Total silence means it did not load: re-check
the filename, the `.js` extension, and that the path is exactly the plugins dir
above.

### Point it at the memory dir

The plugin writes into the first location that resolves:

1. `$GENESEED_MEMORY` — an explicit memory dir;
2. `$GENESEED_HARNESS/memory` (or `/anamnesis` for the imperial theme);
3. `./memory` or `./Harness/memory` — when the bundle lives inside the project.

Because your Harness is global (used from any directory), set `GENESEED_HARNESS`
once to the bundle's absolute path so the plugin always writes to the same memory
store no matter where you launch OpenCode:

```
export GENESEED_HARNESS=/abs/path/to/Harness        # e.g. in your shell profile
```

If the plugin can't read the session's model from the transcript, set a fallback
`GENESEED_MODEL=provider/model`. Otherwise there is nothing else to configure.

> **Field-test note.** This plugin uses `session.idle`, `client.session.messages`,
> message `info.providerID/modelID`, and `client.session.prompt` — all confirmed
> against the current OpenCode plugin + SDK docs. Field names can still shift between
> versions; if one differs it degrades quietly — logs to stderr and writes nothing —
> rather than erroring. The resolvers are isolated at the top of `geneseed-learn.js`
> for a one-line adjustment if needed.

## Doc enforcement — the `context` plugin (v2, convention-glob)

OpenCode's `instructions` array can load a rule file, but not a tree of project
docs with an `eager`/`lazy` split. The
[`plugins/geneseed-context.js`](plugins/geneseed-context.js) plugin closes that gap
— and v2 needs **no committed `context.json`**.

On `session.created` it **auto-discovers the current repo's docs by convention**
and injects the `eager` ones into the session via a no-reply prompt
(`session.prompt({ noReply: true })`) — so they're in context before your first
turn, enforcing **Law XVIII** by injection, not agent discipline. This is what lets
the harness live entirely in the global config dir with zero per-repo files.

- **Eager** (injected in full, budget-capped): root `AGENTS.md`/`AGENT.md`/
  `CLAUDE.md`/`.cursorrules`, `README.md`, `CONTRIBUTING.md`.
- **Lazy** (only listed — path + first heading, read on demand): `docs/`, `doc/`,
  `documentation/`, `architecture/`, `adr/`, monorepo `packages/*/README.md`,
  other root `*.md`. `node_modules`, `.git`, `dist`, `build`, … are never scanned.
- **Budget:** per-eager-file 16 KB and total 48 KB caps (env-overridable via
  `GENESEED_EAGER_FILE_KB` / `GENESEED_EAGER_TOTAL_KB`); an oversized eager file is
  demoted to a lazy listing, logged — never silently truncated.
- **Override / escape hatch:** drop a `.harness/context.json` (or `./context.json`,
  or point `$GENESEED_CONTEXT`) to take control — same schema, plus glob `path`s,
  `load: exclude`, and `"extend": true` to layer overrides on top of discovery.
- **Idempotent:** writes a `<!-- geneseed-context:v2 -->` marker and skips a session
  that already carries it — so a stray second plugin copy can't double-inject. (The
  hard guarantee is still a single install: OpenCode dedups plugins by npm
  name+version only, so two local copies both load.)
- **Survives compaction:** on the experimental `session.compacting` hook it re-pushes
  the eager docs into the compaction context, so the project context (Law XVIII)
  persists when a long session is summarised. The `AGENT.md` rules already survive —
  they load via `instructions`, not the conversation — so only the injected project
  context needs re-pushing.
- **Machine wiki (AGENT.md §7):** the same block carries a `MACHINE WIKI` segment
  for the user's own knowledge base(s) — typically an Obsidian vault — declared in
  `wiki.jsonc` (`$GENESEED_WIKI` → `$GENESEED_HARNESS/wiki.jsonc` → beside the
  install). Per wiki: eager entries inject in full, lazy entries list, and the
  `conventions` / `inbox` / `protected` metadata is surfaced — on the **same**
  budgets, compaction and transform paths as the project context. Schema and
  behaviour: [SETUP.md → Wiki](../../SETUP.md#wiki--your-own-knowledge-base-optional).

It needs no model, writes nothing, skips the learn plugin's throwaway sessions, and
swallows every error. Output mirrors `rituals/harness.py context`.

- **Quiet by default:** it logs nothing (OpenCode renders a plugin's stderr as red
  text in the UI). `GENESEED_DEBUG=1` re-enables discovery/inject logs.
- **Invisible by default:** the context is prepended to each outgoing request via
  the experimental `chat.messages.transform` hook — no `PROJECT CONTEXT` block in
  the conversation, and compaction survival is inherent (re-sent per request). On a
  build that lacks the hook the plugin detects it (a request completes without the
  hook firing) and falls back to the classic visible delivery, a `noReply` session
  message. `GENESEED_CONTEXT_VISIBLE=1` forces the visible block up front; set
  `GENESEED_CONTEXT_INJECT=off` to disable injection entirely and fall back to the
  AGENT.md project-context Law (soft, agent-discipline — no injection).

**Install:** the same step as the learn plugin — `cp …/plugins/*.js` copies all
five plugins (context, learn, guard, workflow, notify); `build --emit opencode` and
`--emit opencode-global` place them for you. It uses
`session.created`, `session.idle` (transform-fallback detection), `session.prompt`
`noReply`, `session.messages`, `session.get`, and the experimental
`chat.messages.transform` and `session.compacting` hooks — all confirmed against the
current OpenCode docs; it degrades quietly if a field differs in your build.

## Workflow tool — the `workflow` plugin

[`plugins/geneseed-workflow.js`](plugins/geneseed-workflow.js) registers ONE custom
tool, `workflow`, that runs saved, code-driven orchestration scripts — the
deterministic counterpart to the model-driven `council` / `parallel-agents` skills:
the script, not the model, drives the control flow.

- **Saved scripts only (v1):** the tool loads `<name>.js` from the sibling
  `workflows/` dir (`.opencode/workflows/` per-repo, `<config>/workflows/` global;
  override with `GENESEED_WORKFLOWS_DIR`). No model-authored scripts are eval'd.
- **Call shape:** `workflow({ name, args })` — call with no name to list what is
  available. Shipped: `council`, `review`, `research-plan-implement`.
- **Runtime API** ([`workflows/_runtime.js`](workflows/_runtime.js)): scripts get
  `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `budget`, `args`.
  Child work runs as real OpenCode sessions (created, prompted, then deleted);
  concurrency is capped at `min(16, cores − 2)`; `budget` meters output tokens.
- **Synchronous and contained:** the tool blocks until the workflow finishes; a
  phase-by-phase trace plus the full result land in
  `.geneseed/workflow-runs/<runId>.log`. Failures are reported, never thrown into
  the session. `GENESEED_DEBUG=1` enables stderr logging.

The matching `workflow` **skill** (in the rendered bundle) teaches the agent when
to reach for the tool; the plugin is what actually executes the scripts.

## Desktop notifications — the `notify` plugin

[`plugins/geneseed-notify.js`](plugins/geneseed-notify.js) pings the OS when the
agent finishes a turn, so you can start a long run, walk away, and be called back
when it's your move again. It hooks `session.idle` like the learn plugin.

- **Anti-spam by design:** it only fires when the turn actually took a while — the
  gap between the session's last user prompt and now must exceed
  `GENESEED_NOTIFY_MIN_SECONDS` (default **30**; set `0` to notify on every turn). A
  quick back-and-forth never notifies; a multi-minute build/test run does.
- **Stays out of the way:** native subagent child sessions and the learn plugin's
  throwaway `geneseed-*` distil sessions are skipped, so background machinery is
  silent.
- **Native, dependency-free delivery:** macOS `osascript`, Linux `notify-send`
  (from libnotify — if it isn't installed the call is swallowed, no error), Windows
  a PowerShell balloon tip. The notifier is spawned detached; any failure is
  swallowed, so it never blocks, delays, or breaks a session.
- **Config:** `GENESEED_NOTIFY=off` disables it; `GENESEED_NOTIFY_MIN_SECONDS=N`
  tunes the threshold; `GENESEED_NOTIFY_TITLE="…"` overrides the title (default
  `Geneseed`); `GENESEED_DEBUG=1` logs each decision/delivery to stderr.

**Verify it loaded:** with `GENESEED_DEBUG=1`, end a session that ran longer than the
threshold — you'll see `[geneseed-notify] notified for …` and a desktop notification.
On Linux, install `libnotify` (`notify-send`) if nothing appears.

## Global install — everything in the config dir

For "the harness is global, zero per-repo files," render straight into OpenCode's
global config dir:

```
python build.py --emit opencode-global          # add --theme imperial if wanted
```

It is **self-contained** — it writes only into the config dir (`$OPENCODE_CONFIG_DIR`,
else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode` — on Windows that resolves
to `C:\Users\<user>\.config\opencode`, the same homedir-relative path OpenCode itself
uses) and builds **no sibling `Harness/` folder**:

- `AGENT.md` rendered straight in;
- `agents/`, `skills/<name>/SKILL.md`, and a single `plugins/` copy;
- the **memory store** at `<cfg>/memory` — always classic English, never themed
  (like `agents/`/`skills/`); migrated once from a legacy `Harness/memory` (or a
  themed `anamnesis/`) if you had one, else seeded;
- `opencode.json` merged to point `instructions` at the absolute `AGENT.md`;
- **no** `context.json` — the context plugin auto-discovers each repo's docs.

The learn plugin now **auto-locates** the in-config store: it resolves `memory/`
relative to its own file (`<cfg>/plugins/geneseed-learn.js` → `<cfg>/memory`), so the
`export GENESEED_HARNESS` step is **optional**. Set it only to point the plugin at a
*different* store:

```
export GENESEED_HARNESS="$HOME/.config/opencode"     # optional override
echo "export GENESEED_HARNESS=\"$HOME/.config/opencode\"" >> ~/.zshrc
```

The dir is shared with your own config, so it is never wiped: a
`.geneseed-manifest.json` tracks only the files this layer owns (AGENT.md, agents,
skills, plugins — **not** memory) and removes stale ones on re-emit, leaving your own
agents/skills/plugins and the memory store untouched.

Use `$OPENCODE_CONFIG_DIR` to keep the global harness in a **git-tracked** folder.
On upgrade: `GENESEED_EMIT=opencode-global ./upgrade.sh` — or, on Windows,
`$env:GENESEED_EMIT="opencode-global"; .\geneseed.cmd upgrade` — (the mode is then
remembered in `<cfg>/.geneseed-emit`, so a bare upgrade keeps it). Full design, setup
guide, and acceptance checklist: [GLOBAL-HARNESS-SPEC.md](GLOBAL-HARNESS-SPEC.md).

## Pointing the agent at files beyond the Harness

With the v2 context plugin you usually need **nothing here** — it auto-discovers a
repo's docs. A **`context.json`** manifest is the *override* for when the convention
doesn't fit: drop it at the bundle root, in `.harness/context.json`, or point
`$GENESEED_CONTEXT` at it. Each entry carries a `load` mode: `eager` (read every
session — small, always-relevant rules), `lazy` (read only when the task needs it),
or `exclude`; `path` may be absolute, repo-relative, or a glob, and `"extend": true`
layers the manifest on top of auto-discovery. The build drops an empty
`context.json` at the bundle root (never overwriting an existing one); git-ignore
it. The schema is in AGENT.md §8, GLOBAL-HARNESS-SPEC.md §3.4, and the file's own
comment.

If you'd rather use OpenCode's own always-on loading for a small rule file, you can
also add its path to the `instructions` array of `opencode.json` directly — it
accepts absolute paths, repo-relative paths, globs, and URLs.

## Newer OpenCode integrations

These exploit OpenCode features beyond the baseline. **All default to today's
behaviour** — nothing changes the machine's current agent/model unless you opt in.

- **Per-agent model routing** (`agent-overrides.json`). The build drops an empty,
  git-ignored `agent-overrides.json` at the bundle/config root. Empty ⇒ every agent
  inherits OpenCode's current model **as-is**. Add entries to pin a model/temperature
  per agent (e.g. route the read-only `reviewer`/`explorer` to a cheaper model). Each
  entry also accepts `variant` (reasoning effort, e.g. `"high"`) and `steps` (a max
  tool-iteration cap — a runaway-loop safety net):
  ```json
  { "agents": { "reviewer": { "model": "anthropic/claude-haiku-4-5", "temperature": 0.1, "variant": "high", "steps": 20 } } }
  ```
  Re-emit to apply. (A future TUI screen will edit this map.) Unlisted keys are omitted,
  so the agent inherits OpenCode's defaults.
- **Agent colours.** Each capability agent is emitted with a `color:` set to an OpenCode
  *named theme slot* — architect=`primary`, reviewer=`warning`, tester=`success`,
  docs=`info`, security=`error`, explorer=`accent`, council seats=`secondary` — so the
  agent switcher and subagent output are colour-coded, and the colour tracks whatever
  OpenCode theme you run (portable, never a raw hex). Cosmetic.
- **Branded theme** (`/theme geneseed-<theme>`). The emit writes a complete OpenCode
  theme at `.opencode/themes/geneseed-<theme>.json` (global: `<cfg>/themes/`), tinted by
  the harness theme's accent using terminal-native ANSI colours (always valid, no host
  palette). Select it with e.g. `/theme geneseed-imperial`; ignore it otherwise.
- **Runtime guard plugin** (`geneseed-guard.js`, installed with the others). Enforces
  the safety Laws at the tool boundary: **blocks** writes to private-key/credential
  files (Law I), catastrophic shell like `rm -rf /` (Law IV), and any mutation under
  a declared wiki's `protected` folders (AGENT.md §7, from `wiki.jsonc`); **warns** on
  `.env` writes and force-push. `GENESEED_GUARD=off` disables it, `=warn` downgrades
  blocks to warnings.
- **Invisible context injection** (the default). The context plugin delivers via
  `experimental.chat.messages.transform`, so the PROJECT CONTEXT block never appears in
  the conversation and survives compaction inherently; on a build without the hook it
  auto-falls back to the visible `session.created` message. `GENESEED_CONTEXT_VISIBLE=1`
  forces the visible block (legacy `GENESEED_CONTEXT_TRANSFORM=0/off` does the same).
- **Default permissions.** A fresh `opencode.json` gets a minimal policy that **asks**
  before `rm -rf *` and **every `git commit` and `git push`** (the host-level backstop
  for the consent-before-commit/push Rule — the agent never records or shares code
  unprompted, on any branch; force-push is also called out explicitly). Added only when
  you have no `permission` key — an existing policy is never touched. Routine local work
  (edits, builds, tests) is unaffected; to allow frictionless commits/pushes, set
  `"git commit*"` / `"git push*"` to `"allow"` in your own `permission.bash` map. (Note:
  OpenCode lets a user pick "always allow" for the session, which makes the gate
  session-sticky — the Claude Code adapter's PreToolUse hook re-asks every time instead.)
- **Primary agent** (`GENESEED_PRIMARY=1`). Emits a `mode: primary` orchestrator that
  works by the Rules and delegates to the capability subagents. Off by default (it can
  change which agent is your default, so it stays opt-in).
- **Slash commands** (`GENESEED_COMMANDS=1`). Also emits `.opencode/command/<name>.md`
  for the hot skill set (commit, plan, code-review, review-response, verify, ship, debug,
  research) so they get `/name` triggers, alongside the native skills. Off by default.

## MCP servers — document conversion (MarkItDown)

OpenCode loads MCP servers from the `mcp` key of `opencode.json`. The baseline
[`opencode.json`](opencode.json) registers one **local** server — Microsoft's
**MarkItDown** — so the `ingest` skill can convert PDF / Office / HTML → Markdown
through a single low-cost tool, `convert_to_markdown(uri)`, instead of shelling out
to a converter:

```json
"mcp": {
  "markitdown": { "type": "local", "command": ["markitdown-mcp"], "enabled": true }
}
```

It's a *reference* entry, not a hard dependency: install the server with
`pipx install markitdown-mcp` (or swap the command to `["uvx", "markitdown-mcp"]` for
the zero-install uv form), or drop the block if you don't want it — the skill falls
back to a CLI converter (MarkItDown / Pandoc / Docling) and never installs one
silently. Full runbook, including the corporate-TLS (`UV_SYSTEM_CERTS`) step and the
OCR extras: [SETUP.md → MarkItDown via MCP](../../SETUP.md#markitdown-via-mcp-opencode).

## Optional add-on — git-worktree isolation (third-party, not vendored)

[`opencode-worktree`](https://github.com/kdcokenny/opencode-worktree) gives the
agent two tools — `worktree_create(branch, baseBranch?)` and
`worktree_delete(reason)` — that create an isolated git worktree under
`~/.local/share/opencode/worktree/<project-id>/<branch>/`, spawn a terminal with
OpenCode already running inside it, and auto-commit + clean up on delete. It pairs
well with the harness's parallel-agent workflows when you want *filesystem*
isolation, not just separate sessions.

It is **not vendored** and **not installed by the harness** — treat it like the
MarkItDown MCP server: a reference pointer you opt into, not a dependency. It does
not follow Geneseed's plugin convention (the four vendored plugins are single-file,
zero-dependency `.js` copied by `cp …/plugins/*.js`; this one is multi-file
TypeScript with npm deps — `jsonc-parser`, `zod` — and Bun-only APIs like
`bun:sqlite`/`Bun.spawn`), so it can't ride the `build --emit opencode` install or
the global-install manifest. Install it on its own track instead.

It coexists cleanly with the vendored plugins — it only registers two tools and
hooks no events they use, so nothing double-fires.

### Setup (extra steps the `*.js` plugins don't need)

Unlike the vendored plugins — which need nothing but the `cp` copy — this one
requires its own package manager and a config file:

1. **Install [OCX](https://github.com/kdcokenny/ocx)** (the KDCO package manager) if
   you don't have it. The worktree plugin is distributed through OCX's registry, not
   copied into `~/.config/opencode/plugins/` like ours.
2. **Add the plugin:**
   ```bash
   ocx add kdco/worktree --from https://registry.kdco.dev
   ```
   OCX manages its npm dependencies and updates for you. (No separate Bun install —
   OpenCode already runs on Bun, which is what the plugin's `bun:sqlite`/`Bun.*` calls
   need.)
3. **Configure sync + lifecycle hooks.** The plugin auto-creates
   `.opencode/worktree.jsonc` on first use. Fill in what each new worktree should
   inherit and run — e.g. for a Node repo:
   ```jsonc
   {
     "sync": {
       "copyFiles": [".env", ".env.local"],   // copied from the main worktree
       "symlinkDirs": ["node_modules"],        // symlinked, not duplicated
       "exclude": []
     },
     "hooks": {
       "postCreate": ["pnpm install"],         // after the worktree is created
       "preDelete": []                          // before it's removed
     }
   }
   ```
4. **(Optional) terminal multiplexer.** Terminal spawning is auto-detected across
   macOS/Linux/Windows; it prefers `tmux` when you're already inside it and
   [`cmux`](https://www.cmux.dev/) for agentic workflows. Neither is required —
   it falls back to your OS default terminal.

**Manual install (no OCX):** copy the plugin's `src/` into `.opencode/plugin/` and
install `jsonc-parser` yourself — you lose OCX's dependency management and
auto-updates, and you own the upgrade-by-re-copy. Prefer the OCX path.

**Consent note.** `worktree_delete` auto-commits before removal. The harness's
consent-before-commit Rule is enforced for *shell* `git commit` via `opencode.json`
permissions, but this plugin commits through its own tool path — so review what it
will commit before invoking delete, or keep the worktree and commit yourself.

## Notes

- Project config beats global; `./opencode.json` or `.opencode/opencode.json`
  both work (OpenCode walks up to the worktree root).
- `instructions` in `opencode.json` accepts absolute paths, repo-relative paths,
  globs (`"laws/*.md"`), and URLs — edit it directly for ambient rule files.
- OpenCode also auto-loads external skills from `~/.claude/skills/` — unrelated to
  this harness, but handy to know.
