/**
 * The fold: a global install's own stores move into the shared tier, once, in the emit (D2).
 *
 * Nothing here deletes. A file reaches the tier through a temp name and a rename, is read back,
 * and only then does the host copy move aside (`archiveStore`, D10). A failed copy keeps the old
 * store readable, because the host layer still serves it, and the next emit retries from the
 * files on disk: there is no progress record to go stale.
 *
 * THE TEMP NAME IS WHAT MAKES A RETRY SAFE. A torn `x.md` in the tier would differ from its source
 * on the next run and become a permanent `x-<host>.md` collision.
 *
 * A SECOND RUN WRITES NOTHING, and no test of bytes alone can see that. A folded host holds seeds,
 * which every step passes over; `.fold-state.json` (C7) holds what stays behind on purpose.
 *
 * `user-rules.md` is the next slice's (fold step 5), and a host `user-rules.draft.md` is not the
 * fold's at all (C18). Spawn-free, and it reaches neither `js/maintain` nor `js/web` (C20).
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { EXCLUDES_FILE, isCanonical } from '../hosts/hosts.mjs';
import { listDir } from '../hosts/hooks-prims.mjs';
import { archiveStore, consolidateMemory, existingSlugs, MEMORY_SEED } from '../hosts/memory-files.mjs';
import { foldExcludes } from '../inspect/excludes.mjs';
import { isDir, isFile, printErr, printOut, readText, writeTextAtomic } from '../lib/fs.mjs';
import { jsonDumpsIndent } from '../lib/json.mjs';
import { LEGACY_WIKI_SEED, NOTES_DIRS, WIKI_NAMES, sharedPaths } from '../lib/machine-dir.mjs';
import { normcase } from '../lib/paths.mjs';
import {
  SESSION_SEEDS, WIKI_FILE, ensureMemoryIndex, ensureProfileStub, ensureWikiStub,
} from './stubs.mjs';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
/** A seed as the context hook hashes it: CRLF folded, because `writeText` expands it on Windows. */
const seedHash = (bytes) => sha256(bytes.toString('utf8').replaceAll('\r\n', '\n'));
const WHOLE_FILE_SEEDS = new Set([sha256(SESSION_SEEDS['PROFILE.md']), sha256(SESSION_SEEDS[WIKI_FILE]),
  LEGACY_WIKI_SEED]);
const isWholeFileSeed = (bytes) => WHOLE_FILE_SEEDS.has(seedHash(bytes));

/** A folded store keeps these: the re-seed restores them, and their text never says "not folded". */
const STORE_KEEPS = ['README.md', '.gitignore'];
const DRAFT_HEAD = '# User rules — draft\n\nNot active. The rule Rite applies decisions.\n';

