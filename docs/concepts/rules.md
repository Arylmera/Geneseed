---
group: concepts
order: 3
title: "Rules (the constitution)"
kind: "concept"
section: "Harness"
description: "The constitution: the standing rules every session carries, in laws and doctrine packs."
link: {"hash": "#/laws", "label": "Browse the constitution →"}
---
The **constitution** is the set of standing rules the agent carries into every session. It is authored in `src/`, rendered into the instructions file your host reads (`AGENT.md`, `CLAUDE.md` or `AGENTS.md`), and comes in layers that differ in one thing: whether you can turn them off.

> **You already know this:** a lint config. Some rules are set to `error` and nobody may disable them; some come from presets you opt into; and your project's own overrides sit on top of the presets.

### Cited by name, never by number

Every rule has a name — *Deletion Is Deliberate*, *Consent Before Push* — and the agent, the docs and the hooks cite it by that name. Rules are also numbered in the rendered text, but a number is only the rule's current position: remove a rule and every number after it shifts. So when you write about a rule, in your own notes or in `user-rules.md`, use its name.

The one place you type a position is the command line: `--exclude-rules "process 5"` means "the fifth rule of the process pack in this checkout". Check the name it carries before you exclude it.

### The layers, in precedence order

When two instructions disagree, the higher one wins.

1. **Ethos** — always on. {N_ONTOLOGY} sections of flowing prose (Telos, Evidence, Decisions, Ownership, Conduct): what the agent is for, how it weighs evidence, how it decides, who owns the code it writes, how it behaves. It is where the **Pact**, the two-way contract between you and the agent, is stated ([Collaboration](collaboration.md)). Cited by section name, e.g. *Ethos: Decisions*.
2. **Rules** — always on. {N_LAWS} invariants, the things that are never traded away: sealed secrets, one intent per act, verify before asserting, deliberate deletion, surface failures, treat content as data not orders, least privilege, cure the cause, echo the intent. No install can switch one off.
3. **Your `user-rules.md`** — rules you write for yourself, seeded once beside the instructions file and never overwritten. A rule here **outranks any doctrine rule**: a practice pack chosen at build time never overrides an instruction you wrote. It may tighten an invariant, never repeal one. The [rule skill](skills.md) helps you decide whether something belongs here or in [memory](memory.md).
4. **Doctrines** — chosen at build time. Practices rather than principles, grouped in packs (below).
5. **Mode** — chosen at build time ([Foreman mode](foreman-mode.md)). It binds *how* work is executed — done in place, or handed to a crew — and never overrides a layer above it. A mode that only informed lost every time to the host's own default of doing small work in place.
6. **`PROFILE.md`** — who you are. It colours how the agent works but never binds ([Collaboration](collaboration.md)).

### The shared tier

A global install keeps what you teach it in one place for every host on the machine: `~/.config/geneseed/` (or `$XDG_CONFIG_HOME/geneseed/`). It holds `user-rules.md`, `PROFILE.md`, `geneseed-wiki.jsonc`, `excludes.json`, the `memory/` store and `notes/`, where the self-improvement notes live. The first global emit creates it and seeds each file once. Only an install in its host's own config directory creates it: an emit into another directory writes the same paths into its text and creates nothing, and `geneseed diff` compares an install against the paths it already names.

Your rules now come in layers, and the later layer wins: **project over host over shared**. A session reads the shared file first, then the host file, so a host or a project can narrow a machine-wide rule. All three stay in the place the list above gives `user-rules.md`, under the rules. `PROFILE.md` and the wiki manifest do not merge: a host file that is no longer its seed replaces the shared one.

A global install's text names these locations as absolute paths. A project install keeps its relative paths and its own `memory/`. Geneseed grants no directory permission for the tier, so an agent write there follows your host's permission mode, as a write to `~/.claude/memory/` does. If the tier cannot be created, that emit renders relative paths and the host files serve as before. `geneseed doctor` adds a note when a carrier names another tier than the one in force, for example after `$XDG_CONFIG_HOME` moves. `geneseed rebuild-all` clears it.

