<div align="center">

# 🌐 Geneseed — Web Console Guide

**Every view in the local browser console, what it shows, and how to drive it.**

[← README](../README.md) · [Setup](../SETUP.md) · [What's shipped](../SHIPPED.md)

</div>

---

The web console is a local, offline browser UI over your deployed harness — the same
actions as the TUI in a dashboard-first layout with rendered markdown and clickable
cross-links. It binds to `127.0.0.1` only, ships its build in `web/dist/`, and needs no
npm at runtime.

## Launching

```bash
geneseed web                 # serve on http://127.0.0.1:4747 and open the browser
geneseed web --port 8080     # pick a port
geneseed web --no-browser    # serve without auto-opening
geneseed web start|stop|status   # run/inspect the background daemon
```

A bare `geneseed` opens the console when the environment can show it (interactive TTY +
GUI browser, not SSH), and otherwise falls back to the TUI menu. Set `GENESEED_NO_WEB=1`
to always prefer the menu.

- **Daemon.** `start` runs the server detached and returns your shell; it's a singleton
  (already running ⇒ just reopens the browser). `stop` and the in-page **Stop** button
  both POST a token-guarded `/api/shutdown`; `status` reports the running instance.
- **Installable (PWA).** A manifest + service worker make it installable as a standalone
  app; immutable assets are cached, while HTML and `/api/*` stay on the network so the
  CSRF token never goes stale.
- **First run with nothing deployed.** The Dashboard shows an **onboarding wizard**
  (pick a voice → install mode → deploy) instead of a dead end.

## Security model

Localhost-bound, and **every mutating action is gated by a per-session `X-Geneseed-Token`**
so other sites can't trigger builds, deletes, or shutdown. Mutating actions (build,
update, export, restore, memory-delete, uninstall) run in the background and report back
as toasts (fire-and-notify). Read-only browsing needs no token.

## The rail

The left rail mirrors the harness's own shape:

| Group | Views |
| --- | --- |
| **🧬 Harness** | Dashboard · Library · Graph |
| **📚 Learn** | Docs · Specs |
| **🔧 Maintain** | Changes · Doctor |
| **🎨 Configure** | Themes · Settings |
| **ℹ️ About** | About |

A global **Spotlight** search lives in the topbar — press <kbd>/</kbd> to focus it, type
to jump to any agent, skill, law, doc, spec, or MCP server; <kbd>↑</kbd>/<kbd>↓</kbd> to
move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to clear. A bottom **Console** drawer
streams the output of background jobs and keeps their history across reloads.

## Views

### 🧬 Harness

- **Dashboard** (`#/`) — a live readout of what's deployed. Three lenses: **Status**
  (readiness ring, KPI counts of agents/skills/laws/memory, a genome grid, recent
  activity), **Lineage** (a mini cross-link graph), and **Operator** (a searchable table
  of every deployed capability). Headlines reflect the active theme's voice.
- **Library** (`#/library`) — browse the harness content: **Laws · Agents · Skills ·
  Memory · Notebook** (plus Wiki/Config). Drill into a section, then an item, to read its
  rendered markdown body and follow its cross-links. On a memory fact, a **Forget this
  fact** control deletes it (token-gated; bare-slug guarded server-side).
- **Graph** (`#/graph`) — the full cross-link constellation across the whole harness:
  every `[[wikilink]]` between agents/skills plus every `Rule N` mention that lands on a
  real law. Hover to isolate a neighbourhood, scroll to zoom, drag to pan, search to
  highlight; orphans dim out. Click a node to open its spec.

### 📚 Learn

- **Docs** (`#/docs`) — rendered documentation: markdown pages, concept pages, a CLI
  reference (generated from the harness argument parser), and a glossary, grouped into
  Get started / Core concepts / How-to / MCP servers / Plugins / Reference / Deeper.
- **Specs** (`#/specs`) — the dated implementation specs from `docs/specs/`, each with its
  purpose line, rendered with the same engine as Docs.

### 🔧 Maintain

- **Changes** (`#/diff`) — the diff between the deployed harness and the source: edited /
  added / missing files with per-file expansion and coloured unified-diff lines. Select
  files to **export an `improvements.md`** back-port, or **restore** them to source.
- **Doctor** (`#/doctor`) — runs the same health engine as the `doctor` command (every
  theme, parity, links, authoring gates, drift), grouping any problems per check. Re-run
  on demand.

### 🎨 Configure

- **Themes** (`#/themes`) — a gallery of the shipped voices (name, tagline, sigil, accent
  glow). **Apply** a voice to rebuild the deployed harness in that theme; the current one
  is marked.
- **Settings** (`#/settings`) — a **Console direction** picker (the visual flavour of the
  console) with a **Dashboard layout** control (Auto follows each theme's designed Status
  lens; Cultivar / Greenhouse / Operator force one regardless of skin), the install snapshot
  (deployed/target/theme/version/memory store/Python), a Maintenance card (PATH link/unlink,
  uninstall), an offline package download, and server controls (Stop). Build, update, and MCP
  wiring live in the Harnesses tab.

### ℹ️ About

- **About** (`#/about`) — project + creator credits and the source link.

## Rebuilding the UI

The committed `web/dist/` build is what ships. After changing anything under `web/src/`:

```bash
cd web && npm install && npm run build
```

If `web/dist/` is missing on a fresh clone, `geneseed web` offers to run that build for
you (answer `Y`); in a non-interactive shell it prints the manual recipe instead.
