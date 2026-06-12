# Geneseed Web UI — Design Spec

**Date:** 2026-06-12
**Status:** Approved (brainstorm with Guillaume)
**Scope:** v1 — local web interface to navigate the deployed Harness with TUI action parity plus richer reading. No editing.

## Goal

A local, browser-based interface shipped with Geneseed that lets a user do everything the TUI does — browse/search the catalog, run doctor, review local edits, build, update — plus read what the TUI renders poorly: memory files, the notebook, config manifests, and cross-links between agents, skills, and laws.

## Decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Runtime model | Local server (`geneseed web`), not static/serverless | TUI parity requires executing Python (doctor, build, update). A static HTML export can only read and goes stale. Anyone who can run the TUI can run a stdlib server. |
| Action scope | TUI parity + rich reading, **no editing** | Browser's advantage is rendering/linking. No file-writing endpoints in v1. |
| Frontend stack | React + Vite (npm at dev time only) | Matches the user's company stack. Built `web/dist/` is **committed**; end users never run npm. |
| Layout | Dashboard-first, drill-in section pages | Health + actions visible at a glance; sections open as full-page browsers. |
| Action UX | Fire-and-notify | Actions run in background; toast on completion; full logs in a drawer. |

## Architecture

- New subcommand `geneseed web [--port N]` in `rituals/harness.py`.
- Starts a stdlib `ThreadingHTTPServer` bound to `127.0.0.1`, default port **4747**, falling back to a free port if taken. Opens the default browser on the served URL.
- Serves (a) static files from the committed React build, (b) a JSON API.
- Harness resolution: identical logic to the TUI (deployed harness dir first), so web and TUI always agree on what they inspect.
- No third-party Python dependencies — stdlib only, consistent with project identity.

### Repository layout

```
web/                  React + Vite source (developer-facing)
web/dist/             Committed production build (served by geneseed web)
rituals/harness.py    cmd_web + API handlers (alongside existing TUI code)
```

## API surface

All endpoints return JSON. Read-only except `/api/actions/*`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/overview` | GET | Counts per section, theme name, harness path, doctor summary, pending local-edit count, last build time. Feeds dashboard cards. |
| `/api/catalog/{agents\|skills\|laws\|memory\|notebook\|config}` | GET | Item list for a section (name, title, one-line description). |
| `/api/item/{type}/{name}` | GET | Raw markdown + metadata. Cross-references (`[[wikilinks]]`, agent/skill mentions) resolved server-side into link targets. |
| `/api/diff` | GET | Local-edit review data — same engine as the TUI `x` action. |
| `/api/actions/{doctor\|build\|update\|export-improvements}` | POST | Start the action as a background job; returns a job id. `update` requires `{"confirm": true}` in the body, mirroring the TUI confirmation. |
| `/api/jobs/{id}` | GET | Job status (`running`/`done`/`failed`) plus captured stdout/stderr. |

## UI

- **Dashboard (home):** status/action cards — doctor health (with "Run doctor" button), pending local edits (with "Review diff"), build/update (with last-build timestamp) — plus count cards per section (Agents, Skills, Laws, Memory, Notebook, Config) that link to section pages.
- **Section pages:** item list + rendered markdown detail with clickable cross-links between agents/skills/laws/memory.
- **Diff review page:** rendered view of `/api/diff` with an "Export improvements" button (parity with TUI `x` → `e`).
- **Global search** in the header, filtering across all sections (client-side over the catalog).
- **Markdown rendering:** client-side in React; a small vendored npm renderer is acceptable.
- **Theming:** the UI reads the harness's `.geneseed-theme` (exposed via `/api/overview`) and applies its accent palette so the web matches the chosen theme.

## Actions and jobs

- POST starts the job in a background thread; the UI polls `/api/jobs/{id}`.
- Completion surfaces as a toast (success/failure); a "last runs" drawer holds full captured logs for the session.
- **One job at a time.** Actions mutate the harness; concurrent builds would race. A second action request while one runs returns HTTP 409 and the UI shows a "busy" toast.
- Jobs are in-memory only; they do not survive a server restart.

## Security

- Bind `127.0.0.1` only — never exposed on the network.
- A per-session token is generated at startup, embedded in the served `index.html`, and required (header) on every POST. This blocks cross-site request forgery from arbitrary websites against the action endpoints.
- No further auth: single local user, read-mostly data.

## Error handling

- **No deployed harness found:** serve an onboarding page pointing to `geneseed setup`.
- **`web/dist/` missing** (developer forgot to build/commit): `geneseed web` exits with a clear CLI error naming the build command.
- **Job failure:** captured stderr shown in the log drawer; toast indicates failure.
- **Port in use:** automatic fallback to a free port; the chosen URL is printed and opened.

## Testing

- **Python:** stdlib `unittest` against the API handlers using a temp-directory harness fixture — request → JSON shape assertions; job lifecycle (start → poll → done/failed); 409 on concurrent action; token enforcement on POST.
- **React:** light Vitest component tests for dashboard cards and item-detail rendering. No e2e in v1.

## Out of scope (v1) / future refinements

- Editing agent/skill/law markdown in the browser.
- Static serverless export (read-only `explorer.html`) for machines that cannot run Python — possible later as a hybrid evolution.
- Live log streaming (SSE/websockets) — fire-and-notify chosen instead.
- Multi-harness switching in the UI.
