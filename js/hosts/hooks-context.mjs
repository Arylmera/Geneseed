/**
 * `context` — the SessionStart verb: inject the harness's session files and the repo's context
 * docs. Runs once per session, so it is loaded only when the hook entry dispatches it; see
 * `js/hosts/hooks.mjs`'s header for the contract every hook verb holds.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readText, printOut as out, printErr as err, withDiscardableStderr } from '../lib/fs.mjs';
import { readJsonc } from '../lib/json.mjs';
import { LEGACY_WIKI_SEED, WIKI_NAMES, sharedPaths } from '../lib/machine-dir.mjs';
import { normcase, toPlatformPath } from '../lib/paths.mjs';
import { relPosix } from '../lib/text.mjs';
import {
  SHARED_TIER_RE, carriersFor, gateCarrierText, globalHookStandingDown, hookProjectDir, isGlobalInstall, resolvePath, sovereignBypass,
} from './hosts.mjs';
import { isFile, isDir, sortPaths, listDir } from './hooks-prims.mjs';
import { gitRootOf } from './gitref.mjs';
import { doneLine } from './done-checks.mjs';
import { ownershipLine } from './ownership-gate.mjs';

/**
 * `str(OSError)` — `[Errno N] strerror: 'filename'`, with the filename REPR'd.
 *
 * This is a compared string, not a log line: `cmd_context` prints it verbatim when an
 * eager entry is missing, so `ENOENT: no such file or directory, open '…'` (Node's
 * wording, Node's quoting, no errno) is a whole-line difference in that cell. Only the
 * codes a verb here can actually raise are mapped; anything else falls back to Node's
 * message, which is at least honest about being different.
 */
const _ERRNO = {
  ENOENT: [2, 'No such file or directory'],
  EACCES: [13, 'Permission denied'],
  EISDIR: [21, 'Is a directory'],
  ENOTDIR: [20, 'Not a directory'],
  EPERM: [1, 'Operation not permitted'],
};

function asOsError(e, filename) {
  const hit = _ERRNO[e && e.code];
  if (!hit) return String((e && e.message) || e);
  // The `[Errno N] text: 'file'` shape this hook has always printed: the filename is quoted,
  // so a Windows path comes out with its backslashes doubled.
  return `[Errno ${hit[0]}] ${hit[1]}: ${JSON.stringify(filename).replace(/^"|"$/g, "'")
    .replace(/\\"/g, '"')}`;
}

/**
 * `fnmatch.fnmatch(name, pattern)` — case-folded on Windows on BOTH sides, and `*` matches
 * a separator (it is shell-glob semantics, not path-glob: `docs/*.md` really does select
 * `docs/nested/deep.md`, in both implementations).
 */
function fnmatch(name, pattern) {
  return fnTranslate(normcase(pattern)).test(normcase(name));
}

function fnTranslate(pat) {
  let out = '';
  for (let i = 0; i < pat.length; i += 1) {
    const c = pat[i];
    if (c === '*') { out += '[\\s\\S]*'; continue; }
    if (c === '?') { out += '[\\s\\S]'; continue; }
    if (c === '[') {
      let j = i + 1;
      if (pat[j] === '!') j += 1;
      if (pat[j] === ']') j += 1;
      while (j < pat.length && pat[j] !== ']') j += 1;
      // An unterminated `[` is a LITERAL bracket (fnmatch semantics), not an error.
      if (j >= pat.length) { out += '\\['; continue; }
      let body = pat.slice(i + 1, j).replaceAll('\\', '\\\\');
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body}]`;
      i = j;
      continue;
    }
    out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^(?:${out})$`);
}

// Kept in step with adapters/opencode/plugins/geneseed-context.js.
const EAGER_ROOT = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', '.cursorrules',
  'README.md', 'README.adoc', 'CONTRIBUTING.md', 'CONTRIBUTING.adoc', 'user-rules.md', 'PROFILE.md'];
// Project docs are Markdown or AsciiDoc: the document-project skill writes AsciiDoc when the
// user asks for it or the docs already are, so a loader blind to `.adoc` would hide those docs.
// Agent-runtime files (AGENTS.md, CLAUDE.md, specs) stay Markdown whatever the project uses.
const DOC_EXT = new Set(['.md', '.adoc']);
const isDoc = (name) => DOC_EXT.has(path.extname(name).toLowerCase());
const LAZY_DIRS = ['docs', 'doc', 'documentation', 'architecture', 'adr', 'ADR'];
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.next',
  'target', '.venv', '__pycache__', '.opencode', '.harness']);

// The root instruction file a host already loads by itself. Injecting it again pays the
// whole harness twice per session — and was doing exactly that until 2026-09: every hooked
// host had its own root in EAGER_ROOT. Other tools' roots stay eager (a repo carrying a
// hand-written AGENTS.md is worth showing Claude Code); only the host's OWN is dropped.
// The OpenCode context plugin carries the same rule for AGENT.md/AGENTS.md/CLAUDE.md.
// OpenClaude's root file is AGENTS.md, or CLAUDE.md when AGENTS.md is absent — resolved
// per repo in `discoverContext`, since which one it loads depends on what is on disk.
const NATIVE_ROOT = {
  claude: ['CLAUDE.md'], bob: ['AGENTS.md'],
  openclaude: ['AGENTS.md', 'CLAUDE.md'],
};
// An `@AGENTS.md` import in a CLAUDE.md: whitespace on both sides, so a `code span` is no import.
const AGENTS_IMPORT_RE = /(^|\s)@(\.\/)?AGENTS\.md(?=\s|$)/m;

