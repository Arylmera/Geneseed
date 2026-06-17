# Live activity surface

**Date:** 2026-06-15 · revised 2026-06-17
**Status:** ready to build

## Problem

Geneseed lets you see what the harness **is** — Laws, Agents, Skills, Memory,
Notebook, Docs are all browsable in the web console — but nothing surfaces what
the harness is **doing**. When the orchestrator fans out to `reviewer`,
`tester`, and `explorer` in parallel, or an agent is blocked waiting for input,
there is no live view of it. The console is a reference manual, not a dashboard;
the six OpenCode plugins (`geneseed-context`, `geneseed-guard`, `geneseed-learn`,
`geneseed-notify`, `geneseed-ponytail`, `geneseed-workflow`) inject and distil,
but never report runtime state.

Prior art: `oh-my-opencode-slim/companion` — a Rust/egui floating HUD that shows
which agent is active. Its **architecture** is the borrowable part:

- The agent runtime (an OpenCode JS plugin) **writes** a JSON state file.
- A separate GUI process **reads** it by polling.
- The two are fully decoupled: language-agnostic, crash-isolated, no RPC.

Geneseed should not adopt its Rust binary — that breaks the stdlib-only,
nothing-to-install ethos. But Geneseed already runs a stdlib HTTP server
(`rituals/_web_*.py`) and a React console (`web/`), so the same file-IPC seam can
light up a **live view inside the console we already ship** — themed, cross-tool,
zero new dependency.

---

## What the prior spec got wrong (grounded findings)

Three load-bearing assumptions did not survive contact with the code:

1. **The path seam was disjoint.** The spec told the writer to use
   `$GENESEED_HARNESS/<store>/activity/…`. But the Python reader resolves
   `_opencode_config_dir()` ([_build_global.py:10](../../_build_global.py)) —
   `$OPENCODE_CONFIG_DIR > $XDG_CONFIG_HOME/opencode > ~/.config/opencode` — and
   stores it as `WebState.target` ([_web_core.py:699](../../rituals/_web_core.py)).
   Writer and reader would have looked in different places. The existing
   `geneseed-ponytail` plugin already writes a state file to **the OpenCode config
   dir** (`<cfg>/opencode/.geneseed-ponytail`,
   [geneseed-ponytail.js:80](../../adapters/opencode/plugins/geneseed-ponytail.js)).
   **That is the shared rendezvous both sides already resolve identically.** Use it.

2. **There is no `agent.start` / `agent.stop` event.** The lifecycle hooks that
   actually exist across the plugins are: `event` (catch-all, filtered by
   `event.type`), `session.created`, `session.idle`, `session.compacting`,
   `tool.execute.before`, `command.execute.before`, and the
   `experimental.chat.*.transform` hooks. `active_agents` cannot be *read* from a
   clean event — it must be **inferred** from session lifecycle + tool activity.
   See §3.

3. **The cross-process lock is avoidable, not mandatory.** The companion uses a
   single shared file + `mkdir` lock because one writer serves all sessions. In
   OpenCode, multiple independent processes (one per `opencode` invocation) would
   all contend on one file. The lazy-correct fix is **one file per session**
   (writer owns it exclusively, no lock) and let the reader glob + merge. This
   eliminates the lock, the torn-read window, and the contention in one move —
   matching how `geneseed-workflow` already shards by run id
   ([geneseed-workflow.js:79](../../adapters/opencode/plugins/geneseed-workflow.js)).

---

## Design

Two parts, decoupled by a directory of small JSON files in the OpenCode config dir.

### 1. Writer — a `geneseed-activity` OpenCode plugin

A seventh plugin, sibling to the existing six in `adapters/opencode/plugins/`,
following their exact module shape (named async factory + default export,
returning a map of hook handlers). Resolve the OpenCode config dir the way
`geneseed-ponytail` already does — copy `statePath()` verbatim
([geneseed-ponytail.js:80](../../adapters/opencode/plugins/geneseed-ponytail.js)):

```js
function activityDir() {
  const cfg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(cfg, "opencode", "activity")   // <cfg>/opencode/activity/
}
```

