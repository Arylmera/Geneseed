# Multi-harness orchestration — Claude installs, Harnesses page, rebuild-all

**Date:** 2026-06-19 · revised same day — user-content safety + Claude config grounded against live `~/.claude` and the Claude Code docs
**Status:** draft — awaiting review

## Problem

Geneseed renders one source (`src/`) into an installed harness, but today the
install machinery only knows **one host and one global**. `build.py --emit`
offers `files`, `opencode`, `opencode-global` ([build.py:89](../../build.py)).
Claude Code exists only as a documentation adapter
([adapters/claude-code/](../../adapters/claude-code)), never as a thing you can
install. The web dashboard's install panel hardcodes `host: "opencode"`
([_web_actions.py:195](../../rituals/_web_actions.py)), and rebuild targets the
single detected install via `WebState`'s lone `target`/`theme`
([_web_core.py:699](../../rituals/_web_core.py)).

The goal: from **one Geneseed source**, install and manage in parallel multiple
harnesses across two axes — **host** (OpenCode | Claude) × **scope** (the tool's
global config dir | a specific folder you name) — all from the web dashboard. A
dedicated **Harnesses** page orchestrates them; the dashboard's headline rebuild
rebuilds **all installs at once**.

The reassuring finding from the design pass: the engine that makes installs
non-destructive and self-coexisting (owned-file manifest, write-before-delete
prune, all-or-nothing stash/rollback, per-root markers) is **already
host-neutral**. The new work is a Claude *emit*, a small host descriptor, and
threading `host` through three hardcoded literals — plus the two web surfaces.

---

## Current behaviour (what rebuild/reinstall does today)

Grounding the "what happens when I rebuild" question so the spec is honest about
what changes and what is reused:

- **Build** POSTs to `/api/actions/build` ([_web_server.py:143](../../rituals/_web_server.py)),
  which resolves theme+emit from the **detected** install
  (`_build_override`, [_web_actions.py:38](../../rituals/_web_actions.py) — a
  bogus picker value can never reach argv; it falls back to the deployed
  `state.theme`/`state.emit`), runs `python build.py --emit <E> --theme <T>` as a
  detached background job ([_web_jobs.py:155](../../rituals/_web_jobs.py)), and
  re-detects from the freshly written markers on finish.
- **`emit_opencode_global`** ([_build_global.py:99](../../_build_global.py))
  re-renders straight into `_opencode_config_dir()`
  (`$OPENCODE_CONFIG_DIR > $XDG_CONFIG_HOME/opencode > ~/.config/opencode`,
  [_build_global.py:10](../../_build_global.py)) and restamps `.geneseed-emit`,
  `.geneseed-theme`, `.geneseed-version`, `.geneseed-manifest.json`.
- **Rebuild is non-destructive by construction.** Memory, notebook, wiki stub,
  user-owned agents/skills/plugins, and `opencode.json` are kept/merged. The only
  deletion is **write-before-delete pruning** (the new full set lands on disk,
  then `old_owned − new_owned` is unlinked; a live file is never momentarily
  absent; a locked stale file is reported to stderr, not silently dropped). The
  `.geneseed-version` build-date is excluded from drift detection
  ([_harness_diff.py:12](../../rituals/_harness_diff.py)).
- **Deactivate** moves every owned tree into a sibling `.geneseed-disabled/`
  stash (all-or-nothing + rollback) and drops the `instructions` entry. The
  stash's *presence* is the disabled flag — no separate state file to drift.

Every one of these guarantees is a property of the shared machinery, keyed on a
`root` dir + an `owned` list. They carry to a Claude root verbatim.

---

## Requirements — how `src/` maps onto each (host, scope)

