---
group: concepts
order: 10
title: "The shared tier"
kind: "concept"
section: "Memory"
description: "One machine-wide folder for memory, rules, profile and wiki, read by every global install."
---
A global install keeps what you teach it in one place for every host on the machine: `~/.config/geneseed/` (or `$XDG_CONFIG_HOME/geneseed/`). Teach Claude Code a fact, and OpenCode knows it too. A project install keeps its own stores unless you [opt in](rules.md).

> **You already know this:** a shell's `~/.gitconfig`. One file serves every repo, and a repo's own config can narrow it.

### What it holds

| In the tier | What it is |
| --- | --- |
| `user-rules.md` | Your standing rules for this machine |
| `PROFILE.md` | Who you are |
| `geneseed-wiki.jsonc` | Your [wiki](../guides/wiki.md) declaration |
| `excludes.json` | [Sovereign folders](exclusions.md) |
| `memory/` | The [memory](memory.md) store: facts, `MEMORY.md`, `topics/`, `agents/`, `archive/` |
| `notes/` | The self-improvement notes: `skill-notes/`, `agent-notes/` |
| `user-rules.draft.md` | What waits for your decision. Never loaded |
| `.fold-state.json` | The record of each drafted or decided item |
| `default-install.json` | The console's default install, once you pick one |

The same folder already held the install registry, your own loop bricks and templates.

**What stays per install.** The constitution and kits: each install renders its own, in its own theme, footprint and packs. The [notebook](notebook.md), apart from its two notes folders. The `wired` receipts in a host's own `excludes.json`. **MCP servers stay yours:** each host keeps its own file, and Geneseed only lists them, read-only, in `geneseed mcp` and the console.

### How a session reads it

| File | How the layers combine |
| --- | --- |
| `user-rules.md`, `memory/MEMORY.md` | Both load, shared first, then host. The order is project over host over shared, so a host can narrow a machine-wide rule |
| `PROFILE.md`, `geneseed-wiki.jsonc` | Whole file. A host file that is no longer its seed replaces the shared one. `$GENESEED_WIKI` overrides both |
| `excludes.json` | A global install reads the union of the shared list and its own |

When both layers load, the heads say which is which: `----- user-rules.md (shared) -----` and `----- user-rules.md (host: claude) -----`. A file still at its seed is skipped. Rules load first, then profile, wiki, memory map and notebook index, so the hook budget cuts the last of these first, with a line that names the file.

A global install's text names these locations as absolute paths. A project install keeps its relative paths and its own `memory/`. Geneseed grants no directory permission for the tier, so an agent write there follows your host's permission mode, as a write to the host's own folder does. A write to the shared rules, draft or memory passes the same [rule gate](hooks.md) as a local one.

### How it is created

The first global emit in a host's own config directory creates the folder and seeds each file once. An emit into another directory writes the same paths into its text and creates nothing, and `geneseed diff` compares an install against the paths it already names. If the tier cannot be created, that emit renders relative paths and the host files serve as before. `geneseed doctor` adds a note when a carrier names another tier than the one in force, for example after `$XDG_CONFIG_HOME` moves. `geneseed rebuild-all` clears it.

### The fold

Each global emit, in the host's own config directory, moves that host's stores into the tier and prints one line, such as `[shared] claude: 12 facts folded, 1 collision, 2 rules to approve, old store moved aside`. A host with nothing to move prints nothing, and a second emit writes nothing. `geneseed migrate --dry-run` previews the fold for each host, and [Upgrade to 5.0](../guides/upgrade-to-5.md) walks through a first run.

- **Facts** copy byte for byte. A fact with the same name and other text lands as `<name>-<host>.md`, then `-2`, `-3`. The memory-curator agent can merge them later. Agent lessons append to the tier's file for that agent.
- **Notes** in `notebook/skill-notes/` and `notebook/agent-notes/` copy the same way. The rest of the notebook stays per host.
- **`PROFILE.md` and the wiki manifest** move when the tier holds only a seed. If the tier holds different text, the host file stays in force and `user-rules.draft.md` gets a pointer that asks which one becomes the shared file.
- **Exclude paths** join the shared list, and a shared path the host never saw gets its wiring. The report line names each file this writes in your repo.
- **`user-rules.md`** merges rule by rule. A rule with the same title and body as a shared rule leaves the host file. Any other rule goes to `user-rules.draft.md` with its host and old number, and stays in the host file, still binding. A host file with no rules left and nothing else of yours returns to its seed; hand-written text keeps the file as it is.

**Approving a draft.** The [rule skill](skills.md) takes each item in turn; nothing else writes a decision. Approve a rule and it joins the shared file under a new number, and the next fold of that host removes the host copy. Reject it and it stays on that host only, and the fold never drafts it again. For a profile or wiki pointer, the file you choose becomes the shared one and the other moves aside, or you keep both and the host file goes on overriding. The draft is never loaded: a drafted rule binds only from its host file.

Nothing is deleted. After every copy is read back, the old `memory/` moves to `archived-memory/<stamp>/` beside it, and the notes and whole files move to the same kind of folder. The host store returns to its seed and keeps its `README.md`. Hand-written index text and `archive/` stay in that folder, and the report line names every other file that stayed there and did not fold. A store or file already linked to the tier, in either direction, is left alone. If a copy fails, the old store stays readable, the emit reports it on stderr and goes on, and the next emit retries. There is no automatic way back: to downgrade, restore the archived folder by hand.

### The console

The console has one hub and no install switch. On the **Personal** page, Rules, Profile and Memory list the shared store once, tagged `shared`, and name no harness; a project install keeps its own entry. Each rule row shows its token cost, and the page shows the total. There is no rule limit. A read-only **Pending** section shows what waits in the draft.

On **Installs**, *Make default* on an active install picks the one the console's pickers start on and a request naming no install reads. The `install` and `theme` lines of `geneseed status` follow it. The pick is `default-install.json`; if that install goes away, the console returns to the fixed host order.

### Uninstall

`geneseed uninstall` never touches the tier, even for the last host and whatever `--archive-memory` says. It prints where the tier lives. Delete the folder yourself if you want it gone.

### Related

[Memory](memory.md) · [Rules](rules.md) — the layers, and `--shared-tier on` for a project · [Exclusions](exclusions.md) · [Upgrade to 5.0](../guides/upgrade-to-5.md)
