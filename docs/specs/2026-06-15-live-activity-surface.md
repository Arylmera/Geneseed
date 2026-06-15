# Live activity surface

**Date:** 2026-06-15
**Status:** proposed

## Problem

Geneseed lets you see what the harness **is** — Laws, Agents, Skills, Memory,
Notebook, Docs are all browsable in the web console — but nothing surfaces what
the harness is **doing**. When the orchestrator fans out to `reviewer`,
`tester`, and `explorer` in parallel, or an agent is blocked waiting for input,
there is no live view of it. The console is a reference manual, not a dashboard;
the OpenCode plugins (`geneseed-context`, `geneseed-learn`, `geneseed-guard`,
`geneseed-workflow`) inject and distil, but never report runtime state.

Prior art: `oh-my-opencode-slim/companion` — a Rust/egui floating HUD that shows
which agent is active as an animated GIF. Its **architecture** is the borrowable
part, not its implementation:

- The agent runtime (an OpenCode JS plugin) **writes** a JSON state file.
- A separate GUI process **reads** it by polling the file's mtime (~250ms).
- The two are fully decoupled: language-agnostic, crash-isolated, no RPC.

Geneseed should not adopt its Rust binary — that breaks the stdlib-only,
nothing-to-install ethos and is OpenCode- and Linux/macOS-coupled. But Geneseed
already runs a stdlib HTTP server (`rituals/_web_*.py`), so the same file-IPC
seam can light up a **live view inside the console we already ship** — themed,
cross-tool, zero new dependency.

## Design

Two parts, decoupled by a single JSON file — the companion's exact seam.

### 1. Writer — a `geneseed-activity` OpenCode plugin

A new plugin sibling to the existing four in
`adapters/opencode/plugins/`. It hooks OpenCode's tool/agent lifecycle events and
maintains a session-state file. Borrow the companion's write discipline verbatim:

- **Path:** under the harness store, resolved the way the other plugins resolve
  it (`$GENESEED_HARNESS` / config dir) — e.g.
  `<store>/activity/session-state.json`. Git-ignored, personal, ephemeral.
- **Atomic writes:** write to `…json.<pid>.tmp`, then `rename` over the target —
  POSIX-atomic, no torn reads. (companion `state.rs`.)
- **Cross-process lock:** `mkdir`-based lock dir with bounded retry, released on
  drop, for the rare concurrent writer. (companion `StateWriteLock`.)
- **Liveness:** each session carries its `pid`; stale sessions whose pid is no
  longer alive (`kill -0`) are pruned. (companion `singleton.rs` / `is_pid_alive`.)
- **Schema** (one entry per live session):
  ```jsonc
  {
    "version": 1,
    "sessions": [
      {
        "session_id": "…",
        "cwd": "/abs/path",
        "active_agents": ["reviewer", "tester"],  // parallel specialists
        "status": "busy" | "waiting-input" | "idle",
        "pid": 12345,
        "updated_at": "2026-06-15T…Z"
      }
    ]
  }
  ```
- Status precedence mirrors the companion's `choose_session`: `waiting-input`
  ranks above `busy` above `idle`, so the most interesting session sorts first.

The plugin is the only OpenCode-specific piece. A Claude Code adapter equivalent
can come later (or a generic shim); the reader does not care who wrote the file.

### 2. Reader — a live "Activity" view in the web console

Reuse the running `ThreadingHTTPServer` (`rituals/_web_server.py`); add nothing
to the dependency surface.

- **`GET /api/activity`** — reads and returns the state file (empty list if
  absent/stale). Mirror the `/api/ping` / `/api/overview` handler style.
- **Client:** a new rail entry / panel under the web UI that polls
  `/api/activity` on an interval (start with poll; SSE only if it proves needed).
  Render one card per session: cwd, status badge, the active-agent set. Reuse the
  catalog's existing agent metadata so each active agent links into its Library
  page — the companion shows a GIF; we show the agent's actual card.
- **Empty state:** "No active sessions" — same as the companion's idle window.
- **Theming:** inherits the deployed theme's tokens like every other view, so the
  activity surface speaks in the installed voice.

### 3. Optional later — ambient mode

Only if the in-console view proves insufficient. Options, cheapest first: a
small always-on-top browser popout of the activity panel; or a minimal terminal
HUD in the launcher (`./geneseed`) that tails the same file. A native floating
window is explicitly **out of scope** — it is what the stdlib ethos exists to
avoid.

## Why this shape

- **Same seam, native materials.** The decoupled file-IPC pattern is the proven,
  borrowable idea; the Rust window is not. We get glanceability inside a surface
  we already build and theme.
- **No new dependency, no build step.** Writer is JS in the OpenCode runtime;
  reader is stdlib Python in the existing server. Honours the no-`pip-install`,
  stdlib-only promise.
- **Cross-tool by construction.** The reader keys off a JSON file, not OpenCode.
  Any future adapter that writes the same schema lights up the same view.
- **Crash-isolated.** If the agent dies, the file goes stale and pids prune; the
  console degrades to "no active sessions" rather than breaking.

## Open questions

- Exact store path and whether activity shares or sits beside the memory store.
- Poll interval and whether SSE is worth it for the console (companion uses a
  250ms mtime poll; a browser tab can afford 1s).
- Whether to model sub-agents/council members as nested `active_agents` or a
  separate field, so the panel can show a debate in progress.
- How `geneseed-guard` events (a blocked tool call) might also feed the status —
  a "blocked by Law" status could be valuable, not just `busy`/`waiting-input`.

## Tests

- Writer: atomic-write round-trips; stale-pid pruning; concurrent-writer lock
  does not corrupt; schema versioning tolerates an older/newer `version`.
- Reader: `/api/activity` returns `[]` on missing/stale file; returns parsed
  sessions otherwise; survives a half-written file (rename atomicity makes this
  rare, but the handler should never 500 on garbage).
- Doctor: the new plugin is link/token-clean across themes, like the other four.
