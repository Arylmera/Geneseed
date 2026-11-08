/**
 * THE CHANGE REPORT: tells the user that a rule, profile, wiki manifest or memory file changed in
 * a session with no approval. It detects; it prevents nothing. Shell is no boundary (the gates read
 * only parsed forms), so this is what still catches a write they never saw, at the end of the turn.
 *
 * OFF THE PER-CALL PATH. Nothing here loads on a tool call. The hook entry takes the baseline after
 * `context` has answered, once per session, and `learn` compares on Stop. Both are stats, no reads.
 *
 * WHAT COUNTS AS APPROVED, per host. Claude and OpenClaude: a Write, Edit or NotebookEdit the
 * transcript shows ran: a rule write runs only past the host's prompt, and a memory write is the
 * agent's own to make (owner decision, 2026-11-08). The transcript is read only when a file changed,
 * which keeps the common Stop to the stats. Bob has no transcript, so every change there is
 * reported, a free memory write included. With process 1 excluded (`ruleStore: false`, the hook's
 * `--no-rule-store`) a rule write runs with no prompt, so a rule file is never counted as approved and
 * the report still shows it; memory keeps its excuse. OpenCode has this logic in the guard plugin, with the
 * baseline in memory and approval from `tool.execute.after`. A memory write by shell is reported on
 * every host: that, and the web console, is how the user sees what the agent chose to remember.
 *
 * GENESEED'S OWN WRITES. `learn`, a memory removal and the fold run inside `recordOwnWrites`, which
 * snapshots the store around the run and logs what moved to `memory/.own-writes.json`, as an exact
 * size and mtime. A change matching the log is not reported. Limits: a write by anything else during
 * that window is excused too, and the log is a plain file an agent could edit. Nothing the web
 * console writes is logged, its decisions on the draft included: its token is readable by anything
 * on the machine, so a POST proves no click, and logging one would let an agent hide a write. So a
 * real click reads as a change, and the line says that may be what it is.
 *
 * WHAT IT CANNOT TELL. Approval is per session, and the tier is shared: another session's approved
 * write reads as a change here, so the line says so rather than call it unapproved. A Claude
 * sub-agent's write sits in its own transcript and reads the same way. shortcut: a false alarm, the
 * safe direction; read the sidechain files here if that proves noisy.
 *
 * WHAT IT CANNOT RESIST. The baseline, like the own-writes log, is a plain file in the install, and
 * an agent that can write there can edit it, or set a file's size and time back. The report is
 * evidence against a careless or a weak agent, not a control against a determined one.
 *
 * Every entry swallows its errors: a report that cannot be made must never change a hook's verdict.
 * Nothing here prints. The caller decides where the line goes, because a Stop's stdout is one document.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { machineDir } from '../lib/machine-dir.mjs';
import { gitRootOf } from './gitref.mjs';
import { normcase } from '../lib/paths.mjs';
import { sovereignBypass } from './hosts.mjs';

const STATE_DIR = path.join('notebook', 'store-baseline');
const OWN_LOG = '.own-writes.json';
const OWN_LOG_CAP = 2000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const NAMES_SHOWN = 5;
// The coined rule-file names, at the end of a `normcase`d path (lower case on Windows).
const RULE_FILE_RE = /[\\/]user-rules(?:\.draft)?\.md$/i;

/** The store files under one home, as `path -> "size:mtime"`. The guard's `storeScan` is its twin. */
export function storeScan(home, found = {}) {
  const stamp = (f) => {
    try { const s = statSync(f); if (s.isFile()) found[f] = `${s.size}:${Math.trunc(s.mtimeMs)}`; } catch { /* absent */ }
  };
  for (const n of ['user-rules.md', 'user-rules.draft.md', 'PROFILE.md', 'geneseed-wiki.jsonc', 'wiki.jsonc', 'wiki.json']) stamp(path.join(home, n));
  const walk = (dir) => {
    let items = [];
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      if (e.isDirectory()) { if (e.name !== 'archive' && !e.name.startsWith('archived-')) walk(path.join(dir, e.name)); }
      else if (e.name.endsWith('.md')) stamp(path.join(dir, e.name));
    }
  };
  walk(path.join(home, 'memory'));
  return found;
}

const homesOf = (root) => [...new Set([root, machineDir()])];
const stampOf = (f, found) => {
  try { const s = statSync(f); if (s.isFile()) found[f] = `${s.size}:${Math.trunc(s.mtimeMs)}`; } catch { /* absent */ }
  return found;
};
/**
 * The project layer's rule files, which the context hook loads from the session's repository: its git
 * root, else `cwd`. Only the two rule names: a repo's own `memory/` folder is not a store.
 */
function projectRules(cwd, found) {
  if (typeof cwd !== 'string' || !cwd) return found;
  const top = gitRootOf(cwd) ?? path.resolve(cwd);
  for (const n of ['user-rules.md', 'user-rules.draft.md']) stampOf(path.join(top, n), found);
  return found;
}
const scanAll = (root, cwd = null) => projectRules(cwd, homesOf(root).reduce((found, h) => storeScan(h, found), {}));
const stateFile = (root, sid) => path.join(root, STATE_DIR, `${String(sid).replace(/[^\w.-]/g, '_').slice(0, 120)}.json`);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

function saveBaseline(root, sid, stamps) {
  const f = stateFile(root, sid);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(stamps));
}

