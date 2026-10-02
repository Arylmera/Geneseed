---
group: guides
order: 5
title: "Uninstall"
kind: "concept"
---
`geneseed uninstall` removes one install at a time. It deletes only what Geneseed wrote and keeps anything you would not be able to rebuild.

## Remove an install

```
geneseed uninstall                          # the project install in this folder, else the OpenCode global one
geneseed uninstall --target /path/to/repo   # a project install
geneseed uninstall --target ~/.claude       # a global install: pass its config directory
```

Without `--target`, the command picks the project install in the current folder if there is one, and the OpenCode global install otherwise. It prints what it will remove and asks before going on. Pass `--yes` to skip the question. In a shell without an interactive terminal, `--yes` is required: without it, the command refuses and exits 1.

To see where each install lives, run `geneseed status`. The web console's **Harnesses** page can also uninstall.

## What it removes

Each install keeps a manifest, a list of the files Geneseed wrote. **Uninstall deletes exactly those files and nothing else**, then removes any folders they leave empty. A file of yours that sits in the same folder stays.

- **OpenCode global:** `AGENT.md`, `agents/`, `skills/`, `plugins/`, the marker files, and the `instructions` entry in `opencode.json`.
- **OpenCode per repo:** `AGENT.md`, `.opencode/`, `laws/`, `agents/`, `skills/`, and the `instructions` entry in `opencode.json`.
- **Claude Code, Bob, OpenClaude:** `agents/`, `skills/`, the marker files, Geneseed's managed block in the instructions file (`CLAUDE.md` or `AGENTS.md`), and Geneseed's own hooks and exclusions in `settings.json`. Your own settings keys and hooks stay.

It also removes the install's row from the registry of installs. Start a new session in your tool afterwards so it stops loading the old files.

## What it keeps

- **`memory/` and `notebook/`.** These are never deleted. `--archive-memory` moves both aside, into sibling `archived-memory/<timestamp>/` and `archived-notebook/<timestamp>/` folders, instead of leaving them in place. Even then they are moved, not deleted.
- **`wiki.jsonc`**, **`context.json`** and the **`improvements/`** folder. None of these are in the manifest.
- **Other installs.** Removing the global install does not touch any project install. Uninstall lists the project installs that remain, each with the command that removes it. If a repo carries installs for several hosts, uninstall removes one and tells you to run it again for the next.

## The hook shim

Claude Code, Bob and OpenClaude hooks all run through one shared file, the hook shim at `~/.geneseed/bin/geneseed-hook` (or under `$GENESEED_HOME`). Uninstalling an install removes that install's hooks but leaves the shim, because other installs may still use it. Once no install is left, you can delete the `~/.geneseed` folder yourself.

## Remove the `geneseed` command

The commands themselves are removed separately:

```
npm uninstall -g geneseed     # installed from npm
```

From a clone, `geneseed unlink` removes the launcher that `geneseed link` put on your `PATH` (see [Run geneseed from anywhere](run-anywhere.md)). Then delete the clone folder.

If you set the web console to start at login, delete that login item too. It is a file you created, and Geneseed never removes it (see [Start the web console at login](autostart.md)).
