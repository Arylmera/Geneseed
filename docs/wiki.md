# Wiki — your machine's knowledge base

The **wiki** is *your* knowledge base — an Obsidian vault, or any folder of
interlinked markdown — that the agent reads from and writes to as a citizen of
your own structure. Unlike memory (private, one-fact-per-file, machine-local)
and the notebook (the agent's sovereign scratch space), the wiki is durable,
cross-project knowledge **you** own and curate. You declare it once per machine
in `wiki.jsonc`; nothing about it is committed to a repo.

## How it works

Each wiki you declare gives the agent:

- **entries** — notes that load each session (`eager`) or on demand (`lazy`),
  the same semantics as project context. An entry can name a single note or a
  whole folder (`"."` = the entire vault).
- **conventions** — the note the agent must read before its first write, so new
  notes match your naming, frontmatter, and folder rules.
- **inbox** — where the agent drops a note it can't confidently file, instead of
  guessing.
- **protected** folders — write-blocked at the tool boundary by the guard plugin.

## What the agent does with it

**Reading.** It starts from your entry notes and navigates by your structure —
following `[[wikilinks]]` and index notes outward — rather than reading the vault
wholesale. What it reads is treated as your knowledge, current as of when it was
written, and verified against the live system before being built on.

**Writing.** Durable, reusable, cross-project facts get written back as proper
citizens of the graph: wikilinked, in your house style, filed where your
structure says they belong (or the inbox). Session detail stays in memory;
secrets are never written anywhere. It never restructures the vault or touches
`protected` folders — moving and renaming your notes is your call.

When a memory fact or notebook note hardens into knowledge worth keeping across
projects, the agent promotes it into the wiki so there's one home for the truth.

## Set it up

The `wiki` skill drives the read/write procedure. To declare a vault, see the
**Wiki — your own knowledge base** section of `SETUP.md` for the `wiki.jsonc`
shape and resolution order. An empty `wikis` list keeps the feature off.