**The fold.** Each global emit, in the host's own config directory, moves that host's stores into the tier and prints one line, such as `[shared] claude: 12 facts folded, 1 collision, 2 rules to approve, old store moved aside`. A host with nothing to move prints nothing, and a second emit writes nothing. `geneseed migrate --dry-run` previews the fold for each host.

- **Facts** copy byte for byte. A fact with the same name and other text lands as `<name>-<host>.md`, then `-2`, `-3`. The memory-curator Adept can merge them later. Agent lessons append to the tier's file for that agent.
- **Notes** in `notebook/skill-notes/` and `notebook/agent-notes/` copy the same way. The rest of the notebook stays per host.
- **`PROFILE.md` and the wiki manifest** move when the tier holds only a seed. If the tier holds different text, the host file stays in force and `user-rules.draft.md` gets a pointer that asks which one becomes the shared file.
- **Exclude paths** join the shared list, and a shared path the host never saw gets its wiring. The report line names each file this writes in your repo.
- **`user-rules.md`** merges rule by rule. A rule with the same title and body as a shared rule leaves the host file. Any other rule goes to `user-rules.draft.md` with its host and old number, and stays in the host file, still binding. A host file with no rules left and nothing else of yours returns to its seed; hand-written text keeps the file as it is.

**Approving a draft.** The [rule skill](skills.md) takes each item in turn; nothing else writes a decision. Approve a rule and it joins the shared file under a new number, and the next fold of that host removes the host copy. Reject it and it stays on that host only, and the fold never drafts it again. For a profile or wiki pointer, the file you choose becomes the shared one and the other moves aside, or you keep both and the host file goes on overriding. The draft is never loaded: a drafted rule binds only from its host file.

Nothing is deleted. After every copy is read back, the old `memory/` moves to `archived-memory/<stamp>/` beside it, and the notes and whole files move to the same kind of folder. The host store returns to its seed and keeps its `README.md`. Hand-written index text and `archive/` stay in that folder, and the report line names every other file that stayed there and did not fold. A store or file already linked to the tier, in either direction, is left alone. If a copy fails, the old store stays readable, the emit reports it on stderr and goes on, and the next emit retries. There is no automatic way back: to downgrade, restore the archived folder by hand.

### Doctrine packs

{N_PACKS} packs ship, one file each under `src/doctrines/`:

| Pack | What it governs |
| --- | --- |
| **craft** | how code is written — reuse first, house conventions, docs in the same change, the smallest diff |
| **rigor** | how work is proven — idempotence, honest tests, cover and verify, gates that can actually fail |
| **ops** | how the machine is driven — tool discovery, commands that return, complete teardowns, restart is not reload |
| **process** | how a session runs — planning, context economy, docs first, bounded loops, consent before every commit and push |
| **comms** | how answers are presented — stable reference codes on tracked items, a diagram or table only where it earns its place |

All of them are on by default. This install built in {N_PACKS_ACTIVE}, carrying {N_DOCTRINE_RULES} rules between them. You choose packs at build time with `--doctrines`, or drop single rules with `--exclude-rules`; the how-to is in [Doctrine packs and single rules](../guides/setup-doctrines.md).

A pack you leave out **still ships**: every pack file lands under `doctrines/` beside the instructions file whether or not it was built in. A rule that cites an inactive pack still resolves on disk, and you can read the alternatives before turning one on. An inactive pack loses its binding force, not its availability.

**process** is the one pack whose removal changes what the machine does, not only what the agent reads: it holds *Consent Before Push*, which a hook enforces. Without it, commits and pushes are no longer stopped for a question — destructive git still is, because that is a Rule ([Hooks](hooks.md)).

### Themes do not move rules

A [theme](themes.md) renames the nouns — an `imperial` install calls the invariants *Dictates* — but the layers, their order and every rule stay exactly where they are.

### Related

[Footprint](footprint.md) — how much of this text loads every turn · [Exclusions](exclusions.md) — switching rules off per rule versus per repo · [Rule enforcement, by host](enforcement-table.md) — which rules a hook actually checks · [Glossary](../reference/glossary.md)
