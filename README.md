<div align="center">

# 🧬 Geneseed

**A portable, theme-able harness you implant once and use everywhere to grow a disciplined AI coding agent.**

[![npm](https://img.shields.io/npm/v/geneseed?color=cb3837&logo=npm)](https://www.npmjs.com/package/geneseed)
[![CI](https://github.com/Arylmera/Geneseed/actions/workflows/ci.yml/badge.svg)](https://github.com/Arylmera/Geneseed/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.3](https://img.shields.io/badge/node-%3E%3D22.3-5fa04e)](package.json)
[![zero dependencies](https://img.shields.io/badge/deps-zero-success)](package.json)
[![Themes](https://img.shields.io/badge/themes-14-9cf)](themes/)
[![Skills](https://img.shields.io/badge/skills-47-blueviolet)](src/skills/)
[![Agents](https://img.shields.io/badge/agents-17-orange)](src/agents/)
[![Laws](https://img.shields.io/badge/laws-9-critical)](src/laws/universal.md)
[![Plugins](https://img.shields.io/badge/plugins-7-teal)](adapters/opencode/plugins/)
[![OpenCode · Claude Code · Bob · Copilot · AGENT.md](https://img.shields.io/badge/works%20with-OpenCode%20·%20Claude%20Code%20·%20Bob%20·%20Copilot%20·%20AGENT.md-1f6feb)](#-supported-harnesses)

[**Why**](#-1--why-geneseed) · [**Setup**](#-2--setup) · [**Web & terminal**](#-3--web--terminal) · [**What you get**](#-4--what-you-get)

</div>

---

Geneseed distils an agent operating system into a generic harness built around a single `AGENT.md`. Point your tool at it and the agent inherits a set of operating **rules**, a roster of capability **agents**, native **skills**, a **memory** convention, and — on OpenCode — 7 **plugins** that auto-load your project's docs, capture durable memory, enforce the safety laws, run saved workflows, ping you when a long run finishes, hold a minimal-code mode when you ask for one, and stream what each session is doing to the web console. One source builds it; it follows you into every repo.

This page is the overview. Four parts: **why** it exists, how to **set it up**, the two ways to **drive it** (web console & command line), and **what you get**. For every install path, configuration knob, and troubleshooting step, read the full [Setup guide](SETUP.md).

---

## 🧬 1 · Why Geneseed

### The name

The name comes from Warhammer 40,000. In the lore, *gene-seed* is a Space Marine Chapter's genetic legacy: implanted once into an aspirant, it rebuilds them from within, and every successor Chapter is founded from the gene-seed of its parent. That is exactly this project's model. The harness began life as a personal, Obsidian-vault-grown agent operating system; this repo is the genetic material distilled out of it — implant it once into your tool, and a disciplined agent grows around it, carrying the same inherited rules, agents, skills, and memory into every repo it touches.

The lineage is also why an **imperial** theme ships alongside the neutral one: it is the voice of the parent system the harness was extracted from. But the genetics are theme-independent — the name is a nod to the origin, not a commitment to Space Marines.

### How it works

One canonical source in `src/` renders, via a tiny zero-dependency generator (`geneseed-build`), into a ready-to-use bundle. **A theme controls only *voice*** — how the AI responds and how the prose inside the docs reads (tagline, greeting, descriptions). **Structure is theme-independent**: section names (Rules, Agents, Skills, Memory…), folder names (`laws/`, `ontology/`, `doctrines/`, `agents/`, `skills/`, `memory/`, `notebook/`) and the four ontology section headings (Telos, Evidence, Decisions, Conduct) are always plain English, so the scaffolding stays tool-friendly while the flavour lives in the words.

```bash
geneseed-build                   # default theme (neutral)
geneseed-build --theme imperial  # Warhammer 40k voice, identical structure
```

---

## 🚀 2 · Setup

### ⚡ The short way — `npx`

The harness is published on npm as **[`geneseed`](https://www.npmjs.com/package/geneseed)** — three commands (`geneseed`, `geneseed-hook`, `geneseed-build`), zero dependencies. One command, nothing cloned, nothing else to install. The only prerequisite is **Node ≥ 22.3**.

```bash
npx geneseed setup            # the guided wizard
```

The wizard asks for a **theme** (each one previewed live — tagline, sigil, voice) and an **install mode** — *OpenCode global* (recommended; every repo inherits it), *per-repo `.opencode/`*, or *plain bundle* for any `AGENT.md` tool — then builds and offers a health check. It works the same on macOS, Linux and Windows (cmd, PowerShell, or a POSIX shell).

Keeping it around is the same command with `npm`:

```bash
npm install -g geneseed       # then plain `geneseed <command>` from any directory
npm install -g geneseed@latest   # …and that is also the update
```

**[QUICKSTART.md](QUICKSTART.md)** walks this in 5 minutes. Every other route (Claude Code, plain `AGENT.md`, per-repo installs, MCP servers, troubleshooting) lives in the full **[Setup guide](SETUP.md)**.

### 🧬 The long way — a git checkout

Cloning still works and is what you want if you intend to *change* the harness rather than use it. It needs **git** and the same **Node ≥ 22.3** as everything else — there is nothing extra to install.

```bash
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
./geneseed setup          # the wizard — or bare `./geneseed` for the main menu
```

**Windows** — native, no bash, WSL, curl, or unzip; works from cmd or PowerShell:

```powershell
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
.\geneseed.cmd setup      # the wizard — or bare .\geneseed.cmd for the main menu
# PowerShell runs a .cmd directly, so this is the PowerShell spelling too
```

Both launchers are thin shims over the Node CLI: they need `node` (22.3+) on `PATH`, and nothing else. Set `GENESEED_NODE` to an absolute path if `node` is not on `PATH` — under a version manager that only patches interactive shells, say. The wizard is plain text prompts on every console, old or new.

### 🟩 One runtime — Node, and nothing else

Node ≥ 22.3 is the entire dependency list. Every subcommand, all four hooks, every web-console endpoint and both generators run from it, and every commit runs the whole unit suite plus `doctor --all` across every theme × host × footprint, on Linux and Windows both. So an install needs no second interpreter — not for the harness, and not for anything it ships. (Until 2026-08-17 the generator's output was also replayed byte for byte against recordings taken from the Python implementation. Those were retired — see [`docs/limits.md`](docs/limits.md) for the measurement that licensed it and the coverage it cost.)

- **0 commands have no Node twin**: 25 of the 25 subcommands, and all four hook verbs, answer from the Node entry points. `catalog`, `mcp` and `memory` are Node-native faces the CLI table declares on top of that roster. There is no full-screen browse panel — `geneseed tui` and `geneseed menu` are verbs that refuse it by name and print the command list instead, off a terminal as well as on one.
- **Nothing you install needs an interpreter.** The `token-report` skill is a script rather than prose, and it ships as `scripts/token_report.mjs`, run with `node`; `daydream` and `herdr` hand their inline code to `node -e`. So **every bundle carries** nothing that needs one: no Python file, and no skill that shells out to an interpreter, on any host, theme or footprint. Three tests freeze that — one scans every tracked file for inline code handed to an interpreter, one globs the bundle source, and one replays the report script over seeded transcripts for all four hosts and compares the bytes.
- **`upgrade` / `update` / `sync-self` / `bootstrap` are for a git checkout.** They `git pull` the install's own origin. From an npm install they stop before touching anything and name `npm install -g geneseed@latest` as the update instead.

One more honest edge, in the web console rather than the CLI: the **"browse…" folder picker** would open an OS-native dialog on the machine running the daemon, and this server declines to. The button reports that it is unavailable and the field beside it stays editable — type or paste the path.

### ✅ After installing

- **Verify** — open your agent in any repo: the first reply starts with the readiness sigil and your project's docs are already in context. `geneseed doctor` should print `ok`.
- **Run it from anywhere** — a global `npm install -g geneseed` already does this. From a checkout, `./geneseed link` writes a launcher shim into `~/.local/bin`; `.\geneseed.cmd link` writes a shim into `%LOCALAPPDATA%\Geneseed\bin` and adds it to your user PATH (open a new terminal).
- **Everything else** — other tools (Claude Code, plain `AGENT.md`), per-repo installs, MCP servers, environment knobs, troubleshooting: **[SETUP.md](SETUP.md)**.

---

## 🖥 3 · Web & terminal

Two front-ends over the same deployed harness — the same actions either way. Reach for the **web console** when you want to read and browse; reach for the **command line** when you live in the terminal. There is no full-screen panel between them.

### 🌐 Web console — `geneseed web`

`geneseed web` opens a local browser console in a dashboard-first layout, with rendered markdown and clickable cross-links.

```bash
geneseed web                 # serve on http://127.0.0.1:4747 and open the browser
geneseed web --port 8080     # pick a port
geneseed web --no-browser    # serve without auto-opening

geneseed web start           # run as a background daemon (doesn't block the terminal)
geneseed web restart         # restart the daemon — pick up a rebuilt UI or changed theme
geneseed web stop            # stop the daemon
geneseed web status          # is it running, and where
```

The left rail mirrors the harness's own shape:

| Group | What's there |
| --- | --- |
| **🧬 Harness** | **Dashboard** — live readout of what's deployed (voice, capabilities, drift, recent jobs) · **Library** — browse Laws, Agents, Skills, Memory, Notebook · **Graph** — cross-link constellation across the whole harness |
| **📚 Learn** | **Docs** — rendered markdown + concept pages + CLI reference + glossary, grouped into Get started / Core concepts / How-to / MCP servers / Plugins / Reference / Deeper · **Specs** — dated implementation specs with design rationale |
| **🔧 Maintain** | **Changes** — diff between the deployed harness and the source, export an `improvements.md` back-port · **Doctor** — health check across themes, links, parity, and authoring gates |
| **🎨 Configure** | **Themes** — preview and switch the deployed voice live · **Settings** — MCP servers, server controls |
| **ℹ️ About** | project + creator credits, source link |

It binds to `127.0.0.1` only and runs entirely offline — no npm needed at runtime; the UI build ships in `web/dist/`. Mutating actions run in the background and report back as toasts (fire-and-notify), guarded by a per-session token so other sites can't trigger them. A global **Spotlight** search in the topbar jumps to any agent, skill, law, doc, or spec. Rebuild the UI after changing anything under `web/src/` with `cd web && npm install && npm run build`. If `web/dist/` is missing (fresh clone, never built), `geneseed web` offers to run that build for you — answer `Y` and it installs, builds, and starts the server; in non-interactive shells it prints the manual recipe instead.

Full reference — every view, the launch/daemon/PWA surface, the security model: **[docs/web-ui.md](docs/web-ui.md)**.

### ⌨️ Terminal — `geneseed`

No browser? Every action the console offers is also a verb: `build`, `doctor`, `diff`, `rebuild-all`, `status`, `memory`, `catalog`, `exclude`, `mcp`, `link`/`unlink`, `uninstall` (global **or** per-repo). `geneseed setup` runs the install wizard — plain text prompts, every console, every OS; see [Setup](#-2--setup) above for the walkthrough. `geneseed --help` lists the rest. There is no full-screen panel: `tui` and `menu` are verbs that say so and print the command list.

---

## 📦 4 · What you get

The harness ships as a small set of layers, and the web console's rail is the same shape — Constitution, Skills and Agents each have their own entry; Memory, Notebook and the wiki sit under Library:

| Layer | What it is |
| --- | --- |
| **🧭 Ontology** (`ontology/`) | the mind the rules govern, in four prose sections — **Telos** (the Pact: protect the user, the truth, the agent), **Evidence** (every claim graded by how it was obtained), **Decisions** (classify and tier by reversibility, show the real forks), **Conduct** (answer what was asked, once). Always in force, never toggleable |
| **🛡️ Rules** (`laws/`) | 9 universal laws the agent obeys — always in force, never toggleable: sealed-secrets, one-intent-one-act, verify-before-assert, deletion-is-deliberate, surface-failures, data-not-orders, least-privilege, root-cause, external-gate |
| **📐 Doctrines** (`doctrines/`) | practice packs, chosen per install at build time: **craft** (how code is written), **rigor** (how work is proven), **ops** (how the machine is operated), **process** (how a task is run). A doctrine rule may tighten a Rule, never repeal one, and the user's own `user-rules.md` outranks it. Pick with `geneseed-build --doctrines craft,rigor` (or `none`), a single rule with `--exclude-rules "process 7"`, in the setup wizard, or through the switches on the console's Constitution page; all four pack files ship on disk either way, so a citation into a pack you left out still resolves |
| **🤖 Agents** (17) | capability specialists: `reviewer`, `tester`, `architect`, `docs`, `security`, `explorer`, `developer` — plus a debate **council** the `council` skill convenes: `advocate`, `skeptic`, `pragmatist`, `steward`, `visionary`, `user-advocate`, `framer`, `empiricist`, `operator`, `historian` |
| **🛠 Skills** (47) | repeatable workflows: brainstorm · **clarify** · plan · **codebase-design** · **domain-modeling** · **wayfinder** · **tickets** · tdd · **develop** · debug · **prototype** · refactor · **ponytail** · **forge-mcp** · geneseed-code-review · **fresh-eyes** · **review-response** · commit · **ship** · **release** · **migrate** · **git-archaeology** · **git-rescue** · repo-map · document-project · **frontend-design** · **prose** · **ingest** · **research** · **learning-path** · **gap-detector** · **feynman** · **crash-course** · **drill** · **decode** · handoff · roast-me · **council** · parallel-agents · **workflow** · **wiki** · **geneseed** · **rule** · **profile** · **opencode-theme** · **herdr** · **pipeline** |
| **🔌 Plugins** (OpenCode) | `geneseed-context` injects project docs *and your machine wiki* every session (and across compaction); `geneseed-learn` distils memory at session end; `geneseed-guard` enforces the safety Laws and protected wiki folders at the tool boundary; `geneseed-workflow` registers the `workflow` tool that runs saved orchestration scripts; `geneseed-notify` sends a native OS notification when a long run finishes; `geneseed-ponytail` holds a minimal-code mode (`/ponytail lite\|full\|ultra\|off`), opt-in, injecting the laziest-that-works ruleset every turn so it doesn't drift; `geneseed-activity` streams what each session is doing to the web console's Activity view |
| **🧠 Memory** (`memory/`) | one-fact-per-file durable knowledge, indexed by `MEMORY.md` (git-ignored, personal) |
| **📓 Notebook** (`notebook/`) | the agent's sovereign space — any medium (code, tools, data, notes), self-ruled via a seed-once charter, always git-ignored; only its `.gitignore` is build-asserted |
| **🌐 Wiki** (`wiki.jsonc`) | your own machine-wide knowledge base — typically an Obsidian vault — declared once per machine: entry notes load eager/lazy, the agent reads and **writes** it under the vault's own conventions, with an inbox fallback and guard-enforced protected folders |
| **🧭 Context** | the project's own docs — auto-discovered on OpenCode, or via a `context.json` manifest |

### 🎨 Themes

Fourteen themes ship — each a single JSON file in `themes/` carrying voice tokens only, so adding your own is a copy-and-edit away.

| Theme | Voice |
| --- | --- |
| 🟢 **neutral** | clear, plain, professional English |
| ⚫ **imperial** | Warhammer 40k — rules read as *Dictates*, agents as *Adepts*, skills as *Rites* |
| 🪖 **military** | crisp military comms |
| 🏴‍☠️ **pirate** | salty seafaring patter |
| 🧙 **wizard** | high-fantasy magical idiom |
| 🌃 **cyberpunk** | neon-dystopia voice |
| 🎮 **gamer** | gaming/streamer cadence |
| 🏟️ **sports** | play-by-play commentary |
| 🏍 **biker** · 🎤 **commentator** · 🃏 **joker** · 🤖 **marvin** · 😤 **mean** · 🏎 **verstappen** | community-added voices for fun |

Pick with `--theme NAME` or via the setup wizard. The theme is remembered in a `.geneseed-theme` marker, so later upgrades preserve it. `doctor` checks every theme defines the same keys, so flavour drift is impossible. Adding a new voice token to `themes/_TEMPLATE.json`? Run `geneseed-build --sync-themes` to fill it into every theme (template's placeholder value, reported for restyling) before `doctor` is expected to pass again.

### 🪶 Footprint (lean vs full)

A second per-install dial, **footprint**, sets how much of the constitution `AGENT.md` carries *inline* every turn — a token-cost knob, not a change to which Rules apply (every Rule is always in force, and so is the whole of the Ontology).

| Footprint | The Ontology + Sections 1–2 of `AGENT.md` | Trade-off |
| --- | --- | --- |
| **lean** *(default)* | the Ontology **whole**; each Rule and each active doctrine rule as its heading + the rule line, then a pointer to the full text | lighter every turn; rationale is one on-demand read away |
| **full** | the Ontology, every Rule and every active doctrine rule at complete text **and** rationale, inlined | maximum guidance density; largest per-turn token cost |

**The Ontology is never truncated.** Lean keeps only the first sentence of each `### ` block, and the four ontology sections are flowing prose rather than numbered rules — truncating them would leave four orphan sentences, so they ship whole at both footprints. The invariants and the doctrine rules *are* truncated at lean, each to its heading plus its first sentence.

Both footprints put the full text on disk beside `AGENT.md`: `laws/`, `ontology/` and `doctrines/` all ship in the bundle, and **all four pack files ship whether or not the pack was built in** — which is what lets a citation into an inactive pack resolve. So lean is a context/token optimization, **not** a rules cut. Measured on `neutral`, adding the ontology and doctrine tiers moved the always-loaded `AGENT.md` from 31,457 to 36,882 bytes at lean (+17.2%) and from 53,378 to 54,810 at full (+2.7%) — the lean growth is the price of shipping the ontology whole, and it was taken deliberately.

Lean is the default: the rationale is one read away and the context it frees is paid back on every turn. Switch to **full** when token cost is a non-issue or you run a smaller model, which leans harder on always-present rationale. Set it with `--footprint lean|full`, the Settings toggle, the per-harness dropdown in the Harnesses tab, or the setup wizard. It's remembered in a `.geneseed-footprint` marker and preserved across rebuilds, on every host (OpenCode, Claude Code, Bob, Copilot).

Either way the harness is otherwise identical — same files, Rules, capabilities, and guards; lean only relocates the *reasoning* to on-demand (and adds the standalone law, ontology and doctrine files to global/Claude/Bob installs). The one behavioural edge: with the rationale always in context, **full** applies a rule's nuance more reliably on subtle edge cases — or with a weaker model that may not reach for the pointer.

Want to check a build before it touches anything real? `geneseed-build --validate-only --theme NAME --emit MODE --out TARGET` renders and validates into a throwaway sandbox — nothing under `--out`/`--root` is written — and exits non-zero on any problem. Details: [SETUP.md](SETUP.md#dry-run-a-build-validate).

---

## 🔌 Supported harnesses

One source, five emit targets. Geneseed builds into whichever host you point it
at — each with a per-repo and a global (`-global`) variant — plus a portable
`files` bundle any `AGENT.md`-aware tool can read. **OpenCode** runs its own
engine (JS plugins, colour themes, LSP); **Claude Code**, **Bob**, and
**Copilot** share one Claude-shaped engine that diverges only by host dialect.

The harness — its Rules, Agents, Skills, Memory convention, and preamble voice —
is **identical on every host**. What differs is how much of it the host can
*automate* for you (via plugins or hooks) versus carry as preamble discipline.

| Capability | OpenCode | Claude Code | Bob | Copilot |
| --- | :---: | :---: | :---: | :---: |
| **Instructions file** | `AGENT.md` + `opencode.json` | `CLAUDE.md` | `AGENTS.md` + `rules/geneseed.md` | `AGENTS.md` / `copilot-instructions.md` |
| **Agents** (capability specialists) | ✅ native | ✅ | ✅ | ✅ `.agent.md` |
| **Skills** (byte-identical) | ✅ | ✅ | ✅ | ✅ |
| **Memory & Notebook** | ✅ | ✅ | ✅ | ✅ |
| **Context injection** | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| **Memory write-back** (learn) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| **Git-gate consent** (process 5) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| **Rule-gate consent** (process 1) | ⚙️ plugin² | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| **Sovereign-repo excludes** | ⚙️ plugin | ✅ `claudeMdExcludes` | ✅ rules-shadow | ➖ none |
| **MCP server wiring** | ✅ `mcp` | ✅ `mcpServers` | ✅ `mcpServers` | ✅ `mcp-config.json` |
| **Colour themes** | ✅ full palette | ➖ | ➖ | ➖ |
| **LSP · workflow runner · primary-agent · `/`-commands** | ✅ | ➖ | ➖ | ➖ |

<sub>✅ native support · ⚙️ OpenCode plugin · 🪝 `settings.json` hook · 📄 carried by preamble prose only · ➖ no host mechanism (harness discipline still applies) · ¹ Bob honours Claude-dialect hooks best-effort — inert if unsupported, harness still holds via the preamble. · ² OpenCode's `tool.execute.before` can only allow or throw, with no "ask the user" tier, so the rule gate is a one-shot speed bump there rather than a prompt.</sub>

**Reading the matrix.** Everything above the divider is at full parity — no host
drops an Agent, Skill, or the memory convention. The asymmetry is entirely in
*automation mechanism*: OpenCode's plugin surface and Claude/Bob's hook surface
enforce a few Rules for you, where **Copilot** (no hook mechanism) enforces them
through preamble discipline instead. The OpenCode-only extras (themes, LSP,
workflow runner, primary-agent) have no analogue on a Claude-shaped host.

Per-host wiring in depth: **[OpenCode](adapters/opencode/README.md)** ·
**[Claude Code](adapters/claude-code/README.md)** ·
**[Bob](adapters/bob/README.md)** · **[Copilot](adapters/copilot/README.md)**.
Token cost per host: **[docs/token-footprint.md](docs/token-footprint.md)**.

## 🗂 Layout

```
Geneseed/
├── package.json          the npm package: three commands, zero dependencies
├── bin/                  the Node entry points — geneseed-cli.mjs (the CLI), geneseed-hook.mjs
│                         (the four hook verbs), geneseed.mjs (the generator driver)
├── js/                   the Node harness — generator, hooks, web server, doctor, installs
│                         (js/cli-table.json is the CLI as data; both runtimes read it)
├── geneseed              launcher (bash): a shim over bin/geneseed-cli.mjs — bare `./geneseed`
│                         = interactive main menu; + every subcommand the CLI carries
│                         (`./geneseed link` puts it on PATH so `geneseed` runs from anywhere)
├── geneseed.cmd          the same shim for cmd.exe / PowerShell — no bash needed
├── harness.config.json   default theme + metadata (the one owner of the version)
├── src/                  canonical source — edit here
│   ├── AGENT.md.tmpl     the entrypoint, rendered to AGENT.md
│   ├── ontology/         how the agent thinks — Telos, Evidence, Decisions, Conduct
│   ├── laws/             the universal invariants
│   ├── doctrines/        the four practice packs (craft, rigor, ops, process)
│   ├── postures/         the relationship register, inlined into AGENT.md
│   ├── modes/            the operating register, inlined into AGENT.md
│   ├── agents/           capability specialists
│   ├── skills/           repeatable workflows
│   ├── memory/           memory convention + index
│   └── notebook/         the agent's own freeform space — convention + index
├── themes/               voice token maps (14 themes shipped)
├── web/                  Vite + React UI source; the committed web/dist/ build is what ships
├── tests/                Node test suites + the pure-function/help recordings they replay
│                         (tests/__snapshots__/ — the emit/cli/web corpora retired 2026-08-17)
├── docs/                 guides (web-ui, wiki, …) + docs/web/ (the console's Docs pages);
│                         specs/, reviews/, superpowers/ are local working docs — git-ignored
├── adapters/             per-host glue (opencode/, claude-code/, bob/, copilot/)
└── .github/workflows/    ci.yml (doctor + tests) · publish.yml (npm, OIDC, manual only)
```

## 🧪 Validate & test

```bash
node bin/geneseed-cli.mjs doctor      # every theme + parity + authoring + drift
node --test "tests/**/*.test.mjs"     # the test suites (node expands the glob)
```

`doctor` checks each theme for unresolved tokens, dead/non-hermetic links, theme-key parity, author-time gates (every spec has a purpose line, the plugins parse, the learn-prompt literal stays extractable), and that a committed bundle still matches a fresh render of `src/`. CI (`.github/workflows/ci.yml`) runs both on every push and PR, on both Linux and Windows. Publishing is a separate, manually-triggered workflow (`.github/workflows/publish.yml`) — see [Contributing](#-contributing).

## 🔄 Keeping it current

**Installed from npm** — one command, and it rebuilds every active install for you:

```bash
npm install -g geneseed@latest
geneseed rebuild-all   # re-render every registered install in its own theme + mode
```

**Installed from a clone** — the `git pull` route, which also refreshes the launchers:

```bash
./geneseed update      # everything in one: refresh the scripts + content, then rebuild
./geneseed bootstrap   # update everything, then drop into the setup wizard
./geneseed upgrade     # just the content refresh (remembers theme + emit mode)
```

**Local edits survive.** The self-improvement loops let the agent refine its deployed agent/skill files in place. Before setup, re-theme, or upgrade overwrites them, any drift is auto-exported to a markdown **improvements file** under `improvements/` *inside the deployed harness dir* (e.g. `~/.config/opencode/improvements/` for the global install) — beside the install it describes, untouched by rebuilds and uninstall. Hand it to an agent in this repo to back-port the changes into `src/`. On demand: `./geneseed diff --out FILE`, or the **Changes** page in the web console.

Details and precedence rules: [SETUP.md → Upgrade](SETUP.md#upgrade).

## 📚 Documentation

| Page | Read it when… |
| --- | --- |
| **[SETUP.md](SETUP.md)** | Installing — every path, configuration knob, env var, verify, troubleshooting |
| **[DESIGN.md](DESIGN.md)** | Changing structure — the spec and the decisions behind it |
| **[SHIPPED.md](SHIPPED.md)** | What's in the harness today — capabilities ↔ the spec behind each |
| **[docs/web-ui.md](docs/web-ui.md)** | The web console — every view, the launch/daemon/PWA surface, security model |
| **[docs/wiki.md](docs/wiki.md)** | The machine wiki — your personal knowledge base, setup and writing model |
| **[docs/token-footprint.md](docs/token-footprint.md)** | What the harness costs in context-window tokens, per host |
| **[docs/opencode-plugin-setup.md](docs/opencode-plugin-setup.md)** | Installing the OpenCode plugins — the one-time wiring they all share |
| **[CHANGELOG.md](CHANGELOG.md)** | What changed between versions |
| **[adapters/opencode/](adapters/opencode/README.md)** | Wiring OpenCode in depth — plugins, native mapping |
| ⤷ [GLOBAL-HARNESS-SPEC.md](adapters/opencode/GLOBAL-HARNESS-SPEC.md) | The global-emit contract |
| ⤷ [HOW-OPENCODE-LOADS.md](adapters/opencode/HOW-OPENCODE-LOADS.md) | Why a file shows up twice; plugin loading |
| **[adapters/claude-code/](adapters/claude-code/README.md)** | The Claude Code hook adapter |
| **[adapters/bob/](adapters/bob/README.md)** | The IBM Bob adapter — Claude-shaped, rules-file preamble |
| **[adapters/copilot/](adapters/copilot/README.md)** | The GitHub Copilot adapter — reduced host, no hooks |
| **[src/memory/README.md](src/memory/README.md)** | The memory convention |
| **[src/notebook/README.md](src/notebook/README.md)** | The agent's own freeform-space convention |

## 🤝 Contributing

Issues and PRs welcome at [github.com/Arylmera/Geneseed](https://github.com/Arylmera/Geneseed). The CI is dependency-free and runs on every push — keep `doctor` green and the test suites passing. Adding a new theme is one JSON file in `themes/` with the same voice-token keys; `doctor` will tell you if any are missing.

Three things that bite when you don't know them:

- **`js/cli-table.json` IS the CLI.** The argument parser is data, and that file is the owned document — not a generated one. `bin/geneseed-cli.mjs` cannot parse a single verb without it, `bin/geneseed-hook.mjs` renders `--help` from it, and the console's `cli` docs page is a filtered view of it. What holds it honest is `tests/unit/cli_table.test.mjs` plus the recorded help texts under `tests/__snapshots__/help/`, which every verb's `--help` is rendered against — so change a flag here and the fixture for that verb is what tells you. Those recordings are frozen and cannot be re-taken; a red one is a finding, not a re-bless.
- **The version has one owner: `harness.config.json`.** `package.json` mirrors it and a test fails the fork. Never `npm version` — it edits one of the two.
- **Publishing is deliberate and manual.** `.github/workflows/publish.yml` uses npm trusted publishing (OIDC); there is no `NPM_TOKEN` in this repository and there must not be one. It runs only from Actions → publish → Run workflow, and the npm-side trusted publisher is keyed on that workflow's **filename** — renaming the file breaks publishing with no local symptom, which is why the file names itself in its own header and a test asserts the two agree.

## 📄 License

[MIT](LICENSE) — built by [@Arylmera](https://github.com/Arylmera).