/**
 * Does Claude Code load this repo's AGENTS.md by itself? Yes when CLAUDE.md imports it (fenced
 * blocks and HTML comments do not import), on any version. Yes when the repo has no CLAUDE.md, from 2.1.277 on.
 *
 * The version comes from `AI_AGENT`, which Claude Code sets for its hooks as
 * `claude-code_2-1-302_harness` (CLI) or `claude-code_2-1-317_agent` (desktop). Observed 2026-11-05,
 * and undocumented: when it is absent or reads otherwise the answer is no, and the hook keeps
 * injecting, because a duplicate costs tokens and a miss loses the doc.
 */
function claudeLoadsAgents(root) {
  let claudeMd = null;
  try { claudeMd = readText(path.join(root, 'CLAUDE.md')); } catch { /* none at the root */ }
  if (claudeMd !== null) return AGENTS_IMPORT_RE.test(claudeMd.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|<!--[\s\S]*?-->/g, ''));
  if (isFile(path.join(root, '.claude', 'CLAUDE.md'))) return false;
  const v = /^claude-code_(\d+)-(\d+)-(\d+)/.exec(process.env.AI_AGENT || '');
  if (!v) return false;
  const [major, minor, patch] = v.slice(1).map(Number);
  return (major - 2 || minor - 1 || patch - 277) >= 0;
}

// The whole payload's budget, in characters. Claude Code does not hand a hook's stdout to the
// model past roughly 10k characters: it saves the output to a file and the model sees a 2 KB
// preview, so everything after the cut is lost without a word. Observed 2026-10 (a 25.6 KB and
// a 16.5 KB SessionStart output, both persisted); the exact threshold is not documented, hence
// the margin. The old 48 KB eager budget never bound — the host's cap always cut first.
// Priority inside the budget: session files (the user's own), then eager docs (whole, or
// listed lazy), then the lazy listing, folded per directory and cut with a count. Session files
// spend in `SESSION_FILES` order, so what the budget cuts first is what comes last.
export const OUTPUT_BUDGET = 9000;
// Kept back from the eager docs so the lazy listing always has room to say what exists.
const LAZY_RESERVE = 1500;
// A directory with this many undescribed lazy files is listed once, with its count.
const LAZY_FOLD_AT = 3;
// The OpenCode plugin's vault walk bounds: `MAX_DEPTH` and `MAX_FILES_SCANNED`.
const WIKI_MAX_DEPTH = 6;
const WIKI_MAX_FILES = 2000;
// Kept back so a listing can still say what exists: from a wiki's eager notes, and at the end of
// the payload from the line per session file the budget left out.
const LIST_RESERVE = 500;
// What a line costs against the budget: its characters plus a terminator counted as two,
// because stdout goes out as \r\n on Windows — a 144-line listing overran by 137 before this.
// Multi-line text pays one more per inner line break, for the same reason.
const cost = (s) => s.length + (s.match(/\n/g) || []).length + 2;
// How a listing marks an eager file the budget kept out; `renderPayload` reads it back in a wiki.
const OVER_BUDGET = ' (eager, but over the session budget — read on demand)';

// The files the root instruction file names for session start, relative to the HARNESS dir
// (`--root`: `.claude/`, `.bob/`, a global config dir) — not to the repo root discovery walks,
// which is why none of them reached a hooked host before 2026-10. Injected here so the read does
// not depend on the model remembering it. `context.json` is not in the list: it is a manifest,
// honoured by `resolveContextSets` (the harness dir is its last candidate). The OpenCode
// context plugin carries the same list, minus the wiki it renders in a block of its own.
const SESSION_FILES = ['user-rules.md', 'PROFILE.md', 'geneseed-wiki.jsonc', 'memory/MEMORY.md',
  'notebook/NOTEBOOK.md'];
// One writer each: a non-seed host copy replaces the shared one. The others concatenate, shared
// first, so a host rule reads after the shared rule it narrows.
const WHOLE_FILES = new Set(['PROFILE.md', 'geneseed-wiki.jsonc']);
// SHA-256 of each seed body in `js/build/stubs.mjs` (`SESSION_SEEDS`), CRLF folded. A file still
// byte-identical to its seed says nothing, so it is skipped rather than injected as noise.
// Hashes, not an import: stubs.mjs pulls in the build's writers, which a session start has no
// use for. tests/unit/claude.test.mjs gates this set, and the plugin's copy, against the seeds.
const SEED_SHA256 = new Set([
  '5c2e92fb1acde041e02d9ebf158460d8ff7a07cbc2b447859631604610130721', // user-rules.md
  '29e012c3c4349ea62a9082cbd04bb25599a0ec280d62c33f6e10742809471816', // PROFILE.md
  '3a82c78ccc5d745033c16c354f5eda9d79350c704e9da8d605d380fb1e108d7a', // geneseed-wiki.jsonc
  // The wiki seed before the rename: the build renames an untouched one byte for byte.
  LEGACY_WIKI_SEED, // wiki.jsonc (legacy)
  '99c786049c260f6baf7aec68a5c0f59907861afe9b867da009440613bdddb907', // MEMORY.md
  '9acb5c9d9cb5dac572104480f05b48cc144e676869bd60e86d8a15b1f6308184', // NOTEBOOK.md
]);
export { SESSION_FILES, SEED_SHA256 };

// A topic line of the memory map (`js/hosts/memory-files.mjs` writes it) and its fact count.
const MAP_COUNT_RE = /^- \[([^\]]*)\]\(topics\/[^)]+\.md\) — (\d+) facts?$/;
// Past this many facts a topic file stops being a quick read, and the curator splits it.
const CURATE_TOPIC_MAX = 40;
const CURATE_NUDGE = `[memory] A topic holds over ${CURATE_TOPIC_MAX} facts, or facts sit in misc: offer the user `
  + 'to dispatch the memory-curator agent to merge, re-topic and archive this store.';
