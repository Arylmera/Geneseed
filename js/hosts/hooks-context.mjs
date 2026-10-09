/**
 * `context` — the SessionStart verb: inject the harness's session files and the repo's context
 * docs. Runs once per session, so it is loaded only when the hook entry dispatches it; see
 * `js/hosts/hooks.mjs`'s header for the contract every hook verb holds.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readText, printOut as out, printErr as err, withDiscardableStderr } from '../lib/fs.mjs';
import { normcase, toPlatformPath } from '../lib/paths.mjs';
import { relPosix } from '../lib/text.mjs';
import { resolvePath, sovereignBypass } from './hosts.mjs';
import { isFile, isDir, selfAndParents, sortPaths, listDir } from './hooks-prims.mjs';

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

/**
 * The host whose own root file counts as native — `--host` on the emitted command, `claude`
 * when absent. Module state for the reason `./hooks.mjs`'s gates keep theirs: a hook process
 * answers exactly one call, so it is set once at `cmdContext`'s entry.
 */
let HOST = 'claude';

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

// The whole payload's budget, in characters. Claude Code does not hand a hook's stdout to the
// model past roughly 10k characters: it saves the output to a file and the model sees a 2 KB
// preview, so everything after the cut is lost without a word. Observed 2026-10 (a 25.6 KB and
// a 16.5 KB SessionStart output, both persisted); the exact threshold is not documented, hence
// the margin. The old 48 KB eager budget never bound — the host's cap always cut first.
// Priority inside the budget: session files (the user's own), then eager docs (whole, or
// listed lazy), then the lazy listing, folded per directory and cut with a count.
const OUTPUT_BUDGET = 9000;
// Kept back from the eager docs so the lazy listing always has room to say what exists.
const LAZY_RESERVE = 1500;
// A directory with this many undescribed lazy files is listed once, with its count.
const LAZY_FOLD_AT = 3;
// What a line costs against the budget: its characters plus a terminator counted as two,
// because stdout goes out as \r\n on Windows — a 144-line listing overran by 137 before this.
// Multi-line text pays one more per inner line break, for the same reason.
const cost = (s) => s.length + (s.match(/\n/g) || []).length + 2;

// The files the root instruction file names for session start, relative to the HARNESS dir
// (`--root`: `.claude/`, `.bob/`, a global config dir) — not to the repo root discovery walks,
// which is why none of them reached a hooked host before 2026-10. Injected here so the read does
// not depend on the model remembering it. `context.json` is not in the list: it is a manifest,
// honoured by `resolveContextSets` (the harness dir is its last candidate). The OpenCode
// context plugin carries the same list.
const SESSION_FILES = ['user-rules.md', 'PROFILE.md', 'memory/MEMORY.md', 'anamnesis/MEMORY.md',
  'notebook/NOTEBOOK.md', 'geneseed-wiki.jsonc'];
// The wiki manifest's earlier name, read when the new one is absent (an install not yet re-emitted,
// or a rename that failed). One release; `wiki.json`, older still, is the build's to rename.
const LEGACY_WIKI = 'wiki.jsonc';
// SHA-256 of each seed body in `js/build/stubs.mjs` (`SESSION_SEEDS`), CRLF folded. A file still
// byte-identical to its seed says nothing, so it is skipped rather than injected as noise.
// Hashes, not an import: stubs.mjs pulls in the build's writers, and this module loads on every
// tool call. tests/unit/claude.test.mjs gates this set, and the plugin's copy, against the seeds.
const SEED_SHA256 = new Set([
  '5c2e92fb1acde041e02d9ebf158460d8ff7a07cbc2b447859631604610130721', // user-rules.md
  '29e012c3c4349ea62a9082cbd04bb25599a0ec280d62c33f6e10742809471816', // PROFILE.md
  '3a82c78ccc5d745033c16c354f5eda9d79350c704e9da8d605d380fb1e108d7a', // geneseed-wiki.jsonc
  // The wiki seed before the rename: the build renames an untouched one byte for byte.
  'cccc917c34e6b990e821620bdb4739090151885ab71b6e85046f30a3b71fa5e8', // wiki.jsonc (legacy)
  '99c786049c260f6baf7aec68a5c0f59907861afe9b867da009440613bdddb907', // MEMORY.md
  '9acb5c9d9cb5dac572104480f05b48cc144e676869bd60e86d8a15b1f6308184', // NOTEBOOK.md
]);
export { SESSION_FILES, SEED_SHA256 };

/**
 * The session files present under `hookRoot` and changed from their seed, as `{ rel, abs, text }`
 * (text CRLF-folded, trailing newlines trimmed). `$GENESEED_WIKI` overrides the wiki declaration,
 * as it does on OpenCode. A missing or unreadable file is simply absent — this is best-effort
 * context, never a gate.
 */