**One file per session, named by session id:** `activity/<session_id>.json`. The
writer for a given OpenCode process touches only the files for sessions it owns —
**no cross-process lock needed**. Atomic write per file (write `…json.<pid>.tmp`,
`rename` over target) keeps the reader from seeing a torn file. (companion
`state.rs` discipline, without its `StateWriteLock`.)

**Per-session entry schema:**
```jsonc
{
  "version": 1,
  "session_id": "ses_…",
  "parent_id": "ses_…" | null,   // set for sub-agent / council sessions
  "agent": "reviewer" | null,    // see §3 — best-effort, may be null
  "title": "…",                  // session title if available
  "cwd": "/abs/path",
  "status": "busy" | "waiting-input" | "idle",
  "pid": 12345,                  // process owning this session — liveness key
  "updated_at": "2026-06-17T…Z"
}
```

The reader assembles the array; **no top-level `sessions` wrapper** is written —
each file is exactly one entry. Sub-agents are *separate files* linked by
`parent_id`, not a nested `active_agents` array (resolves old open question §3):
the reader builds the parent→children tree, so a debate/fan-out in progress
renders as a parent card with its specialists nested under it.

The plugin is the only OpenCode-specific piece. A Claude Code adapter writing the
same per-file schema into the same dir lights up the same view, untouched.

### 2. Reader — a live "Activity" view in the web console

Reuse the running `ThreadingHTTPServer`; add nothing to the dependency surface.