export { CURATE_TOPIC_MAX, CURATE_NUDGE };

/**
 * The one-line curation nudge for a memory map, or ''. Read off the map's own counts, so it
 * costs no extra file read on the hook path. Both triggers are ones a curation pass clears; a
 * store that is merely LARGE is not one, since a curated large store would be nagged forever.
 * The OpenCode context plugin carries the same rule (parity gated in tests/unit/claude.test.mjs).
 */
export function memoryNudge(map) {
  for (const line of map.split('\n')) {
    const m = MAP_COUNT_RE.exec(line.trim());
    if (m && (m[1] === 'misc' || Number(m[2]) > CURATE_TOPIC_MAX)) return CURATE_NUDGE;
  }
  return '';
}

// The one context line for a project that names no runtime; the OpenCode context plugin carries
// the same text (tests/plugins/context_done.test.mjs holds the two equal).
const FLOOR_LINE = 'Runtime floor: package.json declares no engines — name the supported runtime before you '
  + 'add a dependency or a language feature.';

/**
 * `FLOOR_LINE` when the git root's package.json is a JSON object with no `engines` field, else
 * null: no file, invalid JSON, or `engines` present (even empty). It reads the file itself:
 * `inferDoneChecks` skips that read for a project with a done list, and an install with the done
 * gate off never reaches it, so sharing it would tie this line to the done gate.
 *
 * shortcut: package.json only — pom.xml (`maven.compiler.release`), pyproject.toml
 * (`requires-python`) and go.mod (`go`) are not read. Add one when a session in such a repo adds
 * something its runtime cannot run.
 */
function runtimeFloorLine(root) {
  let pkg;
  try { pkg = JSON.parse(readText(path.join(root, 'package.json'))); } catch { return null; }
  return pkg && typeof pkg === 'object' && !Array.isArray(pkg) && pkg.engines === undefined ? FLOOR_LINE : null;
}

/** A session file's text, CRLF-folded and trimmed; null when missing, unreadable or still its seed. */
function sessionText(abs) {
  if (!isFile(abs)) return null;
  let text;
  try { text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
  if (SEED_SHA256.has(createHash('sha256').update(text).digest('hex'))) return null;
  return text.replace(/\n+$/, '');
}

/** The machine tier's copy of a session file; null for what stays per host (the notebook). */
function tierFile(rel) {
  let tier;
  try { tier = sharedPaths(); } catch { return null; }   // no home: the host layer still loads
  return {
    'user-rules.md': tier.rules,
    'PROFILE.md': tier.profile,
    'geneseed-wiki.jsonc': tier.wiki,
    'memory/MEMORY.md': path.join(tier.memory, 'MEMORY.md'),
  }[rel] ?? null;
}

/**
 * The `host` a caller outside the hook passes for an install of `host`: what its emitted command
 * says, and Claude's carries no `--host` (`claudeHookGroups`).
 */
export const emittedHost = (host) => (host === 'claude' ? null : host);

/**
 * Only a global install of THIS host reads the tier, as the OpenCode plugin's `readsTier` has it
 * (it answers for OpenCode alone). The host is the one the emitted hook passed: an emit from before
 * `--host` names none (null), and then any host's global qualifies. One that cannot tell stays on
 * its own layer.
 */
const readsTier = (hookRoot, host) => isGlobalInstall(host, hookRoot);

/**
 * Does this PROJECT install read the machine tier? Its carrier says `Shared tier: on`, and no
 * global hook is already injecting it: under `$GENESEED_STACK_GLOBAL` the global hook does not
 * stand down (`globalHookStandingDown`), so a second tier here would be a double. Without the
 * flag the global hook stands down for a wired project, and this hook is the only injector.
 * A project with the option off reads no tier, as before. `carrier` is `installCarrier`'s text.
 */
function projectReadsTier(carrier) {
  if (process.env.GENESEED_STACK_GLOBAL) return false;
  return SHARED_TIER_RE.test(carrier);
}

/**
 * How many items of the fold's ledger still wait for the user: a drafted rule, or a file with two
 * versions. The fold writes them, and nothing else would say so. Unreadable counts as none: this is a
 * reminder, and the fold itself reports a broken ledger.
 */
export function pendingDrafts() {
  try {
    const { items } = JSON.parse(readFileSync(sharedPaths().foldState, 'utf8'));
    return Object.values(items ?? {}).filter((i) => i?.state === 'pending').length;
  } catch { return 0; }
}

/** The session's reminder of them, or null. The OpenCode context plugin's `draftLine` is its twin. */
function draftLine() {
  const n = pendingDrafts();
  return n ? `[drafts] ${n} drafted item${n === 1 ? '' : 's'} in user-rules.draft.md wait${n === 1 ? 's' : ''} for the user's decision (the rule skill or the web console).` : null;
}

/**
 * The characters the tier would add to a session: every changed-from-seed file the hook injects
 * from it. The `setup` prompt turns this into the token figure it shows beside the option.
 */
export function tierSessionChars() {
  let n = 0;
  for (const rel of SESSION_FILES) {
    const abs = tierFile(rel);
    const text = abs ? sessionText(abs) : null;
    if (text !== null) n += text.length;
  }
  return n;
}

/** A vault folder's `.md` notes, dot-folders skipped: a vault keeps its config and trash inside. */
function walkWiki(dir, depth = 1, acc = []) {
  if (depth > WIKI_MAX_DEPTH) return acc;
  let entries;
  // `withFileTypes`, as the OpenCode plugin: a link or junction is neither a folder nor a note.
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (acc.length >= WIKI_MAX_FILES) return acc;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name) && !e.name.startsWith('.')) walkWiki(full, depth + 1, acc);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) acc.push(full);
  }
  return acc;
}

