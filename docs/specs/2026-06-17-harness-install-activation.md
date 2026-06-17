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

There is no way to turn a *whole* install **off**. The only "off" today is
`cmd_uninstall` ([_harness_mcp.py:274](../../rituals/_harness_mcp.py)), which
**deletes** the owned files. There is no reversible *disabled* state.

We want, from the web UI, a single **switch** that **deactivates an entire
install** — rules (AGENT.md) and the owned artifacts (agents, skills, plugins,
workflows, command, theme) — **without deleting the local files**, and
**reactivates** it later to the exact prior bytes. Scope for v1 is **OpenCode,
both scopes**.

This is real on-disk activation, **not** docs filtering: the OpenCode/Claude
Docs selector ([Docs/index.jsx:122](../../web/src/pages/Docs/index.jsx)) is
unrelated and stays as-is. The on-disk state is the single source of truth — no
localStorage, no client-side preference. The web UI only triggers the action and
reflects what's on disk.

### Out of scope (and why)

- **MCP servers.** No emit ever writes `mcp.<name>` blocks into `opencode.json`
  — not [_build_emit.py](../../_build_emit.py), [_build_global.py](../../_build_global.py),
  nor [build.py](../../build.py). MarkItDown is wired *only* by the separate MCP
  servers panel ([McpServers.jsx](../../web/src/pages/Settings/McpServers.jsx)).
  **MCP is not part of a harness install**, so this switch never touches it; it
  keeps its own per-server panel. (Earlier drafts disabled all MCP servers here —
  that was a stray thread from the MCP card's "global config" target and is
  removed.)
- **LSP (`"lsp": true`).** Shared config that the emit happens to add, but it is
  not what *loads* the harness — it just enables OpenCode's built-in language
  servers. Leaving it on while disabled is harmless; removing/restoring it only
  risks clobbering a value the user may have set. Left untouched by design.
- **Claude Code installs.** Geneseed has no Claude emit or detection — only
  hand-merged `settings.json` hooks. A different shape; a later spec.

## How an install goes live, and the reversible off-lever for each

| Capability | What makes it live | Reversible off-lever |
|---|---|---|
| Rules (AGENT.md) | path in `opencode.json` `instructions` | remove the entry; re-add it (a known constant) — `_unmerge_opencode_json` ([:12](../../rituals/_harness_mcp.py)) / `_merge_opencode_json` ([_build_emit.py:295](../../_build_emit.py)) |
| Agents / Skills / Plugins / workflows / command / theme | **file/dir presence** — OpenCode auto-discovers them; **no config flag exists** ([HOW-OPENCODE-LOADS.md §3–4](../../adapters/opencode/HOW-OPENCODE-LOADS.md)) | **move the files aside**, into a sibling stash |

The bottom row is the crux: agents, skills, and plugins have **no disable flag**
in OpenCode — they load purely because the file sits in `agents/`, `skills/`, or
`plugins/`. The only non-destructive off-lever is to **move them out of the
discovery path**. Geneseed already knows exactly which files it owns: the global
emit writes a manifest, `.geneseed-manifest.json`, with an `owned` list
([_build_global.py](../../_build_global.py)); the per-repo emit owns the entire
`.opencode/` directory ([_build_emit.py:515](../../_build_emit.py)).

So the whole switch is:

> **Deactivate** = drop the AGENT.md `instructions` entry → **move every owned
> artifact into a sibling `.geneseed-disabled/<rel>`**. **Reactivate** = move it
> all back → re-add the entry → remove the empty stash.

**The stash directory's presence is the disabled flag; its contents are the
restore source.** There is *no* recorded JSON state — nothing to drift, nothing
to mis-read across versions. Reactivate moves the *same bytes* back, so an
upgrade between deactivate and reactivate cannot strand a stale snapshot.

It is a **reversible sibling of `_uninstall_global`**: the same file-walk and
empty-dir pruning, but `move` into the stash instead of `unlink`, plus an inverse
restore. Memory and notebook are never in `owned`, so they are never touched —
identical to uninstall's guarantee.

## Fix

Three layers, smallest-diff first: a backend engine, two web endpoints, one
Settings card.

### Part 1 — backend engine ([rituals/_harness_mcp.py](../../rituals/_harness_mcp.py))

This file already houses the install lifecycle (uninstall, manifest, the JSON
helpers), so the new functions live beside them. One constant:

```python
DISABLED_STASH = ".geneseed-disabled"   # sibling dir; presence == disabled
```

**`_install_targets() -> list[tuple[str, Path]]`** — candidate roots, most-local
first, mirroring `_mcp_targets` ([:158](../../rituals/_harness_mcp.py)):

