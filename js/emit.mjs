/**
 * The emit half, in Node — and the process boundary Python drives it across.
 *
 * `js/render.mjs` renders, `js/native.mjs` and `js/opencode.mjs` write the host-native
 * layers, `js/settings.mjs` edits the files the user co-owns; this module is the piece that
 * turns them into an install on disk and the CLI that a `build.py` emit spawns. It is a
 * translation of `_build_render.build` plus BOTH halves of `_build_emit.emit_opencode`,
 * `_build_global.emit_opencode_global` and `_build_global._emit_claude_core` — the last of
 * which is the shared engine behind six emits, so the four job kinds below cover all NINE.
 *
 * "ALL NINE" IS A MEASUREMENT HERE, NOT A CLAIM. It was a claim for two phases and it was
 * false: `emit_opencode_global` spawned Node zero times while four documents said it did,
 * because it was the one mode with no boundary cell able to contradict them.
 * `tests/test_seam_coverage.py` now counts `run_node` invocations per mode and pins the
 * table, and it refuses a mode that crosses without a cell in `tests/test_emit_boundary.py`
 * — so the sentence above cannot come back without the observation behind it.
 *
 * THE HANDOFF THIS MODULE WAS SHAPED BY. Python drove, one spawn per emit:
 *
 *     the Python driver, one emit
 *       +- spawn  node js/emit.mjs <job.json>
 *       |     RENDER  Node writes every file Geneseed owns wholesale
 *       |     WIRE    Node merges the CLAUDE.md managed block, settings(.local).json
 *       |             and opencode.json — the files the USER co-owns
 *       |     Node returns { owned, stats, managed, stdout, stderr } as JSON on stdout
 *       +- Python  PRUNE      old_owned - owned
 *       +- Python  MANIFEST   owned + managed
 *       +- Python  VERIFY     _settings_integrity_check
 *
 * WIRE joined the child at P3b and VERIFY deliberately did not. VERIFY runs after MANIFEST
 * and MANIFEST is Python, so with one spawn per emit there is no child left to run it in —
 * and that is worth having rather than merely tolerable: `_settings_integrity_check` never
 * writes, so every Claude-shaped emit now ends with PYTHON re-reading the settings file
 * NODE just wrote and checking it against the claims NODE just returned. Two
 * implementations of the wiring layer have to interoperate on a real file, on every build.
 *
 * `hookOpts` is the one job field this module cannot compute and must not default. It
 * carries the interpreter and entry point the hook shim bakes, and the child's own
 * `process.execPath` is *node* while the hooks it is wiring are still Python. Left
 * undefined, `hookShimBody` would write `"undefined" "undefined" %*` into the shim and every
 * hook in the install would be dead — so `hookPrefix` throws instead of defaulting.
 *
 * Python still drives because the runtime *is* Python and calls `build.emit_*` in-process
 * from doctor, web deploy, setup and rebuild-all; Node-as-driver would wrap each of those
 * in a subprocess. The seam is designed to collapse: the driver becomes `geneseed.mjs`, the
 * spawn becomes an import, and this job object becomes the function signature.
 *
 * STDOUT CARRIES THE PROTOCOL AND NOTHING ELSE, STRUCTURALLY.
 *
 * The generator prints progress to stdout, and so does this process's protocol — the same
 * stream. Rather than ask every future caller to remember which is which, `main` REPLACES
 * `process.stdout.write` and `process.stderr.write` with buffers for the whole run and
 * restores them only to emit the single JSON document. So:
 *
 *   - a stray `console.log` anywhere in the render tree cannot corrupt the protocol; it
 *     lands in `payload.stdout`, Python re-prints it, and the byte comparison against the
 *     Python generator FAILS. Loud, not silent.
 *   - Python re-emits both buffers through its own `print`, so the emitted bytes carry
 *     Python's encoding behaviour (including its cp1252 failure modes) unchanged. The
 *     alternative — letting Node inherit the streams — would have written UTF-8 where
 *     Python writes the console's locale encoding, a divergence on exactly the machines
 *     least able to report it.
 *
 * This matters beyond tidiness because the same modules reach hook paths at P3, where the
 * emitted git-gate and rule-gate signal their verdict as JSON on stdout and return 0 on
 * every path: one stray byte there turns a blocking gate into a silently permissive one.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { destRel, renderAll, renderFile, SRC_DIR_TOKENS } from './render.mjs';
import { writeNativeLayer, loadAgentOverrides } from './native.mjs';
import {
  ensureAgentOverridesStub, writePrimaryAgent, writeCommandLayer, writePonytailCommand,
  writeTheme, writeColorThemes, copyPlugins, copyWorkflows, sourceReleaseVersion,
} from './opencode.mjs';
import {
  mergeOpencodeJson, mergeClaudeSettings, wireClaudeExcludes, unwireClaudeExcludes,
  unwireClaudeSettings, managedBlockWrite, managedBlockRemove,
} from './settings.mjs';
import { VERSION_MARKER } from './hosts.mjs';
import {
  writeText, readText, copyFile, jsonDumpsIndent, parseJson, pyAscii, pyTruthy,
} from './lib/fs.mjs';
/** `_build_render.SRC_DIRS_MARKER`. */
const SRC_DIRS_MARKER = '.geneseed-srcdirs.json';
/** `_build_render.OWNED_SRC_DIRS` — wiped and regenerated each run. */
const OWNED_SRC_DIRS = ['laws', 'agents', 'skills'];

/**
 * `_build_core.CAPABILITY_LINK_RE` — the DEFAULT only.
 *
 * `cfg.capabilityLinkRe` overrides it and the driver always supplies one, for the same
 * reason `cfg.structure` exists: the constant is in `_OWNED` because a doctor test
 * redirects it to the pre-fix form and asserts the emit then renders dead links, and a
 * redirect that stops at the process boundary half-works silently. The literal stays as
 * the fallback for the parity harnesses, which drive this module in-process.
 */
const CAPABILITY_LINK_RE =
  /\[([^\]]+)\]\((?:(?!https?:\/\/|\/)[A-Za-z0-9_.-]+\/)*(?:agents|skills)\/[A-Za-z0-9_-]+\.md\)/g;

/** `_build_render._TMPL_SPEC_RE`. */
const TMPL_SPEC_RE = /\{\{DIR_(AGENTS|SKILLS)\}\}\/([A-Za-z0-9_-]+)\.md/g;

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
 * Exported since P5c because `js/excludes.mjs` reads it as the single source of the shape a
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
// Small filesystem predicates. Python spells these `Path.is_file()` / `is_dir()`, both
// of which answer False for a missing path rather than raising; `statSync` throws.
// ---------------------------------------------------------------------------

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** `dict.get(key)` with Python's semantics — OWN properties only.
 *
 * The same hazard `js/settings.mjs` and `js/native.mjs` both spell out: the keys here come
 * out of a manifest the user can edit, and `old['constructor']` hands back
 * `Object.prototype`'s member where Python's `.get` returns None. */