/**
 * The manifest's wikis, ready to render: the OpenCode plugin's `wikiSets`, with the same walk
 * bounds and precedence. Folders apply first, so a file entry always overrides its folder's mode;
 * `exclude` prunes; a wiki whose root is missing is skipped. Null for a file that does not parse.
 */
function wikiSets(text) {
  const [data] = readJsonc(text);
  if (data === null) return null;
  const sets = [];
  for (const w of Array.isArray(data.wikis) ? data.wikis : []) {
    if (!w?.path || !isDir(w.path)) continue;
    const entries = (Array.isArray(w.entries) ? w.entries : []).filter((e) => e?.path && typeof e.path === 'string').map((e) => {
      const abs = path.isAbsolute(e.path) ? e.path : path.resolve(w.path, e.path);
      return { abs, load: e.load === 'lazy' || e.load === 'exclude' ? e.load : 'eager',
        description: e.description || '', dir: isDir(abs) };
    });
    const recs = new Map();
    for (const folders of [true, false]) {
      for (const e of entries.filter((x) => x.dir === folders)) {
        for (const note of e.dir ? walkWiki(e.abs) : [e.abs]) {
          if (e.load === 'exclude') { recs.delete(note); continue; }
          const description = (e.dir ? '' : e.description) || recs.get(note)?.description || '';
          recs.set(note, { path: note, load: e.load, description });
        }
      }
    }
    const notes = [...recs.values()].sort((a, b) => a.path.localeCompare(b.path));
    sets.push({ name: w.name || path.basename(w.path), root: w.path, desc: w.description || '',
      conventions: w.conventions || '', inbox: w.inbox || '',
      protected: Array.isArray(w.protected) ? w.protected : [],
      eager: notes.filter((n) => n.load === 'eager'), lazy: notes.filter((n) => n.load === 'lazy') });
  }
  return sets;
}

/**
 * The wikis as the OpenCode plugin prints them, inside `room`: header lines, eager notes whole, and
 * a lazy listing. A note that does not fit is listed instead, like an eager doc. Sized by `stat`
 * before it is read, so a whole-vault eager entry costs no read past the budget.
 */
function renderWiki(wikis, room) {
  const lines = [];
  let left = room;
  const add = (...ls) => { for (const l of ls) { lines.push(l); left -= cost(l); } };
  for (const w of wikis) {
    add(`--- wiki: ${w.name}${w.desc ? ` \u2014 ${w.desc}` : ''} (root: ${w.root}) ---`);
    if (w.conventions) add(`  conventions: ${w.conventions} (read before your first write there)`);
    if (w.inbox) add(`  inbox: ${w.inbox} (drop notes you cannot confidently file)`);
    if (w.protected.length) add(`  protected (never write): ${w.protected.join(', ')}`);
    add('');
    const demoted = [];
    for (const e of w.eager) {
      const head = `----- ${w.name}/${disp(e.path, w.root)}${e.description ? ` \u2014 ${e.description}` : ''} -----`;
      let text = null;
      try {
        if (cost(head) + statSync(e.path).size + cost('') <= left - LIST_RESERVE) text = readText(e.path);
      } catch (x) {
        add(head, `[context] MISSING eager file: ${asOsError(x, e.path)}`, '');
        continue;
      }
      if (text === null) demoted.push({ ...e, over: true });
      else add(head, text.replace(/\n+$/, ''), '');
    }
    if (w.lazy.length || demoted.length) {
      add('--- Lazy entries (load only when the task needs them) ---');
      add(...lazyLines([...demoted, ...w.lazy], w.root, left - cost('')), '');
    }
  }
  return lines.join('\n').replace(/\n+$/, '');
}

/**
 * One session entry per layer. The `(shared)` and `(host: …)` labels appear only when the tier has
 * a say in that file, so an install with an empty tier prints what it always printed. A wiki entry
 * keeps its `wiki` sets, for a render sized to the room `cmdContext` finds.
 */
function sessionEntry(rel, abs, text, label) {
  if (rel === 'geneseed-wiki.jsonc') {
    // The user edits this file by hand, and a throw here would lose the whole payload, rules included.
    try {
      const wiki = wikiSets(text);
      if (wiki !== null) return wiki.length ? { rel, abs, label, wiki, text: renderWiki(wiki, OUTPUT_BUDGET - LAZY_RESERVE) } : null;
    } catch { /* reported below, as a manifest that does not parse */ }
    return { rel, abs, label, text: `[context] ${abs} is not valid JSONC \u2014 no wiki loaded.` };
  }
  const nudge = rel === 'memory/MEMORY.md' ? memoryNudge(text) : '';
  return { rel, abs, label, text: nudge ? `${text}\n${nudge}` : text };
}

/**
 * The session files in force for `hookRoot`, changed from their seed, in `SESSION_FILES` order:
 * `{ rel, abs, text, label }` per layer. A global install, or a project built `--shared-tier on`,
 * reads the machine tier first, then its own host layer. `$GENESEED_WIKI` overrides the wiki declaration on both, as it does on OpenCode.
 * A missing or unreadable file is simply absent — this is best-effort context, never a gate.
 * `host` is what the emitted hook passes (`emittedHost`), null for none, which reads as claude.
 */