```python
def _install_targets():
    """Roots that may carry a Geneseed install, most-local first: this project's
    root, then OpenCode's global config dir. De-duplicated when cwd IS the global
    config dir (else both rows would point at one root and collide)."""
    cands = [("this project", Path.cwd())]
    try:
        cands.append(("global config", build._opencode_config_dir()))
    except Exception:
        pass
    seen, out = set(), []
    for label, root in cands:
        if root.resolve() not in seen:
            seen.add(root.resolve()); out.append((label, root))
    return out
```

**`_install_kind(root) -> "global" | "project" | None`** — which move strategy
applies, so the engine never has to guess from an untagged path:

- `global` if `root / build.GLOBAL_MANIFEST` exists.
- else `project` if `(root / ".opencode").is_dir()`.
- else `None` (no install here).

**`_install_state(root) -> "active" | "disabled" | "absent"`**:

- `disabled` if `(root / DISABLED_STASH).is_dir()`.
- else `active` if `_install_kind(root)` is not `None`.
- else `absent`.

> `# ponytail: state is just "does the stash dir exist" + "is an install present".`
> `# No JSON record to keep in sync with the filesystem — the dir IS the record.`

**`_install_deactivate(root) -> dict`** — **all-or-nothing**, so a failure leaves
the install fully `active`, never half-gutted:

1. Refuse unless `_install_state(root) == "active"` (`{"ok": False, "error": …}`).
   This makes the operation idempotent and stops a second click from running over
   a stash.
