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

**The token stops other sites, not other programs.** Anything on this machine that can read it, from the served page or `.geneseed-web.json`, can call the console API. So the console is no boundary against an agent with a shell, the same as the shell itself. That includes a rule decision: the [change report](concepts/hooks.md#the-change-report) still lists it, for this reason.

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
are `/api/activity`, `/api/memory/delete`, `/api/rules`, `/api/rules/promote`, `/api/rules/decide`, `/api/profile`,
and the `restore` and `build` actions. In `/api/install`, `/api/default-install`, the `install` and
`deploy` actions, `/api/excludes` and `/api/reveal`, `host`/`path` keep their own meaning.

Every `/api/*` read takes and checks the pair, with these exceptions:
- `/api/ping` and `/api/jobs` ignore it.
- The machine-wide reads also ignore it: `/api/update`, `/api/installs`, `/api/fleet`, `/api/migrate/preview`,
  `/api/kits`, `/api/usage`, `/api/gates`, `/api/excludes`, `/api/mcp`, `/api/loops/active`,
  `/api/activity`, and the Library's skill, agent, memory and notebook lists,
  `/api/catalog/skills`, `/api/catalog/agents`, `/api/catalog/memory` and
  `/api/catalog/notebook`. Such a read does not check the pair, and its answer does not change
  with the pair. The Activity detail (`/api/activity/<id>`) and the Activity toggle still take
  the pair.

The skill, agent, memory and notebook lists read every active install (memory and notebook
entries are your own files, so a fact's Forget and Promote act on the install of the copy on
screen, and Promote writes to that install's `user-rules.md`). The installs that read the shared
tier hold one memory store: it is listed under the first of them, and `/api/catalog/memory` names
them all in `sharedInstalls`. Each row is one id (kind and name), and
its `installs` field names the installs that have it, as `host:scope:root` keys (the same keys
as `/api/usage`). An id that only some installs have lists only those installs, so an exclusion
stays visible. The other catalog sections stay install-scoped. `/api/item/skill/<name>` and
`/api/item/agent/<name>` stay install-scoped too, because each install renders its own copy in
its own theme and footprint. With a pair, the item is that install's copy, and an id that
install lacks gets a 404. Without a pair, the item is the copy of the first install that has
it. The order is the host order (OpenCode, Claude Code, Bob, OpenClaude), then global before
project. The item's `install` field names the copy, and its `installs` field names every
install that has the id.

A request that names no install reads the **default install**: the one you chose on the Installs
page (*Make default* on an active row), while it stays active. With no choice, it is the first
active one in the console's one install order (`fleetSort`): host order (opencode, claude, bob,
openclaude), then global before project. The choice is machine-wide and lives in
`default-install.json` in the shared tier. `POST /api/default-install` with `{host, path}` sets it
and refuses anything else with a 409, an empty or malformed body included, and the choice stays.
The console has no way to clear it: choose another install, or delete the file. A choice that no
longer names an active install is ignored, and it applies again if that install comes back. The
`install` and `theme` lines of `geneseed status` follow the same choice. `/api/installs` marks
that row `default: true`. There is no console-wide install and no `POST /api/view`: a page that
acts on one install names it on each request, through a picker placed beside the entry or form it
applies to (see below).
Each named install keeps its own cached doctor run and inventory, and a mutation refreshes all
of them.

## The rail

The left rail has one flat list, and three entries at its foot:

| Entry | Holds |
| --- | --- |
| **Overview** (`#/`) | The fleet: every install on one Ledger, and *Needs you* |
| **Constitution** (`#/laws`) | Ethos, Rules and doctrines |
| **Library** (`#/library`) | Skills, agents, the wiki and the setup files |
| **Kits** (`#/kits`) | The kit catalogue |
| **Loops** (`#/loops`) | Tabs: Templates · Bricks · Active |
| **Personal** (`#/personal`) | Tabs: Rules · Profile · Memory · Notebook |
| **Installs** (`#/installs`) | Tabs: Hosts · Local edits · Doctor |
| **Docs**, **Activity**, **Settings** (foot) | The documentation, the agent sessions on this machine, and this copy of Geneseed with its server |

The old flat routes still resolve to their tab (`VIEW_ALIAS`, `web/src/lib/router.js`): `#/rules`,
`#/profile`, `#/harness`, `#/harnesses`, `#/themes`, `#/diff`, `#/doctor`, `#/about`. Addresses of
what moved open its one home: `#/installs/kits` the Kits page, `#/installs/server` Settings, and
`#/section/memory`, `#/section/notebook`, `#/item/memory/<name>` and `#/item/notebook/<name>` the
Personal tabs. The view notes below keep those older names and their old grouping.

**A rail badge equals what its page lists.** Every count covers every install, deduped by name, and
`/api/overview` `counts` is the size of the same lists the pages show (`fleetCounts`,
`js/web/catalog.mjs`). A folder's index and README (`MEMORY.md`, `NOTEBOOK.md`) are in no list and no
count, and stay readable by name. Constitution counts its rules, on or off, and not the Ethos
sections. Library is the sum of its kinds. Installs counts what is installed, on or off. A number
measured on one install, such as a root file's size on an Overview row, is a measurement and stays
on its row. An install that cannot be read is skipped, and the rest still count. The Loops badge is
the union across installs, and its title says so; the page lists the picked install's templates.
`web/src/__tests__/railCounts.test.jsx` and `tests/unit/web_counts.test.mjs` hold this.

**A read still out is not a failed one.** Each card tells three states apart: `Loading.jsx` while the
first read is out, a sentence when it failed, and what it found when it is empty. No count appears
before its data. The Constitution waits for the picked install's own overview too: a gate read
before it would read as armed.

The rail groups its pages under small mono headers, each with a square in the group's tint: the
Overview alone, then **Govern** (Constitution, Personal), **Build** (Library, Kits, Loops), **Run**
(Installs, Activity) and **Help** (Docs, Settings). Each icon sits in a 28 px chip tinted by its group
(`--sb-<group>-bg` and `-ink` in `styles.css`; light mode has pastel chips with deep ink, 5.3:1 or
better). The lit page gets a raised row and `aria-current="page"`; a count badge is muted mono on the
right. The chevron in the header collapses the rail to 64 px of chips (44 px targets, each link with an
`aria-label` and a tooltip, an expand button on top); the choice is kept per browser under
`geneseed-rail`. Below 960px the rail is always chips and the toggle is hidden; the phone drawer is
always full. The rail holds navigation only: the doctor's verdict, local edits and build age live on Doctor, Diff
and Overview, and the voice gallery on Installs. The topbar's
breadcrumb starts at the page: it names no install.

**Install pickers.** The console has no install switch. Where a page acts on one install, one
`InstallPicker`, always labelled *Install:*, sits right above the heading of the view it acts on
(under the tabs on a tabbed page, over the h1 on a page with none), and starts on the default install; with one active install it is not shown. A form or popover that
acts on its own install holds the same control: the new-rule form and a
Library entry with several copies. The Personal page names no harness for what the harnesses share:
every global install reads one set of rules, one profile and one memory store in the shared tier
(`~/.config/geneseed`), so Rules, Profile and Memory list each once. Its header states that scope
once, a list head or profile card says `shared`, and a project install keeps its own, named by its
install. Each `/api/installs` and `/api/fleet` row carries `shared`, which the pages read from
`useInstalls`; `sharedTier` is only a project install's switch. A write goes back to the file an
entry came from. Notebook stays per install, and its Forget acts on the install of the copy on
screen. Doctor, Local edits, the Constitution (for its gate switches and doctrine Apply), and Loops
each keep their own pick (in the browser's localStorage). The Overview is
fleet-wide: each install's own facts (voice, footprint, posture, mode, local edits) sit on
its row, and a figure still read off a project install set as the default (a suggestion, a lens)
names that install once two or more are active. A *Needs you*
suggestion about a shared file or the shared memory store appears once and names no harness.

The Loaded every turn card also shows the session-start hook output against its 9 000-character
budget, measured without project context, for the install whose content was cut, else the
largest. It turns amber at 85% of the budget or whenever content was cut, and Needs you adds one
suggestion at the same point.

A global **Spotlight** search lives in the topbar — press <kbd>/</kbd> to focus it (or
<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>, which also works from inside a text field), type
to jump to any agent, skill, doc, MCP server, or constitutional rule — the `laws`
catalog it indexes is the whole constitution, so an ontology section, an invariant and a
doctrine rule are all reachable by name; <kbd>↑</kbd>/<kbd>↓</kbd> to
move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to clear. A bottom **Console** drawer
streams the output of background jobs and keeps their history across reloads.

**The Console drawer is a phase timeline.** The left column lists the runs, newest last. Each
row has a status dot (green done, amber done with warnings, red failed, pulsing while it runs),
the action, a short detail (the install, the commits pulled, the installs rebuilt) and the
duration, with `✗` (failed), `⚠` (warnings) or `running` written beside it. A run whose output
holds a failure line reads failed even when the job exited 0. The newest run is picked, and a new run takes the pick back from a click. The right
column shows the picked run: its status pill, a `<duration> · N warnings · N notices` line and
its numbered phases. A phase is one step the job ran (`$ <argv>`) or one install a `rebuild-all`
rebuilt (`[rebuild-all] <host>:<scope>`), so an upgrade reads *Update the source*, then one
*Rebuild* per install. Each phase states *Done*, *N warnings*, *N skipped*, *Failed* or
*Running*. A warning (`[geneseed] WARN`) is an amber box: a short title, one sentence, and its
full text under **Full text**. The `[rebuild-all] WARN` printed once after the last install is
about the whole run, so it shows under **Run warnings**, not under that install. A refused link is a grey notice and counts as skipped. A failure
line is red in its phase, and a failed job with no failure line marks its last phase failed
with the last line it printed. A line the reader does not know stays in its phase as printed;
lines before the first phase (the history keeps only an output's tail) go under **Other
output**. **Full log** shows the raw output unchanged, for the picked run only. The one reader is
`web/src/lib/runPhases.js`, and the prefixes it knows are listed at its top. On a narrow
screen the run list stacks above the detail.

## Views

### Dashboard

- **Overview** (`#/`) — the header's **View** control is the one home of the lens: **Overview** (the
  Ledger), **Genome**, **Greenhouse**, **HUD** and **Journal**. A lens never takes a skin's name, and
  a browser that stored the old `cultivar` or `operator` keeps its lens (`resolveLayout`). All five
  views share one header: the title, the install count, the version chip and the View control.
  Beside the Ledger, a lens has a row with the facts it reads and *Run doctor* and *Rebuild*, then
  three sub-views: **Status** (laid out by the lens), **Lineage** (the source → render → deployed
  timeline and the genome-by-volume strand chart), and **Readout** (a searchable table of every
  deployed capability). Every lens hero carries the
  fleet verdict badge (the Ledger's `fleetVerdict`). The headline speaks the theme's voice only
  while that verdict is good or still loading; a warn, bad or unreachable fleet reads plain
  *Deployed*. Recent-run previews read `verb · scope · result · duration`, and the raw command
  is a tooltip only.

  The KPI band reads **Agents · Skills · Dictates · Local edits**. That third tile is
  labelled *Dictates* (the name AGENT.md gives the laws) and not *Constitution* on purpose: its value is the law count
  alone, and calling it the constitution would under-report the ontology and the doctrine
  packs. The two Status *layouts* that have room for it add the missing half: Greenhouse
  puts an active-packs fraction under the tile (`3/4 packs · N rules`), and the HUD
  gives it its own cell (`PACKS 3/4`). That is what makes a narrowed install *look* different
  from a full one at a glance.

### 📖 Codex

- **Rules** (`#/rules`) — your own standing rules, read from and written to the
  `user-rules.md` (the seed-once file no update ever touches): the shared file every global
  install reads, listed once under a `shared` head, beside each project install's own, under its
  install's name. An edit, graduate or retire writes back to the rule's own file, and a new rule goes
  to the file its form's *Install:* picker names. List with scope (project/global — a hand-written `user` opens as global — or any other scope written by hand, which a
  save keeps as written) and trial chips, add/edit/retire forms (retire moves the rule to `user-rules-retired.md`, which is never loaded; its id is never reused) (a body line starting
  `## ` is refused: the file would read it as a new rule heading), a
  **Graduate** action that adopts a trial rule for good. Each rule row shows its token cost
  (code points / 4 of its own block), and each list's head shows the one rule count and total, such
  as `4 rules · ≈1,055 tokens every turn · scope global unless marked`, which counts the file's
  header too. A row shows a scope only when it differs from that. There is no ceiling.
  A **Pending** section lists what waits undecided in `user-rules.draft.md`, and a pending rule still
  binds on its host. *Approve* and *Reject* decide a rule; a profile or wiki pointer shows both files,
  with *Use the host file*, *Use the shared file* and *Keep both*. These apply the rule skill's own
  steps (`js/build/rule-decide.mjs`), and a decision that moves a file offers *Rebuild all*. No decision
  applies while a job runs. The [change report](concepts/hooks.md#the-change-report) lists a decision like
  any other console write, and says it may be yours.
  Every write carries the fingerprint of the
  content the page last read — if an agent session edited the file meanwhile, the save
  409s and the page reloads instead of clobbering it.
- **Constitution** (`#/laws`) — the whole governance surface on one page, in three bands:
  the **Ethos** (five prose sections), the **Dictates** (the nine numbered Rules, with
  a class facet — only non-empty classes render, and two of the six have had no invariant
  since the split), and the **Doctrines** (one group per pack, each marked active or not for
  this install). Where an install can be rebuilt, each Rule and doctrine row has two toggle
  columns, headed *Rule text* and *Hook gate*. Each open band (Ethos, Dictates, every pack) repeats a compact column header under its title, and a folded pack shows none. Screen readers skip it: each row's label already reads its columns. *Rule text* is the doctrine switch, which stages
  like any doctrine change; a Dictate cannot be excluded, so its cell is locked, with the reason.
  *Hook gate* is the hook's switch: Rules I, III, IV and VIII (the secrets gate, the done gate,
  the deletion gate and the test note: `--no-secrets-gate`, `--no-done-gate`,
  `--no-deletion-gate`, `--no-test-note`) and doctrine rigor 5 (`--no-external-gate`). Flipping
  one asks, then rebuilds the install once; *Enforced by* reads *Gate off* while one is off. A
  hook with no switch shows a locked cell: process 5 reads *with text*, because excluding it
  drops its commit/push ask (`--no-consent`); process 1 and ops 2 read *always on*, because their
  hooks ask in every build. A row with no hook leaves the cell empty. Each switch's accessible
  name names its rule (`Deletion gate: hook gate of Deletion Is Deliberate`, `External Gate rule
  text`). Excluding rigor 5's text also switches its gate off in the same Apply, and the confirm
  says so; including it again offers *Also turn the external gate back on*, checked by default.
  A row whose text is excluded while its hook will still ask reads *Text excluded; the hook still
  asks.*: process 1 and ops 2 always, rigor 5 only once its exclusion is deployed with the gate
  armed. The ownership gate belongs
  to no Rule, so its switch (`--no-ownership-gate`) sits inside the Ethos band's *Ownership*
  row and works the same way. Closed, the row reads *Always* (the section's text binds whatever
  the gate does) and *Hook gate* or *Gate off*. Open, it shows the text, then a gate line with
  the gate's asks and the switch. That line exists only in the console and only where an install
  can be rebuilt: with no install the row reads *Instruction*. The gate counts in *Gated* but
  not as a Rule or a section, and the Ethos rank's pill counts it while it is off. Every tab,
  view and filter shows the row, like the sections around it.
  Every opened row that a hook gates (Rules I, III, IV and VIII, doctrines process 1, process 5,
  rigor 5 and ops 2, and the Ownership section) folds a *What the hook does* block after the rule
  text and before any gate line: what it triggers on, what each host does, what it does not see,
  and what still holds with the gate off. It shows with or without an install to rebuild. The
  text has one home, `GATE_HOOK` in `web/src/lib/constitution.js`; a text-only rule shows none.
  A precedence ladder heads the page (a state pill per rank; ranks 5–6 below). *Gated* and *Changed* narrow the rows; packs fold; staged doctrine changes
  collect in a sticky *Unapplied changes* bar that holds Revert and the page's one Apply.
  Every row expands to its full body, lazily fetched. The rail
  entry is labelled *Constitution* while the route, the id and the badge key stay `laws`; deep links
  are `#/item/law/ont:telos`, `#/item/law/IV`, `#/item/law/process.5` and `#/item/law/ownership` — address
  shapes that cannot collide, because a slug carries a colon no numeral has, a doctrine
  address carries a dot, and `ownership`, which opens the Ownership row at its gate, is a word
  no rule uses.
- **Library** (`#/library`) — browse the catalogue: **Skills · Agents · Wiki · Setup files**.
  Constitution has its own rail entry, and Memory and Notebook are Personal's tabs, their one home:
  the same reader, locked to one kind, with one empty state each. Drill into a section, then an item, to read its
  rendered markdown body and follow its cross-links. On a memory fact in Personal, a **Forget this
  fact** control deletes it (token-gated; bare-slug guarded server-side), and a
  **Promote to rule** control turns a recurring lesson into a trial rule in
  `user-rules.md` — provenance recorded, the source fact deleted so it isn't loaded
  twice — landing you on Personal's Rules tab.
- **Kits** (`#/kits`, `#/kits/<kit>`) — a card per shipped kit over a kits × installs matrix of
  switches; a staged-changes bar applies one install at a time (the server runs one job at a
  time). `#/kits/<kit>` is the kit's page: rules, word budget, banned APIs, upstream credits,
  members and one switch per install. This page is the one home of the kit switches. Toggling only
  stages the set; **Apply** asks first, then rebuilds that install with exactly that set as a console
  job. Staged switches are held for the whole console: they survive leaving the page. A refetch drops
  a row's staging only when that install's kits changed. A failed rebuild keeps it and says so, and
  a reload asks first while anything is staged. Files you edited in a kit that is now off are kept,
  and the matrix lists them under their install.
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
  Bricks read `GET /api/loops` for the install the page's *Install:* picker
  names (its own remembered pick, starting on the default; hidden with one install and on
  Active), resolved from that install's root, so a project install shows its `.geneseed/` bricks
  and templates. **Active** is every loop
  `geneseed loop init` registered on this machine (`GET /api/loops/active`, polled every
  5 s), grouped awaiting, running, done/stopped, finished/unreadable; the reader shows its
  branch, `iteration N / max`, current node and a preset picker (`POST /api/loops/preset`,
  the page's only write), what an awaiting loop waits on (launch / declared / actual / a
  human gate, with its node) — the answer is given in the agent's session, never here — and
  its ring with the current node filled, with its iteration history under it.
- **Profile** (`#/profile`) — `PROFILE.md`: who you are and how you like to work, one card
  per file: the shared one every global install reads, tagged `shared`, and each project
  install's own. Opens rendered; **Edit** is a whole-file editor. The save carries
  the fingerprint it loaded — if an agent session changed the file first, your edit stays
  on screen and a second Save replaces the newer version.
- **Skills** (`#/skills`) and **Agents** (`#/agents`) — the deployed catalogue of every
  installed harness, each entry with its purpose line and full spec. Each row is one skill or
  agent; when more than one install is active, it carries a badge for each install that has it
  (`opencode · global`; a project install by its folder). The reader shows the first install's copy. When more installs have the entry,
  an *Install:* picker beside the copy opens another install's version, for that entry only. While Skills is selected, its skill types sit nested
  under it in the rail, each with its count, above a thin bar of their shares; pick one to
  narrow the list. A skill the registry does not know sits under *Custom*.
- **Docs** (`#/docs`) — rendered documentation: markdown pages, concept pages, a CLI
  reference (generated from the harness argument parser), and a glossary, in a reader: one
  nav column holding the parts (Understand / Guides / Concepts / Reference) with their page
  counts, the open part's sections (pick one to narrow the list) and the part's pages with a
  filter; then the page, with its breadcrumb, section and reading time, a Copy button on each
  code block, an outline that marks the heading being read, and Previous / Next within the
  section. On a phone the page comes first and the parts and pages follow, in the DOM as on screen.
  A page's title is its H1 and its first heading an H2, whatever level the source starts at.
  Filtered for one host (OpenCode, Claude
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
  click it to open the session. With no mouse, tap a pad to show its files (a second tap clears them,
  and neither opens the session), or focus the tree and walk its pads with the arrow keys; Escape leaves. Past ten trees, quiet shelves (no session working or waiting on
  you) fold into chips, the largest first; the last standing shelf never folds. **Pink blossom** repaints the crowns pink, nothing more.
  A session's detail page shows its tree too, live or ended, with the same pad hovers and a
  legend of its turns, context, compactions and sub-agents; an ended session's tree stands still, without the `!`.
- **Local edits** (`#/diff`) — the diff between the install its *Install:* picker names and the source: edited /
  added / missing files, and files only behind the source (unedited; a rebuild updates them)
  listed apart under **Behind source**, with per-file expansion and coloured unified-diff lines. Select
  files to **export an `improvements.md`** back-port, or **restore** them to source.
  Restore acts only on files the diff lists, and never on your own files (`user-rules.md`,
  `PROFILE.md`, `memory/`, `notebook/`). An added file is moved into
  `archived-restore/<date-time>/` in the install, not deleted.
- **Doctor** (`#/doctor`) — runs, for the install its *Install:* picker names, the same health engine as the `doctor` command (that
  install's voice, parity, links, authoring gates, local edits), grouping any problems per check. It shows
  the server's last run for that install — warmed at start, redone after a job or an install
  toggle — and **Run doctor** runs every check again on demand.

### 🎨 Setup

- **Hosts** (`#/installs/hosts`; `#/harness` resolves here) — this machine's own install first (path, voice, footprint,
  and when it was built), then the **Voice** reference, then every detected install. A
  **Sync with source** column says whether each install is behind the source (and by how many
  files), in sync or not checked, shows local edits apart from stale files, and links to Local edits.
  `#/harnesses` and `#/themes` both still resolve here, so old links and bookmarks keep
  working. *Make default* on an active row sets the default install (above), and a per-repo
  install's panel has the **Shared tier** switch, with its benefit and cost beside it.
  - The **Voice** card is the former Themes tab, kept as a REFERENCE rather than a second
    control: a collapsed row that opens to every shipped voice with its tagline, the
    deployed one pinned first and marked. It is the one place you can read what a voice
    sounds like — the per-install picker below is a list of bare names. Applying happens
    there, per install, beside that install's own footprint, posture and mode; a gallery at
    the top of the page could only ever act on one of them.
  - **Every install** lists each detected install (host × scope), one row each. An
    ACTIVE row carries per-row **Voice**, **Footprint**, **Posture** and **Mode**
    pickers plus **Apply**, an on/off switch, and remove; a host that is NOT installed
    yet shows a single **Install…** that discloses the same four choices as steps. The panel is the
    footprint's one home: a line under the pickers says what the chosen footprint does.
    **Posture** is the relationship register (peer/mentor/expert/assistant/artisan —
    default **peer**); **Mode** is the operating register (direct/foreman — default
    **direct**; foreman triages tasks into isolated pipelines instead of working every
    one itself). Both are orthogonal to voice and to each other, picked here or via the
    setup wizard, and preserved across every rebuild.
  - "Deploy to folder…" and "Rebuild all" apply to the whole set. An **Excluded folders**
    card (shown once a global install exists) manages sovereign repos — folders where every
    global harness goes dormant (hooks stay silent, the global preamble never loads);
    add or remove one here, the web mirror of `harness exclude add|remove|list`.
- **Settings** (`#/settings`; `#/about` and `#/installs/server` resolve here) — a rail entry of its
  own, about the tool and never one install: a sheet with a section index. **Machine**:
  version + Update (labelled by how this copy updates: git pull, npm install -g, or the command
  to run by hand; on the Overview the button shows only when the pull can run), Add to PATH. **Server**: running · port ·
  pid · uptime, whether the code matches the disk (with Restart), Start at login (the
  login launcher's state; it writes the file when absent, updates it when stale and removes it when
  Geneseed wrote it, each after a confirm that names the file; a hand-written one gets only a
  link to the guide), and the four request guards; the index marks Server with a good/warn dot. **About**: version, changelog, credits, source, creator.
  **Danger zone**: Stop server, Remove from PATH, and a pointer to each install's own
  Uninstall in Hosts.
- **Appearance** (the topbar's popover, on every page) — the one home of the skin and the accent (a
  skin change resets it to the skin's own), each with a line that says what it does. Both are this
  browser's alone, and nothing here rebuilds.

## Rebuilding the UI

The committed `web/dist/` build is what ships. After changing anything under `web/src/`:

```bash
cd web && npm install && npm run build
```

If `web/dist/` is missing on a fresh clone, `geneseed web` offers to run that build for
you (answer `Y`); in a non-interactive shell it prints the manual recipe instead.
