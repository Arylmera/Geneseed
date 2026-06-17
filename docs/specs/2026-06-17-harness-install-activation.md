# Harness install activation — deactivate an OpenCode install without deleting it

**Date:** 2026-06-17
**Status:** draft

## Problem

A machine can carry more than one Geneseed harness install. OpenCode alone has
two scopes:

- **global** — `~/.config/opencode` (the recommended `opencode-global` emit;
  every repo inherits it), and
- **per-project** — `.opencode/` + `opencode.json` in a repo root (the
  `opencode` emit, committed into one repository).

The web Settings surface already hints at this — the MCP card lists "this
project" and "global config" as separate targets ([_harness_mcp.py:158](../../rituals/_harness_mcp.py)).
But there is no way to turn a *whole* install **off**. The only "off" today is
`cmd_uninstall` ([_harness_mcp.py:274](../../rituals/_harness_mcp.py)), which
**deletes** the owned files. There is no reversible *disabled* state.

We want, from the web UI, to **deactivate an entire install** — rules
(AGENT.md), agents, skills, plugins, MCP servers, LSP — **without deleting the
local files**, and **reactivate** it later to exactly the prior state. Scope for
v1 is **OpenCode, both scopes**. Claude Code is out of scope (its integration is
hand-merged `settings.json` hooks with no emit or detection yet — a later spec).

This is real on-disk activation, **not** docs filtering: the OpenCode/Claude
Docs selector ([Docs/index.jsx:122](../../web/src/pages/Docs/index.jsx)) is
unrelated and stays exactly as-is. The on-disk state is the single source of
truth — no localStorage, no client-side preference. The web UI only triggers the
action and reflects what's on disk.

## How an install goes live, and how each piece turns off (the constraint that shapes everything)

What makes a deployed install *live* in OpenCode, and the **reversible** off-lever
for each — split into "config flag" vs "must move the file" because that split
decides the whole mechanism:

| Capability | What makes it live | Reversible off-lever | Reuse |
|---|---|---|---|
| Rules (AGENT.md) | path in opencode.json `instructions` | remove the entry (record it) | `_unmerge_opencode_json` ([:12](../../rituals/_harness_mcp.py)) |
| MCP servers | `mcp.<name>` blocks (default-enabled) | set each `enabled:false` (record prior) | `_mcp_set_enabled` ([:117](../../rituals/_harness_mcp.py)) |
| LSP | `"lsp": true` in opencode.json | set/remove `lsp` (record prior) | plain JSON edit |
| Agents / Skills / Plugins / workflows / command / themes | **file/dir presence** — OpenCode auto-discovers them; **no config flag exists** | **move the files aside** | move-aside, like `_archive_memory` ([:209](../../rituals/_harness_mcp.py)) |

The bottom row is the crux: agents, skills, and plugins have **no disable flag**
in OpenCode — they are loaded purely because the file is in `agents/`, `skills/`,
or `plugins/`. The only non-destructive way to turn them off is to **move them
out of the discovery path**. Geneseed already knows exactly which files it owns:
the global emit writes a manifest, `.geneseed-manifest.json`, with an `owned`
list ([_build_global.py](../../_build_global.py)); the per-repo emit owns the
entire `.opencode/` directory ([_build_emit.py:512](../../_build_emit.py)).

So:

> **Deactivate** = strip opencode.json (rules + MCP + LSP, recording prior
> values) → **move owned artifacts to a sibling `.geneseed-disabled/`** → write a
> state record. **Reactivate** = read the record → move files back → restore the
> opencode.json values.

It is a **reversible sibling of `_uninstall_global`**: same file-walk and
empty-dir pruning, but `move` instead of `unlink`, plus a restore path. Memory
and notebook are never in `owned`, so they are never touched — identical to
uninstall's guarantee.

## Fix

Three layers, smallest-diff first: a backend engine, two web endpoints, one
Settings card.

### Part 1 — backend engine ([rituals/_harness_mcp.py](../../rituals/_harness_mcp.py))

This file already houses the install lifecycle (uninstall, manifest, MCP toggles,
the JSON helpers), so the new functions live beside them. Add two constants:

```python
DISABLED_STATE = ".geneseed-disabled.json"   # at the target root; presence == disabled
DISABLED_STASH = ".geneseed-disabled"        # sibling dir holding moved artifacts
```

**`_install_targets() -> list[tuple[str, Path]]`** — candidate install roots,
most-local first, mirroring `_mcp_targets`:

```python
def _install_targets():
    """Roots that may carry a Geneseed install, most-local first: this project's
    root, then OpenCode's global config dir."""
    targets = [("this project", Path.cwd())]
    try:
        targets.append(("global config", build._opencode_config_dir()))
    except Exception:
        pass
    return targets
```

**`_install_state(root) -> "active" | "disabled" | "absent"`**:

