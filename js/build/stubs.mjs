/**
 * The files an emit CREATES WHEN THEY ARE ABSENT and never touches again — context, wiki,
 * user rules, excludes, profile, the bundle's .gitignore, the memory and notebook indexes.
 *
 * Every stub is a literal here and an `ensure*` beside it, and the pairing is the contract:
 * the writer checks first and returns without writing when the file exists, because these are
 * the USER's files from the moment they exist. A stub body is bytes a recorded corpus compares
 * — changing one is a product change, not a tidy-up.
 */
import path from 'node:path';
import { writeText } from '../lib/fs.mjs';
import { jsonDumpsIndent } from '../lib/json.mjs';
import { isDir } from './emit-common.mjs';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Seeded stubs. Written once into the bundle and NEVER overwritten — each holds
// something the user owns. Duplicated from `_build_render.py` rather than read from a
// shared file: the parity gate drives both sides, so drift surfaces as a failing cell
// instead of as two copies rotting apart, and a shared file would be a third format to
// keep in agreement. Backticks are escaped; a raw one would end the literal.
// ---------------------------------------------------------------------------

/** `_build_render.CONTEXT_STUB`. */
const CONTEXT_STUB = {
  _comment: "Point the agent at this project's own documentation. Each entry: 'path' "
    + "(absolute, or relative to the repo root), 'load' ('eager' = read every "
    + "session for small always-relevant rules; 'lazy' = read only when the task "
    + "needs it), and 'description'. This file is host-specific — git-ignore it. "
    + 'The build creates it once, empty, and never overwrites it.',
  context: [],
};

/** `_build_render.WIKI_STUB`. */
const WIKI_STUB = `\
// Geneseed wiki.jsonc — declare your machine-wide knowledge base(s) here, typically
// an Obsidian vault (AGENT.md: the Wiki section). Comments are allowed in this file
// (JSONC). It is host-specific — never commit it. The build created it once, empty,
// and will never overwrite it.
//
// Each wiki carries:
//   name         a short label
//   path         absolute root of the vault (use forward slashes, also on Windows)
//   description  one line shown to the agent
//   entries      notes OR folders to load: path relative to the vault root ("." =
//                the whole vault); load "eager" = read every session, "lazy" =
//                read on demand; a folder applies its mode to every note beneath
//                it, a file entry overrides its folder, "exclude" prunes
//   conventions  the vault's authoring-rules note — read before the first write
//   inbox        drop folder for notes the agent cannot confidently file
//   protected    folders the agent must never write to (guard-enforced on OpenCode)
//
// Example — copy this object into the "wikis" array below and edit:
// {
//   "name": "Brain",
//   "path": "C:/Users/me/Documents/Brain",
//   "description": "my machine-wide knowledge base",
//   "entries": [
//     { "path": "ARCHITECTURE.md", "load": "eager", "description": "the root map" },
//     { "path": ".", "load": "lazy" }
//   ],
//   "conventions": "STYLE.md",
//   "inbox": "Inbox/",
//   "protected": ["Journal/"]
// }
{
  "wikis": []
}
`;

/** `_build_render.RULES_FILE`. */
const RULES_FILE = 'user-rules.md';

/** `_build_render.RULES_STUB`. */
const RULES_STUB = `\
# User rules

Your own standing rules. The agent obeys every rule in this file exactly as it
obeys the laws in AGENT.md §1 — always in force, in every task. A user rule may
*tighten* a law, never repeal one: where they conflict, the law wins.

Geneseed seeded this file once and will never overwrite it. The laws file is
regenerated on every update — never edit that one; this file is where your own
governance lives, and it survives updates, reinstalls, and theme switches.
Unlike \`context.json\`, it is safe to commit: project rules are meant to travel
with the repo and bind the whole team.

Keep the set small — every rule here is loaded every session, and a bloated
rule set dilutes the rules that matter. A durable fact belongs in memory, a
pointer to documentation belongs in \`context.json\`; only a standing *behaviour*
belongs here.

Format — one rule per \`## R<n> — Title\` heading, an optional metadata line in
parentheses, then the rule stated plainly:

    ## R1 — No emoji in commit subjects
    (scope: project | source: written by hand)
    Commit subjects are plain text; no emoji, no decorative unicode.

\`trial until: YYYY-MM-DD\` in the metadata line marks a rule on probation —
usually one promoted from a recurring memory. Review it by that date, then
graduate it (remove the marker) or demote it back to memory.
`;

/** `_build_render.EXCLUDES_FILE`. */
export const EXCLUDES_FILE = 'excludes.json';

/**
 * `_build_render.EXCLUDES_STUB` — one long line, exactly as Python spells it.
 *
 * Exported since P5c because `js/inspect/excludes.mjs` reads it as the single source of the shape a
 * missing or corrupt `excludes.json` degrades to, exactly as `_harness_exclude._read_excludes`
 * reads `build.EXCLUDES_STUB` rather than spelling `{"excludes": []}` a second time.
 */
export const EXCLUDES_STUB = `\
{
  "_comment": "Folders where this global Geneseed install goes dormant (hooks silent, preamble suppressed). Managed by \`harness exclude add|remove|list\`; safe to edit by hand. Paths are absolute.",
  "excludes": []
}
`;