export function sessionFiles(hookRoot) {
  const found = [];
  for (const rel of SESSION_FILES) {
    let abs = path.join(hookRoot, rel);
    if (rel === 'geneseed-wiki.jsonc') {
      if (process.env.GENESEED_WIKI && isFile(process.env.GENESEED_WIKI)) abs = process.env.GENESEED_WIKI;
      else if (!isFile(abs)) abs = path.join(hookRoot, LEGACY_WIKI);
    }
    if (!isFile(abs)) continue;
    let text;
    try { text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'); } catch { continue; }
    if (SEED_SHA256.has(createHash('sha256').update(text).digest('hex'))) continue;
    found.push({ rel, abs, text: text.replace(/\n+$/, '') });
  }
  return found;
}

const CLAUDE_MARKERS = ['.claude', '.bob', '.openclaude'];
const GENESEED_MANIFEST = '.geneseed-manifest.json';

/**
 * `_global_hook_standing_down` — project-bypasses-global.
 *
 * A GLOBAL install's hook passes its own dir as `--root`; when a Geneseed PROJECT install
 * of the SAME host sits at or above cwd, the project's hook injects and this one must not
 * double up.
 */
export function globalHookStandingDown(hookRoot, cwd) {
  const marker = path.basename(hookRoot);
  if (!CLAUDE_MARKERS.includes(marker)) return false;
  for (const d of selfAndParents(cwd)) {
    const cand = path.join(d, marker);
    if (isFile(path.join(cand, GENESEED_MANIFEST))) {
      // Path equality, which is case-folded on Windows — `~/.claude` and `~/.Claude` are
      // the same install there and two different ones on Linux.
      return normcase(resolvePath(cand)) !== normcase(resolvePath(hookRoot));
    }
  }
  return false;
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
export function discoverContext(root, host = HOST) {
  const eager = new Map();
  const lazy = new Map();
  const native = host === 'openclaude' && isFile(path.join(root, 'AGENTS.md'))
    ? ['AGENTS.md'] : NATIVE_ROOT[host] || [];
  for (const full of sortPaths(listDir(root).map((n) => path.join(root, n)))) {
    if (!isFile(full)) continue;
    const name = path.basename(full);
    if (native.includes(name)) continue;
    if (EAGER_ROOT.includes(name)) eager.set(full, null);
    else if (isDoc(name)) lazy.set(full, null);
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
export function resolveContextSets(root, hookRoot = null) {
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
    const [e, l] = discoverContext(root);
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
    const [e, l] = discoverContext(root);
    return [e, l, `auto-discovery [${root}] (empty ${path.basename(manifest)})`];
  }

  const recs = new Map();
  const put = (pathStr, load, desc) => {
    const prev = recs.get(pathStr);
    recs.set(pathStr, { path: pathStr, load, description: desc || (prev ? prev.description : '') });
  };

  if (extend) {
    const [de, dl] = discoverContext(root);
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
    const why = e.over ? ' (eager, but over the session budget — read on demand)' : '';
    lines.push(`  - ${shown}${e.description ? ` — ${e.description}` : ''}${why}`);
  }
  const kept = [];
  let used = 0;
  for (const [i, l] of lines.entries()) {
    const tail = `  - … ${lines.length - i} more not listed (session budget)`;
    if (used + cost(l) + (i < lines.length - 1 ? cost(tail) : 0) > room) {
      kept.push(tail);
      break;
    }
    kept.push(l);
    used += cost(l);
  }
  return kept;
}

export function cmdContext(args) {
  HOST = (args && args.host) || 'claude';
  // Discovery runs against the project root the hook was launched from — Claude runs
  // SessionStart hooks with cwd = repo root — not the harness package dir.
  // The only two `resolvePath` calls in this file whose argument can be a `~user` path the
  // user typed — `$GENESEED_ROOT` and `--root` — and `resolvePath` expands, so both can now
  // throw. Every other caller either builds its argument by `path.join` from an absolute
  // root (so no leading tilde survives) or already sits inside a `try`. Refused input
  // injects nothing, which is the same degrade as "nothing to load" below.
  let root;
  let hookRoot;
  try {
    ({ root, hookRoot } = withDiscardableStderr(() => ({
      root: resolvePath(process.env.GENESEED_ROOT || process.cwd()),
      hookRoot: args.root ? resolvePath(args.root) : null,
    })));
  } catch {
    return 0;
  }
  if (hookRoot && sovereignBypass(hookRoot)) return 0;
  if (hookRoot && !process.env.GENESEED_STACK_GLOBAL
      && globalHookStandingDown(hookRoot, root)) return 0;
  const session = hookRoot ? sessionFiles(hookRoot) : [];
  // A session file discovery would also pick up (a `user-rules.md` at the repo root of an
  // install whose harness dir IS the repo root) is injected once, in the session block.
  const seen = new Set(session.map((s) => normcase(path.resolve(s.abs))));
  const fresh = (e) => !seen.has(normcase(path.resolve(path.isAbsolute(e.path)
    ? e.path : path.join(root, e.path))));
  let [eager, lazy, source] = resolveContextSets(root, hookRoot);
  eager = eager.filter(fresh);
  lazy = lazy.filter(fresh);
  if (!session.length && !eager.length && !lazy.length) {
    err(`[context] nothing to load for ${root} `
      + '(no docs discovered, no manifest entries).\n');
    return 0;
  }

  const lines = [];
  // `spent` counts every character pushed, headers included: the budget is the host's cap on
  // the whole payload, not on the file bodies alone.
  let spent = 0;
  const push = (...ls) => { for (const l of ls) { lines.push(l); spent += cost(l); } };
  if (session.length) {
    push('=== SESSION FILES \u2014 your harness files, injected at session start '
      + '(untouched seeds skipped) ===', '');
    for (const s of session) {
      const head = `----- ${s.rel} -----`;
      push(head, capToRoom(s.text, OUTPUT_BUDGET - LAZY_RESERVE - spent - cost(head) - cost(''),
        `${s.abs} on demand`), '');
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

  // Claude Code takes a SessionStart hook's plain stdout as context; Bob reads it the same way.
  out(`${lines.join('\n')}\n`);
  return 0;
}