- `disabled` if `root / DISABLED_STATE` exists (it's the authoritative flag).
- else `active` if an install is present:
  - global: `.geneseed-emit` or `.geneseed-manifest.json` present, **or**
  - per-project: `(root / ".opencode").is_dir()` **or** opencode.json
    `instructions` holds an entry whose basename is `AGENT.md`.
- else `absent`.

**`_install_deactivate(root) -> dict`** — **config first (it can refuse
cleanly), then move**, so a refusal never leaves a half-deactivated install:

1. Resolve the opencode.json target (`build._opencode_target(root / "opencode.json")`).
   If it's a commented `.jsonc`, **abort** with `{"ok": False, "error": …}` and
   move nothing — the same refusal `_unmerge_opencode_json` and the MCP toggle
   already use (a non-destructive rewrite would drop the user's comments).
2. Read it with `_mcp_load`. Record then strip, in memory:
   - `agent_entry` = the `instructions` entry whose basename is `AGENT.md`;
     remove it.
   - `mcp_prior` = `{name: server.get("enabled", True)}` for every present
     `mcp.<name>`; set each to `enabled: false` via `_mcp_set_enabled`.
   - `lsp_prior` = the current `lsp` value (or a sentinel for "absent"); remove
     the key (or set `false`).
   Write the result back with `_mcp_save`.
3. Move owned artifacts into `root / DISABLED_STASH / <rel>` (preserving rel
   paths; `mkdir parents`), then prune emptied dirs (`agents skills plugins
   workflows command themes`) — the same walk as `_uninstall_global`:
   - **global**: the manifest `owned` list **minus the markers**
     (`.geneseed-manifest.json`, `.geneseed-emit`, `.geneseed-theme`,
     `VERSION_MARKER`) — markers stay in place so theme/emit detection keeps
     working while disabled.
   - **per-project**: move the whole `.opencode/` directory (fully owned; there
     is no per-repo manifest).
   Collect per-file failures into a `failed` list and report them, exactly like
   `_uninstall_global` does for locked files.
4. Write `root / DISABLED_STATE`:
   ```json
   {"emit": "...", "ts": "...", "moved": ["AGENT.md", "agents/...", "..."],
    "agent_entry": "...", "mcp_prior": {"markitdown": true}, "lsp_prior": true}
   ```
   `ts` is stamped by the caller (an `_iso_now()`-style helper is fine here —
   this is ordinary runtime code, not a workflow script).

**`_install_reactivate(root) -> dict`** — the inverse:

1. Read `DISABLED_STATE` (`{"ok": False}` if missing).
2. For each `moved` rel, move `stash / rel` back to `root / rel` (`mkdir
   parents`). If the destination already exists (the user re-emitted while
   disabled), **skip and warn** rather than clobber.
3. opencode.json: re-add `agent_entry` to `instructions`; restore each
   `mcp_prior` enabled value via `_mcp_set_enabled`; restore `lsp_prior`. Same
   commented-`.jsonc` refusal applies.
4. Remove the now-empty stash dir and `DISABLED_STATE`.

Reuse `_mcp_load` / `_mcp_save` / `_mcp_apply` for every JSON edit. If the
move+prune logic doesn't cleanly share with `_uninstall_global`, factor a small
`_move_tree(src, dst)` helper and keep it short — don't fork the whole uninstall
routine.

> `# ponytail: deactivate disables ALL mcp servers in the config, recording each`
> `# server's prior enabled-state for an exact restore — matches "MCP off" and is`
> `# fully reversible. Narrow to Geneseed presets only if disabling user servers surprises.`

> `# ponytail: config-edit before file-move, so a commented .jsonc refuses cleanly`
> `# with nothing half-moved.`

### Part 2 — web API

**[rituals/_web_actions.py](../../rituals/_web_actions.py)** (beside `api_mcp`,
[:141](../../rituals/_web_actions.py)):

```python
def api_installs(state):
    """Detected OpenCode installs and their on/off state — the web mirror of the
    install lifecycle. One row per scope (this project, global config)."""
    out = []
    for label, root in harness._install_targets():
        st = harness._install_state(root)
        out.append({"id": f"opencode:{label}", "host": "opencode", "scope": label,
                    "path": str(root), "state": st})
    return {"installs": out}

def api_install_toggle(state, body):
    """Deactivate or reactivate the install at `path`. Non-destructive: deactivate
    moves owned files aside and strips opencode.json; activate restores both."""
    root = Path(body.get("path") or "")
    action = body.get("action")
    if action == "deactivate":
        res = harness._install_deactivate(root)
    elif action == "activate":
        res = harness._install_reactivate(root)
    else:
        res = {"ok": False, "error": f"unknown action {action!r}"}
    state.refresh()
    return res
```

**[rituals/_web_server.py](../../rituals/_web_server.py)**:

- `GET /api/installs` → `api_installs(state)` (in `do_GET`, near `/api/mcp` at
  [:59](../../rituals/_web_server.py)).
- `POST /api/install` → `api_install_toggle(state, self._read_json_body())`,
  token-guarded, returning `200 if res.get("ok") else 409` — exactly how the MCP
  toggle POST is wired ([:118](../../rituals/_web_server.py)).

### Part 3 — web UI

**[web/src/api/installs.js](../../web/src/api/installs.js)** (new), added to the
spread in [api/index.js](../../web/src/api/index.js):

```js
import { get, post } from './http.js'
export const installs = () => get('/api/installs')
export const installToggle = (path, action) => post('/api/install', { path, action })
```

**[web/src/pages/Settings/Installs.jsx](../../web/src/pages/Settings/Installs.jsx)**
(new) — modeled on [McpServers.jsx](../../web/src/pages/Settings/McpServers.jsx)
(its `useAsync` + `busyKey` + `note` pattern, and the `sw-toggle` / `badge`
markup): one row per install showing the label (`host · scope`),
`<code>{path}</code>`, a state badge (`active` / `disabled` / `not installed`),
and a control:

- **active** → toggle calls a confirm first (like the Uninstall button at
  [Settings/index.jsx:204](../../web/src/pages/Settings/index.jsx)): *"Deactivate
  this install? Files are moved aside, not deleted — reactivate any time."* →
  `api.installToggle(path, 'deactivate')`, then reload.
- **disabled** → toggle calls `api.installToggle(path, 'activate')`, then reload.
- **absent** → no toggle (just the badge).
- On a `409` (commented `.jsonc`), surface the returned `error` in the `note`
  line, same as the MCP panel.

Mounted as a new **"Harness installs"** card in
[Settings/index.jsx](../../web/src/pages/Settings/index.jsx), placed **above the
MCP servers card** (~[:172](../../web/src/pages/Settings/index.jsx)) so the page
reads install → its MCP wiring. The Docs page and the MCP card are untouched.

## Files touched

| File | Change |
|---|---|
| `rituals/_harness_mcp.py` | `_install_targets`, `_install_state`, `_install_deactivate`, `_install_reactivate`, constants (Part 1) |
| `rituals/_web_actions.py` | `api_installs`, `api_install_toggle` (Part 2) |
| `rituals/_web_server.py` | `GET /api/installs`, `POST /api/install` routes (Part 2) |
| `web/src/api/installs.js` | new API module (Part 3) |
| `web/src/api/index.js` | spread the new module |
| `web/src/pages/Settings/Installs.jsx` | new card component (Part 3) |
| `web/src/pages/Settings/index.jsx` | mount the "Harness installs" card |
| `tests/test_web.py` | `api_installs` shape + deactivate→reactivate round-trip |

## Test / verify

1. **Unit / round-trip ([tests/test_web.py](../../tests/test_web.py)):** point
   `build._opencode_config_dir` at a tmp dir (or set `OPENCODE_CONFIG_DIR`), seed
   a minimal global install (AGENT.md + an `agents/x.md` + a manifest listing
   them + an opencode.json with the AGENT.md instructions entry, an `mcp` server,
   and `lsp: true`). Then assert:
   - `api_installs` returns one row per scope with the right `state`.
   - after deactivate: the artifacts live under `.geneseed-disabled/`, the
     AGENT.md `instructions` entry is gone, the MCP server is `enabled:false`,
     `lsp` is off, `.geneseed-disabled.json` exists, and **no file was deleted**.
   - after reactivate: artifacts back in place, `instructions`/`mcp`/`lsp`
     restored to the prior values, stash and state file gone.
   - a commented `.jsonc` opencode config makes deactivate return `ok:false`
     and move nothing. Model on existing uninstall tests in
     [tests/test_build.py](../../tests/test_build.py) if present.
2. **API:** `curl -s localhost:<port>/api/installs`.
3. **Live (global):** with a real `opencode-global` install, open the console →
   Settings → Harness installs → deactivate global. Confirm owned files moved to
   `~/.config/opencode/.geneseed-disabled/`, opencode.json stripped, badge
   `disabled`; start a fresh OpenCode session and confirm the harness no longer
   loads. Reactivate → files back, config restored, badge `active`, **files never
   deleted** throughout.
4. **Live (per-project):** repeat in a repo with a `.opencode/` install — the
   whole `.opencode/` directory moves aside and back.

## Deliberately skipped

- **Claude Code installs.** Geneseed has no Claude emit or detection — only
  hand-merged `settings.json` hooks and one optional skill. Deactivating that is
  a different shape; a later spec. (Out of scope per v1 decision.)
- **A CLI `deactivate` command.** The engine functions could back one, but only
  the web trigger was asked for. YAGNI until requested.
- **localStorage / client-side state.** Disk is the single source of truth;
  duplicating it in the browser would only drift.
- **Touching the Docs OpenCode/Claude selector.** It filters documentation by
  host and is unrelated to install activation.
- **A per-capability toggle** (disable just skills, just MCP, …). The ask is
  whole-install on/off; MCP already has its own per-server panel for finer
  control.
