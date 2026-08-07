/**
 * The emit half, in Node — and the process boundary Python drives it across.
 *
 * `js/render.mjs` renders, `js/native.mjs` and `js/opencode.mjs` write the host-native
 * layers; this module is the piece that turns them into a bundle on disk and the CLI that
 * a `build.py` emit spawns. It is a translation of `_build_render.build` plus the RENDER
 * half of `_build_emit.emit_opencode`.
 *
 * THE HANDOFF. Python drives, one spawn per emit:
 *
 *     python build.py --emit opencode
 *       +- spawn  node js/emit.mjs <job.json>
 *       |     Node renders and writes every file Geneseed owns wholesale
 *       |     Node returns { owned, stats, stdout, stderr } as JSON on stdout
 *       +- Python  WIRE       _merge_opencode_json / _merge_claude_settings / ...
 *       +- Python  PRUNE      old_owned - owned
 *       +- Python  MANIFEST   owned + managed
 *       +- Python  VERIFY     _settings_integrity_check
 *
 * Python drives because during P2 the runtime *is* Python and calls `build.emit_*`
 * in-process from doctor, web deploy, setup and rebuild-all; Node-as-driver would wrap
 * each of those in a subprocess. The seam is designed to collapse: at P3 the driver
 * becomes `geneseed.mjs`, the spawn becomes an import, and this job object becomes the
 * function signature.
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
import { renderAll, SRC_DIR_TOKENS } from './render.mjs';
import { writeNativeLayer, loadAgentOverrides } from './native.mjs';
import {
  ensureAgentOverridesStub, writePrimaryAgent, writeCommandLayer, writePonytailCommand,
  writeTheme, writeColorThemes, copyPlugins, copyWorkflows, sourceReleaseVersion,
} from './opencode.mjs';
import {
  writeText, readText, copyFile, jsonDumpsIndent, parseJson, pyAscii, pyTruthy,
} from './lib/pyfs.mjs';

/** `_build_core.VERSION_MARKER`. */
const VERSION_MARKER = '.geneseed-version';
/** `_build_render.SRC_DIRS_MARKER`. */
const SRC_DIRS_MARKER = '.geneseed-srcdirs.json';
/** `_build_render.OWNED_SRC_DIRS` — wiped and regenerated each run. */
const OWNED_SRC_DIRS = ['laws', 'agents', 'skills'];

/** `_build_core.CAPABILITY_LINK_RE`. */
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
function sourceFingerprint(cfg) {
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

/** `_build_core.version_is_newer` — null when either side fails to parse. */
function versionIsNewer(a, b) {
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

// `ensure_excludes_stub` is deliberately absent: it is reachable only from
// `_emit_claude_core`, which is not ported yet, so it lands with its caller rather than
// as an untested export nothing drives.

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
export function build(cfg, themeName, out, { footprint = 'full', nativeCatalog = false } = {}) {
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

/** `_build_emit._strip_capability_links`. */
function stripCapabilityLinks(text) {
  return text.replace(CAPABILITY_LINK_RE, '$1');
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
  const { theme: _theme, out, root, footprint, nativeCatalog, oldOwned, manifestExisted } = job;
  const oc = path.join(root, '.opencode');

  build(cfg, _theme, out, { footprint, nativeCatalog });

  // OpenCode loads agents/skills natively, so strip AGENT.md's per-row spec links to
  // plain names (the portable build keeps them). A deliberate de-link, not a fix.
  const agentMd = path.join(out, 'AGENT.md');
  if (isFile(agentMd)) writeText(agentMd, stripCapabilityLinks(readText(agentMd)));

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

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands: commands.length, primary: !!primary,
    },
  };
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
