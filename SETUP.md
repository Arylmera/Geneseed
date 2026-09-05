<div align="center">

# 🧬 Geneseed — Setup Guide

**From bare repository to a disciplined agent in a few minutes.**

[← Back to README](README.md) · [Design](DESIGN.md) · [OpenCode adapter](adapters/opencode/README.md) · [Claude Code adapter](adapters/claude-code/README.md)

</div>

> **In a hurry?** The 5-minute recommended path is **[QUICKSTART.md](QUICKSTART.md)**.
> This page is the full reference: every install path, knob, and troubleshooting step.

---

You pick a **theme** — the voice and vocabulary the harness wears — and an **install mode**;
the build implants the gene-seed and the agent wakes speaking in that voice. Pick the path
that matches your tool, then configure and verify. For the conceptual overview see the
[README](README.md); for OpenCode internals see [adapters/opencode/](adapters/opencode/README.md).

## 📋 Prerequisites

- **Node ≥ 22.3** — the only hard requirement. Geneseed ships as an npm package with
  **zero dependencies**; `npx geneseed` needs nothing else.
- **Your agent tool** — OpenCode (recommended), Claude Code, Bob, Copilot, or anything
  that reads a root instructions file.
- *Only for a git checkout:* **git**. Nothing else — a checkout runs the same Node
  entry points the npm package installs.
