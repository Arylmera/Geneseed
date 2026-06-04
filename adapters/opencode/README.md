# OpenCode adapter

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
  listed here; the [context plugin](#doc-enforcement--the-context-plugin) loads it,
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

- Read-only agents (their spec says *Read-only*) get `tools: { write: false,
  edit: false }`; the rest keep edit access.
- OpenCode invokes a subagent via the task tool, e.g. `subagent_type: "reviewer"`.
- **Skills are native, not slash commands** — model-invoked via the `skill` tool
  with progressive disclosure (the agent sees each skill's `description` and loads
  the body on demand). This is the *same `SKILL.md` shape Claude Code uses*, so the
  one artifact serves both tools. Trade-off: no `/name` slash trigger and no
  per-skill `agent:`/`model:` pin (a skill runs in the current agent context). See
  [GLOBAL-HARNESS-SPEC.md](GLOBAL-HARNESS-SPEC.md) §9.1.
- Themed: add `--theme imperial` for the Warhammer vocabulary.
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

The native layer is **opt-in**. To (re)generate subagents, commands, and an
`opencode.json` on upgrade, set `GENESEED_EMIT=opencode`:

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
(for read-only agents) `tools: { write: false, edit: false }`, body = the agent
spec. Skills become native skills at `.opencode/skills/<name>/SKILL.md` with
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
  the Geneseed folder.** It installs both the learn plugin and the
  [context plugin](#doc-enforcement--the-context-plugin) (the `*.js` glob), and
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

> **Field-test note.** This plugin follows the published OpenCode plugin + SDK docs
> (`session.idle`, `client.session.messages`, message `info.providerID/modelID`,
> `client.session.prompt`), but has not been run against every OpenCode build. If a
> field name differs in your version it degrades quietly — logs to stderr and writes
> nothing — rather than erroring. The resolvers are isolated at the top of
> `geneseed-learn.js` for a one-line adjustment if needed.

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

It needs no model, writes nothing, skips the learn plugin's throwaway sessions, and
swallows every error. Output mirrors `rituals/harness.py context`.

**Install:** the same step as the learn plugin — `cp …/plugins/*.js` copies both;
`build --emit opencode` and `--emit opencode-global` place both for you. The same
field-test caveat applies (`session.created`, `session.prompt` `noReply`,
`session.messages`, and `session.get` follow the published docs but aren't verified
against every build).

## Global install — everything in the config dir

For "the harness is global, zero per-repo files," render straight into OpenCode's
global config dir:

```
python build.py --emit opencode-global          # add --theme imperial if wanted
```

This writes `AGENT.md`, `agents/`, `skills/<name>/SKILL.md`, and a single
`plugins/` copy into `$OPENCODE_CONFIG_DIR` (else `$XDG_CONFIG_HOME/opencode`, else
`~/.config/opencode`), and merges `opencode.json` to point `instructions` at the
absolute `AGENT.md`. It writes **no** `context.json` — the context plugin
auto-discovers each repo's docs. The dir is shared with your own config, so it is
never wiped: a `.geneseed-manifest.json` tracks only the files this layer owns and
removes stale ones on re-emit, leaving your own agents/skills/plugins untouched.

Use `$OPENCODE_CONFIG_DIR` to keep the global harness in a **git-tracked** folder.
On upgrade: `GENESEED_EMIT=opencode-global ./upgrade.sh`. Full design, setup guide,
and acceptance checklist: [GLOBAL-HARNESS-SPEC.md](GLOBAL-HARNESS-SPEC.md).

## Pointing the agent at files beyond the Harness

With the v2 context plugin you usually need **nothing here** — it auto-discovers a
repo's docs. A **`context.json`** manifest is the *override* for when the convention
doesn't fit: drop it at the bundle root, in `.harness/context.json`, or point
`$GENESEED_CONTEXT` at it. Each entry carries a `load` mode: `eager` (read every
session — small, always-relevant rules), `lazy` (read only when the task needs it),
or `exclude`; `path` may be absolute, repo-relative, or a glob, and `"extend": true`
layers the manifest on top of auto-discovery. The build drops an empty
`context.json` at the bundle root (never overwriting an existing one); git-ignore
it. The schema is in AGENT.md §6, GLOBAL-HARNESS-SPEC.md §3.4, and the file's own
comment.

If you'd rather use OpenCode's own always-on loading for a small rule file, you can
also add its path to the `instructions` array of `opencode.json` directly — it
accepts absolute paths, repo-relative paths, globs, and URLs.

## Notes

- Project config beats global; `./opencode.json` or `.opencode/opencode.json`
  both work (OpenCode walks up to the worktree root).
- `instructions` in `opencode.json` accepts absolute paths, repo-relative paths,
  globs (`"laws/*.md"`), and URLs — edit it directly for ambient rule files.
- OpenCode also auto-loads external skills from `~/.claude/skills/` — unrelated to
  this harness, but handy to know.
