<div align="center">

# 🧬 Geneseed

**A portable, theme-able harness you implant once and use everywhere to grow a disciplined AI coding agent.**

[![CI](https://github.com/Arylmera/Geneseed/actions/workflows/ci.yml/badge.svg)](https://github.com/Arylmera/Geneseed/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.x](https://img.shields.io/badge/python-3.x-blue.svg)](https://www.python.org/)
[![stdlib only](https://img.shields.io/badge/deps-stdlib%20only-success)](build.py)
[![Themes](https://img.shields.io/badge/themes-14-9cf)](themes/)
[![Skills](https://img.shields.io/badge/skills-38-blueviolet)](src/skills/)
[![Agents](https://img.shields.io/badge/agents-16-orange)](src/agents/)
[![Laws](https://img.shields.io/badge/laws-34-critical)](src/laws/universal.md)
[![OpenCode · Claude Code · AGENT.md](https://img.shields.io/badge/works%20with-OpenCode%20·%20Claude%20Code%20·%20AGENT.md-1f6feb)](#-2--setup)

[**Why**](#-1--why-geneseed) · [**Setup**](#-2--setup) · [**Web & TUI**](#-3--web--tui) · [**What you get**](#-4--what-you-get)

</div>

---

Geneseed distils an agent operating system into a generic harness built around a single `AGENT.md`. Point your tool at it and the agent inherits a set of operating **rules**, a roster of capability **agents**, native **skills**, a **memory** convention, and — on OpenCode — six **plugins** that auto-load your project's docs, capture durable memory, enforce the safety laws, run saved workflows, ping you when a long run finishes, and hold a minimal-code mode when you ask for one. One source builds it; it follows you into every repo.

This page is the overview. Four parts: **why** it exists, how to **set it up**, the two ways to **drive it** (web & TUI), and **what you get**. For every install path, configuration knob, and troubleshooting step, read the full [Setup guide](SETUP.md).

---

## 🧬 1 · Why Geneseed

### The name

The name comes from Warhammer 40,000. In the lore, *gene-seed* is a Space Marine Chapter's genetic legacy: implanted once into an aspirant, it rebuilds them from within, and every successor Chapter is founded from the gene-seed of its parent. That is exactly this project's model. The harness began life as a personal, Obsidian-vault-grown agent operating system; this repo is the genetic material distilled out of it — implant it once into your tool, and a disciplined agent grows around it, carrying the same inherited rules, agents, skills, and memory into every repo it touches.

The lineage is also why an **imperial** theme ships alongside the neutral one: it is the voice of the parent system the harness was extracted from. But the genetics are theme-independent — the name is a nod to the origin, not a commitment to Space Marines.

### How it works

One canonical source in `src/` renders, via a tiny dependency-free generator (`build.py`, stdlib only), into a ready-to-use bundle. **A theme controls only *voice*** — how the AI responds and how the prose inside the docs reads (tagline, greeting, descriptions). **Structure is theme-independent**: section names (Rules, Agents, Skills, Memory…) and folder names (`laws/`, `agents/`, `skills/`, `memory/`, `notebook/`) are always plain English, so the scaffolding stays tool-friendly while the flavour lives in the words.

```bash
python build.py                  # default theme (neutral)
python build.py --theme imperial # Warhammer 40k voice, identical structure
```

---

## 🚀 2 · Setup

Two ways in — guided or one command. Either takes a few minutes; the only prerequisites are **git** and **Python 3** (the harness is stdlib-only, nothing to `pip install`).

### 🪄 The guided way — TUI wizard (macOS, Linux & Windows)

The launcher ships a dependency-free, full-screen wizard: pick a **theme** (each one previewed live — tagline, sigil, voice — as you move through the list), pick an **install mode** — *OpenCode global* (recommended; every repo inherits it), *per-repo `.opencode/`*, or *plain bundle* for any `AGENT.md` tool — confirm, and it builds and offers a health check. Bare `geneseed` opens the **main menu** instead, listing every action: browse, review local edits, refresh/set up, update, rebuild, memory, status, and Settings (MCP servers, run-from-anywhere, uninstall).

**macOS / Linux**

```bash
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
./geneseed setup          # the wizard — or bare `./geneseed` for the main menu
```

If `python3` is missing on macOS, `xcode-select --install` or Homebrew provides it. `./geneseed tui` opens the browse panel directly.

**Windows** — native, no bash, WSL, curl, or unzip; works from cmd or PowerShell:

```powershell
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
.\geneseed.cmd setup      # the wizard — or bare .\geneseed.cmd for the main menu
# PowerShell-native twin: .\geneseed.ps1 [setup]
```

The launcher finds Python on its own (the `py` launcher, else `python` on PATH). The full-screen TUI needs a VT-capable console — **Windows Terminal**, or Windows 10 1809+ `conhost` — via a stdlib-only ANSI backend; an older console degrades gracefully to the same wizard as plain text prompts. Screens and results are identical to macOS: theme → install mode → confirm → build → health check.

### ⚡ The direct way — one command (OpenCode, global)

The recommended install, done by hand — once into OpenCode's config dir, every repo inherits it, nothing committed into your projects:

```bash
python build.py --emit opencode-global                 # add --theme imperial if wanted
# Optional: the learn plugin auto-locates the in-config memory store. Set this only
# to pin it explicitly (and persist it to your shell rc):
export GENESEED_HARNESS="$HOME/.config/opencode"
echo 'export GENESEED_HARNESS="$HOME/.config/opencode"' >> ~/.zshrc
```

Windows is the same `python build.py` line; the optional pin is `setx GENESEED_HARNESS "$env:USERPROFILE\.config\opencode"`.

### ✅ After installing

- **Verify** — open your agent in any repo: the first reply starts with the readiness sigil and your project's docs are already in context. `./geneseed doctor` (`.\geneseed.cmd doctor`) should print `ok`.
- **Run it from anywhere** — `./geneseed link` symlinks into `~/.local/bin`; `.\geneseed.cmd link` writes a shim into `%LOCALAPPDATA%\Geneseed\bin` and adds it to your user PATH (open a new terminal). Then plain `geneseed` works from any directory.
- **Everything else** — other tools (Claude Code, plain `AGENT.md`), per-repo installs, MCP servers, environment knobs, troubleshooting: **[SETUP.md](SETUP.md)**.

---

## 🖥 3 · Web & TUI

Two front-ends over the same deployed harness — the same actions either way. Reach for the **web console** when you want to read and browse; reach for the **TUI** when you live in the terminal.

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

### ⌨️ TUI — `geneseed`

Same actions, no browser. Bare `geneseed` opens the **main menu** — browse, review local edits, refresh/set up, update, rebuild, memory, status, and Settings (MCP servers, run-from-anywhere, uninstall). `geneseed setup` jumps straight to the install wizard; `geneseed tui` opens the browse panel directly. The whole thing is a stdlib-only, dependency-free full-screen UI that also degrades to plain text prompts on older consoles — see [Setup](#-2--setup) above for the wizard walkthrough.

---

## 📦 4 · What you get

The harness ships as a small set of layers, mirrored one-for-one in the web console's **Library** rail (Laws · Agents · Skills · Memory · Notebook):

| Layer | What it is |
| --- | --- |
| **🛡️ Rules** (`laws/`) | 34 universal laws the agent obeys — secrets, scope, verify-before-assert, surface-failures, context economy, load-the-docs, tool-discovery, non-interactive-shell, untrusted-content, least-privilege, root-cause, idempotency, calibrated-honesty, source-over-surface, total-teardown… |
| **🤖 Agents** (16) | capability specialists: `reviewer`, `tester`, `architect`, `docs`, `security`, `explorer` — plus a debate **council** the `council` skill convenes: `advocate`, `skeptic`, `pragmatist`, `steward`, `visionary`, `user-advocate`, `framer`, `empiricist`, `operator`, `historian` |
| **🛠 Skills** (37) | repeatable workflows: brainstorm · **clarify** · plan · tdd · debug · refactor · **ponytail** · **forge-mcp** · geneseed-code-review · **fresh-eyes** · **review-response** · commit · **ship** · **release** · **migrate** · **git-archaeology** · **git-rescue** · repo-map · document-project · **frontend-design** · **prose** · **ingest** · **research** · **learning-path** · **gap-detector** · **feynman** · **crash-course** · **drill** · **decode** · handoff · roast-me · **council** · parallel-agents · **workflow** · **wiki** · **geneseed** · **herdr** |
| **🔌 Plugins** (OpenCode) | `geneseed-context` injects project docs *and your machine wiki* every session (and across compaction); `geneseed-learn` distils memory at session end; `geneseed-guard` enforces the safety Laws and protected wiki folders at the tool boundary; `geneseed-workflow` registers the `workflow` tool that runs saved orchestration scripts; `geneseed-notify` sends a native OS notification when a long run finishes; `geneseed-ponytail` holds a minimal-code mode (`/ponytail lite\|full\|ultra\|off`), opt-in, injecting the laziest-that-works ruleset every turn so it doesn't drift |
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

Pick with `--theme NAME` or via the TUI wizard. The theme is remembered in a `.geneseed-theme` marker, so later upgrades preserve it. `doctor` checks every theme defines the same keys, so flavour drift is impossible.

### 🪶 Footprint (lean vs full)

A second per-install dial, **footprint**, sets how much of the Rules `AGENT.md` carries *inline* every turn — a token-cost knob, not a change to which Rules apply (every Rule is always in force).

| Footprint | Section 1 of `AGENT.md` | Trade-off |
| --- | --- | --- |
| **full** *(default)* | every Rule's complete text **and** rationale, inlined | maximum guidance density; largest per-turn token cost |
| **lean** | each Rule's heading + the rule line, then a pointer to the full law file | ~40% smaller; rationale is one on-demand read away |

Lean still ships the complete `laws/universal.md` beside `AGENT.md` and points the agent there before acting on secrets, deletion, git history, scope, or untrusted content — so it's a context/token optimization, **not** a rules cut. Use **full** when token cost is a non-issue or you run a smaller model; use **lean** to reclaim context on long sessions, large repos, or cost-sensitive runs. Set it with `--footprint lean|full`, the Settings toggle, the per-harness dropdown in the Harnesses tab, or the TUI wizard. It's remembered in a `.geneseed-footprint` marker and preserved across rebuilds, on every host (OpenCode, Claude Code, Bob).

Either way the harness is otherwise identical — same files, Rules, capabilities, and guards; lean only relocates each Rule's *reasoning* to on-demand (and adds the standalone laws file to global/Claude/Bob installs). The one behavioural edge: with the rationale always in context, **full** applies a rule's nuance more reliably on subtle edge cases — or with a weaker model that may not reach for the pointer — which is why it stays the default.

---

## 🗂 Layout

```
Geneseed/
├── build.py              generator (stdlib only)
├── geneseed              launcher (bash): bare `./geneseed` = interactive main menu; + subcommands
│                         (`./geneseed link` puts it on PATH so `geneseed` runs from anywhere)
├── geneseed.cmd          native Windows launcher (cmd.exe) — same subcommands, no bash
├── geneseed.ps1          native Windows launcher (PowerShell) — same subcommands, no bash
├── bootstrap             one-shot: update everything (sync + upgrade), then run setup
├── upgrade.sh            self-upgrade from the published source
├── sync-self.sh          meta-updater: refreshes the launcher + upgrade scripts
├── harness.config.json   default theme + metadata
├── src/                  canonical source — edit here
│   ├── AGENT.md.tmpl     the entrypoint, rendered to AGENT.md
│   ├── laws/             governance rules
│   ├── agents/           capability specialists
│   ├── skills/           repeatable workflows
│   ├── memory/           memory convention + index
│   └── notebook/         the agent's own freeform space — convention + index
├── themes/               voice token maps (14 themes shipped)
├── rituals/harness.py    the CLI behind the launchers: menu · setup · tui · web · build · doctor ·
│                         diff · upgrade · sync-self · link/unlink · context · learn · prompt ·
│                         status · version · bootstrap · uninstall
├── rituals/web.py        local web UI server (stdlib HTTP) behind `geneseed web`
├── web/                  Vite + React UI source; the committed web/dist/ build is what ships
├── tests/                stdlib unit tests + a Node workflow-runtime test
├── docs/specs/           dated implementation specs — design rationale + history
├── adapters/             per-tool glue (opencode/, claude-code/)
└── .github/workflows/    CI: doctor + tests
```

## 🧪 Validate & test

```bash
python rituals/harness.py doctor                      # every theme + parity + authoring + drift
python -m unittest discover -s tests -p "test_*.py"   # generator + CLI unit tests (no deps)
node --test tests/workflow_runtime.test.mjs tests/guard.test.mjs tests/context_wiki.test.mjs tests/context_delivery.test.mjs tests/notify.test.mjs tests/ponytail.test.mjs   # Node suites
```

`doctor` checks each theme for unresolved tokens, dead/non-hermetic links, theme-key parity, author-time gates (every spec has a purpose line, the plugins parse, the learn-prompt literal stays extractable), and that a committed bundle still matches a fresh render of `src/`. CI (`.github/workflows/ci.yml`) runs all three on every push and PR, on both Linux and Windows.

## 🔄 Keeping it current

```bash
./geneseed update      # everything in one: refresh the scripts + content, then rebuild
./geneseed bootstrap   # update everything, then drop into the setup wizard
./geneseed upgrade     # just the content refresh (remembers theme + emit mode)
```

**Local edits survive.** The self-improvement loops let the agent refine its deployed agent/skill files in place. Before setup, re-theme, or upgrade overwrites them, any drift is auto-exported to a markdown **improvements file** under `improvements/` *inside the deployed harness dir* (e.g. `~/.config/opencode/improvements/` for the global install) — beside the install it describes, untouched by rebuilds and uninstall. Hand it to an agent in this repo to back-port the changes into `src/`. On demand: `./geneseed diff --out FILE`, or `e` in the TUI's *Review local edits* view.

Details and precedence rules: [SETUP.md → Upgrade](SETUP.md#upgrade).

## 📚 Documentation

| Page | Read it when… |
| --- | --- |
| **[SETUP.md](SETUP.md)** | Installing — every path, configuration knob, env var, verify, troubleshooting |
| **[DESIGN.md](DESIGN.md)** | Changing structure — the spec and the decisions behind it |
| **[SHIPPED.md](SHIPPED.md)** | What's in the harness today — capabilities ↔ the spec behind each |
| **[docs/web-ui.md](docs/web-ui.md)** | The web console — every view, the launch/daemon/PWA surface, security model |
| **[CHANGELOG.md](CHANGELOG.md)** | What changed between versions |
| **[adapters/opencode/](adapters/opencode/README.md)** | Wiring OpenCode in depth — plugins, native mapping |
| ⤷ [GLOBAL-HARNESS-SPEC.md](adapters/opencode/GLOBAL-HARNESS-SPEC.md) | The global-emit contract |
| ⤷ [HOW-OPENCODE-LOADS.md](adapters/opencode/HOW-OPENCODE-LOADS.md) | Why a file shows up twice; plugin loading |
| **[adapters/claude-code/](adapters/claude-code/README.md)** | The Claude Code hook adapter |
| **[src/memory/README.md](src/memory/README.md)** | The memory convention |
| **[src/notebook/README.md](src/notebook/README.md)** | The agent's own freeform-space convention |
| **[docs/specs/](docs/specs/)** | Dated implementation specs — the rationale and history behind each feature |

## 🤝 Contributing

Issues and PRs welcome at [github.com/Arylmera/Geneseed](https://github.com/Arylmera/Geneseed). The CI is dependency-free and runs on every push — keep `doctor` green and the test suites passing. Adding a new theme is one JSON file in `themes/` with the same voice-token keys; `doctor` will tell you if any are missing.

## 📄 License

[MIT](LICENSE) — built by [@Arylmera](https://github.com/Arylmera).
