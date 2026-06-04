# Global Harness + Convention-Glob Context — Spec

Status: **implemented** (build emitter + context plugin v2 landed; docs synced).
Target adapter: OpenCode. A *second deployment mode* ("everything global, zero
per-repo files") plus the context-discovery redesign that makes it safe.

It does **not** replace the portable bundle or the Claude Code adapter. The
factory (`Geneseed/`) stays the single source of truth; this adds a way to render
it straight into OpenCode's global config dir and discover each repo's docs by
convention instead of by a committed `context.json`.

---

## 0. Why this exists (the principle it must not break)

The harness enforces project context by **injection, not instruction** — eager
docs are put *in context before turn 1*, never "left to agent discipline"
([geneseed-context.js](plugins/geneseed-context.js) header;
`project_geneseed_enforcement` memory). A pure "law: read the docs folder"
approach regresses to instruction — the model reads *if* it obeys, *if* the law
names the right folder, and re-reads every session.

This spec keeps injection while removing the per-repo `context.json`: the **global
plugin discovers the current repo's docs by convention at session start** and
injects them. Per-project knowledge moves from a committed manifest into the
plugin's runtime glob. A fallback Law (§8) covers tools/repos the plugin can't.

Three tiers, and where this lands:

| Tier | Global? | Per-repo file? | Enforcement |
|---|---|---|---|
| Law only ("read docs/") | ✅ | none | ❌ soft |
| **Convention-glob plugin (this spec)** | ✅ | none (optional override) | ✅ injected |
| Per-repo `context.json` (today) | plugin global, manifest local | yes | ✅ injected, declarative |

---

## 1. Deployment model — everything global

Render the harness contents straight into OpenCode's global config dir. Nothing
is committed into a work repo.

| Piece | Global location | Loaded by |
|---|---|---|
| Entrypoint rules | `~/.config/opencode/AGENT.md` | `opencode.json` `instructions` (absolute path) |
| Laws | inlined in `AGENT.md` (already) | via above |
| Subagents | `~/.config/opencode/agents/*.md` | OpenCode global agents dir |
| Skills | `~/.config/opencode/skills/<name>/SKILL.md` | native `skill` tool (model-invoked) — see §9.1 |
| Plugins | `~/.config/opencode/plugins/*.js` | OpenCode auto-load |
| Memory store | `$GENESEED_HARNESS/memory` (or `$GENESEED_MEMORY`) | learn plugin |
| Project context | **auto-discovered per repo** by the context plugin | this spec |

`~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["/home/<user>/.config/opencode/AGENT.md"]
}
```

> Use an **absolute** path. A repo-relative `"AGENT.md"` in a *global* config
> would resolve against each repo's root and usually miss.

**Confirmed (OpenCode docs — config + plugins).** `~/.config/opencode/` loads
`agents/`, `commands/`, `plugins/`, and `skills/`. Notes that shape this spec:

- **Subdir names are plural** (`agents/`, `commands/`, `modes/`, `plugins/`,
  `skills/`, `tools/`, `themes/`). Singular (`agent/`, `command/`) is *backwards-
  compat only* — the current Geneseed build emits singular; the global emit (§9)
  must write **plural**.
- **Native `skills/` dir exists** — OpenCode has first-class skills *separate* from
  commands. Today the harness maps skills → commands; globally we may map them →
  `skills/` instead (§12 open question).
- **`OPENCODE_CONFIG_DIR`** relocates the *entire* config dir (searched for
  `agents/`, `commands/`, `modes/`, `plugins/` like `.opencode`). Use it to keep
  the global harness in a **git-tracked** folder instead of `~/.config/opencode`.
- **Precedence:** global config < project config < `OPENCODE_CONFIG_DIR` <
  inline/managed. A project `opencode.json` still overrides the global one.

---

## 2. Context plugin — responsibilities (every block)

The redesigned `geneseed-context.js` must cover all of the following. Blocks
marked **(new)** are added on top of today's behavior.

1. **Resolve source** — pick override manifest *or* auto-discovery (§3.1).
2. **Auto-discovery** **(new)** — glob the repo cwd by convention (§3.2).
3. **Classify** — split candidates into `eager` / `lazy` (§3.2 table).
4. **Budget & demote** **(new)** — enforce size caps; demote oversized eager → lazy (§3.3).
5. **Override merge** **(new)** — `.harness` / `context.json` add, pin, or exclude (§3.4).
6. **Build injection block** — header, eager bodies, lazy listing, idempotency marker (§3.5).
7. **Idempotency** **(new)** — per-instance dedup *and* cross-instance transcript check (§4).
8. **Event + session gating** — fire on `session.created`; skip `geneseed-*` sessions (§5).
9. **Inject** — `session.prompt({ noReply: true })`.
10. **Error handling** — swallow everything; never block a session (§6).
11. **Logging** — one structured stderr line per outcome (§7).

---

## 3. Context discovery — the core

### 3.1 Resolution order (first match wins)

```
1. $GENESEED_CONTEXT                 explicit manifest path  -> declarative mode
2. ./.harness/context.json           per-repo override       -> declarative mode
3. ./context.json                    legacy per-repo manifest -> declarative mode
4. (none of the above)               -> AUTO-DISCOVERY (convention glob)
```

- **Declarative mode** = today's behavior, extended to accept glob `path`s and an
  `exclude` array (§3.4). Back-compatible: an existing flat `context.json` still works.
- **Auto-discovery** = the new default. Zero per-repo files.

Discovery always runs against the **repo root** = the session's `directory` /
`worktree` (walk up from cwd to the git root; fall back to cwd).

### 3.2 Auto-discovery convention

Scanned relative to the repo root. **Eager** = injected in full. **Lazy** = only
*listed* (path + first H1/description) so the agent knows it exists and reads on demand.

| Class | Patterns (root-relative) | Rationale |
|---|---|---|
| **eager** | `AGENTS.md`, `AGENT.md`, `CLAUDE.md`, `.cursorrules`, `.harness/*.md` | agent-directed rules, small, always relevant |
| **eager** | `README.md` (root only), `CONTRIBUTING.md` (root only) | canonical entry doc |
| **lazy** | `docs/**/*.md`, `doc/**/*.md`, `documentation/**/*.md` | doc trees — large, occasional |
| **lazy** | `**/ADR/**/*.md`, `**/adr/**/*.md`, `architecture/**/*.md` | decision records |
| **lazy** | root `*.md` other than the eager ones (e.g. `CHANGELOG.md`) | misc root docs |
| **lazy** | `packages/*/README.md`, `apps/*/README.md` | monorepo package entry docs |
| **exclude (always)** | `node_modules/**`, `.git/**`, `dist/**`, `build/**`, `vendor/**`, `**/*.min.md` | never scan |

Rules:
- **Dedup against `instructions`.** If the repo's own `AGENTS.md`/`AGENT.md` is the
  same file OpenCode already loads via `instructions`, skip it (avoid the
  double-load class of bug). Compare resolved absolute paths.
- **Globs are dependency-free.** Implement a tiny matcher (`**`, `*`) in the
  plugin — do not add an npm dep. Cap directory recursion depth (e.g. 6) so a
  pathological tree can't hang discovery.
- **Determinism.** Sort matches lexicographically before injecting so the block is
  stable across sessions (cache-friendly, diffable).

### 3.3 Size & token budget

Injection happens every session — it must not blow the window.

| Cap | Default | Behavior on exceed |
|---|---|---|
| Per eager file | 16 KB | demote to **lazy** (list it, don't inject); log the demotion |
| Total eager budget | 48 KB | stop injecting eager bodies once hit; remaining eager → listed as lazy |
| Lazy listing | name + first H1 line only | never inject lazy bodies |
| Max files scanned | 2000 | stop walking; log truncation |

All caps overridable via env (`GENESEED_EAGER_FILE_KB`, `GENESEED_EAGER_TOTAL_KB`).
**No silent truncation** — every demotion/cap hit logs (Lex: no silent caps).

### 3.4 Override / escape-hatch schema

`./.harness/context.json` (preferred) or `./context.json`. Same schema as today,
plus two additions. Any override file switches off auto-discovery unless it sets
`"extend": true`.

```jsonc
{
  // optional: keep auto-discovery AND apply these rules on top of it
  "extend": true,
  "context": [
    { "path": "docs/architecture.md", "load": "eager", "description": "system overview" },
    { "path": "docs/**/*.md",         "load": "lazy" },                 // globs allowed
    { "path": "internal/secrets.md",  "load": "exclude" }              // hard exclude
  ]
}
```

- `load`: `eager` | `lazy` | `exclude` (new).
- `path`: absolute, repo-relative, or a glob.
- `extend`: `false`/absent → manifest is the *complete* list (today's semantics).
  `true` → auto-discovery runs first, then manifest entries add/override/exclude.
- Precedence within merge: explicit manifest entry > auto-discovered classification.

This is the `.harness` hatch the design calls for: drop one tiny file only when a
repo's layout defeats the convention.

### 3.5 Injection block format (mirror `harness.py cmd_context`)

Byte-identical structure to [harness.py:237-263](../../rituals/harness.py) so both
enforcement paths read the same. Adds a machine marker (first line) for §4.

```
<!-- geneseed-context:v2 -->
=== PROJECT CONTEXT — binding for this repo per Law XVIII ===

----- <path> — <description> -----
<full file contents, trailing newlines stripped>

----- <path2> -----
<...>

--- Lazy entries (load only when the task needs them) ---
  - docs/architecture/overview.md — RF pipeline
  - CHANGELOG.md
  - [demoted: README.md exceeded 16 KB — read on demand]
```

- Header keeps the exact `=== PROJECT CONTEXT … Law XVIII ===` wording.
- A `MISSING` eager file emits `[context] MISSING eager file: <err>` inline (as today).
- The `<!-- geneseed-context:v2 -->` marker is the idempotency sentinel.

---

## 4. Idempotency & dedup (kills the double-injection)

Two layers:

1. **Per-instance** — keep the `done` Set keyed by session id (today's guard).
   Stops one plugin instance re-firing on a repeated `session.created`.
2. **Cross-instance (new)** — before injecting, read the transcript
   (`client.session.messages({ path: { id } })`) and skip if any message part
   already contains `<!-- geneseed-context:v2 -->`. This catches a global + leftover
   project copy both firing.

> **Docs-confirmed why this is needed:** OpenCode dedups plugins *by npm package
> name+version only* — "a local plugin and an npm plugin with similar names are
> both loaded separately," and global plugins load before project plugins. Two
> local `.js` copies (global `~/.config/opencode/plugins/` + project
> `.opencode/plugins/`) **always** both load. So the marker check is mandatory and
> single-install (§9–10) is the only hard guarantee.

**Honest limit:** if two instances fire *simultaneously* they can both read an
empty transcript and both inject (race). The transcript check shrinks the window
but does not close it. The real guarantee is **single global install** — §9 emits
exactly one copy and the setup guide (§10) removes project copies. Document this.

---

## 5. Events & session gating

- Fire only on `event.type === "session.created"`.
- Extract sid from `properties.sessionID | payload.sessionID | properties.info.id |
  payload.info.id` (as today).
- **Skip throwaway sessions:** if `session.get(...).title` starts with `geneseed-`,
  return (don't pollute the learn plugin's distil sessions).
- Inject via `client.session.prompt({ path: { id }, body: { noReply: true, parts: [{ type: "text", text: block }] } })`.

---

## 6. Error handling

- Every step wrapped; any failure → log to stderr, return, **never throw**. A
  broken discovery must not block a session start (matches `cmd_context` exit-0
  contract).
- Missing repo root → fall back to cwd. No docs found → inject nothing (silent
  except one debug log).

---

## 7. Logging (stderr, one line per outcome)

```
[geneseed-context] injected: 3 eager (41 KB), 12 lazy listed  [repo=/path]
[geneseed-context] demoted README.md -> lazy (18 KB > 16 KB cap)
[geneseed-context] skipped: already injected (marker present)
[geneseed-context] skipped: geneseed-* session
[geneseed-context] no docs discovered in <repo>
[geneseed-context] error: <message>
```

---

## 8. Fallback Law (for tools without the plugin)

Add to the universal laws so non-OpenCode tools and uncovered repos still get
project context — the *instruction* tier behind the *injection* tier:

> **Law (Project Context Discovery).** When project context has not already been
> injected, before substantive work read the repo's agent-directed rules and entry
> docs — `AGENTS.md`/`AGENT.md`/`CLAUDE.md`, root `README.md`, and any `.harness/`
> manifest — and treat `docs/`, `adr/`, and architecture notes as lazy: consult
> them when the task touches their area. Prefer an injected PROJECT CONTEXT block
> when present; this Law is the fallback, not the primary path.

This is the "rely on the rule" path — kept as a safety net, not the main mechanism.

---

## 9. Build / emit changes

Add an emit target so the factory can render straight into the global dir.

`python build.py --emit opencode-global [--theme NAME]` — **self-contained**: it
writes ONLY into `<cfg>` and builds **no sibling `Harness/`** (plural subdir names —
canonical):

1. Render `AGENT.md` straight to `<cfg>/AGENT.md` (no Harness staging/copy).
2. `agents/*.md` → `<cfg>/agents/*.md` (read-only agents keep `tools: { write:false, edit:false }`).
3. skills → `<cfg>/skills/<name>/SKILL.md` (**native skills**, model-invoked — see §9.1).
4. `plugins/*.js` → `<cfg>/plugins/*.js` (**single copy** — the fix).
5. **Memory store** → `<cfg>/memory` (or `anamnesis/`): if it already has files,
   left alone; else migrated once from a legacy `Harness/memory` (so a host moving
   off a sibling bundle loses nothing), else seeded from the `src/memory` template.
   The store is **not** owned-tracked — never deleted on re-emit. Point the learn
   plugin at it with `GENESEED_HARNESS=<cfg>`.
6. Write/merge `<cfg>/opencode.json` with the **absolute** `AGENT.md` path; never
   clobbers a user-edited config — merges the `instructions` entry only.
7. **No** `context.json` (auto-discovery is the default).
8. `.geneseed-emit` marker written in `<cfg>` (build.py persists it regardless of
   entrypoint), so a later bare `./upgrade.sh` keeps emitting globally.

### 9.1 Skills → native `skills/` (decided)

Skills emit as **native OpenCode skills**, not slash commands:

- **Shape:** one directory per skill, `skills/<name>/SKILL.md` (not a flat
  `commands/<name>.md`).
- **Frontmatter:** skill schema — `name`, `description` (+ optional `license`,
  `compatibility: opencode`, `metadata`). Drop the command-only `agent:` / `model:`
  keys. Geneseed's `src/skills/*.md` frontmatter is transformed on emit.
- **Invocation:** model-invoked via the native `skill` tool with progressive
  disclosure (the agent sees `description`s, loads the body on demand) — **not** a
  user-typed `/name`. Each skill's `description` is therefore trigger-critical and
  must be written to fire at the right moment.
- **Trade-off:** loses per-skill `agent:`/`model:` pinning that commands allowed
  (the old `agent: build`); a skill runs in the current agent/model context. Audit
  `src/skills/` for any that depended on it before emit.
- **Cross-adapter win:** `SKILL.md` is the *same artifact shape Claude Code uses*,
  and OpenCode also auto-discovers `~/.claude/skills/*/SKILL.md` and
  `~/.agents/skills/*/SKILL.md`. One skill source can feed both tools — collapsing
  the two divergent emit paths and killing adapter drift. Optional: emit into
  `~/.claude/skills/` for a single dir served to Claude Code *and* OpenCode.
- **Migration:** existing per-repo `.opencode/command/*.md` emits go stale; update
  the adapter README, HOW-OPENCODE-LOADS, and `src/skills/_template.md`.

`<cfg>` resolution: `$OPENCODE_CONFIG_DIR` if set (lets the harness live in a
git-tracked folder), else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`.

`upgrade.sh`: add `GENESEED_EMIT=opencode-global` to re-render globally on upgrade.

> **Windows config path: TBD.** No Windows host in use currently. When one appears,
> confirm OpenCode's actual config dir on Windows (likely `%APPDATA%\opencode` or
> via `$OPENCODE_CONFIG_DIR`) before emitting there.

---

## 10. How to set up (global, zero per-repo)

**One-time, on the machine that runs OpenCode.**

1. **Emit globally** (from the Geneseed folder). No separate bundle build — this is
   self-contained:
   ```bash
   cd /path/to/Geneseed
   GENESEED_EMIT=opencode-global ./upgrade-imperial.sh    # or ./upgrade.sh / --theme neutral
   ```
   This populates `~/.config/opencode/{AGENT.md,agents/,skills/,plugins/,memory/}`,
   wires `opencode.json` to the absolute `AGENT.md`, and remembers the mode in
   `<cfg>/.geneseed-emit` — so every later bare `./upgrade-imperial.sh` stays global.
   (Direct equivalent: `python build.py --emit opencode-global`.)

2. **Point the learn plugin at the in-config memory store** (once):
   ```bash
   export GENESEED_HARNESS="$HOME/.config/opencode"        # so it writes <cfg>/memory
   echo "export GENESEED_HARNESS=\"$HOME/.config/opencode\"" >> ~/.zshrc
   ```
   (Or `$OPENCODE_CONFIG_DIR` if you relocated the config dir.)

3. **Remove every per-repo copy** (the source of the double-injection):
   ```bash
   # in each repo you previously ran --emit opencode in:
   rm -rf .opencode/plugins .opencode/agents .opencode/agent .opencode/skills \
          .opencode/command opencode.json context.json
   # and confirm only ONE global plugin copy exists:
   ls ~/.config/opencode/plugins/        # geneseed-context.js + geneseed-learn.js, once each
   ```

4. **Verify** (§11). A stray sibling `Harness/` from an older global build is now
   unused — safe to delete once memory has migrated into `<cfg>/memory`.

**Per repo afterwards: nothing.** Open OpenCode in any repo — the global AGENT.md,
agents, and skills load, and the context plugin auto-discovers that repo's docs.
Only drop a `./.harness/context.json` (§3.4) in a repo whose layout defeats the
convention.

---

## 11. Acceptance checklist

- [x] Fresh repo with a `README.md` + `docs/` → exactly **one** PROJECT CONTEXT
      block, README eager, `docs/**` listed lazy. *(verified — node fixture test)*
- [x] Repo with no docs → no block, one `no docs discovered` log, session starts clean.
- [x] Global + leftover project plugin copy → still **one** block (marker dedup). *(verified)*
- [x] >16 KB README → demoted to lazy, demotion logged, eager budget respected. *(verified)*
- [x] `.harness/context.json` with `extend:true` + `exclude` + pin → merged correctly. *(verified)*
- [x] `geneseed-*` distil session → no injection.
- [x] Plugin adds **no** npm dependency. *(stdlib `node:fs`/`node:path`/`node:url` only)*
- [x] Global re-emit removes stale owned files, preserves user files, writes no
      `context.json`. *(verified — manifest cleanup test)*
- [ ] Malformed `.harness/context.json` → error logged, session still starts. *(swallowed by readJson; not explicitly tested)*
- [ ] Live OpenCode session on the work laptop (field-test caveat — event/SDK field names).

---

## 12. Non-goals / open questions

- **Not** removing the portable bundle or the per-repo `context.json` tier — both stay.
- **Race** on simultaneous dual-instance injection is mitigated, not eliminated
  (§4) — single install is the guarantee (docs-confirmed: local plugins never dedup).
- **Resolved:** OpenCode global `agents/` + `commands/` + `skills/` loading is
  confirmed (§1). Subdir names are plural (singular = back-compat).
- **Windows config-dir path: TBD** — no Windows host currently (§9).
- **Decided:** skills emit as **native `skills/<name>/SKILL.md`** (§9.1) — model-
  invoked, progressive disclosure, same shape as Claude Code skills. Cost: no slash
  trigger, no per-skill `agent:`/`model:` pinning.
- **Open:** whether eager auto-discovery of a repo's `AGENTS.md` should be dropped
  entirely (since `instructions` may already load it) or kept with path-dedup —
  spec currently keeps it with dedup.
```