function get(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function isDict(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** `Path.rglob("*")` restricted to files, skipping `__pycache__` as Python's callers do. */
function rglobFiles(root, out = []) {
  for (const name of readdirSync(root)) {
    if (name === '__pycache__') continue;
    const full = path.join(root, name);
    if (isDir(full)) rglobFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * `Path.rglob("*")` restricted to files, keeping EVERYTHING — including `__pycache__`.
 *
 * Not a duplicate of `rglobFiles` by accident: `source_fingerprint`'s Python filters
 * `__pycache__` and the legacy-store migration in `_global_memory` does not, so a single
 * walk would be wrong for one caller either way. A user's legacy bundle really can carry
 * one (the harness ships `.py` skill scripts), and copying it or not is a byte difference
 * the two runtimes would disagree on silently.
 */
function rglobAllFiles(root, out = []) {
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    if (isDir(full)) rglobAllFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** `p.relative_to(base).as_posix()`. */
function relPosix(base, p) {
  return path.relative(base, p).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Version identity
// ---------------------------------------------------------------------------

/**
 * `_build_render.source_fingerprint`.
 *
 * Sorted by the ROOT-relative POSIX path as a plain string — NOT `comparePaths`. Python
 * sorts by an explicit `key=` here rather than by `Path` objects, so this one sort is
 * case-SENSITIVE on every platform while `sorted(SRC.rglob("*"))` in `render_all` is not.
 * Two sorts of the same files, two different orders, and only one of them is observable
 * in the output; reproducing the wrong one changes the fingerprint of every install.
 */
export function sourceFingerprint(cfg) {
  const h = createHash('sha256');
  const files = [];
  for (const r of [cfg.src, cfg.themes, cfg.pluginSrc, cfg.workflowSrc]) {
    if (isDir(r)) files.push(...rglobFiles(r));
  }
  const keyed = files.map((p) => [relPosix(cfg.root, p), p]);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [rel, p] of keyed) {
    h.update(Buffer.from(`${rel}\0`, 'utf8'));
    h.update(readFileSync(p));
    h.update(Buffer.from([0]));
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * `_build_render.read_version` — the FINGERPRINT token, which is a different name and a
 * different value from `read_release_version` right below it. `harness version` and the
 * status panel both compare this one against `sourceFingerprint`.
 *
 * `txt.split()[0] if txt else None`: a marker that is empty or whitespace-only reads as no
 * version at all, so the caller's candidate walk carries on past it rather than stopping.
 */
export function readVersion(dir) {
  let txt;
  try {
    txt = readText(path.join(dir, VERSION_MARKER)).trim();
  } catch {
    return null;
  }
  // `str.split()` with no argument splits on runs of whitespace AND drops the leading
  // empties; `String.split(/\s+/)` does not, so an indented marker would yield ''.
  const first = txt.split(/\s+/).filter(Boolean)[0];
  return first === undefined ? null : first;
}

/** `_build_render.read_release_version`. */
function readReleaseVersion(out) {
  let txt;
  try {
    txt = readText(path.join(out, VERSION_MARKER)).trim();
  } catch {
    // Python catches OSError only. A marker that is not valid UTF-8 raises there and
    // degrades to U+FFFD here (Node's decoder substitutes rather than reporting) — the
    // same asymmetry already recorded for `agent-overrides.json`, and on no covered path.
    return null;
  }
  const m = /\[release ([^\]]+)\]/.exec(txt);
  return m ? m[1] : null;
}

/** `_build_core._parse_version_tuple`. */
function parseVersionTuple(v) {
  const parts = v.trim().split('.');
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    // `str.isdigit()`, not `Number.isInteger(+p)`: '' and '1e2' and ' 1' are all
    // non-digit to Python, and `+p` accepts every one of them.
    if (!/^[0-9]+$/.test(p)) return null;
    out.push(Number(p));
  }
  return out;
}

/**
 * `_build_core.version_is_newer` — null when either side fails to parse.
 *
 * EXPORTED FOR ITS GATE, and the argument belongs here rather than in the test. Its only
 * caller is `warnIfDowngrade`, one line down, whose whole observable behaviour is "print a
 * warning or say nothing" — so through the emit face `false` and `null` are the SAME
 * observation, and six of the nine claims this function makes are invisible. That numeric
 * comparison beats lexical (`1.10.0` > `1.9.0`), that a short tuple is zero-padded on the
 * right (`1.2` == `1.2.0`), and that an unparseable side answers `null` rather than `false`
 * are each a decision with a wrong answer that no cell and no emit can distinguish.
 *
 * Nothing else changes: it is the same function, called the same way, from the same one
 * place. See `tests/unit/lifecycle.test.mjs`.
 */
export function versionIsNewer(a, b) {
  const ta = parseVersionTuple(a);
  const tb = parseVersionTuple(b);
  if (ta === null || tb === null) return null;
  const width = Math.max(ta.length, tb.length);
  for (let i = 0; i < width; i++) {
    const x = ta[i] ?? 0;
    const y = tb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** `_build_render._warn_if_downgrade` — STDOUT, matching the Python. */
function warnIfDowngrade(cfg, out) {
  const deployed = readReleaseVersion(out);
  if (deployed === null) return;
  const current = sourceReleaseVersion(cfg);
  if (versionIsNewer(deployed, current)) {
    process.stdout.write(`[geneseed] WARN: installing older Geneseed ${current} over newer `
      + `${deployed} at ${out} — did you forget git pull?\n`);
  }
}

/** `_build_render.write_version`. */
function writeVersion(cfg, out) {
  warnIfDowngrade(cfg, out);
  const fp = sourceFingerprint(cfg);
  const release = sourceReleaseVersion(cfg);
  // `datetime.date.today().isoformat()` — the LOCAL date. `toISOString()` is UTC and
  // would stamp tomorrow's date for anyone east of Greenwich after their evening.
  //
  // No gate can catch this one, and it is recorded rather than left to be discovered:
  // both runtimes read their own clock at almost the same instant, so a UTC-vs-local
  // mutation produces identical bytes except during the hour the two dates disagree.
  // Mutating it away stays green here for a reason no cell can remove — freezing the
  // clock across a process boundary is not something the harness can do — which is
  // exactly why the choice is spelled out instead of relying on the comparison.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getDate()).padStart(2, '0')}`;
  writeText(path.join(out, VERSION_MARKER),
    `${fp} (built ${today}) [release ${release}]\n`);
  return fp;
}

// ---------------------------------------------------------------------------
// Source completeness
// ---------------------------------------------------------------------------

/** `_build_render._missing_referenced_specs` — scans the TEMPLATE, not the render. */
function missingReferencedSpecs(cfg) {
  let tmpl;
  try {
    tmpl = readText(path.join(cfg.src, 'AGENT.md.tmpl'));
  } catch {
    return [];
  }
  const missing = new Set();
  for (const [, kind, name] of tmpl.matchAll(TMPL_SPEC_RE)) {
    const dir = kind.toLowerCase();
    if (name !== '_template' && !isFile(path.join(cfg.src, dir, `${name}.md`))) {
      missing.add(`${dir}/${name}.md`);
    }
  }
  return [...missing].sort();
}

/**
 * `_build_render.assert_source_complete`.
 *
 * Python raises `SystemExit(1)` after writing to stderr. Here the message goes to the
 * captured stderr buffer and the throw carries the exit code, which the driver turns
 * back into a `SystemExit(1)` on the Python side — so the caller sees the same stream
 * bytes and the same exit status whichever runtime rendered.
 */
function assertSourceComplete(cfg, context = '') {
  const missing = missingReferencedSpecs(cfg);
  if (!missing.length) return;
  const where = context ? ` (${context})` : '';
  process.stderr.write(
    `[geneseed][E-INCOMPLETE] ✗ source is incomplete${where}: AGENT.md references `
    + `${missing.length} spec(s) with no file under src/:\n`
    + missing.map((m) => `    - ${m}\n`).join('')
    + '[geneseed] ✗ Refusing to emit — a partial source would write dead links '
    + 'and a global re-emit would delete the good copies in an existing install.\n'
    + '[geneseed] ✗ Re-sync the source (./geneseed update, or re-run the upgrade) '
    + 'and try again.\n');
  const e = new Error('source is incomplete');
  e.exitCode = 1;
  throw e;
}

// ---------------------------------------------------------------------------
// Seeded stubs — write-once, never overwrite
// ---------------------------------------------------------------------------

/** `_build_render.ensure_context_stub`. */
function ensureContextStub(out) {
  const dest = path.join(out, 'context.json');
  if (!existsSync(dest)) {
    writeText(dest, `${jsonDumpsIndent(CONTEXT_STUB, { ensureAscii: false })}\n`);
  }
}

/** `_build_render.ensure_wiki_stub` — a legacy `wiki.json` counts as present. */
function ensureWikiStub(out) {
  const dest = path.join(out, 'wiki.jsonc');
  if (!existsSync(dest) && !existsSync(path.join(out, 'wiki.json'))) writeText(dest, WIKI_STUB);
}

/** `_build_render.ensure_rules_stub`. */
function ensureRulesStub(out) {
  const dest = path.join(out, RULES_FILE);
  if (!existsSync(dest)) writeText(dest, RULES_STUB);
}

/** `_build_render.ensure_profile_stub`. */
function ensureProfileStub(out) {
  const dest = path.join(out, PROFILE_FILE);
  if (!existsSync(dest)) writeText(dest, PROFILE_STUB);
}

/**
 * `_build_render.ensure_excludes_stub` — the sovereign-repo list, seeded once and NEVER
 * overwritten. Reachable only from the Claude-shaped emits, which is why it arrived with
 * `emitClaudeRender` rather than with the bundle stubs beside it.
 */
function ensureExcludesStub(out) {
  const dest = path.join(out, EXCLUDES_FILE);
  if (!existsSync(dest)) writeText(dest, EXCLUDES_STUB);
}

/** `_build_render.ensure_bundle_gitignore`. */
function ensureBundleGitignore(out) {
  const dest = path.join(out, '.gitignore');
  if (!existsSync(dest)) writeText(dest, BUNDLE_GITIGNORE);
}

/** `_build_render.ensure_memory_index` — only inside an EXISTING store dir. */
function ensureMemoryIndex(memDir) {
  if (!isDir(memDir)) return;
  const idx = path.join(memDir, 'MEMORY.md');
  if (!existsSync(idx)) writeText(idx, '# Memory Index\n');
}

/** `_build_render.ensure_notebook_index`. */
function ensureNotebookIndex(nbDir) {
  if (!isDir(nbDir)) return;
  const idx = path.join(nbDir, 'NOTEBOOK.md');
  if (!existsSync(idx)) writeText(idx, '# Notebook Index\n');
}

// ---------------------------------------------------------------------------
// The owned-dir marker
// ---------------------------------------------------------------------------

/** `_build_render._read_prior_src_dirs` — `{}` on anything unreadable or not an object. */
function readPriorSrcDirs(out) {
  let data;
  try {
    data = parseJson(readText(path.join(out, SRC_DIRS_MARKER)));
  } catch {
    return {};
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/** `_build_render._write_src_dirs_marker` — temp + replace. */
function writeSrcDirsMarker(out, resolved) {
  const tmp = path.join(out, `${SRC_DIRS_MARKER}.tmp`);
  writeText(tmp, `${jsonDumpsIndent(resolved)}\n`);
  renameSync(tmp, path.join(out, SRC_DIRS_MARKER));
}

/**
 * The guard on the prune of a RENAMED owned dir — `build`'s one destructive path driven
 * by file content rather than by code.
 *
 * `.geneseed-srcdirs.json` is a plain file a user (or another tool) can edit, and the
 * name in it is joined onto `out` and handed to a recursive delete. `".."` would take out
 * the bundle's PARENT, an absolute path replaces `out` entirely under Python's
 * `Path.__truediv__`, and `"a/b"` reaches into nested content. Only a plain
 * single-segment name resolving directly under `out` is ever deleted.
 */
function safePriorDirName(out, priorName) {
  return typeof priorName === 'string'
    && priorName !== '.' && priorName !== '..'
    && !path.isAbsolute(priorName)
    && path.basename(priorName) === priorName
    && path.dirname(path.resolve(out, priorName)) === path.resolve(out);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

/**
 * `_build_render.build` — render the bundle into `out`.
 *
 * `out` arrives as the STRING Python already resolved, and is echoed into the progress
 * lines verbatim: Python interpolates `str(Path)`, which is backslash-separated on
 * Windows, and re-deriving it here would differ by separator in every message.
 */
/**
 * THE PHASE BOUNDARY MARKER — T8, and the whole of what this port owes
 * `tests/test_emit_phase_order.py`.
 *
 * Every emit runs its stages in one order: RENDER* → WIRE* → PRUNE → MANIFEST → VERIFY. RENDER
 * writes files Geneseed owns wholesale; WIRE reconciles files the USER co-owns (the
 * CLAUDE.md/AGENTS.md managed block, settings(.local).json, opencode.json) by reading what is
 * already there and merging into it. WIRE must precede MANIFEST because wiring is what fills the
 * `managed` record the manifest writes, and every teardown path unwires exactly what was wired.
 *
 * WHY A RUNTIME LOG AND NOT A SOURCE WALK. The reference gated this with five `ast` walks over
 * its own generator, and could, because it keeps `_claude_render` / `_claude_wire` as two
 * dispatchers and therefore two statements at every call site — a shape its own docstring calls
 * "not incidental, it is what leaves this walker something to check". THIS PORT DOES NOT HAVE
 * THAT SHAPE: `claudeWire` is a real function but the two OpenCode emits inline their merge
 * (`emitOpencodeRender`, `emitOpencodeGlobalRender`), and PRUNE/MANIFEST/VERIFY are not in this
 * module at all — they are in `bin/geneseed.mjs`'s driver bodies. A walker would have to span two
 * files and would still be reading source rather than watching a run.
 *
 * So the order is made OBSERVABLE instead, which is strictly the better gate: it reports what
 * actually executed, in the order it executed, including the branch a given host took.
 *
 * ⚠ BEHIND AN ENV VAR THE THREE REPLAYERS DO NOT SET, and that is the entire safety argument.
 * `cellEnv` clears every `GENESEED_*` knob by prefix, so no recorded cell can turn this on and
 * the emit corpus cannot move by one byte. It writes to STDERR, never stdout: stdout is the
 * decision channel every Geneseed hook signals through, and a stray byte there turns a blocking
 * gate into a silently permissive one.
 *
 * Read at CALL time, not at import, so one process can drive several emits under it.
 */
export function phaseLog(phase) {
  if (!process.env.GENESEED_PHASE_LOG) return;
  process.stderr.write(`[geneseed:phase] ${phase}\n`);
}

export function build(cfg, themeName, out, { footprint = 'full', nativeCatalog = false } = {}) {
  phaseLog('RENDER');
  const { theme, items } = renderAll(cfg, themeName, { footprint, nativeCatalog });
  assertSourceComplete(cfg, `theme '${themeName}'`);
  mkdirSync(out, { recursive: true });

  // Wipe the owned dirs ONLY inside an established bundle: a first render into an
  // arbitrary repo (`--out .`) must never delete an agents/ or skills/ the USER owns.
  const isBundle = isFile(path.join(out, '.geneseed-theme')) || isFile(path.join(out, VERSION_MARKER));
  const priorSrcDirs = isBundle ? readPriorSrcDirs(out) : {};
  const resolvedSrcDirs = {};
  for (const srcDir of OWNED_SRC_DIRS) {
    // `theme.get(token, srcDir)` — `??` agrees with it except for an explicit JSON null,
    // where Python would go on to join `None` onto a path and raise. No theme has one.
    const dirname = theme[SRC_DIR_TOKENS[srcDir]] ?? srcDir;
    resolvedSrcDirs[srcDir] = dirname;
    const managed = path.join(out, dirname);

    // `pyTruthy`, not `priorName &&`: the marker is user-editable JSON, and Python's
    // `if prior_name` is false for `[]`, `{}` and `0` where JS's is true for the first
    // two. Getting that wrong warns about a value Python skips in silence — a stderr
    // divergence reachable only from a hand-edited file, which is the one place nobody
    // would look for it.
    const priorName = priorSrcDirs[srcDir];
    if (isBundle && pyTruthy(priorName) && priorName !== dirname) {
      if (safePriorDirName(out, priorName)) {
        const stale = path.join(out, priorName);
        if (isDir(stale)) rmSync(stale, { recursive: true, force: true });
      } else {
        process.stderr.write('[geneseed] WARN: ignoring suspicious prior dir name '
          + `${pyAscii(priorName)} recorded in ${SRC_DIRS_MARKER} - not pruned.\n`);
      }
    }

    if (!isDir(managed)) continue;
    if (isBundle) {
      rmSync(managed, { recursive: true, force: true });
    } else {
      // STDOUT, and ASCII-only: this print crashed with UnicodeEncodeError on a cp1252
      // Windows console when it carried a warning-sign emoji.
      process.stdout.write(`[geneseed] WARN: ${managed} already exists and ${out} is not a `
        + 'Geneseed bundle — keeping it; rendered files merge into it.\n');
    }
  }

  const nbDirname = theme[SRC_DIR_TOKENS.notebook] ?? 'notebook';
  for (const { rel, text, src } of items) {
    const dest = path.join(out, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    // The notebook is the agent's sovereign space: seeded files are written once and
    // never re-emitted, so the agent may rewrite its own rules. Only `.gitignore` is
    // re-asserted — the one law it cannot lift.
    const parts = rel.split('/');
    if (parts[0] === nbDirname && path.basename(rel) !== '.gitignore' && existsSync(dest)) {
      continue;
    }
    if (text !== null) writeText(dest, text);
    else copyFile(src, dest);
  }

  writeText(path.join(out, '.geneseed-theme'), `${themeName}\n`);
  writeVersion(cfg, out);
  writeSrcDirsMarker(out, resolvedSrcDirs);
  ensureContextStub(out);
  ensureWikiStub(out);
  ensureRulesStub(out);
  ensureProfileStub(out);
  ensureBundleGitignore(out);
  ensureMemoryIndex(path.join(out, theme[SRC_DIR_TOKENS.memory] ?? 'memory'));
  ensureNotebookIndex(path.join(out, theme[SRC_DIR_TOKENS.notebook] ?? 'notebook'));
  process.stdout.write(`[geneseed] built theme '${themeName}' -> ${out} (${items.length} files)\n`);
}

// ---------------------------------------------------------------------------
// emit_opencode — the RENDER stage only
// ---------------------------------------------------------------------------

/**
 * `_build_emit._strip_capability_links` — `re.sub(r"\1")`, so the pattern needs `g`.
 *
 * Exported for `js/doctor.mjs`: `_rendered_problems` applies the same de-linking before
 * comparing an OpenCode bundle's AGENT.md against a fresh render, because the emit puts
 * that difference back by design and a check that did not would report the file stale on
 * every run forever.
 */
export function stripCapabilityLinks(cfg, text) {
  const re = cfg.capabilityLinkRe
    ? new RegExp(cfg.capabilityLinkRe, 'g')
    : CAPABILITY_LINK_RE;
  return text.replace(re, '$1');
}

/**
 * The RENDER half of `_build_emit.emit_opencode`: everything up to (not including) the
 * `_merge_opencode_json` call. WIRE, PRUNE and MANIFEST stay in Python.
 *
 * `oldOwned` and `manifestExisted` arrive in the job rather than being read here. The
 * manifest is Python's stage — it writes it, prunes against it, and now reads it too, so
 * there is one owner of the file instead of two processes racing to interpret it.
 *
 * `nativeCatalog` likewise arrives decided. It is `HOSTS['opencode']['native_catalog']`,
 * and the HOSTS registry stays Python this phase; passing the decision keeps the registry
 * in exactly one place rather than duplicating it for one boolean.
 */
export function emitOpencodeRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: _theme, out, root, footprint, nativeCatalog, oldOwned, manifestExisted, agentPath,
  } = job;
  const oc = path.join(root, '.opencode');

  build(cfg, _theme, out, { footprint, nativeCatalog });

  // OpenCode loads agents/skills natively, so strip AGENT.md's per-row spec links to
  // plain names (the portable build keeps them). A deliberate de-link, not a fix.
  const agentMd = path.join(out, 'AGENT.md');
  if (isFile(agentMd)) writeText(agentMd, stripCapabilityLinks(cfg, readText(agentMd)));

  const owned = [];
  const { theme, items } = renderAll(cfg, _theme);

  ensureAgentOverridesStub(cfg, out);
  const overrides = loadAgentOverrides(out);

  const { nAgents, nSkills, written } = writeNativeLayer(
    items, path.join(oc, 'agents'), path.join(oc, 'skills'), overrides,
    { host: 'opencode', oldOwned, cfg: oc, manifestExisted, theme, src: cfg.src });
  for (const p of written) owned.push(relPosix(oc, p));

  const primary = writePrimaryAgent(cfg, path.join(oc, 'agents'), overrides);
  if (primary) owned.push(relPosix(oc, primary));

  const commands = writeCommandLayer(cfg, items, path.join(oc, 'command'));
  commands.push(writePonytailCommand(path.join(oc, 'command')));   // always-on /ponytail
  for (const p of commands) owned.push(relPosix(oc, p));

  owned.push(relPosix(oc, writeTheme(path.join(oc, 'themes'), _theme, theme)));
  for (const p of writeColorThemes(cfg, path.join(oc, 'themes'))) owned.push(relPosix(oc, p));

  const nPlugins = copyPlugins(cfg, path.join(oc, 'plugins'), owned);
  const nWorkflows = copyWorkflows(cfg, path.join(oc, 'workflows'), owned);

  // WIRE — the one file of this emit the user co-owns. `agentPath` arrives decided
  // (`_rel_under` is the Python side by design), and only the BASENAME is consumed
  // downstream: `opencode.json`, or the `.jsonc` sibling when that is what is on disk.
  phaseLog('WIRE');
  const cfgName = path.basename(mergeOpencodeJson(path.join(root, 'opencode.json'), agentPath));

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands: commands.length, primary: !!primary,
    },
    cfgName,
  };
}

// ---------------------------------------------------------------------------
// The global-store helpers, shared by the `opencode-global` and `claude` jobs
// ---------------------------------------------------------------------------

/**
 * `_build_global._global_memory` — ensure `<cfg>/memory` exists, without ever touching a
 * store that already holds something.
 *
 * The three outcomes are the returned status string, which the emit prints, so they are
 * compared through stdout as well as through the tree. Python's `theme` parameter is
 * dropped: the store dir is ALWAYS the classic English `memory/`, never themed (the
 * OpenCode config dir uses fixed names), so the argument was never read.
 *
 * The migration branch copies arbitrary USER files out of a legacy bundle, which is the
 * reason this is not a plain translation: everything it touches is the user's, and the
 * only thing keeping it safe is that it runs at all only when the destination is empty.
 */
function globalMemory(cfgDir, items, legacy, srcRoot) {
  const memName = 'memory';
  const memDir = path.join(cfgDir, memName);
  if (isDir(memDir) && readdirSync(memDir).length) return `kept ${memName}/`;
  mkdirSync(memDir, { recursive: true });
  if (legacy) {
    // `dict.fromkeys([mem_name, "memory", "anamnesis"])` — de-duplicated, order kept.
    // `mem_name` is the literal 'memory' and the Python docstring beside it says the
    // store name is NEVER themed, so the first two entries always collapse and
    // `anamnesis` — an older themed install's name — is the only live alias. The dedupe
    // is what keeps the duplicate harmless rather than copying the same dir twice.
    for (const nm of [...new Set([memName, 'memory', 'anamnesis'])]) {
      const src = path.join(legacy, nm);
      if (isDir(src) && readdirSync(src).length) {
        for (const f of rglobAllFiles(src)) {
          const dest = path.join(memDir, path.relative(src, f));
          mkdirSync(path.dirname(dest), { recursive: true });
          copyFile(f, dest);
        }
        return `migrated ${nm}/ -> ${memName}/`;
      }
    }
  }
  for (const { text, src } of items) {
    const sp = relPosix(srcRoot, src).split('/');
    if (sp[0] === 'memory' && sp.length > 1) {
      // `destRel`, because this seeds from the SOURCE path and not from the item's `rel`
      // (which is themed, and `memory/` never is). Without it the store would be seeded
      // with the on-disk name `gitignore` — see `js/render.mjs`'s `destRel`.
      const dest = path.join(memDir, destRel(path.join(...sp.slice(1))));
      mkdirSync(path.dirname(dest), { recursive: true });
      if (text !== null) writeText(dest, text);
      else copyFile(src, dest);
    }
  }
  return `seeded ${memName}/`;
}

/** `_build_global._global_notebook` — the same shape, with no `anamnesis` alias. */
function globalNotebook(cfgDir, items, legacy, srcRoot) {
  const nbName = 'notebook';
  const nbDir = path.join(cfgDir, nbName);
  if (isDir(nbDir) && readdirSync(nbDir).length) return `kept ${nbName}/`;
  mkdirSync(nbDir, { recursive: true });
  if (legacy) {
    const src = path.join(legacy, nbName);
    if (isDir(src) && readdirSync(src).length) {
      for (const f of rglobAllFiles(src)) {
        const dest = path.join(nbDir, path.relative(src, f));
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFile(f, dest);
      }
      return `migrated ${nbName}/`;
    }
  }
  for (const { text, src } of items) {
    const sp = relPosix(srcRoot, src).split('/');
    if (sp[0] === nbName && sp.length > 1) {
      // `destRel` — same reason as `globalMemory` above.
      const dest = path.join(nbDir, destRel(path.join(...sp.slice(1))));
      mkdirSync(path.dirname(dest), { recursive: true });
      if (text !== null) writeText(dest, text);
      else copyFile(src, dest);
    }
  }
  return `seeded ${nbName}/`;
}

/**
 * `_build_global._ship_lean_laws`.
 *
 * Historically the one RENDER that ran AFTER a WIRE, which is why the phase-order
 * normalisation had to move it before the seam could be cut. Re-derived rather than
 * trusted: its inputs are `items` and `theme` (both from `render_all`) and its only
 * output besides the files is what it APPENDS to `owned` — which travels back in the
 * payload for the manifest and the prune. It reads nothing any wiring stage writes, so
 * its new position is not merely legal, it has no dependency on the old one.
 */
function shipLeanLaws(items, theme, cfgDir, owned) {
  const lawsDir = theme.DIR_LAWS ?? 'laws';
  for (const { rel, text } of items) {
    const parts = rel.split('/');
    // `parts.length` mirrors Python's `parts and parts[0]`, where `Path("").parts` really
    // is empty. `String.split` never returns an empty array, so this half can never be
    // false here — kept for the mirror, and its mutation stays green because there is
    // nothing to detect, not because the gate cannot see it.
    if (text !== null && parts.length && parts[0] === lawsDir) {
      const dest = path.join(cfgDir, ...parts);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeText(dest, text);
      owned.push(rel);
    }
  }
}

// ---------------------------------------------------------------------------
// emit_opencode_global — the ninth, and the last emit to cross
// ---------------------------------------------------------------------------

/**
 * BOTH halves of `_build_global.emit_opencode_global`, the "everything global, zero
 * per-repo" OpenCode deployment. PRUNE and MANIFEST stay in Python; there is no VERIFY,
 * because this emit writes no settings file.
 *
 * ASSEMBLY, NOT TRANSLATION. Every unit it needs was already here — 58 of the 65 functions
 * in its Python closure, counted with `ast` rather than by name-mapping, which is how the
 * scout that produced this list first reported `_posture_body` and `_mode_body` as missing
 * when both are `registerBody` in `js/render.mjs`. What is new is the assembly and the
 * three values that had to be decided on the Python side.
 *
 * `cfgDir` IS THE FIRST OF THEM AND THE REASON THE OTHERS WERE ASKED ABOUT.
 * `_build_core._opencode_config_dir` is an `_OWNED` name — the suite and `harness diff`
 * both redirect it at a sandbox — so resolving it here would render 135 files into the
 * developer's real `~/.config/opencode`. Python's entry point resolves it once, before
 * anything else, and sends the answer. Fourth phase running (`STRUCTURE` at P2d,
 * `capabilityLinkRe` at P2e, `_PREAMBLE_CONFIG_DIR` at P3b): send the decision, never the
 * resolver.
 *
 * `out` IS NOT THE TARGET, and with the default nobody can tell. `emit_opencode_global`
 * writes into `<cfg>` and takes `out` ONLY as the legacy bundle to migrate a memory or
 * notebook store from; the CLI's `--out` defaults to a directory this emit never writes a
 * byte into. A port that derived the legacy source from `<cfg>` would pass every cell that
 * leaves them coincident — the `claude/bundle-in-subfolder` finding at a third call site.
 *
 * `agentPath` travels for the same reason `emitOpencodeRender`'s does: it is WIRE's one
 * input, and `Path.as_posix()` is the Python side's spelling of it.
 */
export function emitOpencodeGlobalRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: themeName, cfgDir, out, footprint, nativeCatalog, oldOwned, agentPath,
  } = job;

  // No `lawsPrefix`: the standalone laws dir sits beside AGENT.md in <cfg>, so the lean
  // pointer's relative `laws/universal.md` resolves with no prefix.
  const { theme, items } = renderAll(cfg, themeName, { footprint, nativeCatalog });
  assertSourceComplete(cfg, 'opencode-global');
  mkdirSync(cfgDir, { recursive: true });

  const owned = [];
  const agentText = items.find((i) => i.rel === 'AGENT.md' && i.text !== null)?.text ?? null;
  if (agentText !== null) {
    // OpenCode loads agents/skills natively, so drop AGENT.md's per-row spec links to
    // plain names. Memory links stay RELATIVE: in the global layout AGENT.md and the
    // store are siblings, so `memory/` resolves from AGENT.md's own location and stays
    // hermetic — no absolute path a doctor check would flag as an escape.
    writeText(path.join(cfgDir, 'AGENT.md'), stripCapabilityLinks(cfg, agentText));
    owned.push('AGENT.md');
  }

  ensureAgentOverridesStub(cfg, cfgDir);
  const overrides = loadAgentOverrides(cfgDir);

  // `manifestExisted` is deliberately not passed — the Python does not pass it either, so
  // the pre-manifest header line is unreachable from this emit on both sides.
  const { nAgents, nSkills, written } = writeNativeLayer(
    items, path.join(cfgDir, 'agents'), path.join(cfgDir, 'skills'), overrides,
    { host: 'opencode', oldOwned, cfg: cfgDir, theme, src: cfg.src });
  for (const p of written) owned.push(relPosix(cfgDir, p));

  const primary = writePrimaryAgent(cfg, path.join(cfgDir, 'agents'), overrides);
  if (primary) owned.push(relPosix(cfgDir, primary));

  const commands = writeCommandLayer(cfg, items, path.join(cfgDir, 'command'));
  commands.push(writePonytailCommand(path.join(cfgDir, 'command')));   // always-on /ponytail
  for (const p of commands) owned.push(relPosix(cfgDir, p));

  owned.push(relPosix(cfgDir, writeTheme(path.join(cfgDir, 'themes'), themeName, theme)));
  for (const p of writeColorThemes(cfg, path.join(cfgDir, 'themes'))) {
    owned.push(relPosix(cfgDir, p));
  }

  const nPlugins = copyPlugins(cfg, path.join(cfgDir, 'plugins'), owned);
  const nWorkflows = copyWorkflows(cfg, path.join(cfgDir, 'workflows'), owned);

  const memStatus = globalMemory(cfgDir, items, out, cfg.src);
  ensureMemoryIndex(path.join(cfgDir, 'memory'));
  const nbStatus = globalNotebook(cfgDir, items, out, cfg.src);
  ensureNotebookIndex(path.join(cfgDir, 'notebook'));
  ensureWikiStub(cfgDir);
  ensureRulesStub(cfgDir);
  ensureProfileStub(cfgDir);
  ensureExcludesStub(cfgDir);

  writeVersion(cfg, cfgDir);
  owned.push(VERSION_MARKER);

  if (footprint === 'lean') shipLeanLaws(items, theme, cfgDir, owned);

  // WIRE — the one file of this emit the user co-owns, and the last render is now behind
  // us. Inlined the way `emitOpencodeRender`'s is (one call, the same merge, the same
  // file name), while the Python side keeps it a separate `_opencode_global_wire_py`:
  // that split is what `tests/test_emit_phase_order.py` walks, and it walks the Python.
  phaseLog('WIRE');
  const cfgName = path.basename(mergeOpencodeJson(path.join(cfgDir, 'opencode.json'),
    agentPath));

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands: commands.length, primary: !!primary,
    },
    memStatus,
    nbStatus,
    cfgName,
  };
}

// ---------------------------------------------------------------------------
// _emit_claude_core — both halves
// ---------------------------------------------------------------------------

/**
 * The RENDER half of `_build_global._emit_claude_core`: everything up to (not including)
 * the CLAUDE.md managed-block merge. WIRE, PRUNE, MANIFEST and VERIFY stay in Python.
 *
 * Six emits route through here — claude, bob and copilot at both scopes — so this one
 * job is what puts two thirds of the matrix on the seam.
 *
 * `claudeMdText` is the payload's one item that is not a file this process wrote. WIRE
 * needs the managed block's text, and that text is a RENDER (`prefixedAgentText`
 * re-renders AGENT.md with every store dir prefixed), so it is computed here and merged
 * there. `emitOpencodeRender` needed nothing of the kind — its wired file is derived from
 * a path, not from a render.
 */
export function emitClaudeRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: themeName, cfgDir, claudeMd, scope, out, footprint, host, nativeCatalog,
    oldOwned,
  } = job;

  // `os.path.relpath(cfg, claude_md.parent)` — note the reversed argument order, and
  // that Python answers '.' for an identical pair where `path.relative` answers ''.
  const relCfg = path.relative(path.dirname(claudeMd), cfgDir).split(path.sep).join('/')
    || '.';
  const lawsPrefix = relCfg === '.' ? '' : `${relCfg}/`;
  const { theme, items } = renderAll(cfg, themeName, { footprint, lawsPrefix, nativeCatalog });
  assertSourceComplete(cfg, `claude-${scope}`);
  mkdirSync(cfgDir, { recursive: true });

  /** `_emit_claude_core._prefixed_agent_text`. */
  const prefixedAgentText = (prefix) => {
    const tmplItem = items.find((i) => i.rel === 'AGENT.md');
    if (tmplItem === undefined) return null;
    // Deliberately NOT the same lookup as `agentText` below: that one skips an
    // AGENT.md whose text is null, this one does not. Unreachable today (`.md` is a
    // text suffix, so the render is never null) and reproduced anyway, because the two
    // spellings sit four lines apart in the Python and only one of them filters.
    //
    // The fast path itself is byte-inert, measured: removing it re-renders with a theme
    // whose DIR_* tokens gained an EMPTY prefix and with the same lawsPrefix, so it
    // produces exactly the item's own text. The mutation stays green, and that is
    // "nothing to detect" rather than "the gate cannot see it" — recorded the way
    // `themed_rel` and `lstripNewlines` are, so the two verdicts stay distinguishable.
    if (!prefix) return tmplItem.text;
    const ptheme = { ...theme };
    for (const tok of ['DIR_LAWS', 'DIR_AGENTS', 'DIR_SKILLS', 'DIR_MEMORY', 'DIR_NOTEBOOK']) {
      ptheme[tok] = prefix + (ptheme[tok] ?? tok.split('_').slice(1).join('_').toLowerCase());
    }
    // Same catalogue decision as the renderAll above — a re-render that forgot it would
    // quietly put the stripped tables back.
    return renderFile(cfg, tmplItem.src, ptheme, footprint, '', new Set(), nativeCatalog);
  };

  const owned = [];
  const agentText = items.find((i) => i.rel === 'AGENT.md' && i.text !== null)?.text ?? null;
  const isBob = host === 'bob';
  const isCopilot = host === 'copilot';

  // Bob's always-injected channel is the rules folder. At GLOBAL scope rules/geneseed.md
  // IS the preamble (a global ~/.bob/AGENTS.md is not auto-loaded), and its pointers need
  // a `../` prefix because it sits one level below the stores; at PROJECT scope it is the
  // slim shadow stub whose only job is to have the same filename.
  if (isBob && agentText !== null) {
    const rulesMd = path.join(cfgDir, 'rules', 'geneseed.md');
    mkdirSync(path.dirname(rulesMd), { recursive: true });
    writeText(rulesMd, scope === 'project' ? BOB_RULES_STUB
      : stripCapabilityLinks(cfg, prefixedAgentText('../') || agentText));
    owned.push('rules/geneseed.md');
  }

  ensureAgentOverridesStub(cfg, cfgDir);
  // Bob's agents/skills use the Claude dialect verbatim; Copilot has its own frontmatter.
  // `manifestExisted` is deliberately not passed: the Python does not pass it either, so
  // the pre-manifest header line is unreachable from this emit on both sides.
  const { nAgents, nSkills, written } = writeNativeLayer(
    items, path.join(cfgDir, 'agents'), path.join(cfgDir, 'skills'),
    loadAgentOverrides(cfgDir),
    { host: isCopilot ? 'copilot' : 'claude', oldOwned, cfg: cfgDir, src: cfg.src });
  for (const p of written) owned.push(relPosix(cfgDir, p));

  const memStatus = globalMemory(cfgDir, items, out, cfg.src);
  ensureMemoryIndex(path.join(cfgDir, 'memory'));
  const nbStatus = globalNotebook(cfgDir, items, out, cfg.src);
  ensureNotebookIndex(path.join(cfgDir, 'notebook'));
  ensureWikiStub(cfgDir);
  ensureRulesStub(cfgDir);
  ensureProfileStub(cfgDir);
  ensureExcludesStub(cfgDir);

  // Project hygiene, claim-on-create: an existing (possibly user-authored) .gitignore is
  // never rewritten, but one we created stays owned across re-emits.
  if (scope === 'project') {
    const gi = path.join(cfgDir, '.gitignore');
    const giLines = (host === 'claude' ? ['settings.local.json'] : [])
      .concat(['wiki.jsonc', 'agent-overrides.json']);
    if (!existsSync(gi)) {
      writeText(gi, `${giLines.join('\n')}\n`);
      owned.push('.gitignore');
    } else if (oldOwned.includes('.gitignore')) {
      owned.push('.gitignore');
    }
  }

  writeVersion(cfg, cfgDir);
  owned.push(VERSION_MARKER);

  if (footprint === 'lean') shipLeanLaws(items, theme, cfgDir, owned);

  // The last render of the emit, and the only one whose product is not written here.
  // Bob at GLOBAL scope gets no managed block at all, so nothing is rendered for it —
  // the condition is the merge's, kept here so RENDER produces exactly what WIRE
  // consumes and no more.
  let claudeMdText = null;
  if (agentText !== null && !(isBob && scope === 'global')) {
    claudeMdText = stripCapabilityLinks(cfg, prefixedAgentText(lawsPrefix) || agentText);
  }

  // WIRE — see `claudeWire` below. One child per emit, so the two halves are two
  // functions rather than two spawns; the seam between them is a call, not a process.
  const managed = claudeWire(job, claudeMdText, agentText !== null);

  return {
    owned,
    stats: { nAgents, nSkills },
    memStatus,
    nbStatus,
    hasAgentText: agentText !== null,
    claudeMdText,
    managed,
  };
}

/**
 * `_build_global._claude_wire_py` — the files the Claude-shaped emits do NOT own: the
 * CLAUDE.md/AGENTS.md managed block and settings(.local).json.
 *
 * Everything the render half wrote, it wrote wholesale. Everything here reconciles
 * Geneseed's claim with content it did not write. The return value is `managed`, the claim
 * set Python records in the manifest so every teardown path unwires exactly what was wired
 * — which is why WIRE must precede MANIFEST, and why `managed` travels back rather than
 * being recomputed.
 *
 * `preambleExclude` arrives decided and is NOT derived here. Python computes it from
 * `_PREAMBLE_CONFIG_DIR`, which resolves through `_build_core._claude_config_dir` — an
 * `_OWNED` name precisely because the suite redirects it at a sandbox. Resolving `~/.claude`
 * on this side would write the developer's REAL CLAUDE.md path into a test's exclude list
 * and suppress it. Third phase running that a name had to travel rather than be re-derived
 * (`STRUCTURE` at P2d, `capabilityLinkRe` at P2e); this one edits a file the user co-owns.
 *
 * `GENESEED_STACK_GLOBAL` is read from the environment on BOTH sides — the child inherits
 * `process.env`, so the opt-out reaches here without travelling in the job. `pyTruthy` is
 * not needed for it: Python tests `os.environ.get(...)` for truthiness and an env var is
 * always a string, so `''` is the only falsy value either language sees.
 */
function claudeWire(job, claudeMdText, hasAgentText) {
  phaseLog('WIRE');
  const { cfgDir, claudeMd, scope, host, oldManaged, preambleExclude, hookOpts } = job;
  const old = oldManaged && typeof oldManaged === 'object' && !Array.isArray(oldManaged)
    ? oldManaged : {};
  const isBob = host === 'bob';
  const isCopilot = host === 'copilot';
  const managed = {};

  // CLAUDE.md — Claude auto-loads it by location; merge as a delimited block so any user
  // prose around it survives. `claudeMdText` is the render half's product; it is null
  // exactly when no block is to be written.
  // Exception — Bob GLOBAL: Bob never auto-loads a global ~/.bob/AGENTS.md, so a global
  // copy is pure disk weight; none is written, and a re-emit self-heals the one an older
  // install carries.
  if (claudeMdText !== null) {
    managedBlockWrite(claudeMd, claudeMdText);
    // No sticky "whole" flag: teardown always excises the block and deletes the file only
    // when nothing else remains — a whole-file delete would eat prose the user added AFTER
    // Geneseed created the file.
    //
    // `os.path.relpath(claude_md, cfg).replace(os.sep, '/')`. Python answers '.' where
    // `path.relative` answers '' for an identical pair, the same guard `lawsPrefix` needs
    // above — unreachable here (CLAUDE.md is a file, cfgDir a directory, so the pair is
    // never identical) and spelled anyway, because the two call sites are 400 lines apart
    // and only one of them is obviously safe.
    const rel = path.relative(cfgDir, claudeMd).split(path.sep).join('/') || '.';
    managed.claude_md = { rel };
  } else if (isBob && scope === 'global' && pyTruthy(get(old, 'claude_md'))) {
    const oldCm = isDict(get(old, 'claude_md')) ? get(old, 'claude_md') : {};
    // `.resolve()` on the Python side; `path.resolve` is its counterpart and both are
    // applied to a path already built from an absolute cfgDir.
    const victim = path.resolve(cfgDir, get(oldCm, 'rel') || path.basename(claudeMd));
    managedBlockRemove(victim);
  }

  // Hooks embed machine-absolute paths. At PROJECT scope for Claude they go into
  // settings.local.json — the personal, untracked file — never the team-shared
  // settings.json, which would hand every teammate failing hooks pointing at this machine's
  // python. (Bob documents no local variant, so it keeps settings.json.) Copilot has NO
  // settings.json and no hook mechanism at all, so the whole stage is skipped: nothing
  // written, no settings_* keys recorded for the lifecycle to unwire.
  if (!isCopilot) {
    const settingsName = scope === 'project' && !isBob ? 'settings.local.json' : 'settings.json';
    const settingsPath = path.join(cfgDir, settingsName);
    managed.settings_file = settingsName;
    // Migration: an older install wired hooks/excludes into a different file — unwire the
    // recorded claims there, or they linger (and run) forever.
    const oldSf = get(old, 'settings_file') || 'settings.json';
    if (oldSf !== settingsName) {
      unwireClaudeSettings(path.join(cfgDir, oldSf), get(old, 'settings_hooks') || []);
      unwireClaudeExcludes(path.join(cfgDir, oldSf), get(old, 'settings_excludes') || []);
    }
    // The merge prunes recorded groups that are no longer canonical and returns the
    // COMPLETE current claim set — store it as-is; unioning with prior would resurrect the
    // stale claims.
    const [, managedHooks] = mergeClaudeSettings(
      settingsPath, scope, oldSf === settingsName ? get(old, 'settings_hooks') : null, hookOpts,
    );
    managed.settings_hooks = managedHooks;

    // Project-bypasses-global (Claude only): a PROJECT install suppresses the GLOBAL
    // ~/.claude/CLAUDE.md while cwd is this repo, via Claude's native claudeMdExcludes.
    // Written only when this run actually emitted the project's own preamble (never
    // suppress with no replacement); GENESEED_STACK_GLOBAL=1 opts out, and a re-emit with
    // it set strips a prior exclude. Bob never gets one: its bypass is the same-named
    // workspace rules file.
    const priorRaw = get(old, 'settings_excludes');
    const priorExcl = Array.isArray(priorRaw) ? priorRaw : [];
    if (scope === 'project' && hasAgentText && preambleExclude) {
      const wantExcl = [preambleExclude];
      if (process.env.GENESEED_STACK_GLOBAL) {
        unwireClaudeExcludes(settingsPath, wantExcl);
        managed.settings_excludes = [];
      } else {
        const addedExcl = wireClaudeExcludes(settingsPath, wantExcl);
        // Claim only what Geneseed itself wired (prior + newly added) — folding `wantExcl`
        // in unconditionally would claim a user's own pre-existing exclude, and uninstall
        // would then strip it. `sorted(set(a) | set(b))` — Python sorts strings by code
        // point and so does the default `Array.sort`, which is why no comparator is passed.
        managed.settings_excludes = [...new Set([...priorExcl, ...addedExcl])].sort();
      }
    } else if (priorExcl.length && isBob) {
      // Self-heal older Bob installs: earlier versions wrote the global AGENTS.md into
      // claudeMdExcludes here. The key is Claude-only and its Bob semantics are unknown, so
      // a re-emit removes it instead of carrying it forward.
      unwireClaudeExcludes(settingsPath, priorExcl);
    } else if (priorExcl.length) {
      managed.settings_excludes = priorExcl;
    }
  }
  return managed;
}

// ---------------------------------------------------------------------------
// The CLI — one job in, one JSON document out
// ---------------------------------------------------------------------------

const KINDS = {
  build: (cfg, job) => {
    build(cfg, job.theme, job.out,
      { footprint: job.footprint, nativeCatalog: job.nativeCatalog });
    return {};
  },
  opencode: emitOpencodeRender,
  'opencode-global': emitOpencodeGlobalRender,
  claude: emitClaudeRender,
};

function main(argv) {
  const captured = { stdout: '', stderr: '' };
  const realWrite = process.stdout.write.bind(process.stdout);

  // Both streams become buffers for the whole run. See the module header: this is what
  // makes "the protocol owns stdout" a structural property rather than a convention
  // every future contributor has to remember.
  const sink = (key) => (chunk, encoding, cb) => {
    captured[key] += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const done = typeof encoding === 'function' ? encoding : cb;
    if (done) done();
    return true;
  };
  process.stdout.write = sink('stdout');
  process.stderr.write = sink('stderr');

  let payload;
  try {
    const job = parseJson(readFileSync(argv[0], 'utf8'));
    const run = KINDS[job.kind];
    if (!run) throw new Error(`unknown job kind ${JSON.stringify(job.kind)}`);
    payload = { ok: true, ...run(job.cfg, job) };
  } catch (e) {
    // `exitCode` marks a deliberate refusal (assertSourceComplete) whose message is
    // already on the captured stderr; anything else is a crash and carries its stack, so
    // a port bug surfaces as a diagnosable failure instead of a truncated tree.
    payload = e && e.exitCode
      ? { ok: false, exit: e.exitCode }
      : { ok: false, exit: 1, error: (e && e.stack) || String(e) };
  }
  payload.stdout = captured.stdout;
  payload.stderr = captured.stderr;

  process.stdout.write = realWrite;
  realWrite(JSON.stringify(payload));
  return 0;
}

// Library AND entry point: the parity gates import `build` directly, and running `main`
// on import would eat their argv and print a payload nobody reads. `import.meta.main` is
// Node >= 24 and this machine runs v22, so the comparison is spelled out.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
