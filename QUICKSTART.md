# ⚡ Quickstart — 5 minutes

The fastest path: the guided wizard, installing **OpenCode global** — one
install, every repo inherits it, nothing committed into your projects. Only
prerequisites: **git** and **Python 3** (stdlib-only, nothing to pip install).

## 1 · Clone and run the wizard

**macOS / Linux**

    git clone https://github.com/Arylmera/Geneseed.git
    cd Geneseed
    ./geneseed setup

**Windows** (cmd or PowerShell — native, no WSL)

    git clone https://github.com/Arylmera/Geneseed.git
    cd Geneseed
    .\geneseed.cmd setup

Pick a **theme** (previewed live), pick **OpenCode global** when asked for the
install mode, confirm. The wizard builds the harness and offers a health check.

## 2 · Verify

Open your agent in any repo — the first reply starts with the readiness sigil
and your project's docs are already in context. Then:

    ./geneseed doctor        # .\geneseed.cmd doctor on Windows

should print `ok`.

## 3 · Optional niceties

- **Run from anywhere:** `./geneseed link` (`.\geneseed.cmd link` on Windows),
  then plain `geneseed` works in any directory.
- **Browse it:** `geneseed web` opens the local web console; bare `geneseed`
  opens the TUI main menu.

## Everything else

Claude Code and plain-`AGENT.md` installs, per-repo mode, MCP servers, all
environment knobs, and troubleshooting live in the full **[Setup guide](SETUP.md)**.

Once installed, point the agent at your repo's own docs with a tiny
`context.json` — see [the worked example](SETUP.md) in the Setup guide.