/**
 * The session's baseline, written once. SessionStart fires again on resume and compact: keeping the
 * first one means those cannot launder a change made before them. Old sessions' files are dropped.
 */
export function writeBaseline(root, sid, cwd = null) {
  try {
    if (typeof sid !== 'string' || !sid || sovereignBypass(root)) return;
    const f = stateFile(root, sid);
    if (existsSync(f)) return;
    saveBaseline(root, sid, scanAll(root, cwd));
    const dir = path.dirname(f);
    for (const n of readdirSync(dir)) {
      const old = path.join(dir, n);
      if (Date.now() - statSync(old).mtimeMs > STALE_MS) unlinkSync(old);
    }
  } catch { /* no notebook, or a read-only install: no report */ }
}

/** What differs between two scans, sorted. */
export function changedFiles(before, now) {
  return [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((f) => before[f] !== now[f]).sort();
}

/**
 * Run `fn`, Geneseed's own writer, and log what it moved under `home`. A throw from `fn` still logs
 * and still propagates. `home` is the folder holding `memory/`.
 */
export function recordOwnWrites(home, fn) {
  let before = null;
  try { before = storeScan(home); } catch { /* the write still runs */ }
  try { return fn(); } finally {
    try {
      if (before) {
        const now = storeScan(home);
        const moved = changedFiles(before, now);
        if (moved.length) {
          const f = path.join(home, 'memory', OWN_LOG);
          const log = { ...readJson(f) };
          for (const p of moved) { delete log[p]; log[p] = now[p] ?? 'gone'; }
          const kept = Object.entries(log).slice(-OWN_LOG_CAP);
          mkdirSync(path.dirname(f), { recursive: true });
          writeFileSync(f, JSON.stringify(Object.fromEntries(kept)));
        }
      }
    } catch { /* the log never fails a write */ }
  }
}

/** The files the transcript shows a file tool really wrote: a tool_use whose result was no error. */
export function approvedInTranscript(file, cwd) {
  const asked = new Map();
  const failed = new Set();
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return new Set(); }
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const blocks = row?.message?.content;
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (b?.type === 'tool_use' && /^(?:Write|Edit|MultiEdit|NotebookEdit)$/.test(b.name)) {
        const p = b.input?.file_path ?? b.input?.notebook_path;
        if (typeof p === 'string') asked.set(b.id, normcase(path.resolve(cwd || process.cwd(), p)));
      } else if (b?.type === 'tool_result' && b.is_error) failed.add(b.tool_use_id);
    }
  }
  return new Set([...asked].filter(([id]) => !failed.has(id)).map(([, p]) => p));
}

/** The line the user reads. The guard's `storeLine` is its twin, same words. */
export function storeLine(files) {
  const shown = files.slice(0, NAMES_SHOWN).map((f) => f.split(/[\\/]/).slice(-2).join('/')).join(', ');
  const more = files.length > NAMES_SHOWN ? ` (+${files.length - NAMES_SHOWN} more)` : '';
  return `Geneseed change report: ${files.length} rule or memory file${files.length === 1 ? '' : 's'} `
    + `changed outside this session's approved writes (another session, or a decision of yours in the web console, may have made it): ${shown}${more}. `
    + 'This detects a change; it prevented nothing.';
}

/** What `geneseed status` shows: the last report, machine-wide, written only where the tier exists. */
function noteForStatus(files, host) {
  try {
    const dir = machineDir();
    if (existsSync(dir)) writeFileSync(path.join(dir, '.store-report.json'), JSON.stringify({ at: new Date().toISOString(), host, files }));
  } catch { /* an unwritable status file must not swallow the report */ }
}

/** The last report within the stale window, or null. For `geneseed status`. */
export function lastStoreReport() {
  try {
    const r = readJson(path.join(machineDir(), '.store-report.json'));
    return r && Array.isArray(r.files) && Date.now() - Date.parse(r.at) < STALE_MS ? r : null;
  } catch { return null; } // no home directory: `status` must still answer
}

/**
 * Compare at a turn's end: the line to show, or null. Rolls the baseline, so a change is said once,
 * and a session with no baseline (installed mid-session) starts one here. `transcript` is null on Bob.
 * `ruleStore: false`: process 1 is off, so no rule write passed a prompt (the header says why).
 */
export function storeReport(root, sid, { transcript = null, cwd = null, host = 'claude', ruleStore = true } = {}) {
  try {
    if (typeof sid !== 'string' || !sid) return null;
    const before = readJson(stateFile(root, sid));
    if (!before) { writeBaseline(root, sid, cwd); return null; }
    // Every file the baseline names is stamped again, so a session whose cwd moved still compares
    // the project files it started with.
    const now = Object.keys(before).reduce((found, p) => stampOf(p, found), scanAll(root, cwd));
    const changed = changedFiles(before, now);
    if (!changed.length) return null;
    saveBaseline(root, sid, now);
    const own = homesOf(root).reduce((log, h) => ({ ...log, ...readJson(path.join(h, 'memory', OWN_LOG)) }), {});
    const approved = typeof transcript === 'string' ? approvedInTranscript(transcript, cwd) : new Set();
    if (!ruleStore) for (const f of approved) if (RULE_FILE_RE.test(f)) approved.delete(f);
    const files = changed.filter((f) => own[f] !== (now[f] ?? 'gone') && !approved.has(normcase(f)));
    if (!files.length) return null;
    noteForStatus(files, host);
    return storeLine(files);
  } catch { return null; }
}
