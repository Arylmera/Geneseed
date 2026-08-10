# ⚡ Quickstart — 5 minutes

The fastest path: one command, installing **OpenCode global** — one install, every
repo inherits it, nothing committed into your projects. The only prerequisite is
**Node ≥ 22.3**. No clone, no Python on the install path, nothing left behind.
(Three things still involve Python; none is on this page. The Setup guide
[names all three](SETUP.md#-where-python-is-still-required--the-exact-list).)

## 1 · Run the wizard

    npx geneseed setup

Same command on macOS, Linux and Windows (cmd, PowerShell, or any POSIX shell).

Pick a **theme**, pick **OpenCode global** when asked for the install mode, confirm.
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
- **Full-screen TUI:** the `tui` and `menu` front-ends are the one part that still
  needs a git checkout and Python 3 — see [the Setup guide](SETUP.md#-prerequisites)
  for the exact list of what does.

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
