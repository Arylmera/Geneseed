# Vault Daydream Skill

Multi-agent system that mines the Obsidian vault for non-obvious connections between notes, mimicking the brain's default mode network. Samples random note pairs, synthesizes connections via Sonnet, filters with Haiku critic.

Inspired by [Gwern's LLM Daydreaming](https://gwern.net/ai-daydreaming).

## Usage

```
/daydream
```

## Setup (Geneseed)

Before the first run, make sure the pieces this skill depends on are in place:

1. **A vault to mine.** Declare your Obsidian vault in the harness `wiki.jsonc`
   (AGENT.md §7) — give a `wikis[]` entry a `path` to the vault root. Without it the
   skill falls back to detecting a `.obsidian/` folder in the current directory, then
   asks. No vault → nothing to daydream about.
2. **Parallel subagents.** Synthesis and critique fan out across ~10–20 subagents per
   run, so the host must be able to dispatch them (Claude Code's `Task`; OpenCode's
   `task` tool — see the [parallel-agents](../parallel-agents.md) skill). On a host
   with no subagent mechanism, the skill still works but runs serially and slowly.
3. **Models.** The upstream prompts request `sonnet` for synthesis and `haiku` for
   critique. Those are Claude model names — on another host, substitute the host's
   capable/cheap pair (a strong model for synthesis, a fast one for scoring).
4. **Prompt templates.** Steps 4 and 5 read the `synthesizer-prompt.md` and
   `critic-prompt.md` files **in this skill's own folder** (`skills/daydream/` in a
   deployed Geneseed bundle). They ship with the skill — nothing to install.
5. **Writable output folders.** The run writes `Daydreams/`, `Daydreams/digests/`,
   `Daily/`, and `ai-research/daydream/history.json` into the vault. If any of those
   sit under a `protected` path in `wiki.jsonc`, the guard plugin will block the write —
   keep them unprotected (Law-I-safe, since they're generated notes, not secrets).

This skill adds **no dependencies of its own** — it uses only the host's built-in
Glob/Read/Write/Bash and subagent tools. See [VENDOR.md](VENDOR.md) for provenance.

## What it does

1. Resolves vault root from the harness `wiki.jsonc` manifest (a declared vault's `path`); falls back to auto-detecting `.obsidian/` from the current directory, then asks if still unfound
2. Scans vault for notes modified in last 120 days
2. Generates 50 recency-weighted random pairs
3. Synthesizes connections (Sonnet, parallel batches of 5)
4. Critiques and scores insights (Haiku, parallel batches)
5. Filters for quality (average score >= 7.0)
6. Saves insight notes to `Daydreams/` folder
7. Generates daily digest in `Daydreams/digests/`
8. Appends summary to today's daily note

## Output

- **Individual insights**: `Daydreams/YYYYMMDD-slug.md` -- full synthesis with scores and wikilinks
- **Daily digest**: `Daydreams/digests/YYYYMMDD-digest.md` -- stats + ranked top insights
- **Daily note**: Summary appended under `## Daydream`
- **History log**: `ai-research/daydream/history.json` -- tracks sampled pairs for dedup

## Architecture

```
Skill (orchestrator)
  |-- Glob/Read: scan vault, extract excerpts
  |-- Generate 50 random pairs (recency-weighted)
  |-- Task(model: sonnet) x 10: synthesize connections  <-- parallel
  |-- Task(model: haiku) x 10: critique/score insights  <-- parallel
  |-- Filter (avg >= 7.0)
  +-- Write: save insight notes + daily digest
```

No external dependencies -- pure Claude Code tools (Glob, Read, Write, Bash, Task).

## Cost

Per run (~50 pairs): approximately $0.40-0.50 via Claude Code usage.
