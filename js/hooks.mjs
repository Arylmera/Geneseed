/**
 * The four HOOK verbs — `context`, `git-gate`, `rule-gate`, `learn` — in Node.
 *
 * These are the commands the emitted `settings.json` actually invokes on a user's machine,
 * every session: a SessionStart injector, two PreToolUse gates, and a Stop/SubagentStop
 * distiller. Since P5b they are also what the emitted hooks name: `bin/geneseed.mjs` bakes
 * `<node> <checkout>/bin/geneseed-hook.mjs` into the machine-wide shim, so an install this
 * driver emits has no Python in its hook path at all — which is what let the interpreter
 * discovery and its exit-4 refusal be deleted rather than merely bypassed.
 *
 * Ported from `rituals/_harness_context.py` and `rituals/_harness_learn.py`, whose shared
 * primitives live in `_harness_core.py`. `rituals/harness.py` links all fourteen
 * submodules into one namespace at import time, so a Python `harness context` loads
 * ~11,600 lines and the generator behind them. This module loads none of that, and that is
 * deliberate rather than incidental: the Python originals already refuse to import `build`
 * for the marker filenames they need ("literals keep the hook dependency-free"), and the
 * same rule is why `opencodeConfigDir` below is six lines here instead of an import from
 * `bin/geneseed.mjs` — which could not be imported anyway, since its last statement runs
 * the generator.
 *
 * THE CONTRACT EVERY VERB HOLDS. Exit 0 on every path, and signal through stdout. A hook
 * that fails is a tool call that fails, so an unreadable payload, a missing file, a
 * malformed user config and a bypass all end the same way: quietly, with 0. The single
 * exception is `learn`, which returns the model CLI's own exit code — an auth or quota
 * failure has to be diagnosable, and its hook command carries `|| exit 0` for exactly that
 * reason.
 *
 * The gate is `tests/harness_golden.py`, which runs each verb through both CLIs in a
 * seeded sandbox and compares stdout, stderr, the exit code and every file left behind.
 */
import { existsSync, statSync, readFileSync, readdirSync, mkdirSync, realpathSync }
  from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readText, writeText, jsonDumpsCompact, normcase, comparePaths }
  from './lib/pyfs.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- Python path and text primitives -------------------------------------------------
// Small, and each one is here because a JS-idiomatic equivalent differs observably. They
// are NOT in js/lib/pyfs.mjs: that module is the generator's, imported by the driver this
// one must stay independent of, and duplicating four helpers is cheaper than coupling a
// hook to the emitter. (`readText`/`writeText`/`normcase` DO come from there — they are
// already the single owner of the CRLF and case-folding rules, and a second copy of those
// is how the two halves start disagreeing about a newline.)