| Install | Path | Layout written | Loads via | Clean map? |
|---|---|---|---|---|
| **OpenCode-global** | `~/.config/opencode` | `AGENT.md`, `agents/`, `skills/`, `command/`, `plugins/`, `workflows/`, `themes/`, merged `opencode.json` | `instructions`→AGENT.md; native auto-load | reference |
| **OpenCode-folder** | named dir, `.opencode/` marker | same + project `opencode.json` | project merges over global | reference |
| **Claude-global** | `~/.claude` *(new)* | `CLAUDE.md`, `agents/` (re-templated), `skills/` (**byte-identical**), merged `settings.json` hooks | auto-loads `CLAUDE.md` by location; hooks fire | partial |
| **Claude-folder** | named dir, `.claude/` marker | `CLAUDE.md`, `agents/`, `skills/`, `settings.json` | same, project scope | partial |

**Maps cleanly (reuse, zero re-templating):**

- **`skills/<name>/SKILL.md` is byte-identical across hosts.** Confirmed:
  `adapters/claude-code/skills/geneseed` ships, with zero agents.
  `_write_native_layer` ([_build_emit.py:181](../../_build_emit.py)) already
  feeds both hosts from one source.
- **Manifest / prune / stash discipline is host-neutral.**
  `.geneseed-manifest.json`, `.geneseed-emit/-theme/-version`, and
  `.geneseed-disabled/` are filenames inside a config dir — they carry to
  `~/.claude` unchanged with the same non-destructive guarantees.
- **memory/, notebook/, wiki.jsonc** seeding is host-agnostic — kept-if-non-empty,
  never in the manifest, never pruned.

**Does NOT map (the honest seams — these are real work, not renames):**

- **Agent frontmatter genuinely diverges** ([_build_emit.py:237-266](../../_build_emit.py)):
  OpenCode bakes `mode: subagent`, `color:` (named theme slots), and a
  `permission:` deny-tree (`edit/webfetch/bash: deny`). Claude Code subagents use
  a different schema (a `tools:` allowlist, no `permission:` block). This is the
  one non-mechanical swap.
- **Wiring differs.** OpenCode splices an absolute `AGENT.md` path into
  `opencode.json`'s `instructions` array; Claude **auto-loads `CLAUDE.md` by
  location** (no `instructions` entry) and instead needs the `settings.json`
  **hooks** block (`SessionStart`/`Stop`/`PreToolUse`).