/** `bytes` at `dest`, or nothing there: a short write fails on its temp name, never on `dest`. */
function landFile(dest, bytes) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.fold-tmp`;
  try {
    writeFileSync(tmp, bytes);
    if (!readFileSync(tmp).equals(bytes)) throw new Error(`a short write to ${dest}`);
    renameSync(tmp, dest);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* a stray temp name is no fact; the error below matters */ }
    throw e;
  }
}

/**
 * Where `bytes` called `name` belong in `dir`: the first of `name`, `<stem>-<host>`,
 * `<stem>-<host>-2`, … that is free or already holds them. Walking the same chain makes a repeat
 * land on its own earlier copy, so a collision is written once.
 */
function landing(bytes, name, dir, host) {
  const { name: stem, ext } = path.parse(name);
  for (let n = 1; ; n += 1) {
    const dest = path.join(dir, n === 1 ? name : `${stem}-${host}${n === 2 ? '' : `-${n - 1}`}${ext}`);
    if (!existsSync(dest)) return { dest, write: true, collision: n > 1 };
    if (readFileSync(dest).equals(bytes)) return { dest, write: false, collision: false };
  }
}

/** Fold step 1's copy rule over `names` in `srcDir`. Returns the [source, landed] pairs to verify. */
function copyFiles(names, srcDir, destDir, ctx, tally) {
  const { host, dryRun, report } = ctx;
  const pairs = [];
  for (const name of names) {
    const src = path.join(srcDir, name);
    const bytes = readFileSync(src);
    const { dest, write, collision } = landing(bytes, name, destDir, host);
    pairs.push([src, dest]);
    if (!write) continue;
    report[tally] += 1;
    if (collision) report.collisions += 1;
    if (!dryRun) landFile(dest, bytes);
  }
  return pairs;
}

function verifyCopies(pairs) {
  for (const [src, dest] of pairs) {
    if (!readFileSync(src).equals(readFileSync(dest))) throw new Error(`${dest} does not match ${src}`);
  }
}

/** A lesson file's lessons: every line that is not blank and not a heading, CRLF folded. */
const lessonsOf = (text) => text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));

/**
 * `agents/<name>.md`: one tier file per agent, so hosts merge by line rather than collide. No cap
 * here (`appendAgentLesson`'s is the writer's): verification needs every source line present.
 * Returns the [source, landed] pairs for `verifyLessons`.
 */
function foldLessons(store, tierMemory, { dryRun, report }) {
  const srcDir = path.join(store, 'agents');
  const pairs = [];
  for (const name of listDir(srcDir).filter((n) => n.endsWith('.md')).sort()) {
    const src = path.join(srcDir, name);
    const dest = path.join(tierMemory, 'agents', name);
    const raw = readFileSync(src);
    const lessons = lessonsOf(raw.toString('utf8'));
    pairs.push([src, dest]);
    if (!existsSync(dest)) {
      report.lessons += lessons.length;
      if (!dryRun) landFile(dest, raw);
      continue;
    }
    const text = readFileSync(dest, 'utf8');
    const have = new Set(lessonsOf(text));
    const missing = [...new Set(lessons)].filter((l) => !have.has(l));
    if (!missing.length) continue;
    report.lessons += missing.length;
    if (dryRun) continue;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const sep = text.endsWith('\n') || !text ? '' : eol;
    landFile(dest, Buffer.from(`${text}${sep}${missing.join(eol)}${eol}`));
  }
  return pairs;
}

function verifyLessons(pairs) {
  for (const [src, dest] of pairs) {
    const have = new Set(lessonsOf(readFileSync(dest, 'utf8')));
    const lost = lessonsOf(readFileSync(src, 'utf8')).find((l) => !have.has(l));
    if (lost !== undefined) throw new Error(`${dest} lacks a lesson of ${src}`);
  }
}

/** Does the store hold anything a seeded one does not? The whole trigger: a seed folds to nothing. */
function storeHolds(store) {
  return listDir(store).some((name) => {
    if (STORE_KEEPS.includes(name)) return false;
    const p = path.join(store, name);
    if (isDir(p)) return listDir(p).length > 0;
    return name !== 'MEMORY.md' || seedHash(readFileSync(p)) !== sha256(MEMORY_SEED);
  });
}

/** One directory under two names: a store a user already linked to the tier has nothing to fold. */
function sameDir(a, b) {
  try { return normcase(realpathSync(a)) === normcase(realpathSync(b)); } catch { return false; }
}

const factNames = (store) => [...existingSlugs(store)].map((s) => `${s}.md`).sort();

/** Fold steps 1 and 6. `topics/`, `MEMORY.md`, `archive/` are not copied: the archive keeps them. */
function foldMemory(cfgDir, ctx) {
  const { shared, dryRun, report } = ctx;
  const store = path.join(cfgDir, 'memory');
  if (sameDir(store, shared.memory) || !storeHolds(store)) return;
  const names = factNames(store);
  const facts = copyFiles(names, store, shared.memory, ctx, 'facts');
  const lessons = foldLessons(store, shared.memory, ctx);
  if (dryRun) {
    report.archived = path.join(cfgDir, 'archived-memory');
    return;
  }
  verifyCopies(facts);
  verifyLessons(lessons);
  // A fact the `learn` hook wrote during the copy would reach only the archive: wait for the next emit.
  if (factNames(store).join('\n') !== names.join('\n')) throw new Error(`${store} changed during the fold`);
  consolidateMemory(shared.memory);
  report.archived = archiveStore(store);
  mkdirSync(store, { recursive: true });
  for (const keep of STORE_KEEPS) {
    const kept = path.join(report.archived, keep);
    if (isFile(kept)) copyFileSync(kept, path.join(store, keep));
  }
  ensureMemoryIndex(store);
}

/**
 * Fold step 2. The host notes then move aside, as a store does: they would otherwise differ from
 * a tier note the moment an agent edits it, and the next fold would write the stale text back as
 * a collision. `collectNotes` would also list each one twice while both exist.
 */
function foldNotes(cfgDir, ctx) {
  const { shared, dryRun } = ctx;
  for (const sub of NOTES_DIRS) {
    const src = path.join(cfgDir, 'notebook', sub);
    const names = listDir(src).filter((n) => n.endsWith('.md') && isFile(path.join(src, n))).sort();
    if (!names.length) continue;
    const pairs = copyFiles(names, src, path.join(shared.notes, sub), ctx, 'notes');
    if (dryRun) continue;
    verifyCopies(pairs);
    archiveStore(src);
  }
}

/**
 * The ledger, or an empty one. A file that does not parse throws: treating it as empty would draft
 * every decided item again, and the failed step is what the user should see.
 */
function readFoldState(shared) {
  if (!existsSync(shared.foldState)) return { version: 1, items: {} };
  const state = JSON.parse(readFileSync(shared.foldState, 'utf8'));
  state.items ??= {};
  return state;
}

/**
 * A pointer in the draft, never a copy (C9), and a C7 record. The key names the host too, so two
 * hosts holding the same differing text are two decisions, and each gets its file set aside.
 * Draft first: a stop between the writes leaves a block the next run recognises, not a lost one.
 */
function draftChoice(kind, hostFile, sharedFile, bytes, { host, shared, dryRun, report }) {
  const state = readFoldState(shared);
  const key = createHash('sha256').update(`${kind}\0${host}\0`).update(bytes).digest('hex');
  if (state.items[key]) return;
  report.pending += 1;
  if (dryRun) return;
  const text = existsSync(shared.draft) ? readText(shared.draft) : DRAFT_HEAD;
  if (!text.includes(`sha256: ${key}`)) {
    writeTextAtomic(shared.draft, `${text}\n## Choose: ${path.basename(sharedFile)}\n`
      + `(hosts: shared, ${host} | paths: ${sharedFile}, ${hostFile} | sha256: ${key})\n`
      + 'Which one becomes the shared file?\n');
  }
  state.items[key] = { kind, host, state: 'pending' };
  writeTextAtomic(shared.foldState, `${jsonDumpsIndent(state)}\n`);
}

