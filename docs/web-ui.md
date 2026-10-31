<div align="center">

# 🌐 Geneseed — Web Console Guide

**Every view in the local browser console, what it shows, and how to drive it.**

[← README](../README.md) · [Docs](README.md) · [What's shipped](../SHIPPED.md)

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
- **First run with nothing active.** When no install on the machine is active, the Overview shows an **onboarding wizard**
  (pick a voice → install mode → deploy) instead of a dead end.

## Security model

Localhost-bound, and **every mutating action is gated by a per-session `X-Geneseed-Token`**
so other sites can't trigger builds, deletes, or shutdown. Mutating actions (build,
update, export, restore, memory-delete, uninstall) run in the background and report back
as toasts (fire-and-notify). Read-only browsing needs no token.

Every request passes one guard first: the `Host` must be `127.0.0.1`, `localhost` or `[::1]`
**at the server's own port** (DNS rebinding, other local servers), `/api/*` refuses a
`Sec-Fetch-Site` of `cross-site`/`same-site` or a foreign `Origin` (so another site cannot read
the API either), and every write compares the token in constant time. Every response carries
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a
strict CSP (`frame-ancestors 'none'`, same-origin only, the one inline token script admitted by
a per-response nonce). `?fresh=1` on the doctor re-runs at most once per 3 s, and the server
drops a request whose headers take over 10 s or whose whole request takes over 30 s.

## Which install a request reads

A request can name the install it reads or writes. A read takes two query parameters,
`?host=<host>&path=<install root>` (two, because a Windows path holds a colon). A write takes
`host` and `path` in its JSON body. The pair is a row of `/api/installs`, and the server checks
it against the same detected-install allowlist as the install toggle. An unknown or half pair
gets a 404 and never falls through to another install's folder. The writes that take the pair
are `/api/activity`, `/api/memory/delete`, `/api/rules`, `/api/rules/promote`, `/api/profile`,
and the `restore` and `build` actions. In `/api/install`, the `install` and
`deploy` actions, `/api/excludes` and `/api/reveal`, `host`/`path` keep their own meaning.

Every `/api/*` read takes and checks the pair, with these exceptions:
- `/api/ping` and `/api/jobs` ignore it.
- The machine-wide reads also ignore it: `/api/update`, `/api/installs`, `/api/fleet`,
  `/api/kits`, `/api/usage`, `/api/gates`, `/api/excludes`, `/api/mcp`, `/api/loops/active`,
  `/api/activity`, and the Library's skill, agent, memory and notebook lists,
  `/api/catalog/skills`, `/api/catalog/agents`, `/api/catalog/memory` and
  `/api/catalog/notebook`. Such a read does not check the pair, and its answer does not change
  with the pair. The Activity detail (`/api/activity/<id>`) and the Activity toggle still take
  the pair.

