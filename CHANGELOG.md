# Changelog

All notable changes to Geneseed are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions are the human-readable
labels in `harness.config.json`. The canonical identity of an *installed* harness
is the source fingerprint in `.geneseed-version` (see `geneseed version`), not this
label. For the capability ↔ spec map, see [SHIPPED.md](SHIPPED.md).

## [Unreleased]

### Added
- **The port's ninth piece, and the first one you can run without Python: `node
  bin/geneseed.mjs` builds the bundle.** Everything before this rendered *inside* a build
  that Python started; this is a second front door. `node bin/geneseed.mjs --theme imperial`
  produces the same bundle, the same console output and the same exit code as `python
  build.py --theme imperial` — verified byte-for-byte over every theme, both footprints, all
  five postures and both modes.
  **Only the plain bundle (`--emit files`) works this way so far.** The other eight emit
  modes still need Python, and asking the Node driver for one tells you so and stops, rather
  than writing half a harness. Nothing about the Python command changes: it is still the one
  the wizard, the web console, doctor and upgrade all use, and it stays that way until every
  mode has crossed.
  Two flags are deliberately *not* coming to the Node side. `--sync-themes` edits this
  repository's own theme files — maintainer tooling, not something an installed copy should
  carry — and `--validate-only` needs the Python doctor to do its second half. Both say so
  and point you at `python build.py`.
  There is no `package.json` and no published package yet; that is a later phase. What
  exists today is a runnable script in the checkout.
- **The port's eighth piece: `--emit opencode-global` renders through Node too, and now
  *every* emit does — counted this time, not claimed.** It was the one mode still on
  Python, which the entry below corrects the record about; it now takes the same path as
  the other eight, so the same promise applies: same files, same console output, same exit
  code, and no Node means nothing changes at all.
  What is worth knowing is what it took to say "every" honestly. The test that counts the
  modes refuses one that crosses with no comparison behind it — and this mode had never
  been compared between the two runtimes at all, only against itself. So it arrived with
  six new cases: a plain install and the rebuild over it; the lean footprint's standalone
  laws file; the opt-in primary agent and slash commands; an old harness to carry a memory
  store over from; a config dir you already keep your own agents, wiki and exclude list in,
  with the stores then edited between the two builds — the only way a byte comparison can
  tell "kept your memory" from "re-seeded it"; and an `opencode.jsonc` you have commented.
  One thing that reads like a detail and is not: `--out` is **not** where this emit writes.
  It renders into your OpenCode config dir and takes `--out` only as an old bundle to carry
  a memory or notebook store over from. Every earlier test left those two the same
  directory, so nothing could tell them apart.
- **The port's seventh piece: the code that edits *your* config files is now the code that
  runs when you build with Node.** The twin added last time was proven and unused; it is
  wired in now, so a build merges your `settings.json` / `settings.local.json` hooks, the
  managed block in your `CLAUDE.md`, and your `opencode.json` in the same Node process that
  renders. As with the six pieces before it, you should not be able to tell: same files,
  same console output, same exit code, and no Node means nothing changes at all.
  Two things stay on the Python side, and both are deliberate. The **check that runs after
  every build** — the one that re-reads your settings file and warns if the hooks did not
  actually land — now verifies Node's work from the other implementation, on every build,
  which is a stronger guarantee than either half could give alone. And the **hook shim**
  still points at Python and `harness.py`, because the hooks themselves are still Python:
  no already-installed harness has its shim rewritten, and nothing you have deployed
  changes. That last one used to be invisible to every test — the shim is deliberately
  excluded from the byte comparison so a version-to-version run is not drowned in noise —
  so the boundary test now compares it directly.
  Newly watched, because nothing reached them before: a `settings.local.json` you have
  added comments to (left untouched, and it says so), an `opencode.jsonc` likewise, and an
  install that has accumulated more than one recorded exclude — where the *order* they are
  recorded in is part of the file and one entry was never enough to notice.
- **A count in these notes and in DESIGN.md was wrong for two releases: `--emit
  opencode-global` never rendered through Node.** "Every emit now renders through Node" was
  eight of the nine. That mode still runs the Python, exactly as it always has, so nothing
  about it has changed or broken — but the sentence claiming otherwise has, and there is now
  a test that counts the modes instead of trusting the prose.
- **The port's sixth piece: the layer that edits *your* config files now has a Node twin
  too — proven, not yet wired in.** Nothing about your builds changes with this; the new
  code is not called yet. What changes is that the merging into `settings.json`, the
  `opencode.json` wiring, the managed block in `CLAUDE.md` and the hook shim are now
  compared byte for byte between the two runtimes, across states no ordinary build ever
  reaches: a settings file carrying your own hooks beside Geneseed's, one with comments in
  it (which the harness refuses to rewrite, and says so), one that is not valid JSON, and
  an older install whose hooks were wired into a different file and have to be unwired
  there. These are the paths `deactivate`, `remerge`, `reactivate`, `uninstall` and
  `exclude` run on a real machine, and nothing had ever compared them.
- **The rebuild's clean-up of files it no longer produces is now actually tested.** The
  build removes what a previous build owned and this one does not — a dropped skill, a
  footprint switch, a theme change. The acceptance harness re-emitted the *same*
  configuration twice, so there was never anything to remove and the clean-up ran empty
  every time. It now builds one configuration, builds a different one on top, and checks
  the result matches a fresh build of the second — which catches both a clean-up that
  leaves stale files behind and one that deletes files the new build still needs.
- **The port's fifth piece: eight of the nine emits now render through Node when you have
  it — Claude, Bob and Copilot included, per-repo and global.** Before this, only `build`
  and `--emit opencode` did; six more moved here. (This entry originally said "every emit"
  and "the other six"; it was seven that remained, and `--emit opencode-global` is the one
  still on Python. Corrected in the seventh piece above.) As with the last four
  pieces, the whole point is that you cannot tell: same files, same console output, same
  exit code. No Node, or `GENESEED_NO_JS=1`, and nothing changes at all.
  What is worth knowing is what the new tests now watch, because these emits touch files
  you co-own and files you own outright. Your `settings.json` / `settings.local.json` hook
  merge and the managed block inside `CLAUDE.md` / `AGENTS.md` are compared byte for byte
  between the two runtimes for the first time, and so are the cases that only happen on a
  real machine: an install migrating a `memory/` or `notebook/` store in from an older
  bundle, a project `.claude/` where you already put your own agent or `.gitignore`, and
  every seeded-once file — `excludes.json`, `user-rules.md`, `PROFILE.md`, `wiki.jsonc`,
  your memory index — **edited between two builds**, which is the only way a comparison can
  prove a rebuild left them alone instead of rewriting them with the same bytes.
- **The port's fourth piece, and the first one you actually run: if you have Node
  installed, `geneseed build` and `--emit opencode` now render through it.** This is the
  first change in the port that touches your machine, and the point is that you should not
  be able to tell — the bundle is byte-for-byte what Python produced, down to the progress
  lines. No Node, or `GENESEED_NO_JS=1`, and the Python path runs exactly as before; there
  is nothing to install and nothing to configure either way.
  The new gate is what makes that claim checkable: it builds the same target twice, once
  each way, and compares the files, both output streams and the exit code — including
  cases a normal build never produces, like a second build over an existing one, a
  hand-edited `.geneseed-srcdirs.json` pointing outside the bundle, and files you edited
  between two builds that the harness promises never to overwrite. The build-comparison
  harness now checks the console output too, which nothing had ever compared.
- **The port's third piece: the OpenCode extras — colour themes, the opt-in primary agent
  and slash commands, the plugin and workflow copies, and the `agent-overrides.json`
  stub.** Still nothing changes about running Geneseed; Python remains what builds your
  harness. The point again is what the new test reaches. Two of these layers only exist
  when `GENESEED_PRIMARY` or `GENESEED_COMMANDS` is set, so a normal build never writes
  them and no build-and-compare test ever had — they are now checked in both languages
  with the flags on and off, along with the "your overrides predate an upgrade" notice in
  each of its four states.
- **The port's second piece: the layer that writes your host-native agents and skills now
  exists in JavaScript too, with a test that covers the cases a normal build never
  reaches.** Nothing about running Geneseed changes yet — Python still builds your harness.
  What is new is the gate. Until now every acceptance test emitted into an empty folder with
  an empty `agent-overrides.json`, so three behaviours had never been checked in either
  language: what happens when you *have* overrides, what happens when a file already exists
  that Geneseed did not write (it is left alone, and you are told), and what the three host
  dialects do differently. `tests/test_native_layer_parity.py` runs all of them in both
  languages and compares the files, the ownership record and the warnings.
- **A bug this found before anyone hit it:** an `agent-overrides.json` setting
  `"temperature": 1.0` would have emitted `temperature: 1.0` from Python and
  `temperature: 1` from JavaScript, because JavaScript has one number type where Python has
  two. No build-and-compare test could have caught it — the build always writes an *empty*
  overrides file, so no such test has ever had an override to render. Fixed, and pinned by a
  test that compares number formatting directly.
- **The generator's render core now exists in JavaScript as well as Python, and a test
  proves the two produce identical bytes.** Nothing about running Geneseed changes yet —
  Python is still what builds your harness — but this is the first piece of the runtime to
  be ported, and it lands with the gate that will keep the rest honest:
  `tests/test_render_parity.py` renders every theme in both languages, on every footprint,
  catalogue, posture and mode axis, writes both trees to disk and compares them byte for
  byte. Writing to disk rather than comparing strings is deliberate: on Windows, Python's
  text writer silently turns every `\n` into `\r\n` and Node's does not, so a port that
  skipped that detail would differ in every single file while looking correct in a diff
  viewer.
- **Every emit now runs its stages in one fixed order** — render everything Geneseed owns,
  then reconcile the files you co-own (`settings.json`, `opencode.json`, the CLAUDE.md
  block), then prune, then record the manifest, then verify. Three emits used to interleave
  those stages differently. Output is unchanged, byte for byte, on all 259 theme × host ×
  footprint combinations; what changes is that there is now a single seam between "files
  Geneseed writes wholesale" and "files you co-own", which is what lets the render half
  move to another language without the merge logic following it.
- **Emitted hooks now go through a stable shim, so moving the checkout no longer kills
  every install at once.** Until now each of the four Claude/Bob hook commands embedded
  two machine-absolute paths — this machine's Python interpreter and this clone's
  `rituals/harness.py` — directly in your `settings.json`. Relocating or replacing the
  checkout therefore broke the gates in every deployed install simultaneously, and the
  only repair was re-emitting every config. The emit now writes one small shim at
  `~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows, relocatable with
  `GENESEED_HOME`) and points every hook at that single stable path; the shim holds the
  two volatile paths instead. Re-pointing every install at a new checkout is now one
  file write. The shim is refreshed on every emit — that refresh is what replaces the
  accidental self-heal the old form had, since a config that no longer names the
  checkout can no longer detect that the checkout moved — and a new `doctor` gate reads
  it back and reports a shim that points at nothing. The shim is deliberately silent:
  `git-gate` and `rule-gate` return success on every path and signal their verdict as
  JSON on **stdout**, so a single stray byte would turn a blocking gate into a silently
  permissive one. Existing installs migrate on their next build — the manifest-driven
  prune replaces the old hook groups exactly, and the orphan scan now recognises both
  the legacy and the shim shape so a stranded hook still surfaces.