/**
 * Fold step 4 for one whole file, over each name it has gone by. The re-seed waits for the end of
 * the walk: `ensureWikiStub` renames a legacy file it finds, and this walk has not reached it yet.
 */
function foldWholeFile(kind, hostFiles, sharedFile, reseed, ctx) {
  const { dryRun, report } = ctx;
  let setAside = false;
  for (const file of hostFiles) {
    if (!isFile(file)) continue;
    const bytes = readFileSync(file);
    if (isWholeFileSeed(bytes)) continue;
    const held = isFile(sharedFile) ? readFileSync(sharedFile) : null;
    const same = held !== null && held.equals(bytes);
    if (held !== null && !same && !isWholeFileSeed(held)) {
      draftChoice(kind, file, sharedFile, bytes, ctx);
      continue;
    }
    if (!same) report.moved.push(kind);
    if (dryRun) continue;
    if (!same) landFile(sharedFile, bytes);
    verifyCopies([[file, sharedFile]]);
    archiveStore(file);
    setAside = true;
  }
  if (setAside) reseed();
}

/**
 * Fold one host. Never throws: a step that fails lands in `report.failed`, the steps after it
 * still run, and what it did not finish stays in place for the next emit. `dryRun` walks the same
 * code and writes nothing, so each host's preview is read against the tier as it stands.
 */
export function foldHost({ host, cfgDir, shared, dryRun = false }) {
  const report = {
    host, facts: 0, lessons: 0, notes: 0, excludes: 0, wired: 0, collisions: 0, pending: 0,
    moved: [], archived: null, failed: [],
  };
  const step = (name, fn) => {
    try { fn(); } catch (e) { report.failed.push(`${name}: ${e.message}`); }
  };
  const ctx = { host, shared, dryRun, report };
  step('memory', () => foldMemory(cfgDir, ctx));
  step('notes', () => foldNotes(cfgDir, ctx));
  step(EXCLUDES_FILE, () => {
    const { added, wired } = foldExcludes(host, cfgDir, dryRun);
    report.excludes = added;
    report.wired = wired;
  });
  step('profile', () => foldWholeFile('profile', [path.join(cfgDir, 'PROFILE.md')], shared.profile,
    () => ensureProfileStub(cfgDir), ctx));
  step('wiki', () => foldWholeFile('wiki', WIKI_NAMES.map((n) => path.join(cfgDir, n)), shared.wiki,
    () => ensureWikiStub(cfgDir), ctx));
  return report;
}

const counted = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A report as the words after `<host>: `, or '' when it did nothing (C7: nothing is reported twice). */
export function foldSummary(r) {
  return [
    r.facts && `${counted(r.facts, 'fact')} folded`,
    r.lessons && counted(r.lessons, 'lesson'),
    r.notes && counted(r.notes, 'note'),
    r.excludes && counted(r.excludes, 'exclude path'),
    r.wired && `${counted(r.wired, 'excluded folder')} wired`,
    ...r.moved.map((kind) => `${kind} moved`),
    r.collisions && counted(r.collisions, 'collision'),
    r.pending && `${r.pending} to approve`,
    r.archived && 'old store moved aside',
  ].filter(Boolean).join(', ');
}

/** The emit's call, on a canonical install only: `diff`, Restore and a stray `--config-dir` fold nothing. */
export function foldOnEmit(host, cfgDir) {
  if (!isCanonical(cfgDir, host)) return;
  const report = foldHost({ host, cfgDir, shared: sharedPaths() });
  const summary = foldSummary(report);
  if (summary) printOut(`[shared] ${host}: ${summary}\n`);
  for (const f of report.failed) {
    printErr(`[shared] ${host}: fold stopped at ${f}; what was not folded stays in place, `
      + 'and the next emit retries\n');
  }
}