The skill, agent, memory and notebook lists read every active install (memory and notebook
entries are your own files, so a fact's Forget and Promote act on the install of the copy on
screen, and Promote writes to that install's `user-rules.md`). Each row is one id (kind and name), and
its `installs` field names the installs that have it, as `host:scope:root` keys (the same keys
as `/api/usage`). An id that only some installs have lists only those installs, so an exclusion
stays visible. The other catalog sections stay install-scoped. `/api/item/skill/<name>` and
`/api/item/agent/<name>` stay install-scoped too, because each install renders its own copy in
its own theme and footprint. With a pair, the item is that install's copy, and an id that
install lacks gets a 404. Without a pair, the item is the copy of the first install that has
it. The order is the host order (OpenCode, Claude Code, Bob, OpenClaude), then global before
project. The item's `install` field names the copy, and its `installs` field names every
install that has the id.

A request that names no install reads the **default install**: the first active one in the console's one
install order (`fleetSort`): host order (opencode, claude, bob, openclaude), then global before
project. `/api/installs` marks
that row `default: true`. There is no console-wide install and no `POST /api/view`: a page that
acts on one install names it on each request, through a picker placed beside the entry or form it
applies to (see below).
Each named install keeps its own cached doctor run and inventory, and a mutation refreshes all
of them.

## The rail

The left rail mirrors the harness's own shape:

| Group | Views |
| --- | --- |
| *(ungrouped)* | Dashboard |
| **📖 Codex** | Constitution · Rules · Profile · Skills · Agents · Library · Loops · Docs |
| **🩺 Care** | Activity · Changes · Doctor |
| **🎨 Setup** | Harness · Settings |

At the foot of the rail sits a **vitals** card — the doctor's verdict, drift, how long ago the
harness was built, and a Voice button — so those facts are on screen from every page. It is
hidden where the rail collapses to icons (≤960px) and returns with the phone drawer. The topbar's
breadcrumb starts at the page: it names no install.

**Install pickers.** The console has no install switch. Where a page acts on one install, an
`InstallPicker` sits beside what it applies to, labelled for it (*Write to:*, *Doctor for:*), and
starts on the default install; with one active install it is not shown. Rules and Profile list
every active install's entries together, each tagged with its install, and write back to the
install an entry came from; so do Memory and Notebook, whose Forget and Promote act on the
install of the copy on screen. Doctor, Local edits, Server, the Constitution (*Constitution of:*,
for its gate switches and doctrine Apply), Loops (*Templates and bricks of:*) and the rail's Voice
popover (*Rebuild:*) each keep their own pick (in the browser's localStorage). The Overview is
fleet-wide: each install's own facts (voice, footprint, posture, mode, memory facts, drift) sit on
its row, and a figure still read off the default install (a suggestion, a tab badge, an older
Overview view, Personal's Rule budget) names that install once two or more are active.

A global **Spotlight** search lives in the topbar — press <kbd>/</kbd> to focus it (or
<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>, which also works from inside a text field), type
to jump to any agent, skill, doc, MCP server, or constitutional rule — the `laws`
catalog it indexes is the whole constitution, so an ontology section, an invariant and a
doctrine rule are all reachable by name; <kbd>↑</kbd>/<kbd>↓</kbd> to
move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to clear. A bottom **Console** drawer
streams the output of background jobs and keeps their history across reloads.

## Views

### Dashboard

- **Dashboard** (`#/`) — a live readout of what's deployed. Three lenses: **Status**
  (readiness ring, a KPI band, a genome grid, recent activity), **Lineage** (the
  source → render → deployed timeline and the genome-by-volume strand chart), and
  **Operator** (a searchable table of every deployed capability). Every lens hero carries the
  fleet verdict badge (the Ledger's `fleetVerdict`). The headline speaks the theme's voice only
  while that verdict is good or still loading; a warn, bad or unreachable fleet reads plain
  *Deployed*. Recent-run previews read `verb · scope · result · duration`, and the raw command
  is a tooltip only.

  The KPI band reads **Agents · Skills · Dictates · Local edits**. That third tile is
  labelled *Dictates* (the name AGENT.md gives the laws) and not *Constitution* on purpose: its value is the law count
  alone, and calling it the constitution would under-report the ontology and the doctrine
  packs. The two Status *layouts* that have room for it add the missing half: Greenhouse
  puts an active-packs fraction under the tile (`3/4 packs · N rules`), and the Operator HUD
  gives it its own cell (`PACKS 3/4`). That is what makes a narrowed install *look* different
  from a full one at a glance.

### 📖 Codex

- **Rules** (`#/rules`) — your own standing rules, read from and written to the
  `user-rules.md` beside the deployed AGENT.md (the seed-once file no update ever
  touches) of every active install, listed together and tagged with their install; an edit,
  graduate or retire writes back to the rule's own install, and a new rule goes to the install
  its form's *Write to:* picker names. List with scope (project/global — a hand-written `user` opens as global — or any other scope written by hand, which a
  save keeps as written) and trial chips, add/edit/retire forms (retire moves the rule to `user-rules-retired.md`, which is never loaded; its id is never reused) (a body line starting
  `## ` is refused: the file would read it as a new rule heading), a
  **Graduate** action that adopts a trial rule for good, and a budget meter that turns
  amber as the always-loaded set gets heavy. Every write carries the fingerprint of the
  content the page last read — if an agent session edited the file meanwhile, the save
  409s and the page reloads instead of clobbering it.
- **Constitution** (`#/laws`) — the whole governance surface on one page, in three bands:
  the **Ethos** (five prose sections), the **Dictates** (the nine numbered Rules, with
  a class facet — only non-empty classes render, and two of the six have had no invariant
  since the split), and the **Doctrines** (one group per pack, each marked active or not for
  this install). Rules I, III and IV each carry a switch for the install's hook gate — the
  secrets gate, the done gate and the deletion gate (`--no-secrets-gate`, `--no-done-gate`,
  `--no-deletion-gate`; *Enforced by* reads *Gate off* while one is off) — flipping one asks,
  then rebuilds the install once; the other Rules read *no gate*. The ownership gate belongs
  to no Rule, so it has no switch here: rebuild with `--no-ownership-gate` instead. A precedence ladder heads the page (a state pill per rung; ranks 5–6 below). *Gated* and *Changed* narrow the rows; packs fold; staged doctrine changes collect in a sticky *Unapplied changes* bar that holds Revert and the page's one Apply. Every row expands to its full body, lazily fetched. The rail entry is
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
- **Kits** (`#/kits`, `#/kits/<kit>`) — a card per shipped kit over a kits × installs matrix of
  switches; a staged-changes bar applies one install at a time (the server runs one job at a
  time). `#/kits/<kit>` is the kit's page: rules, word budget, banned APIs, upstream credits,
  members and one switch per install.
  `GET /api/kits` carries `rules`, `rulesWordBudget`, `banned` and `credits` per kit; the
  catalog and item endpoints for skills and agents carry `kit` (the owning kit or `null`),
  which the Library shows as a `kit:` badge.
- **Loops** (`#/loops`) — the loop catalogue `geneseed loop` runs from, read-only, laid out
  like the Library: a rail of sections (**Templates**, **Bricks**, **Active**, each with its
  count; `#/loops/<section>/<item>` opens an entry), with the selected section's groups
  nested under it in the rail (template categories, brick origins, run statuses — pick one to
  narrow the list), a filterable list, and a reader.
  **Templates** are grouped by their `category` (architecture, tests, development,
  refactoring, day-to-day, then *Other*), a *human gate* pill on any that stops for you. The
  reader draws the selected template as a ring: the iteration turning clockwise from its head,
  each inner retry loop hung outside on its head node, the ⛨ *validate* gate the engine adds
  before the first mutate step, setup entering from the left and `done → close` leaving from
  the head; its `rules` follow, then a compact row per brick (effect, agent or skill, outcomes,
  human gate), and clicking a node scrolls to and lights its row. Beside the ring, *How it runs* says the same in words (setup, iteration and its max, retries, exit, stop); under it, the `geneseed loop init` command for that template with a Copy button, and how many live runs of it are registered. A graph a ring cannot draw
  cleanly (more than eight iteration steps, a node in more than three loops) falls back to
  left-to-right boxes. **Bricks** are grouped by origin (project / global / shipped), pilled
  for *mutate*, *human gate*, what they override and *unavailable*; the reader shows the
  frontmatter facts (outcomes as pills, availability with its reason), then the body rendered as
  markdown, with a **View source** toggle for the file as parsed, frontmatter and all. Templates and
  Bricks read `GET /api/loops`, resolved from the default install's root, so a project
  install shows its `.geneseed/` bricks and templates. **Active** is every loop
  `geneseed loop init` registered on this machine (`GET /api/loops/active`, polled every
  5 s), grouped awaiting, running, done/stopped, finished/unreadable; the reader shows its
  branch, `iteration N / max`, current node and a preset picker (`POST /api/loops/preset`,
  the page's only write), what an awaiting loop waits on (launch / declared / actual / a
  human gate, with its node) — the answer is given in the agent's session, never here — and
  its ring with the current node filled, with its iteration history under it.
- **Profile** (`#/profile`) — `PROFILE.md` beside the deployed AGENT.md: who you are and
  how you like to work, one card per active install, each saving to its own. Opens rendered; **Edit** is a whole-file editor. The save carries
  the fingerprint it loaded — if an agent session changed the file first, your edit stays
  on screen and a second Save replaces the newer version.
- **Skills** (`#/skills`) and **Agents** (`#/agents`) — the deployed catalogue of every
  installed harness, each entry with its purpose line and full spec. Each row is one skill or
  agent; when more than one install is active, it carries a badge for each install that has it
  (`opencode · global`; a project install by its folder). The reader shows the first install's copy. When more installs have the entry,
  a **Viewing copy from** picker beside the copy opens another install's version, for that
  entry only. While Skills is selected, its skill types sit nested
  under it in the rail, each with its count, above a thin bar of their shares; pick one to
  narrow the list.
- **Docs** (`#/docs`) — rendered documentation: markdown pages, concept pages, a CLI
  reference (generated from the harness argument parser), and a glossary, in a reader: one
  nav column holding the parts (Understand / Guides / Concepts / Reference) with their page
  counts, the open part's sections (pick one to narrow the list) and the part's pages with a
  filter; then the page, with its breadcrumb, section and reading time, a Copy button on each
  code block, an outline that marks the heading being read, and Previous / Next within the
  section. Filtered for one host (OpenCode, Claude
  Code, Bob or OpenClaude; Claude-family pages show to all three Claude-engine hosts, a page
  tagged with a list of hosts only to those); with no
  choice stored it follows the deployed install.

### 🩺 Care

- **Activity** (`#/activity`) — the agent sessions on this machine, from every active install
  in one view: each one's status, the files it touched and its todo progress; open one for its
  detail. Each card has a chip that names its install: the host, then the scope when a host has
  two installs, then the project folder when a host has two project installs, and more of the
  folder's path (up to the whole path) when two folders have the same name. A session that two
  installs of one host both recorded is one card. Its chip and link name the first of those
  installs in a fixed order (host order, then global before project), so they do not change
  between polls. Tracking is on or off per install: the tracking
  card has one switch per install, and each switch changes only that install. OpenCode project
  installs have no switch: their sessions appear under, and follow, the OpenCode global switch. Sessions that ended in the last 7 days are listed under
  **Recently ended**, below the live ones. Every host records it:
  the OpenCode plugin, and `geneseed-hook activity` on Claude Code, OpenClaude and Bob.
  The live sessions open in the **Garden** by default; a **List | Garden** switch (kept in the
  URL with the filters, which apply to both) shows them as a list of cards instead. The Garden
  shows them as pixel bonsai: one shelf per repository (worktrees stand on their
  repo's shelf, tagged ⎇), one tree per session. The pot's glaze is the host (clay Claude Code,
  blue Bob, grey OpenCode, violet OpenClaude); the tree grows taller with turns, its crown
  with context fill, and the tips yellow past 80 %. A compaction cuts the crown flat (it
  regrows as context refills) and leaves a notch on the rim. A running sub-agent is a thick
  branch with its own pad, coloured by agent type; a finished one is a pruned stub and a
  fallen leaf. A cream blossom is a changed file, on the pad of the AI that changed it (Bob
  cannot tell, so all its blossoms sit on the crown). An amber `!` means the session needs
  you, a red `x` an error, a grey tree an idle session. Two sessions changing the same file
  are tied together in red (same worktree) or dashed amber (two worktrees of the repo): tangled
  roots in the moss when they stand side by side, a thread under the pots when they do not.
  Hover a tree for its model, turns, context and compactions, or a pad for its author's files;
  click it to open the session. Past ten trees, quiet shelves (no session working or waiting on
  you) fold into chips, the largest first; the last standing shelf never folds. **Sakura** repaints the crowns pink, nothing more.
  A session's detail page shows its tree too, live or ended, with the same pad hovers and a
  legend of its turns, context, compactions and sub-agents; an ended session's tree stands still, without the `!`.
- **Changes** (`#/diff`) — the diff between the install its *Local edits of:* picker names and the source: edited /
  added / missing files, and files only behind the source (unedited; a rebuild updates them)
  listed apart under **Behind source**, with per-file expansion and coloured unified-diff lines. Select
  files to **export an `improvements.md`** back-port, or **restore** them to source.
  Restore acts only on files the diff lists, and never on your own files (`user-rules.md`,
  `PROFILE.md`, `memory/`, `notebook/`). An added file is moved into
  `archived-restore/<date-time>/` in the install, not deleted.
- **Doctor** (`#/doctor`) — runs, for the install its *Doctor for:* picker names, the same health engine as the `doctor` command (every
  theme, parity, links, authoring gates, drift), grouping any problems per check. It shows
  the server's last run for that install — warmed at start, redone after a job or an install
  toggle — and **Re-run checks** runs every check again on demand.

### 🎨 Setup

- **Harness** (`#/harness`) — this machine's own install first (path, voice, footprint,
  and when it was built), then the **Voice** reference, then every detected install. A
  **Sync with source** column says whether each install is behind the source (and by how many
  files), in sync or not checked, shows hand edits apart from stale files, and links to Local edits.
  `#/harnesses` and `#/themes` both still resolve here, so old links and bookmarks keep
  working.
  - The **Voice** card is the former Themes tab, kept as a REFERENCE rather than a second
    control: a collapsed row that opens to every shipped voice with its tagline, the
    deployed one pinned first and marked. It is the one place you can read what a voice
    sounds like — the per-install picker below is a list of bare names. Applying happens
    there, per install, beside that install's own footprint, posture and mode; a gallery at
    the top of the page could only ever act on one of them.
  - **Every install** lists each detected install (host × scope), one row each. An
    ACTIVE row carries per-row **Voice**, **Footprint**, **Posture** and **Mode**
    pickers plus **Apply**, an on/off switch, and remove; a host that is NOT installed
    yet shows a single **Install…** that discloses the same four choices as steps.
    **Posture** is the relationship register (peer/mentor/expert/assistant/artisan —
    default **peer**); **Mode** is the operating register (direct/foreman — default
    **direct**; foreman triages tasks into isolated pipelines instead of working every
    one itself). Both are orthogonal to voice and to each other, picked here or via the
    setup wizard, and preserved across every rebuild.
  - "Deploy to folder…" and "Rebuild all" apply to the whole set. An **Excluded folders**
    card (shown once a global install exists) manages sovereign repos — folders where every
    global harness goes dormant (hooks stay silent, the global preamble never loads);
    add or remove one here, the web mirror of `harness exclude add|remove|list`.
- **Kits** (`#/installs/kits`) — every install (disabled ones read-only) as a panel with one switch per kit.
  Toggling only stages the set; **Apply** asks first, then rebuilds that install with
  exactly that set as a console job. Staged switches are held for the whole console: they
  survive leaving the page, and the Kits page and Installs › Kits share them. A refetch drops a
  row's staging only when that install's kits changed. A failed rebuild keeps it and says so,
  and a reload asks first while anything is staged. Files you edited in a kit that is now off are kept,
  and the row lists them.
- **Server** (`#/installs/server`; `#/settings` and `#/about` resolve here) — a settings sheet
  with a section index. **Appearance**: skin, accent (a skin change resets it to the skin's own), Overview view. **Machine**:
  version + Update (labelled by how this copy updates: git pull, npm install -g, or the command
  to run by hand), Add to PATH, the footprint of the install the head's *Footprint of:* picker names (read-only, links to Hosts). **Server**: running · port ·
  pid · uptime, whether the code matches the disk (with Restart), start-at-login state (read
  only), and the four request guards; the index marks Server with a good/warn dot. **About**: version, changelog, credits, source, creator.
  **Danger zone**: Stop server, Remove from PATH, and a pointer to each install's own
  Uninstall in Hosts.

## Rebuilding the UI

The committed `web/dist/` build is what ships. After changing anything under `web/src/`:

```bash
cd web && npm install && npm run build
```

If `web/dist/` is missing on a fresh clone, `geneseed web` offers to run that build for
you (answer `Y`); in a non-interactive shell it prints the manual recipe instead.