- **The `rule` skill becomes the front door to both durable stores, behind a Law VI
  gate**: nothing reaches `user-rules.md` or `memory/` on the agent's own initiative
  any more. The skill now opens on a fork it must put to the user — *a standing rule,
  or a fact to remember?* — because the agent silently arbitrating that was the actual
  defect: a passing preference got legislated as a permanent rule, or a real rule was
  filed away as a forgettable note. The memory branch asks for the binding `force`
  (constraint · choice · conviction · tempered) and shows the exact file, frontmatter
  included, before writing. The rule branch pressure-tests instead of drafting: the
  user restates the rule as they would to a colleague on day one and gets interrupted
  on jargon they cannot unpack, a missing step, or a simplification that makes the rule
  false (the feynman skill's mechanic, borrowed — not delegated to); then a **mandatory
  counter-example**, where the agent builds the case the rule would harm and the user
  must either accept it or narrow the rule. A rule that cannot survive its own worst
  case was never generic, only never contradicted. The asymmetry in cost between the
  two branches is deliberate — cheap to remember, expensive to legislate, or the rule
  set inflates. Enforced at the tool boundary, not just in prose: a new
  `harness.py rule-gate` PreToolUse hook makes Claude Code and Bob **ask** before any
  write to `user-rules.md` or a memory file, and `geneseed-guard.js` speed-bumps the
  first such write on OpenCode (its `tool.execute.before` has no ask tier — a re-issued
  write goes through, so nothing is ever trapped). Copilot has no hook mechanism and is
  held by the Law and the preamble alone.
- **`token-report` folder skill — session token usage breakdown on every host**: a
  first-party folder skill (the first non-vendored entry in `VENDORED_SKILL_DIRS`,
  which the folder mechanism carries because it bundles an executable script) that
  renders the session's token usage as markdown tables: exact recorded totals
  (output, fresh input, cache reads/writes; main thread vs subagents), context
  window occupancy (session-start harness baseline, current/peak vs limit), an
  estimated per-category attribution of what filled the context (user messages,
  replies, thinking, per-tool calls/results, injected skill content), and the
  heaviest single items. `scripts/token_report.py` auto-detects the host by most
  recent session activity: exact usage on Claude Code, IBM Bob (`$BOB_CONFIG_DIR`
  honoured) and OpenCode; best-effort harvesting on GitHub Copilot, whose
  session-state schema is undocumented. OpenCode reads the v1.2+ SQLite store
  (`opencode.db`: `session`/`message`/`part` tables, JSON `data` columns,
  step-finish fallback when a message record carries no tokens, child sessions
  attributed as subagent usage) and falls back to the pre-1.2 `storage/` JSON
  files when no DB exists. Carrier ceiling (full) raised 49_000 → 51_000 for
  the new AGENT.md folder-skill entry.
- **GitHub Copilot host — `--emit copilot` / `--emit copilot-global`**: the fourth
  first-class host, riding the Claude-shaped emit engine. Per-repo: root `AGENTS.md`
  (auto-loaded by the Copilot CLI, coding agent, and VS Code agent mode) + a layer in
  the shared `.github/` dir — `agents/<name>.agent.md` in Copilot's custom-agent
  dialect (`tools:` allowlist for read-only agents, sibling links rewritten to the
  `.agent.md` extension) and byte-identical `skills/` (Copilot Agent Skills).
  Personal: `~/.copilot` (`$COPILOT_CONFIG_DIR` relocates) with the preamble as a
  managed block in `copilot-instructions.md`, which the CLI auto-loads — no Bob-style
  rules-folder workaround needed. Copilot has no settings.json or hook mechanism, so
  the settings/hooks/excludes stage is skipped entirely (memory rides the preamble's
  instructions); with no exclude mechanism either, the global emit warns when project
  installs exist (both preambles stack). Writing into `.github/` is safe by
  construction: the ownership manifest + claim-on-create never touch user files.
  Full lifecycle parity — setup wizard/TUI rows, web console deploy option +
  Harnesses rows, MCP wiring (`~/.copilot/mcp-config.json`, `mcpServers` with the
  CLI's required `type`/`tools` keys, global-only), doctor per-repo emit validation,
  rebuild-all, diff/restore, deactivate/reactivate/uninstall, footprint dial, and
  theme detection via the `copilot-instructions.md` sigil fallback.
- **User rules — `user-rules.md`**: a seed-once file beside AGENT.md for the user's
  own standing rules, obeyed with the same force as the laws (they may tighten a
  law, never repeal one). Same host-state contract as `context.json`: every emit
  seeds it once, never overwrites it, never records it in an owned manifest — so
  user governance survives updates, reinstalls, and theme switches; unlike
  `context.json` it is committable, so project rules can travel with a repo and
  bind the team. Named `user-rules.md` (not `rules.md`) because the neutral theme
  renders the laws themselves as "Rules". The context plugin and Claude hook
  eager-load it in discovery mode. A new **rule skill** drafts and triages rules
  (rule vs memory vs `context.json` vs already-covered), refuses law conflicts,
  promotes recurring feedback memories into trial rules with consent, and runs
  the review flow (graduate / demote / delete). Memory and notebook READMEs now
  route "share with the team" there instead of the regenerated laws.
- **Web console Rules page** (`#/rules`, right under Laws in the rail): list your
  rules with scope and trial chips, add/edit/retire them, graduate a trial rule,
  and watch a budget meter that turns amber as the always-loaded set grows. A
  **Promote to rule** control on memory facts turns a recurring lesson into a
  trial rule with provenance and deletes the source fact. Backed by
  `GET/POST /api/rules` + `/api/rules/promote` (token-gated); every write carries
  a content fingerprint and 409s when an agent session edited the file
  concurrently, and mutations splice one rule's block — the rest of the user's
  file is never regenerated.

### Fixed
- **The golden acceptance harness could render into your real install.** `tests/golden.py`
  runs the generator over 259 cells, ~126 of which are `*-global` emits whose whole job is
  to write into a host's global config dir, and it sandboxes them by redirecting `HOME`
  and `XDG_CONFIG_HOME`. That was not enough: each host resolver checks its own relocation
  variable *first* and returns before ever consulting those paths, so anyone with
  `OPENCODE_CONFIG_DIR` set — the documented way to keep the harness in a git-tracked
  folder — had every global cell rendering straight into the real target. Reproduced
  against the pre-fix code: a single `opencode-global` cell wrote 135 files outside the
  sandbox. The cell environment now clears `OPENCODE_CONFIG_DIR`, `BOB_CONFIG_DIR` and
  `COPILOT_CONFIG_DIR`, plus every `GENESEED_*` knob except the one it sets itself —
  cleared by prefix, so a knob added later is neutralised by default. Four tests pin it,
  including one that re-derives the variable list from `_build_core`'s own source rather
  than trusting a hand-written list to stay current.
- **Every login launcher told you to start the web UI in the foreground**: the VBS,
  the `schtasks` task and the macOS LaunchAgent in SETUP.md (and its `autostart`
  web slice) all ran `geneseed web --no-browser`. Only `web start` daemonizes and
  writes the `.geneseed-web.json` pid record — bare `web` blocks in the foreground
  and records nothing, so the server that came up at every login was invisible to
  `web stop`, `web restart` and `web status`. They reported "no live server" while
  it kept serving; worse, `restart` then spawned a second daemon that could not bind
  the taken port, leaving three live processes and the *stale* one still answering.
  That is how a `web/dist` rebuild turned into hard MIME failures in the browser: the
  old server kept handing out the previous `index.html`, whose chunk hashes no longer
  existed on disk, and the SPA 404-fallback returned them as `text/html`. All four
  launchers now use `web start`, and the section says why in a callout.
- **Laws XXXVI and XXXVII render their Principle in the web ledger**: both shipped
  with no row in `LAW_META` (`web/src/pages/Laws.jsx`), the map that holds each
  rule's one-line Principle — display copy that lives nowhere else in the tree. An
  absent row falls back to `['craft', '']`, so the two newest laws showed a blank
  description and a wrong class chip while everything upstream stayed correct: the
  catalog served them, the page rendered, `LAW_CLASS` was complete, doctor and both
  suites were green. Rows added (XXXVI · security, XXXVII · process), and `doctor`
  gained the gate that was missing (`_law_meta_problems`): every rule in
  `universal.md` must have a `LAW_META` row with a non-empty principle and a known
  class that agrees with `LAW_CLASS`, and no row may outlive its rule. Sibling of
  the `LAW_CLASS` completeness gate added after Law XXXV shipped mis-classified —
  same failure shape, the other half of the pair. `DESIGN.md` now lists the six
  satellite edits a new Law drags along, so the next one is a checklist, not a
  rediscovery.
- **Claude/Bob emits no longer ship dead skill-table links**: CLAUDE.md/AGENTS.md's
  per-row skill/agent links (e.g. `.claude/skills/council.md`) were dead — the
  native layer writes each skill as a folder (`.claude/skills/council/SKILL.md`).
  `_strip_capability_links` already ran on this path, but `CAPABILITY_LINK_RE`
  only matched a BARE `agents/`/`skills/` prefix; the claude/bob project-scope
  render re-prefixes those tokens (`.claude/`, `.bob/`, `../`), which slid straight
  past the regex. It now tolerates an optional relative-path prefix (never
  `http(s)://` or a leading `/`), so the existing strip catches every prefixed form
  too — same fix benefits the OpenCode emits' own prefixed edge cases. `doctor`
  gained a matching check (`_claude_bob_emit_problems`): it previously validated
  the `files` build and the opencode-global emit but never the claude/bob per-repo
  emits, which is why this shipped unnoticed; `--validate-only --emit claude`/`bob`
  are clean again, and the stale SETUP.md "known limitation" note is removed.
- **Renamed DIR_* dirs in the portable bundle no longer orphan**: the bundle's
  owned dirs (`laws`/`agents`/`skills`, in their themed form) are wiped and
  rebuilt each run, but the wipe was keyed only to the CURRENT theme's dir name —
  if a theme ever renamed one of them between two builds into the same target,
  the old dir was never targeted and lingered forever. A new local marker
  (`.geneseed-srcdirs.json`) now remembers which dir name was actually used last
  time, so a rename is also pruned. (Shipped themes don't currently vary DIR_*, so
  this is future-proofing rather than an active drift; the global/Claude/Bob
  scopes' equivalent case — a lean-footprint standalone laws dir surviving a
  switch back to full — is already covered by the owned-file manifest.)
- **Bob installs now actually load the preamble/theme**: IBM Bob's only
  always-injected instruction channel is the rules folder — a global
  `~/.bob/AGENTS.md` is never auto-loaded (only a project-root one is), which left
  Bob installs with working skills but no harness voice. Both Bob emits now also
  ship the preamble as `rules/geneseed.md` (project `.bob/rules/`, global
  `~/.bob/rules/`). The Claude-only `claudeMdExcludes` key is no longer written for
  Bob (its Bob semantics are undocumented and a filename-keyed match would suppress
  the project's own `AGENTS.md`); a re-emit strips one left by an older install.
  Project-bypasses-global on Bob now rides on its native rule precedence: the
  workspace `rules/geneseed.md` shadows the same-named global rule.
- **Lean installs no longer report permanent phantom drift — and Restore no longer
  converts them to full**: everything that renders an "expected" copy of an install
  must render it at that install's OWN footprint, read from its `.geneseed-footprint`
  marker. Three callers did not. `diff` (and the Local-edits panel it feeds) rendered
  at `full`, so every lean install reported two edits it could never clear by
  rebuilding — `AGENT.md` (terse §1 digest vs the inlined laws) and
  `laws/universal.md`, which only the lean global emit writes. `doctor` validated the
  full emit only, so a lean-only regression could ship green. Worst of the three,
  `Restore` in the web console rendered at `full` too: discarding a local edit on a
  lean install rewrote `AGENT.md` with the inlined laws and DELETED
  `laws/universal.md` — silently promoting the install to a full footprint. All three
  now read the marker. Note that the web UI serves the code it was launched with:
  restart the daemon (`geneseed web restart`) after upgrading, or the panel keeps
  reporting the old verdict.

### Changed
- **The host-config wiring moved into its own module, `_build_settings.py`.** The emit was
  doing two unrelated jobs in one file: computing bundle content, and reconciling
  Geneseed's claim inside files you also edit — `settings.json`, `opencode.json`, the
  managed `CLAUDE.md` block — through JSONC parsing and surgical merges. The second job is
  not really part of generation at all: nine of its ten entry points are called by the
  *runtime* (deactivate, remerge, reactivate, uninstall, plus `exclude` and `mcp`), not by
  a build. Splitting them takes `_build_emit.py` from 1466 lines to 734 and leaves a layer
  whose dependency closure points one way only — nothing in it calls back into the render
  or emit code. Nothing moved namespace: `build.py` splices the new module alongside the
  others, so every existing call site resolves unchanged, and emitted output is identical
  across all 259 golden cells. If you monkeypatch any of it, patch `_build_settings` —
  patching another submodule's spliced copy binds a copy the real caller never reads, and
  a test now fails on that shape.
- **The generator's configuration now has one owner instead of five copies.** `build.py`
  splices its four `_build_*` submodules into a shared namespace, which gave each of them
  its own copy of `SRC`, `THEMES`, `ROOT`, `CONFIG`, `PLUGIN_SRC`, `WORKFLOW_SRC`,
  `COLOR_THEMES`, `CAPABILITY_LINK_RE`, `VENDORED_SKILL_DIRS`, the four
  `_<host>_config_dir` resolvers and the posture/mode selection — and forced a facade
  `__setattr__` that mirrored every write out to all four so that redirecting one
  actually reached the render code. `_build_core` now owns those names outright: they are
  held back from both its `__all__` and the splice, so no copy exists, and the mirror is
  deleted. Emitted output is unchanged — verified byte-for-byte against the previous
  revision across the full 259-cell matrix (14 themes × 9 emit modes × 2 footprints, plus
  every posture and mode). Two consequences for anyone working on the generator: read
  them as `_build_core.SRC`, not a bare `SRC` (a bare one now raises `NameError` instead
  of silently reading a stale copy), and redirect them by writing `_build_core.SRC` —
  `build.SRC` still reads but refuses writes, because `mock.patch.object(build, "SRC", …)`
  deleted rather than restored the attribute on exit and leaked the redirect into every
  later test in the process. A test now walks the suite and fails on any redirect of a
  shared-but-unowned name, the shape that quietly stops covering what it claims to —
  `_opencode_config_dir` was already in that state, one missing `cfg=` argument away from
  sending a global emit into the developer's own `~/.config/opencode`.
- **`docs/specs/`, `docs/reviews/`, and `docs/superpowers/` are local working docs
  now**: untracked from git and added to `.gitignore`. They are per-machine work
  artifacts (dated specs are drafted, executed, then dropped — the existing
  lifecycle); the repo's prose (README, DESIGN, SHIPPED) no longer links them as
  distributed folders, and SHIPPED.md states its spec links are historical
  pointers into that local record.
- **Bob installs stopped double-paying the preamble**: a per-repo Bob install's
  `.bob/rules/geneseed.md` is now a slim shadow stub instead of a full second copy
  of the preamble — the repo-root `AGENTS.md` (auto-loaded) carries the
  instructions, and the stub's only job is to shadow the same-named global rules
  file (Bob injects every workspace rule each turn, so the full copy doubled the
  install's fixed per-turn token cost). The global Bob emit no longer writes
  `~/.bob/AGENTS.md` at all — Bob never auto-loads a global one; `rules/geneseed.md`
  is the sole carrier — and a re-emit removes the stale copy an older install left
  behind. Existing installs heal on the next rebuild/upgrade.
- **Self-update is now `git pull`**: `geneseed upgrade`/`update`/`sync-self` fast-forward
  the install's own git origin (host-agnostic — wherever it was cloned from), doctor-gate
  the result (rolling back on failure), then rebuild — replacing the bespoke curl/urllib
  archive-zip download stack. A dirty tree or non-git checkout is reported (CLI message + a
  web info popup) instead of failing mid-run.

### Removed
- The offline `geneseed upgrade --zip <file>` path and the web "Offline package" download
  (`/api/offline-zip`) — use `git pull` directly.

### Added
- **Per-agent memory** — each capability agent now keeps durable lessons in
  `memory/agents/<name>.md`. Every agent spec reads its own file first at dispatch
  (step 0 of its procedure); the write-back is mechanical and lands on **all three
  hosts equally**: the OpenCode `geneseed-learn` plugin distils a finished subagent
  session into one per-agent lesson, and the claude/bob emits gain a `SubagentStop`
  hook that routes to the same Python path (`learn` reads the payload's
  `hook_event_name`). Unresolvable subagent name → silent no-op, never a wrong write.
- **`learn --consolidate`** — rebuilds `MEMORY.md` from the fact files on disk:
  re-indexes orphaned facts, prunes dead index lines, and reports duplicate
  descriptions for the user to merge (never auto-merged).
- **`dispatch` workflow** — a saved OpenCode workflow that decomposes a multi-domain
  goal, routes each subtask to its owning capability agent, and converges the
  results. Where a host has no `workflow` tool, the same shape runs model-driven via
  the parallel-agents skill. The **handoff envelope** (subtask goal, inputs, output
  contract; no commit/push — Law XX stays with the caller; gaps reported, never
  invented) is now written into `AGENT.md` for every emit, the OpenCode orchestrator,
  the parallel-agents skill, and the agent template.
- **Downgrade warning + stale-overrides notice**: re-emitting over an existing
  install now compares the deployed release (stamped in `.geneseed-version`
  alongside the fingerprint) against the source tree's `harness.config.json`
  version and prints a loud, warn-only notice when the deployed build is newer
  ("did you forget git pull?") — never blocks, since a deliberate downgrade must
  stay possible. `agent-overrides.json` is now stamped with `_version` at
  creation; the file itself is never rewritten on re-emit, but if it carries real
  overrides and its `_version` no longer matches the source, a one-line notice
  points you at reviewing them against the updated agent specs.
- **`build.py --validate-only`**: a dry run — full render, all doctor validations,
  and a sandboxed emit of the requested target, written to a temp dir and
  discarded. Exits non-zero on any problem, writes nothing real. (Note: `--emit
  claude|bob` currently reports known pre-existing dead skill-link problems;
  that fix is tracked separately.)
- **`build.py --sync-themes`**: fills any key `themes/_TEMPLATE.json` has but a
  theme JSON is missing — surgical line insertion in template order (no file
  churn), never removes extras, and exits 1 when it changed files so CI can use
  it as a check. The doctor's parity failure now points at it.
- **`AGENT_COLORS` theme key**: the OpenCode agent→colour-slot map moved from a
  hardcoded table in the emitter into `themes/_TEMPLATE.json` (and all shipped
  themes), so a theme can restyle agent UI grouping. Unknown slot values warn
  and fall back to `secondary`; themes missing the key fall back to the old
  built-in map.
- **Ask-tier bash for research agents**: `explorer` and `empiricist` now carry
  the same marker `historian` already had — OpenCode emits `bash: ask` (instead
  of deny) and Claude Code leaves Bash to its own permission prompts, so
  read-only searches (grep, git log) no longer dead-end. Every other read-only
  agent keeps the blanket deny.
- **`.opencode/` re-emits stopped wiping user files**: the project OpenCode emit
  now tracks what it owns in `.opencode/.geneseed-manifest.json` and prunes only
  stale owned files (write-before-delete), skipping user-authored files with a
  warning — the same claim-on-create model the Claude path always had. The first
  re-emit over a pre-manifest install treats existing files as yours and says so.
- **`harness uninstall` hardening**: a global uninstall now prints an inventory of
  any surviving PROJECT installs elsewhere (each is self-contained — its hooks call
  the shared checkout by absolute path, not the global config dir being removed —
  so nothing is touched, just listed with the exact `--target` to remove it too); a
  project uninstall now checks whether another host (Claude/OpenCode/Bob) also has
  an install at the same repo root and says so. A settings.json left with a
  leftover/locked owned file (Windows-plausible) no longer silently drops its
  `.geneseed-emit` marker — the marker is kept and the run is reported INCOMPLETE
  so the install can be found and retried. After every settings.json merge/unwire
  (emit, deactivate, uninstall), a new integrity check (`_settings_integrity_check`)
  verifies the manifest's claimed hooks/excludes actually match the file and warns
  (never auto-fixes) on drift or an unrecorded Geneseed-pattern hook left behind.
- **Project bypasses global harness**: when a repo carries its own Geneseed
  install, the same host's GLOBAL harness no longer double-loads there. For
  Claude/Bob a project emit writes the global preamble into `claudeMdExcludes`
  (native, repo-scoped) and the global SessionStart context hook stands down via
  an up-walk marker check — so a session started anywhere in the repo gets the
  project harness only, and the global one elsewhere. OpenCode already scopes its
  context to the cwd (the context plugin dedups), and its `instructions[]`
  preamble double-load remains the documented harmless cost (moving it would
  strip subagents of the laws). Opt out — restore stacking — with
  `GENESEED_STACK_GLOBAL=1` (honoured at emit and in the hook).
- **Law XXI — Commands Must Return**: a non-interactive-shell law forbidding
  commands that hang on a TTY (interactive prompts, pagers, REPLs, editors,
  unbounded processes) and directing the agent to the non-interactive form
  (`--yes`, `--no-pager`, piped input, bounded long runs). Brings the law count
  to 21. (Distilled from awesome-opencode's *Shell Strategy* plugin.)
- **Context plugin — self-awareness & command discovery**: `geneseed-context`
  now surfaces the session's live model (read from the transcript, with a
  `GENESEED_MODEL` fallback) and the project's runnable command targets
  (`Makefile`, `package.json` scripts, `justfile`, `Taskfile`) in the injected
  PROJECT CONTEXT block. (Distilled from awesome-opencode's *Model Announcer* and
  *Command Inject* plugins.)
- **`geneseed-notify` plugin** (OpenCode): a fifth plugin that sends a native,
  dependency-free OS notification (macOS `osascript`, Linux `notify-send`, Windows
  PowerShell) when the agent finishes a turn — gated by `GENESEED_NOTIFY_MIN_SECONDS`
  (default 30) so only genuinely long runs ping, and skipping subagent/throwaway
  sessions. Toggle with `GENESEED_NOTIFY=off`. (Distilled from awesome-opencode's
  *Opencode Notify*.)
- Three learning skills that teach the user rather than do the work for them:
  - `crash-course` — go from zero to functional in a skill fast: what to learn
    first, what to ignore, and the one high-leverage exercise.
  - `drill` — turn shaky knowledge into reflex through Socratic practice on
    realistic mistakes, withholding the answer until the user has tried.
  - `decode` — make confusing material click via one keystone sentence, an
    everyday analogy, and a three-question comprehension check.
  These join `learning-path`, `gap-detector`, and `feynman`, bringing the
  skill count to 33.

## [1.0.0] — 2026-06-13

First stable release. The harness, its tooling, and the local web console are
feature-complete and validated by a dependency-free CI (doctor + unit/node/web
suites) on Linux and Windows.

### Harness
- One neutral `src/` rendered by a stdlib-only generator (`build.py`) into 14
  themed, tool-agnostic bundles; structure stays theme-independent.
- 20 universal laws, 16 capability agents (6 execution + a 10-seat debate council),
  30 skills, the one-fact-per-file memory convention, and the agent's sovereign
  notebook.

### Tooling
- `geneseed` launchers for bash, cmd, and PowerShell; run-from-anywhere via
  `link`/`unlink`; `bootstrap`/`upgrade`/`sync-self` with SHA-pinned, self-healing
  updates.
- `doctor` (tokens, links, theme parity, authoring gates, bundle drift), `diff` +
  improvements export, `status`/`version`, a curses TUI with a native-Windows VT
  backend, and MCP wiring.

### Web console
- Local, offline, installable (PWA) browser UI over the deployed harness: Dashboard,
  Library, Graph, Docs, Specs, Changes, Doctor, Themes, Settings, About, plus a
  Spotlight search and a streaming job console. Background daemon; `127.0.0.1`-bound
  with a per-session CSRF token on every mutation.

### Adapters
- OpenCode native agent/skill mapping and four plugins (context, learn, guard,
  workflow); a Claude Code hook adapter.

### Documentation & quality (this release)
- Added a whole-project review (`docs/reviews/`), a `SHIPPED.md` capability registry,
  and a `docs/web-ui.md` console guide; demarcated `docs/superpowers/` as an archive.
- Added `themes/_TEMPLATE.json` + a theme-authoring guide, routed every theme
  enumeration through a single `build.theme_files()` helper (scaffolds excluded).
- Tightened the safety net: fixture tests for all three emit modes, self-tests for
  the doctor parity gate, the `context_delivery` node suite wired into CI, and a
  universal `prefers-reduced-motion` pass in the web UI.
- Removed a leaked authoring note from Law VII.

### Known follow-ups
Structural refactors identified in the review remain as post-1.0 work: generating the
`AGENT.md` capability tables from `src/`, unifying the three emit paths in `build.py`,
a route table for `web.py`, and replacing the `harness.py` namespace-merge facade with
explicit imports. None affect behaviour today.

[1.0.0]: https://github.com/Arylmera/Geneseed/releases/tag/v1.0.0