2. Resolve `target = build._opencode_target(root / "opencode.json")`. If it is a
   commented `.jsonc`, **abort** and move nothing — the same refusal
   `_unmerge_opencode_json` and the MCP toggle already use (a non-destructive
   rewrite would drop the user's comments).
3. Build the move-list:
   - **project**: the single entry `.opencode/`.
   - **global**: the manifest `owned` list **minus `VERSION_MARKER`** (the only
     marker actually in `owned` — see [_build_global.py:155](../../_build_global.py);
     markers stay in place so theme/emit/version detection keeps working while
     disabled).
   Guard every rel with `_within(root, root / rel)` before touching it (reject a
   `..`-escaping manifest entry), mirroring `api_restore`.
4. **Move** each entry to `root / DISABLED_STASH / <rel>` (`mkdir parents`). If
   **any** move raises, **roll back** every move already done, return
   `{"ok": False, "failed": [...]}`, and touch nothing else. The install is still
   `active`.
5. Only after every file moved: drop the AGENT.md `instructions` entry from
   `target` via `_unmerge_opencode_json`. Prune emptied owned dirs (`agents
   skills plugins workflows command`) — the `_uninstall_global` ancestor-climb
   ([:243](../../rituals/_harness_mcp.py)), not a destructive rmtree.

Return `{"ok": True, "kind": kind, "moved": n}`.

> `# ponytail: config edit is the LAST step and the only non-move mutation, so a`
> `# move failure rolls back cleanly with the instructions entry still intact.`

**`_install_reactivate(root) -> dict`** — the inverse:

1. Refuse unless `_install_state(root) == "disabled"`.
2. **Re-emit-while-disabled guard:** if `_install_kind(root)` is not `None` (live
   files already exist — the user ran `geneseed build`/`upgrade` while disabled),
   the install is already active. Discard the now-stale stash, ensure the
   `instructions` entry is present, and return `{"ok": True, "note": "install was
   re-created while disabled; discarded the stashed snapshot"}`. (No clobber, no
   orphaned stash.)
3. Otherwise move every entry under `DISABLED_STASH` back to `root / <rel>`
   (`mkdir parents`). If a single destination already exists, **skip it, keep the
   stash, and return `ok: False`** with the leftovers — never delete the stash
   while anything is unrestored.
4. Re-add the AGENT.md `instructions` entry (reuse the emit's merge; it is a known
   constant). Remove the now-empty stash dir.

If the move/prune logic doesn't cleanly share with `_uninstall_global`, factor a
short `_move_tree(src, dst)` helper — don't fork the whole uninstall routine.
`_archive_memory` is *illustrative only* (it moves one dir to a timestamped dest,
not a per-rel walk); this needs its own helper.

### Part 2 — web API

**[rituals/_web_actions.py](../../rituals/_web_actions.py)** (beside `api_mcp`,
[:141](../../rituals/_web_actions.py)):

```python
def api_installs(state):
    """Detected OpenCode installs and their on/off state. One row per scope."""
    out = []
    for label, root in harness._install_targets():
        out.append({"id": f"opencode:{label}", "host": "opencode", "scope": label,
                    "path": str(root), "state": harness._install_state(root)})
    return {"installs": out}

def api_install_toggle(state, body):
    """Deactivate or reactivate the install at `path`. Non-destructive."""
    # Path allowlist — mirror api_mcp_toggle: the body path MUST be one of the
    # detected roots, else 404. This endpoint moves whole trees; never build the
    # move root from raw body input.
    known = {str(r): r for _l, r in harness._install_targets()}
    root = known.get(body.get("path") or "")
    if root is None:
        raise NotFound("unknown install path")
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
markup): one row per install showing `host · scope`, `<code>{path}</code>`, a
state badge (`active` / `disabled` / `not installed`), and a switch:

- **active** → the toggle confirms first (like Uninstall at
  [Settings/index.jsx:204](../../web/src/pages/Settings/index.jsx)): *"Deactivate
  this install? Files are moved aside, not deleted — reactivate any time."* →
  `api.installToggle(path, 'deactivate')`, then reload.
- **disabled** → `api.installToggle(path, 'activate')`, then reload.
- **absent** → no switch (just the badge).
- Keep `busyKey` set across the request — the move can touch a whole `.opencode/`
  tree, so the switch must disable to block a double-click.
- On a `409`, surface the returned `error` / `failed` list in the `note` line
  (commented `.jsonc`, a rolled-back partial move, or an unrestored leftover) —
  same as the MCP panel. Never report success when `ok` is false.

Mounted as a new **"Harness installs"** card in
[Settings/index.jsx](../../web/src/pages/Settings/index.jsx), placed **above the
MCP servers card** (~[:172](../../web/src/pages/Settings/index.jsx)) so the page
reads install → its MCP wiring. The Docs page and the MCP card are untouched.

## Files touched

| File | Change |
|---|---|
| `rituals/_harness_mcp.py` | `DISABLED_STASH`, `_install_targets`, `_install_kind`, `_install_state`, `_install_deactivate`, `_install_reactivate` (+ `_move_tree` if needed) (Part 1) |
| `rituals/_web_actions.py` | `api_installs`, `api_install_toggle` with path allowlist (Part 2) |
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
   them + an opencode.json with the AGENT.md `instructions` entry). Assert:
   - `api_installs` returns one row per scope with the right `state`.
   - after deactivate: the artifacts live under `.geneseed-disabled/`, the
     AGENT.md `instructions` entry is gone, the stash dir exists, and **no file
     was deleted**.
   - after reactivate: artifacts back at their original rel paths, the
     `instructions` entry restored, stash dir gone.
   - **roll-back:** make one owned file un-movable (e.g. a dir where a file is
     expected, or chmod) → deactivate returns `ok:false`, every already-moved file
     is back, the `instructions` entry is intact, state is still `active`.
   - **re-emit-while-disabled:** deactivate, recreate the live files, reactivate →
     `ok:true` with the "discarded the stashed snapshot" note, stash gone, nothing
     clobbered.
   - a commented `.jsonc` opencode config makes deactivate return `ok:false` and
     move nothing. Model on existing uninstall tests in
     [tests/test_build.py](../../tests/test_build.py) if present.
2. **API:** `curl -s localhost:<port>/api/installs`; a POST with an unknown
   `path` returns `404`.
3. **Rebuild the web bundle.** The server serves the *committed* React build from
   `web/dist/` ([_web_server.py:168](../../rituals/_web_server.py)), not `web/src/`
   — so the card only appears after `cd web && npm ci && npm run build` and a
   server restart. `web/dist/` is tracked, so commit the rebuilt bundle alongside
   the source.
4. **Live (global):** with a real `opencode-global` install, Settings → Harness
   installs → switch off. Confirm owned files moved to
   `~/.config/opencode/.geneseed-disabled/`, the `instructions` entry stripped,
   badge `disabled`; start a fresh OpenCode session and confirm the harness no
   longer loads. Switch on → files back, config restored, badge `active`, **files
   never deleted** throughout.
5. **Live (per-project):** repeat in a repo with a `.opencode/` install — the
   whole `.opencode/` directory moves aside and back.

## Deliberately skipped

- **MCP servers and LSP.** Not part of an install (see *Out of scope*); MCP keeps
  its own per-server panel, LSP is left as-is.
- **Claude Code installs.** No Claude emit/detection yet; a later spec.
- **A CLI `deactivate` command.** The engine functions could back one, but only
  the web switch was asked for. YAGNI until requested.
- **A recorded JSON state file.** The stash dir's presence + contents are the
  whole state; a parallel record would only drift from the filesystem.
- **localStorage / client-side state.** Disk is the single source of truth.
- **A per-capability toggle** (disable just skills, just one plugin). The ask is
  whole-install on/off.