- *Optional, for the `ingest` skill:* a document converter — **MarkItDown**, Pandoc,
  or Docling — if you want the agent to read PDFs/Office files (see
  [Reading non-markdown docs](#reading-non-markdown-docs)).

### 🟩 One runtime — Node, and nothing else

Nothing in this guide needs a second interpreter. Three things are worth stating plainly,
because each is a live constraint rather than a footnote:

- **0 commands have no Node twin**: every command in this guide answers from the Node
  entry points. There is no full-screen browse panel: `geneseed tui` and `geneseed menu`
  are verbs that say the panel is not here and print the command list instead, and off a
  terminal (which is how scripts and CI run them) the bytes and the exit code are the
  recorded ones. `home` opens the web console, which is the visual front end.
- **Nothing you install needs an interpreter.** The `token-report` skill is a script
  rather than prose, and it ships as `scripts/token_report.mjs`, run with `node`;
  `daydream` and `herdr` hand their inline code to `node -e`.
  So **every bundle carries** nothing that needs one: no Python file, and no skill that
  shells out to an interpreter — on any host, any theme, either footprint. Three tests
  freeze that, down to a byte-for-byte replay of the report script over seeded
  transcripts for all four hosts.
- **The self-update commands are for a git checkout.** `upgrade`, `update`, `sync-self`
  and `bootstrap` `git pull` the install's own origin. From an npm install they stop
  before touching anything and name `npm install -g geneseed@latest` instead.

One more, in the web console rather than the CLI: the **"browse…" folder picker** would
open an OS-native dialog on the machine running the daemon, and the server declines to.
The button reports itself unavailable and the path field beside it stays editable.

## 🛣️ Choose your path

**Easiest:** `npx geneseed setup` — no clone, nothing installed permanently.
It runs the same guided wizard as a checkout does: it asks for a theme and an install
mode, runs the right build, and offers a health check. To keep the command around, put
it on PATH with `npm install -g geneseed`.

**From a clone:** `./geneseed setup` on macOS/Linux, `.\geneseed.cmd setup` on Windows.
It is the same dependency-free wizard the npx route runs — plain text prompts, every
console, every OS.

**Already installed from a clone, and moving to npm?** `geneseed migrate` re-emits every
install you already have onto the npm shape in a single all-or-nothing pass, keeping each
one's own theme, emit, footprint, posture and mode. `--dry-run` prints the plan and
writes nothing. It **reports rather than rewrites** anything it did not create — your own
hooks, third-party hooks, and the login autostart entry you hand-wrote. Your old clone
keeps working for a full release; there is no cliff.
See [Migrate an existing install](docs/web/migrate.md).

As you move through the theme picker the wizard **previews each theme live** — its
tagline, loaded-sigil, and voice — so you hear the flavour before you choose; once
you pick, it speaks in that theme's accent through confirm and build, and the
install ends on the theme's own **banner and benediction**.

**Already installed?** Bare **`./geneseed`** (Windows: `.\geneseed.cmd`) opens the
**web console**, which is where browsing, local edits, rebuilds, memory, status, MCP
servers and uninstall all live — see [The web console](docs/web-ui.md). `GENESEED_NO_WEB=1`
suppresses that and prints the command list instead. Uninstall from the CLI is
`geneseed uninstall --target <repo>` (bare `--target` runs against whichever project
install the cwd sits in). **`./geneseed bootstrap`** jumps straight to
update-then-setup; **`./geneseed setup`** straight to the wizard. Prefer to do it by
hand? Pick a path below.

| Path | Use when |
| --- | --- |
| [A — OpenCode, global](#path-a--opencode-global-recommended) | **Recommended.** One install, every repo inherits it, nothing committed into projects. |
| [B — OpenCode, per-repo](#path-b--opencode-per-repo) | You want a committed `.opencode/` layer in one repository. |
| [C — Claude Code](#path-c--claude-code) | You drive Claude Code and want the lifecycle hooks. |
| [C′ — GitHub Copilot](#path-c--github-copilot) | You drive the Copilot CLI, coding agent, or VS Code agent mode. |
| [D — Any `AGENT.md` tool](#path-d--any-agentmd-tool) | Cursor, Aider, or any tool that reads a root instructions file. |
| [E — No runtime on the target at all](#path-e--no-runtime-on-the-target-at-all) | The machine that *uses* the harness cannot run Node. |

> **Every `geneseed-build …` below is the generator.** `npm install -g geneseed` puts it
> on your `PATH`; without installing anything, `npx -p geneseed geneseed-build --emit
> opencode-global` is the same command. From a checkout it is
> `node bin/build-driver.mjs` with the same flags. Every commit re-emits with it across every
> theme × host × footprint combination and checks the result with `doctor --all`, on Linux
> and Windows both. Until 2026-08-17 that output was also compared byte for byte against
> recordings taken from the Python implementation; those were retired, and `docs/limits.md`
> says why and what it cost.

---

### Path A — OpenCode, global (recommended)

Installs the whole harness into OpenCode's config dir; every repo you open inherits it.

```
# from inside the Geneseed folder
geneseed-build --emit opencode-global            # add --theme imperial for the 40k voice
# GENESEED_HARNESS is optional — the learn plugin auto-locates the in-config memory
# store. Set it only to pin the location explicitly (and persist it to your rc):
export GENESEED_HARNESS="$HOME/.config/opencode"
echo 'export GENESEED_HARNESS="$HOME/.config/opencode"' >> ~/.zshrc
```

**Windows (PowerShell)** — identical, no bash/WSL needed:
```powershell
# from inside the Geneseed folder
geneseed-build --emit opencode-global            # add --theme imperial for the 40k voice
setx GENESEED_HARNESS "$env:USERPROFILE\.config\opencode"   # optional; pins the memory store
```
On Windows the config dir is the same homedir-relative path,
`C:\Users\<user>\.config\opencode` — OpenCode uses `~/.config/opencode` on every OS.

This writes into `$OPENCODE_CONFIG_DIR` (else `$XDG_CONFIG_HOME/opencode`, else
`~/.config/opencode`): `AGENT.md`, `agents/`, `skills/<name>/SKILL.md`, a single
`plugins/` copy, the `memory/` store, and a merged `opencode.json` pointing
`instructions` at the absolute `AGENT.md`. No `context.json` — the context plugin
auto-discovers each repo's docs.

It is **non-destructive**: a `.geneseed-manifest.json` tracks only the files it owns
and prunes stale ones on re-emit; your own agents/skills/plugins and the memory store
are never touched. Full design + checklist:
[GLOBAL-HARNESS-SPEC.md](adapters/opencode/GLOBAL-HARNESS-SPEC.md).

### Path B — OpenCode, per-repo

```
geneseed-build --emit opencode --target /path/to/your-repo
```

Writes the full bundle (`AGENT.md`, `agents/`, `skills/`, `memory/`, `notebook/`)
plus the OpenCode-native layer (`opencode.json` and `.opencode/{agents,skills,plugins,workflows}`)
into the target dir. Commit them or not. **Want the bundle in a subfolder?** add `--root`
so instruction paths resolve from the project root:

```
geneseed-build --emit opencode --out /path/to/repo/Harness --root /path/to/repo
```

Depth, native mapping, and the manual fallback: [adapters/opencode/](adapters/opencode/README.md).

### Path C — Claude Code

Merge [`adapters/claude-code/settings.json`](adapters/claude-code/settings.json) into
your repo's `.claude/settings.json` (paths assume the bundle is at the repo root).
It wires:

- **PreToolUse** (matcher `Bash`) — runs `harness git-gate`, a tool-boundary backstop
  for Doctrine `process 5`. The hook inspects the command and forces an `ask` on every
  `git commit` or `git push` (even chained or `-C`-flagged), un-suppressible by a
  one-time "don't ask again". Every other Bash command is deferred to the normal
  permission flow. It is wired only when **Doctrine process 5 itself** is active — build
  with `--doctrines` leaving `process` out, or with `--exclude-rules "process 5"`, and this
  hook is not installed at all. The prompt and the boundary move together by construction:
  the gate is keyed on the rule, not on its pack.
- **SessionStart** (`startup`/`clear`) — prints `AGENT.md` and injects the project
  context (`harness context`, which auto-discovers the repo's docs);
- **SessionStart** (`resume`/`compact`) — refreshes the project context only, without
  re-printing the static `AGENT.md`. `compact` matters: auto-compaction summarises away the
  injected context, memory index and notebook TOC, and this re-seeds them;
- Every gate **ask** appends one line to `notebook/gates.jsonl` in the install (rule and
  timestamp, never the command); `geneseed status` counts them by rule and says when an
  `excludes.json` entry has the gates standing down for the current directory. A defer
  writes nothing.
- **Stop** — runs `harness learn` to capture durable memory. Opt in by setting
  `GENESEED_LLM` (e.g. `claude -p`); unset, it's a harmless no-op. Geneseed never
  embeds an API key.
- **PreCompact** — runs `harness learn` once more, right before auto-compaction
  summarises the transcript tail that `learn` distils from. Memory is captured before
  the summary; the SessionStart `compact` matcher re-seeds context after it.

All the hooks are emitted as one stable path — the **hook shim** at
`~/.geneseed/bin/geneseed-hook` (`geneseed-hook.cmd` on Windows) — instead of writing
this machine's runtime and this checkout into your `settings.json`. The shim
carries those two volatile paths itself, so moving or replacing the clone no longer
breaks the hooks in every install at once: one `geneseed build` rewrites the shim and
every install is live again. It is refreshed on every emit, and `geneseed doctor`
reports it if it was ever stale. `GENESEED_HOME` relocates it.

Detail: [adapters/claude-code/](adapters/claude-code/README.md).

### Sovereign repos — excluding folders from the global harness

Some repos are complete agent harnesses of their own (an Obsidian vault with its
own laws, hooks and memory conventions). Inside such a repo the global Geneseed
layer would stack on top of the local one — conflicting doctrine and wasted
tokens. Exclude the folder instead:

    harness exclude add  ~/Documents/git/Terra
    harness exclude list
    harness exclude remove ~/Documents/git/Terra

Inside an excluded folder the global install is fully dormant: the context,
learn and git-gate hooks exit silently (they check `<config dir>/excludes.json`
on every call — edits take effect immediately, no re-emit), and the global
preamble is suppressed natively (Claude: `claudeMdExcludes` written to the
repo's own `.claude/settings.local.json`; Bob: the workspace rules shadow stub;
OpenCode: the plugins stand down). Everything is reversed by `exclude remove`.

Limitations: GitHub Copilot has no per-repo suppression mechanism, so the global
`copilot-instructions.md` still loads there; and globally installed skills/
subagents remain listed by the host (no native per-repo disable exists). A
global install emitted later starts with an empty list — re-run
`harness exclude add` (`exclude list` flags installs that diverge).

### Path C′ — GitHub Copilot

```
geneseed-build --emit copilot-global           # personal: render into ~/.copilot
geneseed-build --emit copilot --out . --root .  # per-repo: AGENTS.md + .github/, committed
```

Copilot is Claude-shaped where it counts: skills are the same `SKILL.md` folders
(Copilot's Agent Skills — `.github/skills/` in a repo, `~/.copilot/skills/`
personally), agents render in Copilot's own custom-agent dialect
(`agents/<name>.agent.md`, a `tools:` allowlist instead of Claude's denylist), and
the preamble rides a file Copilot auto-loads: the repo-root `AGENTS.md` (CLI, coding
agent, and VS Code agent mode) or the personal `~/.copilot/copilot-instructions.md`
(CLI). Two differences from the Claude paths:

- **Hooks at global scope only, block-or-warn.** The global emit wires two hooks
  into `~/.copilot/settings.json`: `sessionStart` (eager project-context injection,
  as on Claude Code) and `toolCall` (both gates behind one command, because Copilot
  takes one command per event). Copilot's `toolCall` has no "ask the user" tier, so
  Laws I and IV **block** and the two consent rules (process 1, process 5) **warn**
  on stderr instead of prompting. No `learn` hook — Copilot's `sessionEnd`/`agentStop`
  payloads carry no transcript — so the memory convention rides the preamble's
  instructions. The per-repo emit wires nothing: Copilot reads hooks from the
  personal settings file only, and a machine-absolute command in a shared
  `.github/` would fail on every teammate's machine.
- **The per-repo layer lives in the shared `.github/`** (Copilot's repo config
  surface). Safe by construction: the ownership manifest + claim-on-create never
  touch files Geneseed didn't write — your workflows and same-named agents/skills
  survive every emit and uninstall.

MCP servers go in `~/.copilot/mcp-config.json` (the Settings/MCP screens know the
shape). `$COPILOT_CONFIG_DIR` relocates the personal dir, mirroring
`$BOB_CONFIG_DIR`. Note both carriers stack if you install globally *and* per-repo —
the global emit warns when that's about to happen.

### Path D — Any `AGENT.md` tool

```
geneseed-build                        # renders the plain bundle to ./Harness
```

Point your tool's instructions/rules setting at `Harness/AGENT.md`. If the tool only
auto-loads a specific name, rename or symlink (`AGENT.md` → `AGENTS.md` / `CLAUDE.md`).
The rules work on agent self-discipline alone; the plugins (context, memory) are an
OpenCode convenience.

### Path E — No runtime on the target at all

A maintainer runs it once, on a machine that can run Node:

```
npx geneseed prompt --theme neutral > install-geneseed.md
```

That emits a self-contained prompt that recreates the entire file tree verbatim.
Paste it into any capable agent on the target machine — nothing to install, no build step.
Any theme works the same way — substitute its name after `--theme`. The prompt is
always rendered fresh from `src/`, so it can never drift from the current harness.

---

## 🎛 Configure

### Theme

Choose any of the 14 themes in `themes/` — `neutral` (plain), `imperial` (Warhammer 40k),
`military`, `pirate`, `wizard`, `cyberpunk`, `gamer`, `sports` (play-by-play),
`biker`, `commentator`, `joker`, `marvin`, `mean`, or `verstappen` — with
`--theme NAME` (the wizard lists them all with live previews). It is remembered in a
`.geneseed-theme` marker, so later upgrades keep it. Adding your own is one JSON file
of voice tokens; `doctor` checks every theme defines the same keys.

Adding a new voice token to `themes/_TEMPLATE.json` means all 14 theme files need it
too, or the parity check fails. `geneseed-build --sync-themes` does the mechanical
part: it copies any key the template has but a theme is missing into that theme
(filled with the template's placeholder text), in template order, and prints exactly
which keys were added so you can restyle them in that theme's voice. It never deletes
a key a theme has that the template doesn't — those are only reported. The edit is
surgical (only the inserted lines change; nothing is reformatted), and the exit code
doubles as a CI drift check: `1` when it had to change files, `0` when every theme was
already in sync, and `2` when `_TEMPLATE.json` itself is missing or unreadable — the one
case where a `0` would have meant "in sync" without having checked anything.

### Doctrine packs

The constitution is three tiers, and only one of them is a choice. The **Ontology** (how the
agent thinks — Telos, Evidence, Decisions, Conduct) and the nine **Rules** (what it never
trades away) are always on and cannot be switched off. The **Doctrines** are practices rather
than principles, and they ship as four packs:

| Pack | What it governs |
| --- | --- |
| **craft** | how code is written — reuse first, house conventions, docs in the same change, the smallest diff |
| **rigor** | how work is proven — idempotence, honest tests, cover-and-verify, gates that can actually fail |
| **ops** | how the machine is driven — tool discovery, commands that return, complete teardowns, restart is not reload |
| **process** | how a session runs — planning, context economy, docs first, bounded loops, and the consent gate on every commit and push |

They are picked **at build time**, once, on the generator — there is no runtime toggle — and
the default is all four:

    geneseed-build --doctrines craft,rigor   # two packs
    geneseed-build --doctrines none          # ontology and the nine Rules only
    geneseed-build                           # all four (the default)

`harness.config.json`'s `doctrines` array sets this checkout's own default, and `doctor`
refuses one that names a pack the checkout does not ship. Order is fixed by the harness
(craft → rigor → ops → process) regardless of the order you type.

### One rule at a time

A pack is coarse: `--doctrines` can only keep all of **process** or none of it.
`--exclude-rules` is the finer axis, and it takes rule addresses:

    geneseed-build --exclude-rules "process 7"            # keep the pack, drop one rule
    geneseed-build --exclude-rules "process 5,craft 2"    # several
    geneseed-build --exclude-rules none                   # exclude nothing (the default)

Both spellings of an address work — `process 7` as the constitution writes it, or `process.7`
as the console addresses it. The two axes compose: a pack whose every rule is excluded drops
out of `Active packs:` entirely, so you never get a pack header with nothing under it.

An install records what it excluded in a second marker line, `Excluded rules: process 7`,
written **only when something is excluded** — so a build with the default keeps every byte it
had before this axis existed. `upgrade`, `rebuild-all` and the web console all read that line
back and preserve it, exactly as they preserve the pack list.

⚠ **`process 5` is special**: excluding it also unwires the commit/push consent hook, because
the tool boundary is keyed on that rule. That is by design — the prompt and the boundary must
never disagree — and both the console and the wizard say so before applying it.

The web console has the switches: **Constitution → Doctrines**, one per rule, staged locally
with a single **Apply** that rebuilds the install once.

The setup wizard asks too — one *all* / *choose* gate, then a yes/no per pack with its
one-line description — and it **pre-selects what the install already carries**, read off the
`Active packs:` marker line in the deployed `AGENT.md`. So re-running the wizard and holding
Enter cannot silently widen a set you deliberately narrowed.

**The whole catalogue always ships.** Every pack file lands under `doctrines/` beside
`AGENT.md` at both footprints whether or not it was built in, so a rule that cites a pack you
left out is still readable on disk — only the rendered `AGENT.md` is narrower. `doctor` reports
such citations as a `[note]`, printed and not counted, because a narrowed build is a
configuration you chose rather than a defect.

⚠ **Turning `process` off also removes the commit/push consent gate.** Doctrine `process 5`
(*Consent Before Push*) is enforced twice: as prose in `AGENT.md`, and at the tool boundary —
the `git-gate` PreToolUse hook on Claude Code and Bob, and the `git commit*` / `git push*`
permission entries on OpenCode. A build without the `process` pack wires neither, and
rebuilding an install that had them takes the Claude hook back out of `settings.json`. That is
deliberate and it is the rule the tiering rests on: **prompt and boundary must never
disagree.** A gate that stops every command to ask consent for a rule the install did not adopt
is a gate the agent cannot explain and you did not ask for. Two details worth knowing:

- **What stays in every build regardless:** `rm -rf *`, `git push --force*` and `git push -f*`.
  Those are Rule IV's territory — an always-on invariant — not the process pack's.
- **On OpenCode, an existing `opencode.json` is not stripped.** That file is co-owned, nothing
  on disk records who wrote a given permission entry, and Geneseed will not delete a line you
  might have typed yourself. A pack-off rebuild leaves an already-written `git commit*` in
  place and *reports* it instead. A fresh install has no git gate at all.

`process` is the only pack whose removal changes what the machine does rather than only what
the agent reads — which is why the wizard's blurb for it says so.

### Footprint (lean vs full)

**Footprint** sets how much of the constitution `AGENT.md` carries *inline* on every turn — a
token-cost dial, not a change to which Rules apply. Both states keep all Rules in force:

- **lean** (default) — Sections 1–2 carry the heading and rule line of each Rule and each
  active doctrine rule, then a pointer to the full text. Lighter every turn; the complete
  `laws/universal.md`, `ontology/` and `doctrines/` still ship beside `AGENT.md` and the agent
  reads them on demand (and is told to before acting on secrets, deletion, git history, scope,
  or untrusted content).
- **full** — Sections 1–2 inline every Rule's and every active doctrine rule's complete text
  *and* rationale. Maximum guidance density; the largest always-loaded block in the harness.

**The Ontology is never truncated.** Lean keeps only the first sentence of each `### ` block,
and the four ontology sections are flowing prose rather than numbered rules — cutting them
would leave four orphan sentences, so they ship whole at both footprints. That is why adding
the ontology tier grew the lean carrier proportionally more than the full one; it was taken as
a deliberate cost.

**Why:** context is scarce and metered. Lean reclaims that budget — and the tokens you
pay for it — for the task, moving the *rationale* one read away while keeping the rules
themselves present. **Pros & cons:** full = always-present reasoning (better for smaller
models, zero indirection) at the highest token cost; lean = cheaper, leaner context every
turn at the cost of one extra fetch when a rule's nuance matters. Prefer **lean** for long
sessions, large repos, or cost-sensitive runs; keep **full** when cost is a non-issue or
you run a smaller model.

**Same harness, either way.** Footprint changes neither what the harness *is* nor what it
can *do*: lean and full emit identical files (same agents, skills, plugins, commands, memory,
notebook, hooks) and every Rule is present and binding. The only structural difference is
that a lean install on a global / Claude / Bob / Copilot target also ships the standalone
`laws/universal.md` and `ontology/` (project bundles already carry them, and `doctrines/`
ships at both footprints on every target); the only behavioural difference is that the
reasoning loads on demand instead of every turn. Lean is the default; full, with the rationale
always in front of the model, applies a rule's nuance more reliably on subtle edge cases or
with a weaker model, and is one flag away.

Set it with `--footprint lean|full` (alongside any `--emit`), the **Footprint** toggle in
the web Settings, the per-harness dropdown in the Harnesses tab, or the setup wizard. It is
remembered in a `.geneseed-footprint` marker and preserved across every rebuild, on every
host (OpenCode, Claude Code, Bob, Copilot).

### Dry-run a build (`validate`)

```
geneseed validate --theme imperial --emit opencode --out /path/to/repo/Harness
```

(It is a verb on the CLI rather than a flag on the generator because it runs `doctor`, and
the generator is deliberately unable to start a process. `geneseed-build --validate-only
…` is the same tool with the same flags.)

Renders and emits the requested `--theme`/`--emit`/`--out`/`--root`/`--footprint`
combination into a throwaway sandbox — nothing under the real `--out`/`--root` is
written, no marker files, no settings merge, no install-registry record — then runs
every doctor-grade check against it (unresolved tokens, dead/non-hermetic links, theme
parity, authoring gates, AGENT.md table parity). Prints a per-layer file count of what
would have been written (`-v`/`--verbose` for the full path list) and exits non-zero on
any problem, `0` when clean. Useful in CI, or before pointing a real deploy at a repo you
don't want to touch yet.

### Project context (usually nothing)

On OpenCode the context plugin auto-discovers a repo's docs every session:

- **Eager** (injected in full, budget-capped): root `AGENTS.md`/`AGENT.md`/`CLAUDE.md`/
  `.cursorrules`, `README.md`, `CONTRIBUTING.md`.
- **Lazy** (listed, read on demand): `docs/`, `doc/`, `documentation/`, `architecture/`,
  `adr/`, `ADR/`, monorepo `packages/*/README.md` and `apps/*/README.md`, other root
  `*.md`. `node_modules`, `.git`, `dist`, `build`, `vendor`, `.next`, `target`,
  `.venv`, `__pycache__`, `.opencode`, and `.harness` are never scanned.

Override only when the convention doesn't fit — drop a `.harness/context.json` (or
`./context.json`, or point `$GENESEED_CONTEXT`):

```json
{
  "extend": true,
  "context": [
    { "path": "docs/house-rules.md", "load": "eager", "description": "Branch policy, DoD." },
    { "path": "docs/**/*.md", "load": "lazy" },
    { "path": "internal/secrets.md", "load": "exclude" }
  ]
}
```

`path` is absolute, repo-relative, or a glob; `load` is `eager` | `lazy` | `exclude`;
`"extend": true` layers the manifest on top of discovery. Schema:
[GLOBAL-HARNESS-SPEC.md §3](adapters/opencode/GLOBAL-HARNESS-SPEC.md).

#### 📌 Worked example — a monorepo's `context.json`

The harness stays lean because project knowledge does not go into it — it goes
into this per-repo manifest, which the context plugin auto-loads at session
start. A monorepo with docs scattered across packages might write:

```json
{
  "extend": true,
  "context": [
    { "path": "docs/architecture.md", "load": "eager", "description": "system map" },
    { "path": "api/README.md", "load": "eager" },
    { "path": "web/README.md", "load": "eager" }
  ]
}
```

`"extend": true` keeps auto-discovery running (so `README.md`, `AGENT.md`, and
the rest of the convention still apply) and layers these three eager entries on
top. Keep the eager list to the few files a new teammate would read first —
each `eager` entry is injected in full into every session in this repo, so it
has a permanent token cost; prefer three sharp docs over ten broad ones, and
reach for `"load": "lazy"` for anything a session should only read on demand.

**Self-orientation extras.** The same injected block also carries two best-effort
lines so the agent starts oriented: the repo's **runnable commands** (targets from
`Makefile`, `package.json` scripts — with the right runner per lockfile — `justfile`,
and `Taskfile`), and the session's **current model** (read from the transcript, or
`GENESEED_MODEL=provider/model` as a fallback). Both degrade silently when absent —
no commands file, no known model → the line is simply omitted.

**Delivery — invisible by default.** The plugin delivers the context by prepending
it to each outgoing request via OpenCode's `experimental.chat.messages.transform`
hook: nothing shows in the conversation, and the context survives compaction
inherently because it is re-sent per request. The hook is experimental — on an
OpenCode build that lacks it, the plugin notices the first time a request completes
without it and **falls back automatically** to the classic visible delivery (the
`PROJECT CONTEXT` block posted as a session message), so no build is ever left
without context; `GENESEED_DEBUG=1` logs the fallback when it engages. Prefer to
*see* what the agent received? Set `GENESEED_CONTEXT_VISIBLE=1` (persist with
`export` in your rc, or `setx` on Windows) to force the visible block up front —
legacy `GENESEED_CONTEXT_TRANSFORM=0`/`off` does the same, while `=1`, the old
opt-in, now simply matches the default. To drop injection entirely, set
`GENESEED_CONTEXT_INJECT=off` and rely on the AGENT.md law.

### Wiki — your own knowledge base (optional)

If you keep a personal knowledge base on this machine — an Obsidian vault, or any
folder of interlinked markdown — declare it once in **`wiki.jsonc`** and the agent
becomes a citizen of it: entry notes load each session (eager) or on demand (lazy),
and it reads *and writes* notes under your vault's own conventions (AGENT.md §8,
the `wiki` skill). Unlike `context.json` this is **per machine, not per repo**.

The build seeds `wiki.jsonc` beside `AGENT.md` (for a global install:
`~/.config/opencode/wiki.jsonc`) and never overwrites it. The file is **JSONC** —
comments and trailing commas are fine — and the seeded stub carries this very
example commented out, ready to copy and edit in place. Resolution:
`$GENESEED_WIKI` → `$GENESEED_HARNESS/wiki.jsonc` → beside the installed `AGENT.md`
(a `wiki.json` from an earlier install is still honoured at each location).
Fill it in:

```json
{
  "wikis": [{
    "name": "Brain",
    "path": "/home/me/Documents/Brain",
    "description": "my machine-wide knowledge base",
    "entries": [
      { "path": "ARCHITECTURE.md", "load": "eager", "description": "the root map" },
      { "path": ".", "load": "lazy" }
    ],
    "conventions": "STYLE.md",
    "inbox": "Inbox/",
    "protected": ["Journal/"]
  }]
}
```

`path` is the vault root (absolute; on Windows use forward slashes —
`C:/Users/me/Brain`); entry paths are relative to it, with the same `eager`/`lazy`
semantics as `context.json`. An entry may name a single note **or a folder**: a
folder applies its mode to every note beneath it (`"."` = the whole vault,
dot-folders like `.obsidian` skipped), a file entry overrides its folder's mode
whatever the order, and `"load": "exclude"` prunes a note or folder from the
listing. The example above is the canonical shape — root index eager, everything
else on demand. A big vault's lazy listing truncates at 200 lines with a visible
count (`GENESEED_WIKI_LAZY_LIMIT` adjusts it). `conventions` names the note the agent must read before
its first write; `inbox` is where it drops notes it cannot confidently file;
`protected` folders are write-blocked by the guard plugin at the tool boundary
(`GENESEED_GUARD` modes apply). Several wikis may be declared; an empty `wikis`
list keeps the feature off. The file may hold private paths — it is host-specific,
covered by the bundle `.gitignore`, and never committed.

On tools without the plugins (plain `AGENT.md`, Claude Code), the same contract
holds through prose: AGENT.md §8 instructs the agent to read `wiki.jsonc` at session
start and honour it.

### Memory

Durable facts live as one-file-per-fact under the memory store, indexed by `MEMORY.md`
(git-ignored — personal to the machine). The learn plugin writes to the first that
resolves: `$GENESEED_MEMORY` → `$GENESEED_HARNESS/memory` → `./memory` or
`./Harness/memory`. For a global install, set `GENESEED_HARNESS` once (Path A).
Convention: [src/memory/README.md](src/memory/README.md).

### Reading non-markdown docs

The `ingest` skill teaches the agent to convert a PDF/Word/PPTX/Excel/HTML file or a
URL to markdown before reading it — discovery and the read-the-docs law only see
markdown. Install one converter and the skill uses it:

- **MarkItDown** (Microsoft) — broadest (`pip install markitdown`), or its MCP server
  (see [MarkItDown via MCP](#markitdown-via-mcp) below — preferred on an
  MCP-capable host: zero per-call install, one low-cost tool);
- **Pandoc** — excellent for Office/HTML (single binary);
- **Docling** (IBM) — best for complex tables / scanned PDFs.

The skill never installs a converter silently — if none is present it reports which to add.

### MCP servers

Beyond document conversion, Geneseed ships ready-to-wire MCP server presets —
**MarkItDown** (below), **GitLab** (two slots, `gitlab` and `gitlab-2`, so you can
point at two instances), and **Filesystem** — four preset entries in total. Each
is a *local* server the agent launches on demand: registering one only points the agent
at a command — *you* install the tool (or let `npx`/`pipx` fetch it) and supply any
credentials. On OpenCode they live under the `mcp` key of an `opencode.json`, each entry
shaped:

```json
"<name>": { "type": "local", "command": ["…"], "environment": {}, "enabled": true }
```

> **Never commit a real token.** The presets and the reference
> [`adapters/opencode/opencode.json`](adapters/opencode/opencode.json) carry **empty**
> `GITLAB_PERSONAL_ACCESS_TOKEN` placeholders (and a sample filesystem path) — fill them
> in your own config, never in a tracked file (universal Law I — secrets).

**Don't want to hand-edit JSON?** `./geneseed` → **Settings** → **MCP servers** toggles
any preset into your project or global `opencode.json` — and enables, disables, or
removes them — for you. The reference config ships MarkItDown enabled and the GitLab /
Filesystem entries disabled, so a merge never activates a credential-less server: fill
the blanks, then flip the one(s) you want on.

#### MarkItDown via MCP

Wire Microsoft's MarkItDown in as a **local MCP server** so the agent can convert
PDF / Word / Excel / PowerPoint / HTML → Markdown on demand, exposing a single tool
`convert_to_markdown(uri)` (`uri` accepts `file:`, `http:`, `https:`, or `data:`).
The server runs locally and, once cached, does not hit PyPI again.

> **A config entry alone does nothing.** A `local` MCP server is just a command your
> agent launches — if that command isn't on PATH in the shell the agent starts from, the
> server still *appears* in the list but never connects ("shown but not working"). The
> `uvx` form below is the zero-install way to guarantee it resolves.

**1. Make the command resolve.** Pick one:

- **`uvx` (recommended, zero-install).** If you have [uv](https://docs.astral.sh/uv/)
  (`uvx` on PATH), nothing to install — `uvx markitdown-mcp` fetches and caches the
  server on first call. This is the command the reference config and the harness toggle
  now use.
- **`pipx` (pinned install).** No uv? `pipx install markitdown-mcp` puts a
  `markitdown-mcp` binary on PATH; then use `"command": ["markitdown-mcp"]` instead.
  Verify with `markitdown-mcp --help`.

```
# uv route (recommended) — confirm it resolves:
uvx markitdown-mcp --help
# pipx route — only if you don't have uv:
brew install pipx && pipx ensurepath        # macOS;  Debian/Ubuntu: sudo apt install pipx && pipx ensurepath
pipx install markitdown-mcp && markitdown-mcp --help
```

Optional OCR / image / audio extras (needed for scanned/image-only PDFs, which
otherwise return empty): `uvx --with "markitdown[all]" markitdown-mcp` for the uv route,
or `pipx inject markitdown-mcp "markitdown[all]"` for the pipx route (same venv).

**2. Corporate TLS (only on a network with SSL inspection).** uv ships its own root CAs
and ignores the OS trust store, so a proxy's internal CA fails with `invalid peer
certificate: UnknownIssuer`. Point uv at the OS trust store — don't disable verification:

```
echo 'export UV_SYSTEM_CERTS=true' >> ~/.zshrc && source ~/.zshrc   # older uv: UV_NATIVE_TLS=true
# fallback: export SSL_CERT_FILE=/path/to/corporate-root-ca.pem
```

**3. Register it in your host's MCP config** — add the server entry to the file your
agent reads, alongside any servers you already have:

<!--harness:opencode-->
On OpenCode that's `opencode.json` (global `~/.config/opencode/opencode.json`, the
`.jsonc` variant if you keep one — the file OpenCode reads — or per-repo), under the
`mcp` key. Geneseed's
[`adapters/opencode/opencode.json`](adapters/opencode/opencode.json) already carries
this block:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "markitdown": { "type": "local", "command": ["uvx", "markitdown-mcp"], "enabled": true }
  }
}
```

On the pipx route, swap the command to `["markitdown-mcp"]`. Prefer not to hand-edit
JSON? `./geneseed` → **Settings** → **MCP servers** toggles this exact block in for you.
<!--/harness-->
<!--harness:claude-->
On Claude Code that's `.mcp.json` under `mcpServers`:

```json
{ "mcpServers": { "markitdown": { "command": "uvx", "args": ["markitdown-mcp"] } } }
```

See the **Claude Code** section for the GitLab / Filesystem shapes.
<!--/harness-->

**4. Verify.** Restart your agent; its MCP list should show `markitdown` **connected**
(not just listed). The `ingest` skill auto-prefers an MCP
converter when one is exposed,
so a prompt like *"convert file:///path/to/spec.pdf to markdown"* now just works. Still
not connecting? See [MCP server won't connect](#mcp-server-wont-connect) below.

#### GitLab (one entry per instance)

Wire GitLab in via [`@zereight/mcp-gitlab`](https://github.com/zereight/gitlab-mcp) —
repo, merge-request, issue, and CI tools over the GitLab API, run through `npx` (nothing
installed globally; the first run fetches it). It is self-hosted ready, so the same
command serves gitlab.com and any private instance.

**1. Mint a Personal Access Token** on *each* instance — User Settings → Access Tokens,
scopes `api` and `read_repository`. Treat it like a password.

**2. Register one entry per instance** — same command, different `GITLAB_API_URL`
and token. Two instances (e.g. gitlab.com plus a self-hosted server) → two entries.
The MCP screen ships a one-click row for the **first** entry only; a second instance is a
hand-added copy of that block, which is all it ever was:

<!--harness:opencode-->
On OpenCode, under the `mcp` key of `opencode.json`:

```json
{
  "mcp": {
    "gitlab": {
      "type": "local",
      "command": ["npx", "-y", "@zereight/mcp-gitlab"],
      "environment": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      },
      "enabled": true
    },
    "gitlab-2": {
      "type": "local",
      "command": ["npx", "-y", "@zereight/mcp-gitlab"],
      "environment": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.example.com/api/v4"
      },
      "enabled": true
    }
  }
}
```
<!--/harness-->
<!--harness:claude-->
On Claude Code, under `mcpServers` in `.mcp.json` — same command, but `env` (not
`environment`) and `command` + `args` split. See the **Claude Code** section for the
exact block; add one `mcpServers` entry per instance.
<!--/harness-->

The entry key is just a label — name them `gitlab` / `gitlab-2`, or after each instance
(`gitlab`, `gitlab-acme`). What separates the two is the `GITLAB_API_URL` + token pair;
keep the `/api/v4` suffix on the URL.

**Don't know where this file lives?** Run `geneseed web`, open **Harnesses**, and expand an
active install — each MCP target prints the full path of the config file it writes, right
above its server rows. That is the file the token and the URL go into. From the terminal,
`geneseed mcp` prints the same paths without starting anything.

#### Filesystem

Give the agent scoped file access via
[`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem),
also through `npx`. The **allowed directories are command-line arguments** — the server
can touch *only* the paths you list, so grant the narrowest set that works:

<!--harness:opencode-->
On OpenCode, under the `mcp` key of `opencode.json`:

```json
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": [
        "npx", "-y", "@modelcontextprotocol/server-filesystem",
        "/path/to/project", "/path/to/another/allowed/dir"
      ],
      "enabled": true
    }
  }
}
```
<!--/harness-->
<!--harness:claude-->
On Claude Code, under `mcpServers` in `.mcp.json` (`command` + `args` split):

```json
{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"] } } }
```
<!--/harness-->

> **Replace the placeholder.** The reference config and the harness toggle ship the
> literal arg `/path/to/allowed/dir`. Enabling the server without swapping that for a
> real path leaves it running but able to touch nothing — the classic "filesystem MCP
> sees nothing." Edit the path(s) before (or right after) you flip it on.

> **Least privilege.** Prefer the narrowest set of dirs the task needs over `$HOME` or
> `/` — the server refuses any path outside them, and a broad grant lets the agent reach
> everything under it.

#### Claude Code

Claude Code reads the same servers from a `.mcp.json` `mcpServers` map — note the key is
`env` (not `environment`) and the command and its args are split into `command` +
`args`:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/mcp-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-…",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
    },
    "markitdown": { "command": "uvx", "args": ["markitdown-mcp"] }
  }
}
```

Register it with `claude mcp add` or by editing `.mcp.json` directly; the same
token-safety rule applies.

#### Verify

Restart your agent.
<!--harness:opencode-->
On OpenCode, `opencode mcp` lists each server and whether it **connected**.
<!--/harness-->
<!--harness:claude-->
On Claude Code, `/mcp` lists each server and whether it connected.
<!--/harness-->
Listed ≠ working — a `local` server
appears in the list whether or not its command actually launches.

#### MCP server won't connect

A `local` MCP entry is just a command OpenCode/Claude Code runs. If it's listed but
not connected, walk these in order:

1. **Does the command resolve?** Run the exact command from a fresh terminal —
   `uvx markitdown-mcp --help`, `npx -y @modelcontextprotocol/server-filesystem --help`.
   "command not found" means the binary isn't on PATH in the shell your agent launches
   from. Fix: use the `uvx`/`npx` zero-install form (these only need uv / Node), or
   install the tool and point at the absolute path. This is the #1 cause of
   "shown but not working" for **markitdown** (no `markitdown-mcp` on PATH, no pipx).
2. **Filesystem sees nothing?** The allowed-dir arg is still the placeholder
   `/path/to/allowed/dir`, or points somewhere that doesn't exist. Swap in a real path.
3. **GitLab won't connect?** Almost always a missing / over-scoped token or the wrong
   `GITLAB_API_URL` — keep the `/api/v4` suffix.
<!--harness:opencode-->
4. **Right file?** OpenCode reads `opencode.jsonc` if present, else `opencode.json`, at
   the project root and `~/.config/opencode/`. Editing the wrong one is silent. Use
   `./geneseed` → **Settings** → **MCP servers** to write to the file OpenCode actually reads.
<!--/harness-->
<!--harness:claude-->
4. **Right file?** Claude Code reads `.mcp.json` (project) and the `mcpServers` block in
   `~/.claude.json` / settings. Editing the wrong one is silent — `claude mcp list`
   shows which servers actually loaded.
<!--/harness-->

### Environment knobs

| Variable | Used by | Effect |
| --- | --- | --- |
| `GENESEED_HOME` | emit / hooks | dir holding the hook shim `bin/geneseed-hook` (default: `~/.geneseed`). Change it and re-run the build, so emitted hooks point at the new location |
| `GENESEED_HARNESS` | learn plugin | base whose `memory/` the plugin writes to (optional — the plugin auto-locates the in-config store; set to pin it) |
| `GENESEED_MEMORY` | learn plugin / CLI | explicit memory dir (overrides the above) |
| `GENESEED_CONTEXT` | context plugin / CLI | explicit `context.json` path |
| `GENESEED_WIKI` | context + guard plugins | explicit `wiki.jsonc` path (default: `$GENESEED_HARNESS/wiki.jsonc`, else beside the installed `AGENT.md`) |
| `GENESEED_ROOT` | `harness context` | repo root to discover docs from (default: cwd) |
| `GENESEED_MODEL` | learn + context plugins | `provider/model` fallback if the session model can't be read (learn distils with it; context shows it in the self-awareness line) |
| `GENESEED_LLM` | `harness learn` (Claude) | model CLI for distillation, e.g. `claude -p` |
| `GENESEED_EMIT` | `geneseed upgrade` | `opencode-global` \| `opencode` \| unset (plain bundle) |
| `GENESEED_OUT` / `GENESEED_ROOT` | `geneseed upgrade` | bundle / project-root locations |
| `GENESEED_DEBUG` | context + notify + ponytail plugins | `1` re-enables discovery/inject logs (context), decision/delivery logs (notify), and level-switch logs (ponytail) |
| `GENESEED_CONTEXT_INJECT` | context plugin | `off` disables the injected block (rely on the AGENT.md law) |
| `GENESEED_EAGER_FILE_KB` / `GENESEED_EAGER_TOTAL_KB` | context plugin | per-file / total eager injection budget (default 16 / 48) |
| `GENESEED_LAZY_HEADINGS` | context plugin | cap on lazy-file heading reads per session (default 64) |
| `GENESEED_WIKI_LAZY_LIMIT` | context plugin | cap on lazy notes LISTED per wiki per session (default 200; beyond it the listing truncates with a count) |
| `GENESEED_CONTEXT_VISIBLE` | context plugin | `1` shows the classic visible `PROJECT CONTEXT` block instead of the invisible per-request delivery (see [Project context](#project-context-usually-nothing)) |
| `GENESEED_CONTEXT_TRANSFORM` | context plugin | legacy — `0`/`off` forces the visible delivery (same as `GENESEED_CONTEXT_VISIBLE=1`); `1` matches the default |
| `GENESEED_LEARN_DEBOUNCE_MS` | learn plugin | quiet period before distilling (default 60000) |
| `GENESEED_GUARD` | guard plugin | `warn` downgrades blocks to warnings; `off` disables the safety guard |
| `GENESEED_WORKFLOWS_DIR` | workflow plugin | override the directory the `workflow` tool reads saved scripts from |
| `GENESEED_NOTIFY` | notify plugin | `off` disables end-of-run desktop notifications |
| `GENESEED_NOTIFY_MIN_SECONDS` | notify plugin | minimum turn length, in seconds, before notifying (default 30; `0` = every turn) |
| `GENESEED_NOTIFY_TITLE` | notify plugin | override the notification title (default `Geneseed`) |
| `GENESEED_PONYTAIL` | ponytail plugin | default minimal-code level for new installs: `lite` \| `full` \| `ultra` \| `off` (default `off`; switch live with `/ponytail <level>`) |
| `GENESEED_PRIMARY` | `geneseed-build` | `1` also emits the primary orchestrator agent |
| `GENESEED_COMMANDS` | `geneseed-build` | `1` also emits the `/slash` command layer |
| `GENESEED_TUI_ASCII` / `GENESEED_TUI_PLAIN` | terminal output | force pure-ASCII / drop emoji + animation in what the CLI prints |
| `GENESEED_NO_ANIM` | install animation | disable the themed install animation |
| `GENESEED_LOG` | `geneseed upgrade` | override the install/upgrade log path |
| `GENESEED_NET_TIMEOUT` | `upgrade` | seconds before download attempts give up (default 20, floor 5) |
| `GENESEED_NO_WEB` | launcher / menu | `1` disables the web-first default of bare `./geneseed` — falls back to the terminal menu |
| `OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME` | global emit | where the global install is written |
| `OPENCODE_DISABLE_LSP_DOWNLOAD` | OpenCode (LSP) | `true` stops OpenCode auto-downloading built-in language servers (typescript, pyright, jdtls) — set it on air-gapped machines and pre-install each server yourself |

---

## ✅ Verify it works

1. **Sigil** — the agent's first reply opens with the readiness line (the `✅`/`🧬`
   sigil for neutral/imperial). If it's missing, the instructions aren't pointed at
   `AGENT.md`.
2. **Context (OpenCode)** — start a session; with `GENESEED_DEBUG=1` the context
   plugin logs what it discovered and injected.
3. **Memory (OpenCode)** — do a little work and end the session; after the debounce
   the learn plugin logs `wrote N memory file(s)` or a skip reason to stderr. Total
   silence means it didn't load — re-check the filename, `.js` extension, and that it
   sits in the plugins dir.
4. **Harness health** — `geneseed doctor` should print `ok` (`npx geneseed doctor` without
   installing). From a checkout, `node bin/geneseed-cli.mjs doctor` runs the same checks.
   To run the full suite the way CI does: `node --test "tests/**/*.test.mjs"`.

Browsing agents, skills and laws, and running build/doctor/diff without retyping a
command, is what the web console is for — bare `./geneseed` opens it.

## 🚀 Run `geneseed` from anywhere

**From npm this is already done.** `npm install -g geneseed` puts `geneseed`,
`geneseed-hook` and `geneseed-build` on your `PATH` through npm's own bin linking; there
is nothing to link and `geneseed link` is not needed. The rest of this section is for a
git checkout.

By default you invoke the launcher as `./geneseed` from inside the repo. To call it
like any other command — plain `geneseed` from any directory — put it on your `PATH`:

```
./geneseed link                    # a launcher shim in ~/.local/bin (no sudo); pass a dir to override
./geneseed link /usr/local/bin     # e.g. a system-wide bin dir (may prompt for sudo)
```

(Or, in the web console: **Settings** → the Maintenance card's PATH link / unlink.)

`link` writes a small `#!/bin/sh` shim that runs this checkout by absolute path, and
tells you whether the target dir is on your `PATH` (and, if not, the one line to add
it). The shim names this checkout's CLI entry point by absolute path, so it finds the
harness no matter where the shim itself lives — the same shape the Windows arm has
always used. Once it's on `PATH`, drop the `./`:

```
geneseed            # the interactive main menu, from any directory
geneseed build      # …and every subcommand
```

Remove it with `./geneseed unlink` (it clears the `geneseed` shims it wrote — and any
symlink an older version left — from `PATH` and the common bin dirs; a `geneseed` it
did not write is left alone). Prefer a shell function? Add one to your rc instead —
it does the same job:

```
echo 'geneseed() { "'"$PWD"'/geneseed" "$@"; }' >> ~/.zshrc   # or ~/.bashrc
```

**Windows** — use the native launcher `geneseed.cmd`, which routes to the same Node CLI with
no bash. PowerShell runs a `.cmd` directly, so it is the PowerShell spelling too:

```powershell
.\geneseed.cmd setup
.\geneseed.cmd link             # writes a geneseed.cmd shim into %LOCALAPPDATA%\Geneseed\bin
                                # and adds that dir to your user PATH (no admin / symlink needed)
```

Open a new terminal after `link`, then call `geneseed` from any directory. Remove it
again with `.\geneseed.cmd unlink`.

## 🔌 Start the web UI at login

The web UI is the only long-running Geneseed process. `geneseed web **start**`
spawns a **detached daemon** on `127.0.0.1:4747` and returns immediately, so a login
hook that runs `geneseed web start --no-browser` once — no browser tab — leaves the
UI ready whenever you open [http://127.0.0.1:4747](http://127.0.0.1:4747). It is
**per-user and per-machine**: each laptop runs its own daemon on its own loopback, so
Windows and macOS are set up independently and never collide. The daemon is a
singleton — a second `start` just no-ops — so re-running it (or logging in twice) is
harmless.

> **Use `web start`, not bare `web`, in every launcher below.** Without the
> `start` action the server runs in the **foreground** and writes no
> `.geneseed-web.json` record, so it becomes invisible to `web stop`, `web restart`
> and `web status` — they report "no live server" while it keeps serving, and a
> `restart` will orphan a second daemon that cannot bind the taken port. Recovering
> then means finding it by port and killing it by hand.

> **These are files YOU create, and Geneseed never writes one.** Nothing in this project
> has ever created a Startup entry or a LaunchAgent, and nothing ever edits one — including
> `geneseed migrate`, which detects a login item still naming an old checkout, prints the
> path and the line to put there, and leaves the file alone. It is your login
> configuration; deleting the file is the only uninstall it has.

**Windows** — drop a hidden VBS launcher in the Startup folder (runs at login, no
console flash, removed by deleting the file). Open the folder with **Win+R** →
`shell:startup`, then create `geneseed-web.vbs`:

```vbs
' geneseed-web.vbs — start the Geneseed web daemon at login (hidden, no browser).
CreateObject("WScript.Shell").Run "cmd /c ""%LOCALAPPDATA%\Geneseed\bin\geneseed.cmd"" web start --no-browser", 0, False
```

Expand `%LOCALAPPDATA%` to its real path (e.g. `C:\Users\you\AppData\Local`) — VBS
does not expand environment variables inside a string. **Disable** by deleting the
file. Prefer a scheduled task (runs hidden, can restart on failure)? Use:

```powershell
schtasks /Create /TN "Geneseed Web" /SC ONLOGON /TR "\"%LOCALAPPDATA%\Geneseed\bin\geneseed.cmd\" web start --no-browser" /RL LIMITED /F
schtasks /Delete /TN "Geneseed Web" /F   # to remove
```

**macOS** — the launcher is the `geneseed` shim that `./geneseed link` writes (default
`~/.local/bin/geneseed`). Use a **LaunchAgent** with `RunAtLoad` — and **no**
`KeepAlive`, because the launcher exits after spawning the detached daemon (the
daemon runs in its own session and survives). Write
`~/Library/LaunchAgents/dev.geneseed.web.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>dev.geneseed.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/you/.local/bin/geneseed</string>
    <string>web</string>
    <string>start</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key>        <true/>
</dict>
</plist>
```

Use the **absolute** path to your `geneseed` launcher (LaunchAgents don't see your
shell `PATH`). Then load it — it also runs it once now:

```bash
launchctl load ~/Library/LaunchAgents/dev.geneseed.web.plist     # enable + start now
launchctl unload ~/Library/LaunchAgents/dev.geneseed.web.plist   # disable
```

On either OS, `geneseed web stop` stops the running daemon without touching the
login hook, and `geneseed web status` reports whether it's up.

## 🤖 Headless / CI (OpenCode)

Once the harness is installed (Path A or B), OpenCode can run **non-interactively** —
no TUI — so the harness's agents, rules, and skills apply in scripts and pipelines:

```
opencode run "review the staged diff and list any correctness bugs"   # one-shot, prints to stdout
opencode run -m anthropic/claude-sonnet-4-5 "…"                       # pin a model for the run
cat issue.md | opencode run "triage this and propose a fix plan"      # pipe input in
```

`opencode run` loads the same `opencode.json` (so `instructions` → `AGENT.md`, the
permission gates, and any per-agent overrides all take effect) and the same
`.opencode/` agents/skills/plugins. Useful for CI checks, cron jobs, or scripting a
capability agent. Notes:

- **Permissions still gate.** The consent-before-commit/push / `rm -rf` `ask` rules
  will *block* in a non-interactive run (nothing to answer the prompt). Both
  `git commit` and `git push` are gated on every branch whenever the **process** pack
  is active (Doctrine `process 5`; a build without it wires neither), so a CI job that
  commits must opt those commands back to `"allow"` in its own `permission.bash` map,
  or scope the run to read-only work — don't blanket-disable the guards.
- **`--pure`** runs OpenCode ignoring local/global config — handy to reproduce a bug
  without the harness in the way, or to confirm a behaviour is the harness's doing.
- The **learn** plugin (`session.idle` → memory) and **context** plugin still load in
  headless runs; set `GENESEED_GUARD=warn`/`off` or `GENESEED_DEBUG=1` per the
  [adapter README](adapters/opencode/README.md) if a run needs different behaviour.

This is a usage note, not an emitted feature — the harness writes nothing for it.

## Upgrade

**Installed from npm:**

```
npm install -g geneseed@latest     # get the new version
geneseed rebuild-all               # re-render every active install in its own theme + mode
```

`upgrade` / `update` / `sync-self` / `bootstrap` are the *git checkout* route — they pull
the install's own origin. Run one from an npm install and it stops before touching
anything, naming the `npm install -g` line above instead.

**Installed from a clone:**

```
./geneseed upgrade                 # track the checkout's current branch; keep theme + emit mode
./geneseed upgrade imperial        # force a theme
```

It git-pulls the install's own origin (fast-forward only), validates it (a blocking
`doctor` pass, rolling back on failure), then re-renders in place — leaving host state
(memory, `context.json`, markers) untouched. Theme and emit mode are remembered between
runs. `./geneseed update` and `./geneseed sync-self` are aliases of `upgrade` (one pull
refreshes launchers and factory together), and `./geneseed bootstrap` continues into the
setup wizard. A dirty tree or a non-git checkout is reported, not force-updated.

**Reviewing local edits** — if the deployed harness was tweaked in place (you, or the
agent's own self-improvement loops) and you want to see what diverged from source:

```
./geneseed diff                        # summary — --full for line-level diffs
./geneseed diff --out improvements.md  # export a markdown improvements file
```

The `--out` file is a self-contained back-port artifact: hand it to an agent in the
Geneseed source repo and ask it to fold the changes into `src/`. You rarely need to
run it by hand — **setup, re-theme, and upgrade auto-export one** whenever the
harness they are about to overwrite carries local edits, so a rebuild never silently
destroys what the agent learned. The auto-export lands in `improvements/` **inside
the deployed harness dir** (e.g. `~/.config/opencode/improvements/`) — beside the
install it describes; it is not in the manifest, so re-emits never clobber it, diff
never reports it, and uninstall leaves it in place (the same contract as memory).
The web console's **Changes** page exports the same file.

## 🩺 Troubleshooting

| Symptom | Fix |
| --- | --- |
| No readiness sigil | Instructions not pointed at `AGENT.md` — check `opencode.json` `instructions` (or your tool's rules setting). |
| `PROJECT CONTEXT` block appears twice | Two copies of the context plugin (global + a leftover `.opencode/plugins/`). Remove the project copy. |
| Full `PROJECT CONTEXT` block visible in the terminal | Either `GENESEED_CONTEXT_VISIBLE=1` (or legacy `GENESEED_CONTEXT_TRANSFORM=0/off`) is set, or your OpenCode build lacks the experimental transform hook and the plugin fell back to visible delivery — run with `GENESEED_DEBUG=1` to see which (see [Project context](#project-context-usually-nothing)). |
| Learn plugin silent / no memory written | Set `GENESEED_HARNESS` (or `GENESEED_MEMORY`); confirm the `.js` files are in the plugins dir. |
| `could not determine a model` | Set `GENESEED_MODEL=provider/model`. |
| PDFs / Office docs ignored | Use the `ingest` skill and install a converter (MarkItDown / Pandoc / Docling). |
| A "read-only" agent won't run a command | By design — read-only agents are denied `bash`. Agents that must run read-only commands (reviewer, security) allow it via a spec marker. |
| Skills not tracked in git | A parent `.gitignore` blanket-ignores the bundle dir — remove the bare `Harness/` line; the bundle's own `.gitignore` scopes correctly. |

More OpenCode-specific notes (why a file loads twice, plugin loading): [HOW-OPENCODE-LOADS.md](adapters/opencode/HOW-OPENCODE-LOADS.md).