export function sessionFiles(hookRoot, host = null, carrier = installCarrier(hookRoot, host)) {
  const tier = readsTier(hookRoot, host) || projectReadsTier(carrier);
  const found = [];
  for (const rel of SESSION_FILES) {
    const wiki = rel === 'geneseed-wiki.jsonc';
    const pinned = wiki && process.env.GENESEED_WIKI && isFile(process.env.GENESEED_WIKI);
    const hostAbs = pinned ? process.env.GENESEED_WIKI
      : wiki ? WIKI_NAMES.map((n) => path.join(hookRoot, n)).find(isFile) ?? path.join(hookRoot, rel)
        : path.join(hookRoot, rel);
    const own = sessionText(hostAbs);
    const sharedAbs = tier && !pinned ? tierFile(rel) : null;
    const shared = sharedAbs ? sessionText(sharedAbs) : null;
    if (shared !== null && !(own !== null && WHOLE_FILES.has(rel))) {
      found.push(sessionEntry(rel, sharedAbs, shared, 'shared'));
    }
    if (own !== null) found.push(sessionEntry(rel, hostAbs, own, shared === null ? '' : `host: ${host || 'claude'}`));
  }
  return found.filter(Boolean);
}

/** `_disp` — relative to the repo root when it sits under it, else verbatim. */
function disp(pathStr, root) {
  // A path on another drive has no relative form, so it is printed as given. `path.relative`
  // would silently return an absolute path instead — a different string, not the same one.
  if (path.parse(path.resolve(pathStr)).root.toLowerCase()
      !== path.parse(path.resolve(root)).root.toLowerCase()) {
    return pathStr;
  }
  return relPosix(root, pathStr);
}


function rglobDocs(dir, acc = []) {
  for (const name of listDir(dir)) {
    const full = path.join(dir, name);
    if (isDir(full)) rglobDocs(full, acc);
    else if (isFile(full) && isDoc(name)) acc.push(full);
  }
  return acc;
}

/**
 * `_discover_context` — the no-manifest path, mirroring the OpenCode context plugin.
 * Root entry docs are eager; other root docs (.md or .adoc), the doc trees and monorepo package
 * READMEs are lazy.
 */
export function discoverContext(root, host = 'claude') {
  const eager = new Map();
  const lazy = new Map();
  const native = host === 'openclaude' && isFile(path.join(root, 'AGENTS.md'))
    ? ['AGENTS.md'] : [...(NATIVE_ROOT[host] || [])];
  if (host === 'claude' && claudeLoadsAgents(root)) native.push('AGENTS.md');
  for (const full of sortPaths(listDir(root).map((n) => path.join(root, n)))) {
    if (!isFile(full)) continue;
    const name = path.basename(full);
    if (native.includes(name)) continue;
    if (EAGER_ROOT.includes(name)) eager.set(full, null);
    else if (isDoc(name) && name !== 'user-rules-retired.md') lazy.set(full, null);  // retired rules are never loaded
  }
  for (const d of LAZY_DIRS) {
    const sub = path.join(root, d);
    if (!isDir(sub)) continue;
    for (const md of sortPaths(rglobDocs(sub))) {
      const parts = path.relative(root, md).split(/[\\/]/);
      if (parts.some((part) => EXCLUDE_DIRS.has(part))) continue;
      if (!eager.has(md) && !lazy.has(md)) lazy.set(md, null);
    }
  }
  for (const group of ['packages', 'apps']) {
    const base = path.join(root, group);
    if (!isDir(base)) continue;
    for (const pkg of sortPaths(listDir(base).map((n) => path.join(base, n)))) {
      if (!isDir(pkg) || EXCLUDE_DIRS.has(path.basename(pkg))) continue;
      for (const name of ['README.md', 'README.adoc']) {
        const readme = path.join(pkg, name);
        if (isFile(readme) && !eager.has(readme) && !lazy.has(readme)) lazy.set(readme, null);
      }
    }
  }
  return [
    [...eager.keys()].map((p) => ({ path: p, description: '' })),
    [...lazy.keys()].filter((p) => !eager.has(p)).map((p) => ({ path: p, description: '' })),
  ];
}

/**
 * `_resolve_context_sets` — an explicit manifest wins, `"extend": true` layers it on top
 * of discovery, and an empty stub falls through to pure discovery.
 *
 * `recs` is a Map, not an object: JS reorders integer-like keys on a plain object, and
 * these keys are absolute paths whose iteration order becomes the printed order.
 * @returns {[Array<{path: string, description: string}>, Array<{path: string, description: string}>, string]}
 */
