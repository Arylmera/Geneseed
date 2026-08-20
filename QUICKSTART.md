# ⚡ Quickstart — 5 minutes

The fastest path: one command, installing **OpenCode global** — one install, every
repo inherits it, nothing committed into your projects. The only prerequisite is
**Node ≥ 22.3**. No clone, nothing else to install, nothing left behind.

## 1 · Run the wizard

    npx geneseed setup

Same command on macOS, Linux and Windows (cmd, PowerShell, or any POSIX shell).

Pick a **theme**, then accept the defaults for posture, mode, doctrine packs and footprint (or pick deliberately — see [setup choices](docs/web/setup-choices.md)), pick **OpenCode global** when asked for the install mode, confirm.
The wizard builds the harness and offers a health check.

Want the command to stay? `npm install -g geneseed`, then plain `geneseed …` from
any directory.

## 2 · Verify

Open your agent in any repo — the first reply starts with the readiness sigil
and your project's docs are already in context. Then:

    npx geneseed doctor

should print `ok`.

## 3 · Optional niceties

- **Browse it:** `npx geneseed web` opens the local web console.
- **No full-screen TUI:** `tui` and `menu` are verbs that say the panel is not here and
  print the command list instead. The web console is the visual front end.

## Coming from a clone?

    npx geneseed migrate --dry-run    # survey what would change; writes nothing
    npx geneseed migrate              # move every install onto the npm shape

All-or-nothing, keeps each install's own theme and mode, and never rewrites a hook
or a login item it did not create. Your clone keeps working meanwhile.

## Everything else

Claude Code, Bob and plain-`AGENT.md` installs, per-repo mode, MCP servers, all
environment knobs, and troubleshooting live in the full **[Setup guide](SETUP.md)**.

Once installed, point the agent at your repo's own docs with a tiny
`context.json` — see [the worked example](SETUP.md) in the Setup guide.
