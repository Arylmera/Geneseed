<div align="center">

# 🌐 Geneseed — Web Console Guide

**Every view in the local browser console, what it shows, and how to drive it.**

[← README](../README.md) · [Setup](../SETUP.md) · [What's shipped](../SHIPPED.md)

</div>

---

The web console is a local, offline browser UI over your deployed harness — the same
actions the CLI offers, in a dashboard-first layout with rendered markdown and clickable
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
GUI browser, not SSH), and otherwise prints the command list. Set `GENESEED_NO_WEB=1` to
always get the command list.

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
| **🧬 Harness** | Dashboard · Activity · Constitution · Rules · Profile · Skills · Agents · Library · Docs · Graph |
| **🔧 Maintain** | Changes · Doctor |
| **🎨 Configure** | Harnesses · Themes · Settings |
| **ℹ️ About** | About |

A global **Spotlight** search lives in the topbar — press <kbd>/</kbd> to focus it, type
to jump to any agent, skill, doc, spec, MCP server, or constitutional rule — the `laws`
catalog it indexes is the whole constitution, so an ontology section, an invariant and a
doctrine rule are all reachable by name; <kbd>↑</kbd>/<kbd>↓</kbd> to
move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to clear. A bottom **Console** drawer
streams the output of background jobs and keeps their history across reloads.

## Views

### 🧬 Harness

- **Dashboard** (`#/`) — a live readout of what's deployed. Three lenses: **Status**
  (readiness ring, a KPI band, a genome grid, recent activity), **Lineage** (a mini
  cross-link graph), and **Operator** (a searchable table of every deployed capability).
  Headlines reflect the active theme's voice.

  The KPI band reads **Agents · Skills · Invariants · Local edits**. That third tile is
  labelled *Invariants* and not *Constitution* on purpose: its value is the invariant count
  alone, and calling it the constitution would under-report the ontology and the doctrine
  packs. The two Status *layouts* that have room for it add the missing half: Greenhouse
  puts an active-packs fraction under the tile (`3/4 packs · N rules`), and the Operator HUD
  gives it its own cell (`PACKS 3/4`). That is what makes a narrowed install *look* different
  from a full one at a glance.
- **Rules** (`#/rules`) — your own standing rules, read from and written to the
  `user-rules.md` beside the deployed AGENT.md (the seed-once file no update ever
  touches). List with scope (user/project) and trial chips, add/edit/retire forms, a
  **Graduate** action that adopts a trial rule for good, and a budget meter that turns
  amber as the always-loaded set gets heavy. Every write carries the fingerprint of the
  content the page last read — if an agent session edited the file meanwhile, the save
  409s and the page reloads instead of clobbering it.
- **Constitution** (`#/laws`) — the whole governance surface on one page, in three bands:
  the **Ontology** (four prose sections), the **Invariants** (the nine numbered Rules, with
  a class facet — only non-empty classes render, and two of the six have had no invariant
  since the split), and the **Doctrines** (one group per pack, each marked active or not for
  this install). Every row expands to its full body, lazily fetched. The rail entry is
  labelled *Constitution* while the route, the id and the badge key stay `laws`; deep links
  are `#/item/law/ont:telos`, `#/item/law/IV` and `#/item/law/process.5` — three address
  shapes that cannot collide, because a slug carries a colon no numeral has and a doctrine
  address carries a dot.
- **Library** (`#/library`) — browse the content that has no tab of its own: **Memory ·
  Notebook · Knowledge** (the wiki chip, which also carries the two setup manifests).
  Constitution, Skills and Agents each have their own rail entry instead. Drill into a section, then an item, to read its
  rendered markdown body and follow its cross-links. On a memory fact, a **Forget this
  fact** control deletes it (token-gated; bare-slug guarded server-side), and a
  **Promote to rule** control turns a recurring lesson into a trial rule in
  `user-rules.md` — provenance recorded, the source fact deleted so it isn't loaded
  twice — landing you on the Rules page.
- **Graph** (`#/graph`) — the cross-link constellation across agents, skills and the
  **invariants only**: every `[[wikilink]]` between agents/skills, plus every `Rule N`
  mention that lands on a real invariant. ⚠ The reference pattern matches the tier noun
  followed by a **Roman numeral** — `Rule`, `Law`, or whatever the active theme calls one,
  which is how `Dictate III` still resolves under `imperial`. A doctrine address is
  `<pack> <n>` and matches nothing, so **doctrine cross-links are not drawn**; the graph is
  a view of the invariant backbone, not of the whole constitution. Hover to isolate a
  neighbourhood, scroll to zoom, drag to pan, search to highlight; orphans dim out. Click a
  node to open its spec.

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

- **Harnesses** (`#/harnesses`) — every detected install (host × scope), one row each,
  with per-row **Voice**, **Footprint**, **Posture**, and **Mode** pickers plus
  Install/Apply, an on/off switch, and remove. **Posture** is the relationship register
  (peer/mentor/expert/assistant/artisan — default **peer**); **Mode** is the operating
  register (direct/foreman — default **direct**; foreman triages tasks into isolated
  pipelines instead of working every one itself). Both are orthogonal to voice and to
  each other, picked here or via the setup wizard, and preserved across every rebuild.
  "Deploy to folder…" and "Rebuild all" apply to the whole set. An **Excluded folders**
  card (shown once a global install exists) manages sovereign repos — folders where every
  global harness goes dormant (hooks stay silent, the global preamble never loads);
  add or remove one here, the web mirror of `harness exclude add|remove|list`.
- **Themes** (`#/themes`) — a gallery of the shipped voices (name, tagline, sigil, accent
  glow). **Apply** a voice to rebuild the deployed harness in that theme; the current one
  is marked.
- **Settings** (`#/settings`) — a **Console direction** picker (the visual flavour of the
  console) with a **Dashboard layout** control (Auto follows each theme's designed Status
  lens; Cultivar / Greenhouse / Operator force one regardless of skin), the install snapshot
  (deployed/target/theme/version/memory store), a Maintenance card (PATH link/unlink,
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