export function resolveContextSets(root, hookRoot = null, host = 'claude') {
  let manifest = null;
  const env = process.env.GENESEED_CONTEXT;
  if (env && isFile(env)) {
    // `Path(env)`, and the label is printed — so the separators are folded exactly the
    // way `str(Path(...))` folds them, or the source line differs by every slash in it.
    manifest = toPlatformPath(env);
  } else {
    // The harness dir last: a repo's own manifest outranks the one seeded beside the install.
    for (const cand of [path.join(root, '.harness', 'context.json'),
      path.join(root, 'context.json'), ...(hookRoot ? [path.join(hookRoot, 'context.json')] : [])]) {
      if (isFile(cand)) { manifest = cand; break; }
    }
  }

  if (manifest === null) {
    const [e, l] = discoverContext(root, host);
    return [e, l, `auto-discovery [${root}]`];
  }

  let raw;
  try {
    raw = readText(manifest);
  } catch (e) {
    err(`[context] could not read ${manifest}: ${asOsError(e, manifest)}\n`);
    return [[], [], String(manifest)];
  }
  let entries;
  let extend;
  try {
    let data = JSON.parse(raw);
    // Valid JSON of the wrong SHAPE (null, a number, an array) is an empty manifest, not a
    // syntax error. The guard is written out rather than left to fall out of the language:
    // without it, `null.context` throws into the catch below and a file a user really does
    // hand-edit is reported as invalid JSON when it is not.
    data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    entries = data.context || [];
    if (!Array.isArray(entries)) entries = [];
    extend = Boolean(data.extend);
  } catch {
    // The decoder's own message is not quoted: its wording and offset are engine details,
    // and V8 supplies no offset at all for the commonest shapes. Reporting the file is what
    // the user needs.
    err(`[context] ${manifest} is not valid JSON — no context was loaded `
      + '(fix the syntax, then re-run).\n');
    return [[], [], String(manifest)];
  }

  if (!entries.length && !extend) {
    const [e, l] = discoverContext(root, host);
    return [e, l, `auto-discovery [${root}] (empty ${path.basename(manifest)})`];
  }

  const recs = new Map();
  const put = (pathStr, load, desc) => {
    const prev = recs.get(pathStr);
    recs.set(pathStr, { path: pathStr, load, description: desc || (prev ? prev.description : '') });
  };

  if (extend) {
    const [de, dl] = discoverContext(root, host);
    for (const x of de) put(x.path, 'eager', '');
    for (const x of dl) put(x.path, 'lazy', '');
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = typeof entry.path === 'string' ? entry.path.trim() : '';
    if (!raw) continue;
    const load = entry.load === undefined ? 'eager' : entry.load;
    const desc = entry.description === undefined ? '' : entry.description;
    if (raw.includes('*')) {
      // A glob RECLASSIFIES files already known; it never pulls in new ones.
      for (const [pathStr, rec] of [...recs.entries()]) {
        if (fnmatch(disp(pathStr, root), raw)) put(pathStr, load, desc || rec.description);
      }
      continue;
    }
    const abs = path.isAbsolute(raw) ? raw : resolvePath(path.join(root, raw));
    put(abs, load, desc);
  }

  const eager = [];
  const lazy = [];
  for (const r of recs.values()) {
    (r.load === 'eager' ? eager : lazy).push({ path: r.path, description: r.description });
  }
  return [eager, lazy, String(manifest)];
}

/**
 * Cut a session file at the last line break that fits `room` and say where the rest is. Only
 * session files are cut: they are the user's own rules, and half of them beats none. An eager
 * doc that does not fit is listed lazy instead — a README cut mid-section misleads.
 */
function capToRoom(text, room, where) {
  if (cost(text) <= room) return text;
  const marker = `\n[context] truncated (session budget) — read ${where}`;
  let cut = text.length;
  do cut = text.lastIndexOf('\n', cut - 1);
  while (cut > 0 && cost(text.slice(0, cut) + marker) > room);
  return `${cut > 0 ? text.slice(0, cut) : ''}${marker}`;
}

/**
 * The lazy listing: a described entry gets its own line; undescribed entries sharing a parent
 * directory are folded into one `dir/ — N docs` line once there are LAZY_FOLD_AT of them (a
 * `docs/` tree of 186 files was 186 lines). Lines past `room` become one count line.
 */
function lazyLines(entries, root, room) {
  const byDir = new Map();
  for (const e of entries) {
    const dir = path.dirname(disp(e.path, root));
    // Root files stay listed one by one: there are few, and each name says what it is.
    if (e.description || e.over || dir === '.') continue;
    byDir.set(dir, (byDir.get(dir) || 0) + 1);
  }
  const lines = [];
  const folded = new Set();
  for (const e of entries) {
    const shown = disp(e.path, root);
    const dir = path.dirname(shown);
    if (!e.description && !e.over && byDir.get(dir) >= LAZY_FOLD_AT) {
      if (folded.has(dir)) continue;
      folded.add(dir);
      lines.push(`  - ${dir.replace(/\\/g, '/')}/ — ${byDir.get(dir)} docs`);
      continue;
    }
    const why = e.over ? OVER_BUDGET : '';
    lines.push(`  - ${shown}${e.description ? ` — ${e.description}` : ''}${why}`);
  }
  return fitLines(lines, room, (n) => `  - … ${n} more not listed (session budget)`);
}

/** As many of `lines` as fit `room`, and past that one line saying how many did not. */
function fitLines(lines, room, tailOf) {
  const kept = [];
  let used = 0;
  for (const [i, l] of lines.entries()) {
    const tail = tailOf(lines.length - i);
    if (used + cost(l) + (i < lines.length - 1 ? cost(tail) : 0) > room) {
      kept.push(tail);
      break;
    }
    kept.push(l);
    used += cost(l);
  }
  return kept;
}

/**
 * The text of this host's own carrier, or '' (armed). A global install keeps it in its config dir;
 * a project install keeps it in the repo, one level above the harness dir. The first candidate
 * that exists answers, as `firstCarrier` does.
 */
function installCarrierFile(hookRoot, host) {
  const base = readsTier(hookRoot, host) ? hookRoot : path.dirname(hookRoot);
  // Last, a plain bundle or git-clone harness dir keeps its AGENT.md in the dir itself.
  const found = [...carriersFor(host || 'claude').map((rel) => path.join(base, rel)), path.join(hookRoot, 'AGENT.md')];
  for (const file of found) {
    try { return [file, readFileSync(file, 'utf8')]; } catch { /* next candidate */ }
  }
  return ['', ''];
}
const installCarrier = (hookRoot, host) => installCarrierFile(hookRoot, host)[1];

