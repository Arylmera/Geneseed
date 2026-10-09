---
name: setup
description: Install the Geneseed harness into Claude Code, globally or for the current repo. Use when the user runs /geneseed:setup or asks to install, set up or try Geneseed.
---

# Install Geneseed

This plugin carries no harness of its own. Geneseed is a build: it renders laws, agents, skills,
memory and hooks for the machine it runs on, so the install goes through its CLI.

1. Check `node --version` is 22.3 or later. If not, stop and point the user to https://nodejs.org.
2. Ask the user two things, and wait for the answers:
   - **Scope.** *Global* writes to `~/.claude` and every repo inherits it (recommended). *This repo*
     writes `CLAUDE.md`, `.claude/` and the hooks into the current repository only.
   - **Theme.** `neutral` (default) unless they name another. Themes change only the voice.
3. Install the CLI, after the user agrees: `npm install -g geneseed`. A global install keeps the
   hook shim pointing at a stable path; do not build from `npx`.
4. Build:
   - Global: `geneseed build --emit claude-global --theme <theme>`
   - This repo: `geneseed build --emit claude --out . --root . --theme <theme>`
5. Verify with `geneseed doctor`, then `geneseed status`.
6. Tell the user to start a new Claude Code session: the hooks and `CLAUDE.md` load at session start.

For the interactive wizard with theme previews, the user can run `geneseed setup` in their own
terminal instead. Uninstall: `geneseed uninstall`. Docs: https://github.com/Arylmera/Geneseed/blob/main/docs/guides/install-claude-code.md