- **plugins/ and workflows/ have no Claude equivalent.** The six JS plugins
  (context/learn/guard/notify/ponytail/workflow) are OpenCode-SDK event plugins,
  and `~/.claude/plugins/` is a Claude-managed **marketplace** (not a drop folder)
  Geneseed must not write to ([plugins](https://code.claude.com/docs/en/plugins.md)).
  Claude's parallel is `settings.json` hooks, which already shell out to
  `harness.py context|learn` and a git-gate — so context-injection, learn, and
  the git-gate carry over; **ponytail, the primary-agent switch, and `/ponytail`
  do not.**
- **Colour themes have no Claude analogue.** A Claude rebuild re-themes **prose
  only** (CLAUDE.md voice), not TUI colours.

---

## User-content safety — never clobber, never delete what isn't ours

A hard guarantee for every `(host, scope)`: **Geneseed touches only files it
owns. A pre-existing config it did not create — the user's own skills, agents,
commands, settings, plugins — is preserved on install AND on uninstall.** This
matters most for Claude, whose `~/.claude` is a live, densely-populated dir (the
target machine already has a user `settings.json` + `settings.local.json`, a
`skills/` full of the user's own skills and symlinks, `commands/spawn.md`, and
Claude's own runtime state). Three mechanisms, all keyed off the per-root
`.geneseed-manifest.json`:

1. **Claim-on-create (namespaced items: `skills/`, `agents/`, `command/`).**
   Before writing an owned file, if the target already exists **and was not in
   the prior manifest** (`old_owned`), it is the user's: **skip the write, do not
   add it to `owned`, warn** (`[geneseed] kept your existing skills/impeccable —
   skipped Geneseed's to avoid clobbering`). A same-named user skill is never
   overwritten, never enters the manifest, and so is never pruned or
   uninstalled. Re-emit still updates Geneseed's own files (they ARE in
   `old_owned`). This is a pure hardening of the shared write path
   ([_write_native_layer, _build_emit.py:181](../../_build_emit.py);
   [_build_global.py:154](../../_build_global.py)) — it only changes behaviour in
   a collision, where today's behaviour (overwrite → adopt → delete-on-uninstall)
   is the bug. It benefits the OpenCode emit too.

2. **Managed-block merge (the root instruction file: `CLAUDE.md`).** CLAUDE.md
   auto-loads by location, so it can't be namespaced or skipped. If the user
   already has one, Geneseed inserts/updates a single delimited block
   (`<!-- BEGIN GENESEED -->…<!-- END GENESEED -->`) and leaves the rest of the
   file untouched; uninstall removes only that block (and deletes the file only
   if Geneseed created it whole). The manifest records `CLAUDE.md: geneseed-block`
   rather than full ownership. (OpenCode's `AGENT.md` keeps its current
   whole-file ownership — revisit only if a collision is reported.)

3. **Surgical, reversible settings merge (`settings.json` / `opencode.json`).**
   Deep-merge only Geneseed's keys — for Claude, append its hook entries into the
   `hooks.<event>` arrays, **preserving the user's other keys and their own hook
   entries**. The manifest records exactly which entries were added so
   `unwire`/uninstall removes precisely those and never rewrites or deletes the
   file. **Never write `settings.local.json`** (the user's gitignored layer).

**Never write `~/.claude/plugins/`.** Per the docs it is a marketplace-managed
system (`installed_plugins.json`, `known_marketplaces.json`) — third-party tools
must not drop `.js` files there
([plugins](https://code.claude.com/docs/en/plugins.md)). The Claude emit omits
the plugin copy entirely; the useful behaviour of the six OpenCode plugins
reaches Claude via `settings.json` hooks instead.

**memory/, notebook/, wiki.jsonc** stay host state — seeded once if absent, never
in the manifest, never pruned, never uninstalled (existing behaviour,
[_build_global.py:25-96](../../_build_global.py)).

Net: uninstall is already manifest-only
([_harness_mcp.py:221](../../rituals/_harness_mcp.py)); these rules keep user
content **out of the manifest in the first place**, so "keep my skills/plugins
even on uninstall" holds by construction.

---

## Design

### 1. Install identity = `(host, scope, path)` tuple

`host` ∈ {`opencode`, `claude`}; `scope` ∈ {`global`, `project`}; `path` is the
resolved root dir. **`host` is carried separately from `kind`/`scope`** — today
`kind` (global/project) secretly means "which OpenCode install"; with two hosts,
conflating "which host" with "which scope" is the source of every cross-host bug
below. Keep them orthogonal and a Claude-global and an OpenCode-global can never
collide.

### 2. One bounded `HOSTS` descriptor

A 2-entry module-level literal in [_build_global.py](../../_build_global.py),
next to `emit_claude_global` and `_opencode_config_dir`, so build dispatch *and*
install detection read **one source of host truth** (not a consumer module that
rots):

```python
HOSTS = {
  "opencode": {"config_dir": _opencode_config_dir, "config_file": "opencode.json",
               "project_marker": ".opencode", "agent_file": "AGENT.md",
               "emit_global": emit_opencode_global, "wire": ..., "unwire": ...},
  "claude":   {"config_dir": _claude_config_dir,   "config_file": "settings.json",
               "project_marker": ".claude",  "agent_file": "CLAUDE.md",
               "emit_global": emit_claude_global,   "wire": ..., "unwire": ...},
}
```

No registry/loader, no plugin discovery — bounded to the hosts that exist. This
*is* the one new abstraction; resist anything beyond it (YAGNI).

### 3. The Claude build path

- **`_claude_config_dir()`** in [_build_global.py](../../_build_global.py) —
  returns `Path.home() / ".claude"` (Windows: `%USERPROFILE%\.claude`, which
  `Path.home()` already resolves). Per the docs there is **no env var that
  relocates the user config dir** (unlike OpenCode's `$OPENCODE_CONFIG_DIR`), so
  this resolver is *simpler* than its sibling — no env branch.
  ([configuration](https://code.claude.com/docs/en/configuration.md))
- **`emit_claude_global(theme, cfg=None)`** modeled line-for-line on
  `emit_opencode_global`. **Reuse unchanged:** `render_all`, source-completeness
  assert, the manifest read + write-before-delete prune block,
  `_global_memory`/`_global_notebook`/`ensure_*_index`/`ensure_wiki_stub`,
  version stamp. **Swap only the boundary tail:** write `CLAUDE.md` (not
  `AGENT.md`); `_write_native_layer` into `cfg/agents` + `cfg/skills` (skills
  identical, **via claim-on-create** so user skills survive; agents via the new
  Claude branch — §4); write CLAUDE.md via the **managed-block merge**; replace
  `_merge_opencode_json` with `_merge_claude_settings(cfg/'settings.json',
  scope)`. **Drop `_copy_plugins` / `_copy_workflows` / `_write_color_themes`
  entirely** — plugins are marketplace-managed (never written), there is no Claude
  workflow runtime, and colour themes are OpenCode-TUI JSON. So the Claude tail is
  *smaller*, not just different. No `instructions` step (CLAUDE.md auto-loads).
- **Folder scope** rides the existing per-repo path: `emit_claude` writes the
  same layout under a named dir with a `.claude/` marker (the Claude analogue of
  `emit_opencode`).

### 4. The two non-mechanical seams

- **Agent frontmatter** — branch the frontmatter section of `_write_native_layer`
  ([_build_emit.py:237-266](../../_build_emit.py)) on host. OpenCode keeps
  `mode: subagent` / `color:` / `permission:` deny-tree. Claude's confirmed
  user-scope subagent schema (`~/.claude/agents/<name>.md`): required `name`
  (kebab-case) + `description`; optional `tools:` (allowlist — omit to inherit
  all), `disallowedTools:` (denylist, applied first), `model:`, `permissionMode:`.
  **Map** the OpenCode `permission: {edit: deny, webfetch: deny, bash: deny}`
  deny-tree → Claude `disallowedTools: Write, Edit, WebFetch` (or a positive
  `tools:` allowlist for read-only agents like `explorer`). No `mode:`/`color:`
  (Claude has neither). ([sub-agents](https://code.claude.com/docs/en/sub-agents.md))
- **`_merge_claude_settings(path, scope)`** beside `_merge_opencode_json`
  ([_build_emit.py:383](../../_build_emit.py)) — **surgical, reversible** merge of
  Geneseed's hook entries into the user's `settings.json` (reusing `_read_jsonc`
  + the **commented-file refusal** guard). Appends into `hooks.<event>` arrays,
  **preserving the user's other keys and any hook entries they already have**;
  records the added entries in the manifest so `unwire`/uninstall removes exactly
  those and never rewrites the file (User-content safety §3). **Load-bearing fix —
  hook cwd is the *project*, not the config dir** (confirmed:
  [hooks](https://code.claude.com/docs/en/hooks.md)). The shipped
  [adapters/claude-code/settings.json](../../adapters/claude-code/settings.json)
  hooks are project-relative (`cat AGENT.md`, `python rituals/harness.py
  context`) — **dead hooks** under a global install launched from an arbitrary
  repo. For **global** scope, write absolute command paths (the interpreter +
  absolute `<ROOT>/rituals/harness.py`, known at emit time) and pass the working
  repo via Claude's `${CLAUDE_PROJECT_DIR}` placeholder so context-injection still
  targets it. For **folder** scope the project-relative form is correct (cwd =
  that repo). This function is the host's `wire`; the recorded-entry removal is
  `unwire`.

### 5. Host-aware install detection + activation

In [rituals/_harness_mcp.py](../../rituals/_harness_mcp.py):

- **`_install_targets()`** yields **`(host, scope, root)` triples** — loop both
  hosts; each host's global `config_dir` row, plus a cwd-project row **only when
  that host's `project_marker` is present**.
- Thread `host` into `_install_state`, `_install_kind`, `_install_move_list`,
  `_install_relive`, `_stashed_kind`, `_install_agent_entry`,
  `_install_deactivate`, `_install_reactivate` — replacing literal
  `.opencode`/`opencode.json`/`AGENT.md`/instructions-splice with `HOSTS[host]`
  lookups and the host's `wire`/`unwire`. The owned-manifest, all-or-nothing
  stash/rollback, and empty-dir prune are **reused unchanged** (they already
  operate on `root` + `owned`, which both hosts produce).
- For Claude: deactivate = move trees to stash (which removes `CLAUDE.md` from
  the auto-load location) + `unwire` drops the `hooks` key; reactivate = move
  back + `wire` re-adds hooks.

In [rituals/_harness_setup.py](../../rituals/_harness_setup.py): extend
`EMIT_OPTIONS` ([:152](../../rituals/_harness_setup.py)) with `claude-global` and
`claude`; make `_installed_defaults` ([:124](../../rituals/_harness_setup.py))
also probe `_claude_config_dir()` and treat its manifest as `claude-global`; add
`CLAUDE.md` as a second sigil source in `_theme_of_dir`
([:108](../../rituals/_harness_setup.py)) so a Claude install's theme
auto-detects.

In [build.py](../../build.py): add `claude-global` and `claude` to `--emit`
choices; dispatch `claude-global → emit_claude_global` (near
[:93](../../build.py)); generalize the post-emit marker block
([:101-114](../../build.py)) to stamp into the Claude config dir when the emit
name starts with `claude`. The emit name already disambiguates the target dir —
**no new `--host` flag**.

### 6. Web API — host-aware rows + restore

In [rituals/_web_actions.py](../../rituals/_web_actions.py):

- **`api_installs`** loops the triples:
  `{"id": f"{host}:{scope}", "host": host, "scope": scope, "path": str(root),
  "state": _install_state(root, host)}`.
- **`api_install_toggle`** keys its allowlist on **`(host, path)`** (not path
  alone — see Coexistence) and passes the resolved host into
  `_install_deactivate(root, host)` / `_install_reactivate(root, host)`.
- **`api_restore`** ([:104](../../rituals/_web_actions.py)) becomes host-aware:
  pick `emit_claude_global` vs `emit_opencode_global` from the detected emit
  (`state.emit`, already detected by `_installed_defaults`) so drift/restore
  renders against the right host. No silently-OpenCode-only restore on a Claude
  row.

### 7. The Harnesses orchestration page

**Do not write a new component — promote the existing install panel.**
[web/src/pages/Settings/Installs.jsx](../../web/src/pages/Settings/Installs.jsx)
already lists the `(host, scope, path)` rows with per-row toggles and is
path-keyed; [web/src/api/installs.js](../../web/src/api/installs.js) is already
path-keyed. Lift it to a top-level page:

- [web/src/lib/router.js](../../web/src/lib/router.js) — add `'harnesses'` to
  `FLAT_VIEWS`.
- `App.jsx` — render `<Harnesses>` (thin wrapper over the Installs panel) at that
  route.
- [web/src/components/Rail.jsx](../../web/src/components/Rail.jsx) — one nav entry.

Then extend the page with what Settings/Installs lacks: a **per-row Rebuild**
(fires the themed `build` action scoped to that row's detected theme/emit) and a
top-of-page **"Rebuild all"** button (the `build-all` action, §8). The page is
the single console for all installs; the dashboard keeps only the headline
rebuild-all.

### 8. rebuild-all (`build-all`)

The job runner already runs a list of commands sequentially in one job, **but
stops on the first failure** ([_web_jobs.py:74-94](../../rituals/_web_jobs.py)) —
wrong for rebuild-all, where one broken install must not block the rest. So the
loop lives in **Python, not the job list**:

- Add a **`rebuild-all` subcommand** to [rituals/harness.py](../../rituals/harness.py)
  that enumerates `_install_targets()`, rebuilds each **in-place** (reading each
  root's own `.geneseed-theme`/`.geneseed-emit` markers), **best-effort**
  (continue past a failed install, print per-install status, return non-zero only
  on catastrophic error).
- Web side is one entry in `action_commands`
  ([_web_jobs.py:153](../../rituals/_web_jobs.py)):
  `"build-all": [[py, h, "rebuild-all"]]`. No JobManager change, no per-install
  theme threading in the web layer, and the **CLI + TUI get rebuild-all for
  free**.
- Dashboard wiring: the Build buttons in
  [StatusView.jsx:79](../../web/src/pages/Dashboard/StatusView.jsx),
  [GreenhouseView.jsx:232](../../web/src/pages/Dashboard/GreenhouseView.jsx),
  [OperatorHudView.jsx:160](../../web/src/pages/Dashboard/OperatorHudView.jsx),
  and [Onboarding.jsx:99](../../web/src/pages/Dashboard/Onboarding.jsx) swap
  `onAction('build', {theme, emit})` → `onAction('build-all')`. **Name it
  `build-all`, not `rebuild-all`,** so the auto-reload-on-finish in
  [useJobs.js:58](../../web/src/hooks/useJobs.js) (`action.startsWith('build')`)
  keeps working with zero extra code.

---

## Coexistence model

**Coexistence falls out of distinct root dirs + per-root markers — no new state
file.** OpenCode-global lives in `~/.config/opencode`, Claude-global in
`~/.claude`; folder installs live under their named dir with `.opencode/` vs
`.claude/` markers. Each root carries its own `.geneseed-manifest.json`,
`.geneseed-emit/-theme/-version`, and `.geneseed-disabled/` stash. The two emits
write to **disjoint dirs**, so rebuilding one is invisible to the other.
memory/notebook/wiki stay per-root and out of every manifest, so neither host
deletes the other's host-state.

**Two installs of one host at different scopes** (claude-global at `~/.claude`
AND claude-project at `./.claude`) are two distinct roots with independent
markers/stashes — they list and toggle independently. Active/disabled stays
purely "does this root's `.geneseed-disabled/` exist", evaluated per row.

**The one real hazard — a single cwd holding both `.opencode/` AND `.claude/`.**
A purely path-keyed toggle allowlist would collapse the two rows to one dict
entry and could dispatch a deactivate to the **wrong host's** tree-mover (a
cross-host clobber). Two structural fixes, both small and both required:

1. **De-dup `_install_targets` on the `(host, resolved-path)` pair**, not path
   alone, and have `_install_kind(root, host)` test **only that host's**
   `project_marker`. A cwd with both markers yields two independent,
   correctly-typed rows.
2. **Key the toggle allowlist on `(host, path)`** and give each install a
   **host-tagged stash dir** (e.g. `.geneseed-disabled/<host>/`) so two same-root
   installs disabled at once can't overwrite each other's stashed bytes.

---

## Out of scope (YAGNI — add-when triggers)

- **Claude JS-plugin parity** (ponytail, primary-agent switch, `/ponytail`,
  notify). No JS-plugin runtime in Claude; hooks already cover
  context/learn/git-gate. *Add when* a user asks for ponytail-in-Claude — build
  it as a Claude hook/skill, not a `.js` port.
- **Curated colour themes for Claude.** No analogue. *Add when:* never, unless
  Claude ships a TUI theme format.
- **`--host` flag on build.py.** The emit name already disambiguates the dir.
- **Merging the two `emit_*_global` into one parameterized function.** The ~15-line
  orchestration tails differ enough that siblings reusing shared helpers beat one
  over-branched function. Keep them siblings.
- **Hiding the colour-theme affordance on Claude rows.** Cosmetic honesty, not
  correctness. *Add when* you ship the per-install rebuild button — do both
  together so each row only exposes controls its host supports.

---

## Build order (execution plan)

Bottom-up: get a Claude harness building from the CLI and verifiable before any
web work, so each phase is independently testable.

1. **Claude emit + user-content safety, CLI-only.** `_claude_config_dir`,
   `emit_claude_global`, the Claude agent-frontmatter branch (`disallowedTools`),
   `_merge_claude_settings` (reversible hooks merge + absolute paths), the
   CLAUDE.md managed-block merge, **claim-on-create in `_write_native_layer`**
   (skip pre-existing unowned files — benefits both hosts), the `HOSTS`
   descriptor, `build.py` dispatch + marker block. **Verify against a populated
   config dir** (point `$HOME` at a temp dir pre-seeded with a user
   `settings.json`+own hook, a same-named `skills/impeccable`, a user agent, a
   user `CLAUDE.md`): install writes a coherent harness (CLAUDE.md block, skills
   in Claude schema, agents with `disallowedTools`, hooks absolute) **without
   overwriting the user's settings, skills, or commands**; the same-named skill is
   kept + warned; re-emit prunes only Geneseed's own; **uninstall removes only
   owned files and leaves every user file + the user's settings keys intact**;
   `~/.claude/plugins/` is never written. Effort **M**.
2. **Folder scope.** `emit_claude` for a named dir + `.claude/` marker.
   **Verify:** install into a throwaway repo; markers land; coexists with that
   repo's `.opencode/` if present. Effort **S**.
3. **Host-aware install state + activation.** Thread `host` through
   `_install_targets` and the activate/deactivate engine; the `(host, path)`
   de-dup + host-tagged stash. **Verify:** detect, deactivate, reactivate a
   Claude install with the OpenCode one untouched; a cwd with both markers shows
   two correctly-typed rows that toggle independently. Effort **M**.
4. **Setup/detection plumbing.** `EMIT_OPTIONS`, `_installed_defaults`,
   `_theme_of_dir`. **Verify:** `harness status`/setup wizard list the Claude
   install with its theme. Effort **S**.
5. **Web API host-awareness.** `api_installs` triples, `(host, path)` toggle
   allowlist, host-aware `api_restore`. **Verify:** `/api/installs` returns four
   rows; toggling each is correct; restore on a Claude row renders Claude. Effort
   **S–M**.
6. **rebuild-all.** `rebuild-all` subcommand + `build-all` action entry.
   **Verify:** one job rebuilds every install in place, best-effort, streaming
   per-install status; a deliberately broken install does not abort the rest.
   Effort **S–M**.
7. **Harnesses page + dashboard rewire.** Promote Installs → top-level page (route
   + nav + wrapper), per-row Rebuild, Rebuild-all button; dashboard Build buttons
   → `build-all`. **Verify in the live preview:** four rows render with
   independent badges/switches; Rebuild-all fires one job; dashboard rebuild
   rebuilds all. Effort **S**.

**Total: M.** Everything load-bearing (non-destructive prune, stash/rollback,
coexistence, the web rows) is reuse; the only genuinely new code is the Claude
agent frontmatter, `_merge_claude_settings`, and the `rebuild-all` loop.

---

## Tests

Mirror the repo's split (`tests/test_*.py` unittest for Python,
`web/src/__tests__/*.test.js` vitest for the UI):

- **Emit (unittest, like the existing build tests):** `emit_claude_global` into a
  temp dir writes CLAUDE.md + Claude-schema agents + identical skills + absolute
  hooks; a second emit prunes only its own owned set and never touches
  memory/notebook/user files; skills are byte-identical to the OpenCode emit from
  the same source; folder `emit_claude` round-trips with a `.claude/` marker.
- **User-content safety (unittest — the core of this revision):** into a temp
  config dir pre-seeded with a user `settings.json` (carrying the user's own
  hook), a same-named skill (`skills/impeccable/SKILL.md`), a user agent, and a
  user `CLAUDE.md`, an emit **keeps all of them** — the skill is skipped + warned
  (not clobbered), the user's settings keys + their own hook survive, the user's
  CLAUDE.md prose survives around the Geneseed block; **none of the user files
  enter the manifest**; uninstall removes only Geneseed-owned files and leaves
  every user file + user settings intact; `~/.claude/plugins/` is never written.
- **Install state (unittest):** `_install_targets` enumerates `(host, scope,
  root)` triples; a cwd with both `.opencode/` and `.claude/` yields two
  correctly-typed rows; deactivate/reactivate a Claude root leaves the OpenCode
  root untouched; two same-root installs disabled at once keep separate stashes
  (host-tagged stash dir).
- **rebuild-all (unittest):** loops all detected installs; **continues past a
  failing install** and reports it; rebuilds each in its own detected
  theme/emit; returns success when all succeed.
- **Web API (unittest, like `tests/test_web.py`):** `api_installs` returns the
  host/scope/path/state rows; `api_install_toggle` allowlist is keyed on `(host,
  path)` and 404s an unknown pair; `api_restore` selects the emit by host.
- **Web UI (vitest):** the Harnesses page renders one row per install with
  host·scope badges keyed on path; the build picker auto-gains `claude-global`
  from `EMIT_OPTIONS`; the dashboard rebuild button dispatches `build-all`.
- **Doctor:** a Claude install is link/token-clean across themes, like the
  OpenCode emit.

---

## Open questions

- **Resolved this revision** (folded into the design above): config dir is
  `~/.claude` with **no** relocating env var
  ([configuration](https://code.claude.com/docs/en/configuration.md)); subagent
  frontmatter is `name`+`description`+`tools`/`disallowedTools`/`model`/
  `permissionMode` ([sub-agents](https://code.claude.com/docs/en/sub-agents.md));
  `~/.claude/plugins/` is marketplace-managed and must not be written
  ([plugins](https://code.claude.com/docs/en/plugins.md)).
- **CLAUDE.md managed-block format.** Confirm the delimited-block insert/update/
  remove is robust to a user editing around it — idempotent re-emit, clean
  uninstall. Spike before Phase 1 lands.
- **Skill frontmatter parity.** Claude wants `description` (+ optional
  `disable-model-invocation`); confirm Geneseed's `SKILL.md` frontmatter is
  accepted as-is by both hosts (the byte-identical claim) or needs a per-host
  tweak.
- **Cross-scope settings override.** Claude merges user vs project settings by
  **whole-key override, not deep-merge** — a project `.claude/settings.json` with
  its own `hooks` key fully shadows the user-scope Geneseed hooks. Fine for v1
  (folder-scope install writes project hooks too), but note it so a user isn't
  surprised that a project's `hooks` silences the global harness hooks.
- **Per-install Rebuild vs the single-target picker.** `WebState` holds one
  `target`/`theme` ([_web_core.py:699](../../rituals/_web_core.py)). Per-row
  Rebuild can reuse the themed `build` action with that row's detected theme/emit
  without touching `WebState`; confirm that's enough, or whether a row needs to
  set `state.target` before dispatch.
- **Folder-install detection beyond cwd.** `_install_targets` detects a project
  install in the current root only. Listing folder installs the user made in
  *other* repos would need a registry; v1 lists global installs + the cwd
  project. Decide whether that's sufficient.