/**
 * The payload, what it spent against `OUTPUT_BUDGET`, and whether the budget `cut` content from it:
 * THE ONE WRITER of all three, so what the hook prints and what `sessionStartSize` reports cannot
 * differ. Cut means a session file truncated or left out, a wiki note or an eager doc listed
 * instead of injected; a lazy listing shortened is not, since it only names files. `heads` are the
 * lines above the session block; `root` places `eager` and `lazy`. Reads, never prints.
 */
const SESSION_TITLE = '=== SESSION FILES — your harness files, injected at session start '
  + '(untouched seeds skipped) ===';
// The sub-agent's banner (`subagentRules`): the user's rules alone, under their own title.
export const USER_RULES_TITLE = '=== USER RULES — the user\'s standing rules; obey them as you obey the Dictates ===';

function renderPayload({ heads, session, eager, lazy, source, root, title = SESSION_TITLE }) {
  const lines = [];
  // `spent` counts every character pushed, headers included: the budget is the host's cap on
  // the whole payload, not on the file bodies alone.
  let spent = 0;
  let cut = false;
  const push = (...ls) => { for (const l of ls) { lines.push(l); spent += cost(l); } };
  if (heads.length) push(...heads, '');
  if (session.length) {
    push(title, '');
    // Rules answer only to their own size: the lines above them never push one out, so they are
    // capped when their layers together pass the share, and everything after them spends `spent`.
    let rulesSpent = 0;
    const left = [];
    for (const s of session) {
      const head = `----- ${s.rel}${s.label ? ` (${s.label})` : ''} -----`;
      const rules = s.rel === 'user-rules.md';
      const room = OUTPUT_BUDGET - LAZY_RESERVE - (rules ? rulesSpent : spent) - cost(head) - cost('');
      const where = `${s.abs} on demand`;
      if (room <= 0) {
        left.push({ rel: s.rel, line: `[context] ${s.rel} not injected (session budget) \u2014 read ${where}` });
        continue;
      }
      const text = capToRoom(s.wiki && cost(s.text) > room ? renderWiki(s.wiki, room) : s.text, room, where);
      if (text !== s.text || (s.wiki && text.includes(OVER_BUDGET))) cut = true;
      push(head, text, '');
      if (rules) rulesSpent += cost(head) + cost(text) + cost('');
    }
    // Paths have no length limit, so these lines answer to the budget like any listing.
    if (left.length) {
      cut = true;
      const room = OUTPUT_BUDGET - LIST_RESERVE - spent - cost('');
      const tail = (n) => `[context] ${n} more session files not injected (session budget)`;
      // The memory map first, and by its short name when its path cannot fit: a count line must
      // never replace the one file C12 owes a line that names it.
      const isMap = (l) => l.rel === 'memory/MEMORY.md';
      const maps = left.filter(isMap);
      const lines = [...maps, ...left.filter((l) => !isMap(l))].map((l) => l.line);
      let shown = fitLines(lines, room, tail);
      if (maps.length && shown[0] !== lines[0]) {
        const short = [...new Set(maps.map((l) => `[context] ${l.rel} not injected (session budget)`))];
        shown = fitLines([...short, ...lines.slice(maps.length)], room, tail);
      }
      push(...shown, '');
    }
  }
  if (eager.length || lazy.length) {
    push(`=== PROJECT CONTEXT \u2014 binding for this repo (via ${source}) ===`, '');
  }
  const demoted = [];
  for (const entry of eager) {
    const p = entry.path === undefined ? '' : entry.path;
    const desc = entry.description === undefined ? '' : entry.description;
    const target = path.isAbsolute(p) ? p : path.join(root, p);
    const head = `----- ${disp(p, root)}${desc ? ` \u2014 ${desc}` : ''} -----`;
    let text;
    try {
      text = readText(target).replace(/\n+$/, '');
    } catch (e) {
      push(head, `[context] MISSING eager file: ${asOsError(e, target)}`, '');
      continue;
    }
    if (spent + cost(head) + cost(text) + cost('') > OUTPUT_BUDGET - LAZY_RESERVE) {
      demoted.push({ ...entry, over: true });
      continue;
    }
    push(head, text, '');
  }

  if (lazy.length || demoted.length) {
    const title = '--- Lazy entries (load only when the task needs them) ---';
    push(title);
    push(...lazyLines([...lazy, ...demoted], root, OUTPUT_BUDGET - spent - cost('')), '');
  }
  return { text: `${lines.join('\n')}\n`, spent, cut: cut || demoted.length > 0 };
}

/**
 * What the session-start hook of a GLOBAL install prints with no project around it, against the
 * budget: `{ chars, budget, cut }`, for the console, which has no repo. `chars` is `spent`, in the
 * budget's own unit (`cost`), so on Windows it is the output's length in characters. `cut` is told
 * apart from `chars` because session files stop near 83% of the budget: a size cannot show it.
 *
 * The figure ignores `sovereignBypass`: the hook prints nothing in an excluded folder, but the
 * exclusion depends on the session's cwd, and the console has no session. Reads files, writes nothing.
 */
export function sessionStartSize(hookRoot, host) {
  const session = sessionFiles(hookRoot, emittedHost(host));
  const { spent, cut } = renderPayload({ heads: [], session, eager: [], lazy: [], source: '', root: hookRoot });
  return { chars: spent, budget: OUTPUT_BUDGET, cut };
}

/**
 * The user-rules layers a sub-agent gets, in SessionStart's order and under its labels: the tier
 * and the install (`session`), then the project root's own `user-rules.md` where discovery or the
 * manifest names it eager, each file once. `agentLoadout` (js/inspect/cost.mjs) reads the same list.
 */