/** `Path.expanduser()` — a LEADING `~` only, as Python does it. */
function expanduser(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * `Path(p).resolve()` — absolute, symlinks followed, and the filesystem's OWN casing.
 *
 * `realpathSync` throws on a path that does not exist, which is routine here (an
 * `excludes.json` may name a folder that was deleted), so the existing prefix is
 * canonicalised and the rest appended verbatim — `resolve(strict=False)`'s behaviour.
 */
function pyResolve(p) {
  let cur = path.resolve(expanduser(p));
  const tail = [];
  for (;;) {
    try {
      return tail.length ? path.join(realpathSync.native(cur), ...tail)
        : realpathSync.native(cur);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(expanduser(p));
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * `str(Path(p))` — separators folded to the platform's own, `//` collapsed, a trailing
 * one dropped. NOT `path.resolve`: a relative path stays relative, which is what the two
 * string comparisons below depend on.
 */
function pyStrPath(p) {
  const n = path.normalize(p);
  // A root's separator is part of it, not a trailing one: `str(Path("C:/"))` is `C:\`,
  // and `str(Path("C:/x/"))` is `C:\x`. Comparing the NORMALISED string to its own root is
  // what tells the two apart — `path.parse('C:').root` is `''`, so stripping first and
  // asking afterwards gets `C:\` wrong.
  if (n === path.parse(n).root) return n;
  return /[\\/]$/.test(n) ? n.replace(/[\\/]+$/, '') : n;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** `(p, *p.parents)` — the path and every ancestor, nearest first. */
function selfAndParents(p) {
  const out = [p];
  let cur = p;
  for (;;) {
    const up = path.dirname(cur);
    if (up === cur) return out;
    out.push(up);
    cur = up;
  }
}

/**
 * `str.splitlines()`.
 *
 * `split('\n')` is not it: Python breaks on eleven boundaries, and a transcript or a
 * memory file carrying a form feed or U+2028 would be split by one implementation and not
 * the other. The trailing empty is dropped the way Python drops it (`"a\n"` is one line,
 * `""` is none).
 */
function pySplitlines(text) {
  if (!text) return [];
  const parts = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** `str.split()` with no argument — runs of whitespace, ends stripped, no empties. */
function pyWords(s) {
  return s.split(/\s+/).filter(Boolean);
}

/** `s[-n:]` in CODE POINTS. JS slices UTF-16 units and can cut a surrogate pair in half. */
function tail(s, n) {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(-n).join('');
}

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

function pyOsError(e, filename) {
  const hit = _ERRNO[e && e.code];
  if (!hit) return String((e && e.message) || e);
  // Python reprs the filename, so a Windows path comes out with its backslashes doubled.
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
      // An unterminated `[` is a LITERAL bracket in Python's translate, not an error.
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

/** stdin, decoded as UTF-8 with Python's universal newlines. Absent stdin reads empty. */
function readStdin() {
  try {
    return readFileSync(0, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  } catch {
    return '';
  }
}

/**
 * The two output funnels, with Python's newline translation reproduced.
 *
 * `sys.stdout` is a TextIOWrapper with `newline=None`, so on Windows every `\n` a hook
 * prints leaves the process as `\r\n` — and `harness.py`'s `reconfigure(encoding="utf-8")`
 * changes the encoding only, not that. `process.stdout` translates nothing, so an install
 * emitted by the Node driver would hand its host different BYTES than the same install
 * emitted by Python: measured at 176 vs 171 for one `context` run.
 *
 * `harness_golden.py` structurally cannot see it — `subprocess` decodes with universal
 * newlines on the way back, folding both to `\n` before any cell compares them, the same
 * shape as the shim's exclusion from `golden.py`. It went unobservable while nothing baked
 * this entry into a shim; P5b's flip makes it what a real host reads, so it is fixed here
 * and gated in binary rather than left on the known-differences list.
 */
const NL = process.platform === 'win32' ? '\r\n' : '\n';
const xlate = (s) => (NL === '\n' ? s : s.replaceAll('\n', NL));
const out = (s) => process.stdout.write(xlate(s));
const err = (s) => process.stderr.write(xlate(s));

/**
 * `_build_core._opencode_config_dir`, duplicated rather than imported.
 *
 * `learn`'s memory resolver reaches for it as a last fallback, and it is the one place
 * these verbs need something the generator also knows. Importing `bin/geneseed.mjs` would
 * RUN the generator (its last statement is `main(...)`), and importing the emit layer
 * would pull the whole render core into a hook. Six lines, with the Python original named
 * so the two can be diffed.
 */
function opencodeConfigDir() {
  const env = process.env.OPENCODE_CONFIG_DIR;
  if (env) return pyResolve(env);
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? expanduser(xdg) : path.join(os.homedir(), '.config');
  return pyResolve(path.join(base, 'opencode'));
}

// ======================================================================================
// context — project-context discovery (Rule XVIII)
// ======================================================================================

// Kept in step with adapters/opencode/plugins/geneseed-context.js, same as the Python.
const EAGER_ROOT = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', '.cursorrules',
  'README.md', 'CONTRIBUTING.md', 'user-rules.md', 'PROFILE.md'];
const LAZY_DIRS = ['docs', 'doc', 'documentation', 'architecture', 'adr', 'ADR'];
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.next',
  'target', '.venv', '__pycache__', '.opencode', '.harness']);

const CLAUDE_MARKERS = ['.claude', '.bob'];
const GENESEED_MANIFEST = '.geneseed-manifest.json';
const EXCLUDES_FILE = 'excludes.json';

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
      return normcase(pyResolve(cand)) !== normcase(pyResolve(hookRoot));
    }
  }
  return false;
}

/**
 * `sovereign_bypass` — the user's own excludes.json, read on EVERY hook call so an edit
 * takes effect without a re-emit. Every failure mode degrades to false: a hook must never
 * fail or block on a file the user owns.
 */
export function sovereignBypass(root) {
  if (!root) return false;
  let entries;
  try {
    const data = JSON.parse(readText(path.join(root, EXCLUDES_FILE)));
    entries = Array.isArray(data && data.excludes) ? data.excludes : [];
  } catch {
    return false;
  }
  let cwd;
  try {
    cwd = normcase(pyResolve(process.cwd()));
  } catch {
    return false;
  }
  for (const entry of entries) {
    const raw = (entry && typeof entry === 'object' ? entry.path : entry) || '';
    if (typeof raw !== 'string' || !raw.trim()) continue;
    // `.rstrip("\\/")` AFTER normcase, exactly as the Python orders it, so the separator
    // test below cannot be fooled by a trailing slash in the user's file.
    const base = normcase(pyStrPath(expanduser(raw.trim()))).replace(/[\\/]+$/, '');
    if (cwd === base || cwd.startsWith(base + path.sep)) return true;
  }
  return false;
}

/** `_disp` — relative to the repo root when it sits under it, else verbatim. */
function disp(pathStr, root) {
  // `os.path.relpath` raises ValueError across drives and the Python falls back to the
  // path as given; `path.relative` silently returns an absolute path instead, which would
  // print a DIFFERENT string rather than the same one.
  if (path.parse(path.resolve(pathStr)).root.toLowerCase()
      !== path.parse(path.resolve(root)).root.toLowerCase()) {
    return pathStr;
  }
  return path.relative(root, pathStr).split(path.sep).join('/');
}

/** `Path.glob`/`rglob` order: `sorted()` over paths, which is case-folded on Windows. */
function sortPaths(list) {
  return list.slice().sort(comparePaths);
}

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function rglobMd(dir, acc = []) {
  for (const name of listDir(dir)) {
    const full = path.join(dir, name);
    if (isDir(full)) rglobMd(full, acc);
    else if (isFile(full) && path.extname(name).toLowerCase() === '.md') acc.push(full);
  }
  return acc;
}

/**
 * `_discover_context` — the no-manifest path, mirroring the OpenCode context plugin.
 * Root entry docs are eager; other root markdown, the doc trees and monorepo package
 * READMEs are lazy.
 */
export function discoverContext(root) {
  const eager = new Map();
  const lazy = new Map();
  for (const full of sortPaths(listDir(root).map((n) => path.join(root, n)))) {
    if (!isFile(full)) continue;
    const name = path.basename(full);
    if (EAGER_ROOT.includes(name)) eager.set(full, null);
    else if (path.extname(name).toLowerCase() === '.md') lazy.set(full, null);
  }
  for (const d of LAZY_DIRS) {
    const sub = path.join(root, d);
    if (!isDir(sub)) continue;
    for (const md of sortPaths(rglobMd(sub))) {
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
      const readme = path.join(pkg, 'README.md');
      if (isFile(readme) && !eager.has(readme) && !lazy.has(readme)) lazy.set(readme, null);
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
 */
export function resolveContextSets(root) {
  let manifest = null;
  const env = process.env.GENESEED_CONTEXT;
  if (env && isFile(env)) {
    // `Path(env)`, and the label is printed — so the separators are folded exactly the
    // way `str(Path(...))` folds them, or the source line differs by every slash in it.
    manifest = pyStrPath(env);
  } else {
    for (const cand of [path.join(root, '.harness', 'context.json'),
      path.join(root, 'context.json')]) {
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
    err(`[context] could not read ${manifest}: ${pyOsError(e, manifest)}\n`);
    return [[], [], String(manifest)];
  }
  let entries;
  let extend;
  try {
    let data = JSON.parse(raw);
    // Valid JSON of the wrong SHAPE, guarded on both sides — see the Python original. JS
    // would not have thrown here (`[].context` is merely undefined), which is exactly why
    // the guard is written out rather than left to fall out of the language: without it,
    // the two CLIs disagree about a file a user really does hand-edit.
    data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    entries = data.context || [];
    if (!Array.isArray(entries)) entries = [];
    extend = Boolean(data.extend);
  } catch {
    // See the Python original for why the decoder's own message is not quoted: the two
    // engines disagree on the wording and on the offset, and V8 supplies no offset at all
    // for the commonest shapes. Reporting the file is what the user needs; reporting
    // WHICH decoder found it is what makes two implementations impossible.
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
    const abs = path.isAbsolute(raw) ? raw : pyResolve(path.join(root, raw));
    put(abs, load, desc);
  }

  const eager = [];
  const lazy = [];
  for (const r of recs.values()) {
    (r.load === 'eager' ? eager : lazy).push({ path: r.path, description: r.description });
  }
  return [eager, lazy, String(manifest)];
}

export function cmdContext(args) {
  // Discovery runs against the project root the hook was launched from — Claude runs
  // SessionStart hooks with cwd = repo root — not the harness package dir.
  const root = pyResolve(process.env.GENESEED_ROOT || process.cwd());
  const hookRoot = args.root ? pyResolve(args.root) : null;
  if (hookRoot && sovereignBypass(hookRoot)) return 0;
  if (hookRoot && !process.env.GENESEED_STACK_GLOBAL
      && globalHookStandingDown(hookRoot, root)) return 0;
  const [eager, lazy, source] = resolveContextSets(root);
  if (!eager.length && !lazy.length) {
    err(`[context] nothing to load for ${root} `
      + '(no docs discovered, no manifest entries).\n');
    return 0;
  }

  const lines = [
    `=== PROJECT CONTEXT \u2014 binding for this repo per Rule XVIII (via ${source}) ===`,
    '',
  ];
  for (const entry of eager) {
    const p = entry.path === undefined ? '' : entry.path;
    const desc = entry.description === undefined ? '' : entry.description;
    const target = path.isAbsolute(p) ? p : path.join(root, p);
    lines.push(`----- ${disp(p, root)}${desc ? ` \u2014 ${desc}` : ''} -----`);
    try {
      lines.push(readText(target).replace(/\n+$/, ''));
    } catch (e) {
      lines.push(`[context] MISSING eager file: ${pyOsError(e, target)}`);
    }
    lines.push('');
  }

  if (lazy.length) {
    lines.push('--- Lazy entries (load only when the task needs them) ---');
    for (const entry of lazy) {
      const p = entry.path === undefined ? '' : entry.path;
      const desc = entry.description === undefined ? '' : entry.description;
      lines.push(`  - ${disp(p, root)}${desc ? ` \u2014 ${desc}` : ''}`);
    }
    lines.push('');
  }

  out(`${lines.join('\n')}\n`);
  return 0;
}

// ======================================================================================
// git-gate — Law XX's tool-boundary backstop
// ======================================================================================

// A `git` verb ANYWHERE in the command trips the gate, including the chained
// (`git add . && git commit … && git push`) and `-C <path>` forms, so a compound
// one-liner can never slip a commit past the prompt. `[^\n]*` is the boundary: a `git` on
// one line and a `commit` on the next are two commands, not one.
const GIT_GATE_RE = /\bgit\b[^\n]*\b(?:commit|push)\b/;

/** The `permissionDecision: "ask"` document, in Python's compact `json.dumps` spelling. */
function askDecision(reason) {
  return `${jsonDumpsCompact({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  })}\n`;
}

export function cmdGitGate(args) {
  if (sovereignBypass(args.root)) return 0;
  let command;
  try {
    const payload = JSON.parse(readStdin() || '{}');
    command = ((payload && payload.tool_input) || {}).command;
  } catch {
    return 0;
  }
  if (typeof command !== 'string' || !GIT_GATE_RE.test(command)) return 0;
  out(askDecision('Geneseed Law XX \u2014 every git commit/push needs explicit approval'));
  return 0;
}

// ======================================================================================
// rule-gate — Law VI's tool-boundary backstop
// ======================================================================================

/**
 * `_rule_gate_target` — name the store a write would land in, or null for ordinary work.
 *
 * A deployed install's folder and file names are theme-INDEPENDENT by design, so this
 * matches literal names and needs no install lookup. `user-rules.md` and `MEMORY.md` are
 * Geneseed's own coinage and match anywhere; any other markdown matches only inside THIS
 * install's `<root>/memory/`.
 */
export function ruleGateTarget(p, root) {
  if (typeof p !== 'string') return null;
  // Split on BOTH separators rather than taking a basename: a payload carrying a Windows
  // path reaches a POSIX host with its backslashes intact, and `path.basename` there
  // returns the whole string — so the two coined names would go unrecognised exactly
  // where they are meant to match on whichever host reads them.
  const name = p.split(/[\\/]/).pop().toLowerCase();
  if (name === 'user-rules.md') return 'user-rules.md';
  if (name === 'memory.md') return 'the memory index';
  if (!root || !name.endsWith('.md')) return null;
  try {
    const store = normcase(pyResolve(path.join(root, 'memory')));
    // `.parents`, so the store dir itself is not one of its own ancestors.
    return selfAndParents(pyResolve(p)).slice(1).some((d) => normcase(d) === store)
      ? 'memory' : null;
  } catch {
    return null;
  }
}

export function cmdRuleGate(args) {
  if (sovereignBypass(args.root)) return 0;
  let p;
  try {
    const payload = JSON.parse(readStdin() || '{}');
    const ti = (payload && payload.tool_input) || {};
    p = ti.file_path || ti.path || '';
  } catch {
    return 0;
  }
  if (typeof p !== 'string' || !p) return 0;
  const target = ruleGateTarget(p, args.root);
  if (!target) return 0;
  out(askDecision(`Geneseed Law VI \u2014 writing to ${target}: a standing rule, or a fact to `
    + "remember? That choice is the user's. Run the rule skill first."));
  return 0;
}

// ======================================================================================
// learn — distil notes/transcripts into deduped memory entries
// ======================================================================================

const MEMORY_DIR_NAMES = ['memory', 'anamnesis'];
const FRONTMATTER_RE = /^\s*---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
const FILE_SEP_RE = /^---FILE---[^\S\n]*$/m;
const AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;
const MAX_AGENT_BULLETS = 100;
const MAX_NOTES_CHARS = 16000;
// Host payloads name the finished subagent inconsistently; try each.
const SUBAGENT_NAME_FIELDS = ['agent_name', 'agent_type', 'subagent_type', 'agent',
  'agent_id'];

const PLUGIN_LEARN = path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-learn.js');

/**
 * `_load_learn_prompt_head` / `_load_agent_lesson_prompt`.
 *
 * The single source of truth for both prompts is the OpenCode plugin — the artifact that
 * ships to the primary runtime — and both CLIs extract the template literal from its
 * SOURCE rather than keeping a copy. Reading it means this port cannot drift from the
 * plugin either; a copied constant here would be a third place to edit.
 */
function pluginLiteral(name, fallback) {
  try {
    const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\``).exec(readText(PLUGIN_LEARN));
    if (m) return m[1];
  } catch { /* unreadable plugin must never crash a Stop hook */ }
  return fallback;
}

const LEARN_PROMPT_HEAD = pluginLiteral('LEARN_PROMPT_HEAD',
  'Distil at most one durable, reusable memory from the notes below. '
  + 'When in doubt, output exactly: NOTHING.');
const AGENT_LESSON_PROMPT = pluginLiteral('AGENT_LESSON_PROMPT',
  'Output AT MOST ONE line: a durable lesson about how this agent should '
  + 'operate on a future dispatch. Else output exactly: NOTHING.');

/** `resolve_agent_name` — a safe agent slug from a raw field value, or null. */
export function resolveAgentName(raw) {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  return name && AGENT_NAME_RE.test(name) ? name : null;
}

/** `append_agent_lesson` — one dated bullet, capped at the newest MAX_AGENT_BULLETS. */
export function appendAgentLesson(memDir, agent, lesson) {
  const d = path.join(memDir, 'agents');
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${agent}.md`);
  let bullets = [];
  if (existsSync(f)) bullets = pySplitlines(readText(f)).filter((l) => l.startsWith('- '));
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`
    + `${String(now.getDate()).padStart(2, '0')}`;
  bullets.push(`- ${day}: ${pyWords(lesson).join(' ')}`);
  bullets = bullets.slice(-MAX_AGENT_BULLETS);
  writeText(f, `# ${agent} \u2014 lessons\n${bullets.join('\n')}\n`);
  return f;
}

/** The lifecycle-hook payload if stdin is one, else `{}`. */
function hookMeta(raw) {
  const s = raw.trim();
  if (s.slice(0, 1) !== '{') return {};
  try { return JSON.parse(s); } catch { return {}; }
}

/** Flatten a message `content` field (string, or a list of blocks) to text. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block === 'object' && block.type === 'text') {
        parts.push(block.text === undefined ? '' : block.text);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/** Render a Claude-Code-style JSONL transcript into `role: text` notes. */
function flattenTranscript(p) {
  let raw;
  try {
    // `errors="replace"`: Node's utf8 decoder already substitutes U+FFFD.
    raw = readText(p);
  } catch {
    return '';
  }
  const acc = [];
  for (let line of pySplitlines(raw)) {
    line = line.trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const msg = obj.message || {};
    const role = msg.role || obj.role || obj.type;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = contentText(msg.content === undefined ? obj.content : msg.content).trim();
    if (text) acc.push(`${role}: ${text}`);
  }
  return acc.join('\n\n');
}

/**
 * `_read_notes` — a lifecycle-hook payload with a `transcript_path` is read and flattened
 * (this is what makes wiring `learn` to a Stop hook work with no redirection); anything
 * else is used as-is.
 */
function readNotes(raw) {
  const s = raw.trim();
  if (!s) return '';
  if (s[0] === '{') {
    let payload;
    try { payload = JSON.parse(s); } catch { return raw; }
    const tp = payload && payload.transcript_path;
    if (tp) return flattenTranscript(tp);
    return raw;
  }
  return raw;
}

/**
 * `_resolve_memory_dir` — where learn dedups and indexes.
 *
 * Precedence: `--memory` > `$GENESEED_MEMORY` > a `memory/` (or `anamnesis/`) beside cwd
 * or under `./Harness` > `$GENESEED_HARNESS/memory` > the OpenCode GLOBAL config dir's
 * store. The last two matter for the recommended opencode-global install, whose store
 * lives in `~/.config/opencode` rather than beside any repo. null => stdout-only.
 */
export function resolveMemoryDir(explicit) {
  if (explicit) {
    const p = pyStrPath(explicit);
    return isDir(p) ? p : null;
  }
  const env = process.env.GENESEED_MEMORY;
  if (env && isDir(env)) return pyStrPath(env);
  const cwd = process.cwd();
  const bases = [cwd, path.join(cwd, 'Harness')];
  const gh = process.env.GENESEED_HARNESS;
  if (gh) bases.push(expanduser(gh));
  try { bases.push(opencodeConfigDir()); } catch { /* best-effort, as the Python */ }
  for (const base of bases) {
    for (const name of MEMORY_DIR_NAMES) {
      const cand = path.join(base, name);
      if (isDir(cand)) return cand;
    }
  }
  return null;
}

/** `_frontmatter` — leading YAML-ish frontmatter as a flat map, plus the body. */
function frontmatter(md) {
  const m = FRONTMATTER_RE.exec(md);
  if (!m) return [new Map(), md];
  const fm = new Map();
  for (const line of pySplitlines(m[1])) {
    const at = line.indexOf(':');
    if (at >= 0) {
      // `str.strip('"')` strips the character from BOTH ends, however many there are.
      fm.set(line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"+|"+$/g, ''));
    }
  }
  return [fm, m[2]];
}

const fmGet = (fm, key) => (fm.has(key) ? fm.get(key) : '');

/** `Path.stem` for a filename. */
const stem = (name) => path.basename(name, path.extname(name));

/** `mem_dir.glob("*.md")` — case-INSENSITIVE on Windows, as pathlib's glob is. */
function globMd(dir) {
  return listDir(dir).filter((n) => normcase(n).endsWith('.md')
    && isFile(path.join(dir, n)));
}

/** `_existing_slugs` — slugs already stored, so learn never re-emits a known fact. */
function existingSlugs(memDir) {
  const skip = new Set(['memory', 'readme']);
  return new Set(globMd(memDir).map(stem).filter((s) => !skip.has(s.toLowerCase())));
}

function buildLearnPrompt(notes, existing) {
  const parts = [LEARN_PROMPT_HEAD, ''];
  if (existing.size) {
    parts.push('ALREADY STORED \u2014 do NOT emit a memory matching any of these '
      + 'slugs (skip updates too; only genuinely new facts):');
    parts.push(...[...existing].sort().map((slug) => `- ${slug}`));
    parts.push('');
  }
  parts.push('NOTES:', notes);
  return parts.join('\n');
}

/**
 * `_write_memories` — split the model output into files, write each NEW one, and append a
 * pointer line to MEMORY.md. `existing` is MUTATED, so a reply carrying the same slug
 * twice writes it once.
 */
function writeMemories(modelOutput, memDir, existing) {
  const written = [];
  const indexLines = [];
  for (let chunk of modelOutput.split(FILE_SEP_RE)) {
    chunk = chunk.trim();
    if (!chunk || chunk.toUpperCase() === 'NOTHING') continue;
    const [fm] = frontmatter(chunk);
    const name = fmGet(fm, 'name').trim();
    if (!name || existing.has(name)) continue;
    writeText(path.join(memDir, `${name}.md`), `${chunk.replace(/\n+$/, '')}\n`);
    existing.add(name);
    written.push(name);
    const desc = fmGet(fm, 'description').trim();
    indexLines.push(`- [${name}](${name}.md)${desc ? ` \u2014 ${desc}` : ''}`);
  }
  if (indexLines.length) {
    const index = path.join(memDir, 'MEMORY.md');
    const current = existsSync(index) ? `${readText(index).replace(/\n+$/, '')}\n`
      : '# Memory Index\n';
    writeText(index, `${current}${indexLines.join('\n')}\n`);
  }
  return written;
}

/**
 * `consolidate_memory` — rebuild MEMORY.md from the fact files actually on disk: index
 * orphans, prune dead lines, report duplicate descriptions (never auto-merge — nuance is
 * the user's to keep).
 */
export function consolidateMemory(memDir) {
  const skip = new Set(['memory', 'readme']);
  const facts = new Map();
  for (const name of sortPaths(globMd(memDir))) {
    const s = stem(name);
    if (skip.has(s.toLowerCase())) continue;
    try {
      facts.set(s, fmGet(frontmatter(readText(path.join(memDir, name)))[0], 'description').trim());
    } catch { continue; }
  }
  const index = path.join(memDir, 'MEMORY.md');
  const oldSlugs = new Set();
  if (existsSync(index)) {
    for (const line of pySplitlines(readText(index))) {
      const m = /^- \[[^\]]*\]\(([^)]+)\.md\)/.exec(line.trim());
      if (m) oldSlugs.add(m[1]);
    }
  }
  const lines = ['# Memory Index', ''];
  for (const [slug, desc] of facts) {
    lines.push(`- [${slug}](${slug}.md)${desc ? ` \u2014 ${desc}` : ''}`);
  }
  writeText(index, `${lines.join('\n')}\n`);
  const seen = new Map();
  const dups = [];
  for (const [slug, desc] of facts) {
    if (desc && seen.has(desc)) dups.push([seen.get(desc), slug]);
    if (!seen.has(desc)) seen.set(desc, slug);
  }
  const added = [...facts.keys()].filter((s) => !oldSlugs.has(s)).sort();
  const pruned = [...oldSlugs].filter((s) => !facts.has(s)).sort();
  return { added, pruned, duplicates: dups };
}

/**
 * The model CLI, run as `$GENESEED_LLM`'s words plus the prompt.
 *
 * `encoding="utf-8"` on the Python side and `'utf8'` here, never the console code page: a
 * distilled memory carrying an accent or an em dash is WRITTEN to the store, so a
 * mis-decode outlives the process. `maxBuffer` is lifted off Node's 1 MB default, which
 * would truncate a long reply into a silently-half-parsed set of memory files.
 */
function runLlm(llm, prompt) {
  const argv = pyWords(llm);
  const proc = spawnSync(argv[0], [...argv.slice(1), prompt],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // Universal newlines, because Python reads the pipe in TEXT mode: a model CLI that is
  // itself a Python script emits CRLF on Windows, `subprocess` folds it to `\n`, and
  // `write_text` expands it again on the way into the memory file. Node hands back the raw
  // bytes, so without this the stored fact is written with `\r\r\n` on every line.
  const universal = (s) => (s === null || s === undefined ? ''
    : String(s).replaceAll('\r\n', '\n').replaceAll('\r', '\n'));
  return {
    stdout: universal(proc.stdout),
    stderr: universal(proc.stderr),
    // A spawn that never started is Python's FileNotFoundError, which propagates there;
    // here it surfaces as a non-zero code with the reason on stderr rather than a stack.
    returncode: proc.error ? 1 : (proc.status === null ? 1 : proc.status),
    error: proc.error,
  };
}

/**
 * `_learn_agent_lesson` — the SubagentStop path: at most one per-agent lesson into
 * `memory/agents/<name>.md`. Skips silently when the host does not name the subagent:
 * parity of mechanism, degrading to a no-op, never a crash.
 */
function learnAgentLesson(meta, notes, args) {
  let agent = null;
  for (const field of SUBAGENT_NAME_FIELDS) {
    agent = resolveAgentName(meta[field]);
    if (agent) break;
  }
  if (!agent) return 0;
  const memDir = resolveMemoryDir(args.memory);
  if (!memDir) return 0;
  const prompt = [AGENT_LESSON_PROMPT, '', 'NOTES:', notes].join('\n');
  const llm = process.env.GENESEED_LLM;
  if (!llm) {
    err('[learn] $GENESEED_LLM unset \u2014 printing agent-lesson prompt.\n\n');
    out(`${prompt}\n`);
    return 0;
  }
  const proc = runLlm(llm, prompt);
  const text = proc.stdout.trim();
  if (text && text.toUpperCase() !== 'NOTHING') {
    const lesson = pySplitlines(text)[0].replace(/^[-*]+/, '').trim();
    const n = Array.from(lesson).length;   // code points, as `len()` counts them
    if (n >= 10 && n <= 300) {
      err(`[learn] agent lesson -> ${appendAgentLesson(memDir, agent, lesson)}\n`);
    }
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
  return proc.returncode;
}

export function cmdLearn(args) {
  if (args.consolidate) {
    const memDir = resolveMemoryDir(args.memory);
    if (!memDir) {
      err('[learn] no memory store found \u2014 nothing to consolidate.\n');
      return 0;
    }
    const report = consolidateMemory(memDir);
    err(`[learn] consolidated ${memDir}: +${report.added.length} indexed, `
      + `-${report.pruned.length} pruned, `
      + `${report.duplicates.length} duplicate description(s)\n`);
    for (const [a, b] of report.duplicates) err(`  duplicate: ${a} <-> ${b}\n`);
    return 0;
  }

  // The Stop/SubagentStop hook always passes `--memory <cfg>/memory`; inside an excluded
  // folder the global install must not learn.
  if (args.memory && sovereignBypass(path.dirname(pyStrPath(args.memory)))) return 0;

  const raw = args.file ? readText(args.file) : readStdin();
  let notes = readNotes(raw);
  if (!notes.trim()) {
    err('[learn] no notes or transcript content \u2014 nothing to distil.\n');
    return 0;
  }
  notes = tail(notes, MAX_NOTES_CHARS);   // keep the tail: most recent, most durable

  const meta = hookMeta(raw);
  if (meta.hook_event_name === 'SubagentStop') return learnAgentLesson(meta, notes, args);

  const memDir = resolveMemoryDir(args.memory);
  const existing = memDir ? existingSlugs(memDir) : new Set();
  const prompt = buildLearnPrompt(notes, existing);

  const llm = process.env.GENESEED_LLM;
  if (!llm) {
    err('[learn] $GENESEED_LLM unset \u2014 printing prompt instead.\n\n');
    out(`${prompt}\n`);
    return 0;
  }

  const proc = runLlm(llm, prompt);
  const output = proc.stdout;
  if (memDir && output.trim() && output.trim().toUpperCase() !== 'NOTHING') {
    const written = writeMemories(output, memDir, existing);
    if (written.length) {
      err(`[learn] wrote ${written.length} memory file(s) to `
        + `${memDir}: ${written.join(', ')}\n`);
    } else {
      err('[learn] nothing new to store (all duplicates).\n');
    }
  } else {
    out(output);
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
  return proc.returncode;
}