- **`GET /api/activity`** — new handler in `rituals/_web_activity.py` (mirrors
  `_web_overview.py`'s `api_overview(state) -> dict` shape), registered with one
  line in `do_GET()` ([_web_server.py:44](../../rituals/_web_server.py)):
  ```python
  if path == "/api/activity":
      return self._send_json(api_activity(state))
  ```
  It globs `state.target / "activity" / "*.json"`, parses each (skipping any that
  fail to parse — never 500 on garbage), **prunes**, and returns the live tree.

- **Reader-side pruning is primary** (the prior spec put pruning only in the
  writer — but a *crashed* writer never writes again, so its stale file lingers
  forever). The reader drops an entry when:
  - its `pid` is no longer alive (`os.kill(pid, 0)`; on Windows, where signal 0
    isn't portable, fall back to the staleness check only), **or**
  - `updated_at` is older than a generous threshold (e.g. 5 min) as a backstop.

  pid-liveness is the real signal; `updated_at` is only a backstop. This means
  the writer does **not** need a heartbeat timer for a long, tool-less "thinking"
  turn to stay visible (resolves an old open question). Optionally the reader
  deletes files whose pid is dead, so the dir self-cleans.

- **Client:** a new React page (`web/src/pages/Activity.jsx`) + api module
  (`web/src/api/activity.js`, `export const activity = () => get('/api/activity')`),
  composed into the facade ([web/src/api/index.js](../../web/src/api/index.js)),
  added to `FLAT_VIEWS` ([web/src/lib/router.js](../../web/src/lib/router.js)),
  a `Rail` nav entry ([web/src/components/Rail.jsx](../../web/src/components/Rail.jsx)),
  and dispatched in `App.jsx`. Poll on an interval with the existing
  `setInterval`-in-`useEffect` pattern from `useJobs`
  ([web/src/hooks/useJobs.js:39](../../web/src/hooks/useJobs.js)) — 1s is plenty
  (SSE only if it ever proves needed).
- Render one card per root session: cwd, title, status badge, and nested active
  sub-agents. Reuse the catalog's agent metadata so each named agent links into
  its Library page — the companion shows a GIF; we show the agent's actual card.
- **Empty state:** "No active sessions."
- **Theming:** inherits the deployed theme's CSS-var tokens
  ([web/src/styles.css](../../web/src/styles.css)) like every other view — no work.

### 3. Status & agent inference (resolved against the SDK)

Spiked against `@opencode-ai/sdk` 1.17.5
(`~/.config/opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`).
The original spec assumed there was no clean signal — there is more than expected:

- **Status is first-class.** `EventSessionStatus` (`type: "session.status"`)
  carries `{sessionID, status}` where `SessionStatus` is `{type:"idle"} |
  {type:"retry", attempt, message, next} | {type:"busy"}` (types.gen.d.ts:396).
  Plus `session.idle` and `session.deleted` events. No need to infer "busy" from
  `tool.execute.before`.
- **Agent name IS available — but not on `Session`.** The `Session` object
  (types.gen.d.ts:465 — `id`, `projectID`, `directory`, `parentID?`, `title`,
  `time`) has **no** agent/mode field, so `client.session.get()` would *not*
  surface it. It lives on the **`AssistantMessage`** instead: `mode: string`,
  with `path: {cwd, root}` and `sessionID` (types.gen.d.ts:98), delivered via the
  `message.updated` event.
- **Sub-agent fan-out is explicit.** A `subtask` message Part —
  `{type:"subtask", prompt, description, agent: string}` (types.gen.d.ts:348),
  delivered via `message.part.updated` — names each spawned specialist
  (`reviewer`/`tester`/`explorer`) directly. This is the exact signal the panel's
  fan-out view needs; the writer records it under the parent session.

Resulting event → entry map:

| Event | Effect on the session's entry |
|---|---|
| `session.created` | upsert; capture `parent_id` from `info.parentID` |
| `session.status` | set `status` from `properties.status.type` (`busy`/`idle`/`retry`) |
| `session.idle` | `status: "waiting-input"` (turn finished; agent yielded) |
| `message.updated` | capture `mode` → `agent`, `path.cwd` → `cwd`; bump `updated_at` |
| `message.part.updated` (subtask) | record `agent` as an active sub-agent under this session |
| `session.deleted` | delete this session's file (clean removal, not just pid prune) |

`mode` is the running agent's name; map `retry` to a `busy`-with-note badge if
worth surfacing, else fold into `busy`. The agent-name unknown is **closed** — no
spike remains.

### 4. Optional later — ambient mode & guard status

- **Guard "blocked by Law" status.** `geneseed-guard` throws synchronously in its
  own `tool.execute.before`
  ([geneseed-guard.js:184](../../adapters/opencode/plugins/geneseed-guard.js)); the
  activity plugin can't observe another plugin's throw. Clean path: have guard
  write a transient `blocked` marker (same dir, same pattern) on a block, which the
  reader folds into status. **Deferred** — `busy`/`waiting-input`/`idle` ships first.
- **Ambient HUD.** Cheapest first: an always-on-top browser popout of the panel,
  or a terminal tail in `./geneseed`. A native floating window stays **out of
  scope** — it is what the stdlib ethos exists to avoid.

---

## Why this shape

- **Same seam, native materials, paths that actually meet.** Writer and reader
  both resolve the OpenCode config dir today; we reuse that, not a phantom store.
- **No lock, no torn reads.** One file per session means each writer owns its file;
  concurrency disappears by design instead of being managed.
- **No new dependency, no build step.** Writer is JS in the runtime; reader is
  stdlib Python in the existing server + a React page in the existing console.
- **Cross-tool by construction.** The reader keys off a directory of JSON files,
  not OpenCode. Any adapter writing the schema lights up the same view.
- **Crash-isolated.** A dead writer's file is pruned by the reader on pid-liveness;
  the console degrades to "no active sessions" rather than breaking.

## Open questions (remaining)

- **Per-project installs.** `.opencode/` installs and the global config dir are
  different roots; v1 reads only the global config dir as the single rendezvous.
  Per-project sessions would need the writer to *also* (or only) write to the
  global dir. Decide: always write global, or make the dir configurable via env.
- **pid-liveness on Windows** — `os.kill(pid, 0)` isn't portable; the staleness
  backstop covers it, but confirm the degradation is acceptable.
- **Stale threshold** — 5 min backstop is a guess; tune once observed.

## Tests

- **Writer (vitest, like `web/src/__tests__/api.test.js`):** atomic-write
  round-trips; status transitions across the §3 event table; one-file-per-session
  isolation (two sessions never clobber each other); schema `version` tolerance.
- **Reader (unittest, like [tests/test_web.py](../../tests/test_web.py)):**
  `api_activity` returns `[]` on an empty/absent dir; parses a dir of entries into
  the parent→children tree; prunes dead-pid and stale entries; never 500s on a
  half-written or garbage file; builds the nested tree from `parent_id` links.
- **Doctor:** the new plugin is link/token-clean across themes, like the other six.