export function userRuleLayers(session, root, hookRoot, host) {
  const rules = session.filter((s) => s.rel === 'user-rules.md');
  const seen = new Set(rules.map((s) => normcase(path.resolve(s.abs))));
  for (const e of root ? resolveContextSets(root, hookRoot, host || 'claude')[0] : []) {
    const abs = path.isAbsolute(e.path) ? e.path : path.join(root, e.path);
    const key = normcase(path.resolve(abs));
    if (path.basename(abs) !== 'user-rules.md' || seen.has(key)) continue;
    seen.add(key);
    const text = sessionText(abs);
    if (text !== null) rules.push({ rel: disp(abs, root), abs, label: '', text });
  }
  return rules;
}

/**
 * A sub-agent's start (`SubagentStart`): no host hands a sub-agent the SessionStart output, so the
 * user's rules reach it here, and nothing else (spec 2026-11-08, D4): not the profile, not the
 * project context, which the root file already brings. Same renderer, same budget, same cut.
 * Claude Code documents only the JSON form for this event, so the payload is ONE JSON object on
 * stdout. No rule anywhere prints nothing, as an empty SessionStart does.
 */
function subagentRules(session, root, hookRoot, host) {
  const rules = userRuleLayers(session, root, hookRoot, host);
  if (!rules.length) return 0;
  const { text } = renderPayload({ heads: [], session: rules, eager: [], lazy: [], source: '', root, title: USER_RULES_TITLE });
  out(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text } })}\n`);
  return 0;
}

export function cmdContext(args) {
  const host = (args && args.host) || null;
  // Discovery (and the stand-down) runs against the SESSION's project root, not the harness
  // package dir: `$CLAUDE_PROJECT_DIR` when the host sets it (`hookProjectDir`), because
  // SessionStart also fires on resume/compact/clear, after the agent may have `cd`'d away.
  // The only two `resolvePath` calls in this file whose argument can be a `~user` path the
  // user typed — `$GENESEED_ROOT` and `--root` — and `resolvePath` expands, so both can now
  // throw. Every other caller either builds its argument by `path.join` from an absolute
  // root (so no leading tilde survives) or already sits inside a `try`. Refused input
  // injects nothing, which is the same degrade as "nothing to load" below.
  let root;
  let hookRoot;
  try {
    ({ root, hookRoot } = withDiscardableStderr(() => ({
      root: resolvePath(process.env.GENESEED_ROOT || hookProjectDir()),
      hookRoot: args.root ? resolvePath(args.root) : null,
    })));
  } catch {
    return 0;
  }
  if (hookRoot && sovereignBypass(hookRoot)) return 0;
  // The RAW `args.host`, never defaulted to claude, which would key an older
  // OpenClaude emit's `~/.openclaude` (no `--host`) on `.claude` instead of its folder name.
  if (globalHookStandingDown(hookRoot, root, args.host, 'context')) return 0;
  const [carrierFile, carrier] = hookRoot ? installCarrierFile(hookRoot, host) : ['', ''];
  const session = hookRoot ? sessionFiles(hookRoot, host, carrier) : [];
  if (args.event === 'SubagentStart') return subagentRules(session, root, hookRoot, host);
  // A session file discovery would also pick up (a `user-rules.md` at the repo root of an
  // install whose harness dir IS the repo root) is injected once, in the session block.
  const seen = new Set(session.map((s) => normcase(path.resolve(s.abs))));
  const fresh = (e) => !seen.has(normcase(path.resolve(path.isAbsolute(e.path)
    ? e.path : path.join(root, e.path))));
  let [eager, lazy, source] = resolveContextSets(root, hookRoot, host || 'claude');
  eager = eager.filter(fresh);
  lazy = lazy.filter(fresh);
  // The done gate's checks for this repo, and where they come from (`./hooks-done.mjs`). No git
  // root, no gate, no line. Printed even when there is nothing else to load. An install built
  // `--no-done-gate` carries `Done gate: off` in its AGENT.md and gets no line — the OpenCode
  // context plugin's `doneGateOff` reads the same marker with the same pattern.
  const gitRoot = gitRootOf(root);
  const gateOff = (marker) => new RegExp(`^${marker}:[ \\t]*off[ \\t]*\\r?$`, 'm')
    .test(gateCarrierText(carrierFile, carrier));
  // Bob's Stop carries no transcript, so the gate never judges a turn there (`hooks-done.mjs`).
  const done = gitRoot && !gateOff('Done gate') ? doneLine(gitRoot, host !== 'bob') : null;
  // The ownership decline reminder (`./ownership-gate.mjs`), under the same contract: an install
  // built `--no-ownership-gate` carries `Ownership gate: off` and gets no line.
  const owned = gitRoot && !gateOff('Ownership gate') ? ownershipLine(gitRoot) : null;
  const drafts = hookRoot && (readsTier(hookRoot, host) || projectReadsTier(carrier)) ? draftLine() : null;
  const heads = [done, owned, gitRoot && runtimeFloorLine(gitRoot), drafts].filter(Boolean);
  if (!session.length && !eager.length && !lazy.length) {
    err(`[context] nothing to load for ${root} `
      + '(no docs discovered, no manifest entries).\n');
    if (heads.length) out(`${heads.join('\n')}\n`);
    return 0;
  }

  // Claude Code takes a SessionStart hook's plain stdout as context; Bob reads it the same way.
  out(renderPayload({ heads, session, eager, lazy, source, root }).text);
  return 0;
}
