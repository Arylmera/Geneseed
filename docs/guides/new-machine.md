---
group: guides
order: 31
title: "Move to a new machine"
kind: "concept"
section: "Keep it running"
description: "Carry your rules, memory and own skills to another machine in one file."
---
A new install gives you every skill and agent Geneseed ships. It does not give you what you taught it on the old machine: your rules, your profile, your memory, your notes and the skills you wrote. `geneseed backup` puts all of that in one `.zip`. `geneseed restore` puts it back on the new machine and rebuilds your installs as they were.

> **You already know this:** it is the export and import of a browser profile. One file holds your bookmarks and settings, and the new browser reads it back without losing what it already has.

### On the old machine

```bash
geneseed backup
```

This writes `geneseed-backup-<machine>-<date>-<time>.zip` in the current folder. Use `--out <file>` to choose the name, and `--dry-run` to see the file list first. The command never writes over an existing file.

Your projects hold a notebook, and sometimes a memory, rules and a profile, that git does not track. Name the folder your projects are in, and the backup takes them too:

```bash
geneseed backup --projects ~/projects
```

The backup remembers the folder for the next time. For several folders, separate them as in `PATH`. `--projects none` scans nothing. It looks six folders deep, and not inside `node_modules`, a dot folder or a link.

### On the new machine

1. Install Geneseed ([Install](install.md)).
2. Copy the `.zip` across (a USB key, a network share, a mail to yourself).
3. Restore it:

```bash
geneseed restore geneseed-backup-<machine>-<date>-<time>.zip
```

Use `--dry-run` first if the new machine already has rules or memory of its own.

### From the web console

**Settings › Backup & restore** does the same on this machine. It lists the backups in a folder (Downloads until you choose another). *Projects* lists the folders to scan. *Create backup* writes a new one there and remembers them. *Preview* shows what a restore would do and writes nothing; *Restore* asks first. Each runs the command above, and its output opens in the job log. Nothing is uploaded.

### What travels

| In the backup | On restore |
| --- | --- |
| The [shared tier](../concepts/shared-tier.md): `user-rules.md`, `PROFILE.md`, memory, notes, notebook, personal profiles, your bricks, loops and factories, the wiki and exclude lists | Merged into this machine's tier. Paths under your old home folder are rewritten in the wiki, exclude and profile files |
| The skills and agents you wrote in a global install, and the shipped ones you edited | Written where the file is absent or is still Geneseed's own untouched text. A file you changed here stays, and the backup's lands beside it |
| Each tool's own `user-rules.md`, `PROFILE.md`, wiki manifest, `context.json` and `agent-overrides.json` once you filled them in, its memory, its notebook, its `agent-memory/`, the `rules/` and `workflows/` files you added, the rules draft and the `improvements/` reports. The same for OpenCode, Claude Code, Bob and OpenClaude | Written where the file is absent or still the empty seed. A file of yours stays, and the backup's lands beside it; for `rules/` and `workflows/`, in `rules-restored/` or `workflows-restored/`, so nothing new comes into force |
| For each scanned project: the memory, notebook, `user-rules.md`, `PROFILE.md` and `.claude/agent-memory/` that git does not track | Written into the project when its folder is here (the old home is rewritten), by the same rule. If not, into `~/geneseed-restored-projects/<name>`: clone the project and restore again |
| Each global install's settings (theme, footprint, packs, kits, gates) | Saved as the personal profile `restored-<host>` and rebuilt with `geneseed profile apply` |

Nothing on the new machine is overwritten. A fact, a profile, a wiki manifest or any other file that differs lands beside yours as `<name>-restored`, for example `PROFILE-restored.md`. A rule your rules file lacks waits in `user-rules.draft.md` for your decision, as with the [fold](../concepts/shared-tier.md), and a rule still pending on the old machine stays pending. A shipped skill you edited replaces the untouched copy that `setup` wrote; if you edited it on the new machine too, yours stays and the backup's lands beside it. Nothing is written through a link. A second restore of the same file writes nothing.

### What does not travel

- Machine state: the cache, old backups, the install registry and the default install, and what the hooks log in a notebook (`gates.jsonl`, `usage.jsonl`, `agent-runs.jsonl`, `done-gate/`, `store-baseline/`).
- A folder under `skills/` that is not a skill: no `SKILL.md` at its root, or a name that starts with a dot. The backup names it.
- A skill that is a link (for example to a vault): the report names it and its old target.
- Project installs: the report names each folder; run the install there again.
- In a project: what git tracks, a notebook's `archive/`, and a `notebook/` or `memory/` that is not Geneseed's.
- MCP servers, host plugins, your own commands and hooks, and settings that Geneseed does not own: they stay the host's.

The restore prints each of these, and each wiki path that does not exist on the new machine.

### Exit codes

`0` everything is restored. `1` the file was refused (not a backup, or damaged) and nothing was written. `2` partial: a host was not rebuilt, for example because it is not installed here. The report names the `geneseed profile apply` command to run once it is.

### Keep the file private

The backup is a plain copy of your own files. Geneseed does not scan it for secrets and does not encrypt it. Keep it somewhere only you can read, and delete it when the new machine is ready.

### Related

[The shared tier](../concepts/shared-tier.md) · [Install profiles](../reference/profiles.md) · [Uninstall](uninstall.md)
