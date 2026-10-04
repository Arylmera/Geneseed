---
group: guides
order: 30
title: "Add git-worktree isolation"
kind: "concept"
section: "OpenCode extras"
description: "Add the optional third-party git-worktree isolation to OpenCode."
harness: "opencode"
---
This is a third-party, optional OpenCode plugin. Geneseed does not ship it or install it.

[`opencode-worktree`](https://github.com/kdcokenny/opencode-worktree) gives the agent two tools:

- `worktree_create(branch, baseBranch?)` creates an isolated git worktree under `~/.local/share/opencode/worktree/<project-id>/<branch>/` and opens a terminal with OpenCode already running in it.
- `worktree_delete(reason)` commits and cleans up the worktree.

It suits parallel work when you want separate *files* on disk, not just separate sessions. It coexists with Geneseed's plugins: it registers two tools and hooks no event they use, so nothing fires twice.

It cannot ride Geneseed's install. Geneseed's plugins are single dependency-free files. This one is multi-file TypeScript with npm dependencies and Bun-only APIs, so it installs on its own track.

## Install

1. **Install [OCX](https://github.com/kdcokenny/ocx)**, the package manager that distributes the plugin, if you do not have it.
2. **Add the plugin:**
   ```bash
   ocx add kdco/worktree --from https://registry.kdco.dev
   ```
   OCX manages the plugin's dependencies and updates. You do not need a separate Bun install, because OpenCode already runs on Bun.
3. **Configure it.** On first use the plugin creates `.opencode/worktree.jsonc`. Fill in what each new worktree should inherit and run. For a Node repo, for example:
   ```jsonc
   {
     "sync": {
       "copyFiles": [".env", ".env.local"],   // copied from the main worktree
       "symlinkDirs": ["node_modules"],        // symlinked, not duplicated
       "exclude": []
     },
     "hooks": {
       "postCreate": ["pnpm install"],         // after the worktree is created
       "preDelete": []                          // before it is removed
     }
   }
   ```
4. **Optional: a terminal multiplexer.** The plugin detects your terminal on macOS, Linux and Windows. It prefers `tmux` when you are already inside it, and [`cmux`](https://www.cmux.dev/) for agent workflows. Neither is required. Without them, it uses your OS default terminal.

**Without OCX**, you can copy the plugin's `src/` into `.opencode/plugin/` and install `jsonc-parser` yourself. You then lose dependency management and automatic updates, and you have to re-copy the plugin to upgrade it.

## Consent

`worktree_delete` **commits before it removes the worktree.** The harness's *Consent Before Push* rule (when the `process` pack is built in) asks before a *shell* `git commit` through `opencode.json` permissions. This plugin commits through its own tool, so that gate never sees the commit. Before you call delete, review what it will commit, or keep the worktree and commit yourself.