/**
 * `_build_global._BOB_RULES_STUB` — the workspace shadow stub a PROJECT Bob emit ships.
 *
 * Exported since P5c: `harness exclude add` writes the SAME stub into an excluded repo, and
 * decides ownership on the next `remove` by comparing the file's content to it byte for byte
 * — so a second spelling here would orphan every stub the other writer created.
 */
export const BOB_RULES_STUB = `\
<!-- geneseed: workspace shadow stub -->
This project's Geneseed instructions are the repo-root \`AGENTS.md\`, which Bob
auto-loads. This file exists only to shadow the same-named global Geneseed rules
file (\`~/.bob/rules/geneseed.md\`) so the global preamble does not stack on top of
the project's own. Follow the root \`AGENTS.md\`.
`;

/** `_build_render.PROFILE_FILE`. */
const PROFILE_FILE = 'PROFILE.md';

/** `_build_render.PROFILE_STUB`. */
const PROFILE_STUB = `\
# Your profile

Who you are and how you like to work — so the agent can meet you where you are
instead of guessing. Every section is optional; delete what you don't want to
share, add what you do. Geneseed seeded this file once and will never overwrite
it, so it survives updates, reinstalls, and theme switches.

This is *identity, not rules*. A standing rule the agent must obey belongs in
\`user-rules.md\` (AGENT.md §1); this file only colours how the agent works — tone,
depth, defaults. Where the two ever seem to conflict, the rule wins: precedence
is laws, then user-rules, then this profile.

## Who I am

Role, domains you know deeply, domains you're learning. What you're usually here
to do.

## How I work

Habits, tools, and environment worth knowing — your stack, your shell, the
conventions you hold to, the things that reliably annoy you.

## Register preferences

How you like answers pitched: terse or expansive, teach-me or just-do-it, how
much pushback you want, which language(s) you think in.
`;

/** `_build_render.BUNDLE_GITIGNORE`. */
const BUNDLE_GITIGNORE = `\
# Generated by Geneseed. The rendered harness — AGENT.md, the laws, agents, and
# skills — is safe to commit; track it if you want it versioned with your project.
# Only the host-specific / personal files below are kept out of git.

# Project-context manifest — may hold private paths; never commit.
context.json

# Knowledge-base manifest — holds private machine paths; never commit.
# (wiki.json is the legacy name from earlier seeds.)
wiki.jsonc
wiki.json

# Per-agent model/temperature overrides — host-specific; never commit.
agent-overrides.json

# Which theme + emit mode + footprint this host last built (local build state, must not travel).
.geneseed-theme
.geneseed-emit
.geneseed-footprint
.geneseed-srcdirs.json

# memory/ keeps its own .gitignore so learned facts stay on this machine.
# notebook/ keeps its own .gitignore so the agent's own files stay on this machine.
`;

// ---------------------------------------------------------------------------
// Seeded stubs — write-once, never overwrite
// ---------------------------------------------------------------------------

/**
 * `_build_render`'s eight `ensure_*_stub` functions all wrote this same guard out by hand:
 * write `t` to `p` only when nothing is there yet. The STUB BODIES above are what a recorded
 * corpus compares byte for byte — this only touches the write-once CHECK every one of them
 * repeated, never the text.
 */
const seed = (p, t) => { if (!existsSync(p)) writeText(p, t); };

/** A stub whose destination is a fixed `out`-relative name and a fixed body. */
const stubWriter = (file, stub) => (out) => seed(path.join(out, file), stub);

/** `_build_render.ensure_context_stub` — the one stub whose body is computed, not literal. */
export function ensureContextStub(out) {
  seed(path.join(out, 'context.json'), `${jsonDumpsIndent(CONTEXT_STUB, { ensureAscii: false })}\n`);
}

/** `_build_render.ensure_wiki_stub` — a legacy `wiki.json` counts as present. */
export function ensureWikiStub(out) {
  if (!existsSync(path.join(out, 'wiki.json'))) seed(path.join(out, 'wiki.jsonc'), WIKI_STUB);
}

/** `_build_render.ensure_rules_stub`. */
export const ensureRulesStub = stubWriter(RULES_FILE, RULES_STUB);

/** `_build_render.ensure_profile_stub`. */
export const ensureProfileStub = stubWriter(PROFILE_FILE, PROFILE_STUB);

/**
 * `_build_render.ensure_excludes_stub` — the sovereign-repo list, seeded once and NEVER
 * overwritten. Reachable only from the Claude-shaped emits, which is why it arrived with
 * `emitClaudeRender` rather than with the bundle stubs beside it.
 */
export const ensureExcludesStub = stubWriter(EXCLUDES_FILE, EXCLUDES_STUB);

/** `_build_render.ensure_bundle_gitignore`. */
export const ensureBundleGitignore = stubWriter('.gitignore', BUNDLE_GITIGNORE);

/** A stub INSIDE an already-existing store dir — a memory/notebook index, only ever seeded
 * once the store itself exists (`ensureMemoryIndex`/`ensureNotebookIndex` are both called
 * right after the store dir is created, but never invent the dir themselves). */
const storeIndexWriter = (file, header) => (dir) => { if (isDir(dir)) seed(path.join(dir, file), header); };

/** `_build_render.ensure_memory_index` — only inside an EXISTING store dir. */
export const ensureMemoryIndex = storeIndexWriter('MEMORY.md', '# Memory Index\n');

/** `_build_render.ensure_notebook_index`. */
export const ensureNotebookIndex = storeIndexWriter('NOTEBOOK.md', '# Notebook Index\n');

