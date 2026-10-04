---
group: guides
order: 15
title: "Connect your wiki"
kind: "concept"
section: "Set up"
description: "Give the agent your own notes, machine-wide."
---
If you keep a personal knowledge base on this machine, such as an Obsidian vault or any folder of interlinked markdown, you can declare it once. The agent then reads from it and writes to it while following your own structure. This is optional. Until you declare a wiki, the feature stays off.

> **You already know this:** a wiki is a shared drive with a README that says "read me before you add anything". The agent reads that note first, files new notes where your structure says they belong, and keeps out of the folders you marked off-limits.

## Wiki, memory, notebook: three different stores

- **[Memory](../concepts/memory.md)**: small facts the agent learns, one per file, private to this machine.
- **[Notebook](../concepts/notebook.md)**: the agent's own scratch space.
- **Wiki**: durable knowledge that spans projects, which **you** own and curate.

When a memory fact or a notebook note hardens into knowledge worth keeping across projects, the agent promotes it into the wiki, so the truth lives in one place.

## Declare it in `wiki.jsonc`

The build writes a `wiki.jsonc` stub beside `AGENT.md` (for the OpenCode global install, `~/.config/opencode/wiki.jsonc`) and never overwrites it. The file is JSONC, so comments and trailing commas are fine. The stub contains this example, commented out:

```json
{
  "wikis": [{
    "name": "Brain",
    "path": "/home/me/Documents/Brain",
    "description": "my machine-wide knowledge base",
    "entries": [
      { "path": "ARCHITECTURE.md", "load": "eager", "description": "the root map" },
      { "path": ".", "load": "lazy" }
    ],
    "conventions": "STYLE.md",
    "inbox": "Inbox/",
    "protected": ["Journal/"]
  }]
}
```

- **`path`**: the vault root, absolute. On Windows, use forward slashes (`C:/Users/me/Brain`).
- **`entries`**: notes the agent sees each session, with the same `eager` and `lazy` meaning as [project context](project-context.md). An eager note is loaded in full. A lazy note is only listed, and the agent reads it on demand. An entry can be one note or a folder (`"."` is the whole vault; dot-folders like `.obsidian` are skipped). A file entry overrides its folder's mode, and `"load": "exclude"` removes a note or folder from the list. The example above is the usual shape: the root index eager, everything else lazy.
- **`conventions`**: the note the agent must read before its first write, so new notes match your naming, frontmatter and folder rules.
- **`inbox`**: where the agent drops a note it cannot confidently file, instead of guessing.
- **`protected`**: folders the agent must never write to.

You can declare several wikis. An empty `wikis` list keeps the feature off. The file may hold private paths. It is specific to this machine and must never be committed. A project install's own `.gitignore` already lists it.

Geneseed looks for the file in this order: `$GENESEED_WIKI`, then `$GENESEED_HARNESS/wiki.jsonc`, then beside the installed `AGENT.md`. A `wiki.json` left by an older install is still read at each of those places.

## How each host honours it

<!--harness:opencode-->
*(OpenCode only)*

The context plugin loads your eager entries and lists your lazy ones at session start. A big vault's lazy list stops at 200 notes and shows a count of the rest (`GENESEED_WIKI_LAZY_LIMIT` changes the limit). The guard plugin **blocks** any write into a `protected` folder at the tool boundary, before the write happens. `GENESEED_GUARD=warn` turns the block into a warning, and `GENESEED_GUARD=off` disables the guard.
<!--/harness-->

<!--harness:claude-->
*(Claude Code only)*

No hook reads the wiki. The instructions in your harness tell the agent to read `wiki.jsonc` at session start and to honour it, including the `protected` folders. That is an instruction the model follows, not a block. Nothing stops a write at the tool boundary. The same applies to Bob, OpenClaude and plain `AGENT.md` tools. See [Enforced vs. asked](../understand/enforced-vs-asked.md).
<!--/harness-->

## What the agent does with it

The `wiki` skill drives the procedure.

- **Reading.** The agent starts from your entry notes and moves outward by your own structure, following `[[wikilinks]]` and index notes, instead of reading the whole vault. It treats what it reads as true when written, and checks it against the live system before building on it.
- **Writing.** Durable, reusable facts that span projects go back into the wiki as proper notes: wikilinked, in your house style, filed where your structure says (or in the inbox). Session details stay in memory, and secrets are never written anywhere. The agent never restructures the vault. Moving and renaming notes is your call.
