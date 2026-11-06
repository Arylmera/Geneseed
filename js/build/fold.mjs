/**
 * The fold: a global install's own stores move into the shared tier, once, in the emit (D2).
 *
 * Nothing here deletes. A file reaches the tier through a temp name, is read back,
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
 * A RULE LEAVES A HOST FILE ONLY WHEN THE SHARED FILE ALREADY HOLDS IT (`foldRules`): everything
 * else stays there, in force, until the user decides. A host `user-rules.draft.md` is not the
 * fold's at all (C18). Spawn-free, and it reaches neither `js/maintain` nor `js/web` (C20).
 */
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync,
  rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { EXCLUDES_FILE, isCanonical } from '../hosts/hosts.mjs';
import { LINE_BREAK, listDir, splitLines } from '../hosts/hooks-prims.mjs';
import {
  archiveStore, consolidateMemory, draftChoiceHead, draftRuleHead, existingSlugs, indexNotes, MEMORY_SEED, parseRules,
  readFoldState,
} from '../hosts/memory-files.mjs';
import { foldExcludes } from '../inspect/excludes.mjs';
import { recordOwnWrites } from '../hosts/store-watch.mjs';
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
const STORE_KEEPS = ['README.md', '.gitignore', '.own-writes.json'];
const DRAFT_HEAD = '# User rules — draft\n\nNot active. The rule Rite applies decisions.\n';

/**
 * Claim `dest` with the finished bytes, or throw EEXIST: a rename would replace a file another
 * process landed since the `existsSync`. A hard link is atomic and exclusive.
 * shortcut: a volume with no hard links takes the exclusive copy, which a crash can leave torn.
 */
function claimFile(tmp, dest) {
  try {
    linkSync(tmp, dest);
  } catch (e) {
    if (e.code === 'EEXIST') throw e;
    copyFileSync(tmp, dest, constants.COPYFILE_EXCL);
  }
  rmSync(tmp, { force: true });
}

/**
 * `bytes` at `dest`, or nothing there: a short write fails on its temp name, never on `dest`.
 * `exclusive` is for a name the caller found free; without it the file is meant to be replaced.
 */
function landFile(dest, bytes, { exclusive = false } = {}) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.fold-tmp`;
  try {
    writeFileSync(tmp, bytes);
    if (!readFileSync(tmp).equals(bytes)) throw new Error(`a short write to ${dest}`);
    if (exclusive) claimFile(tmp, dest);
    else renameSync(tmp, dest);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* a stray temp name is no fact; the error below matters */ }
    throw e;
  }
}

/** A path with its links resolved, for comparing. A path that does not exist yet stands for itself. */
function realOf(p) {
  try { return normcase(realpathSync.native(p)); } catch { return normcase(path.resolve(p)); }
}

/**
 * Is `src` the tier under another name, or inside it, or around it? Then moving it aside would move
 * what the tier reads, through a link either way round, and there is nothing to fold. Every
 * `archiveStore` here is behind this check, or behind `verifyCopies` for a single linked file.
 */
function sharesTier(src, shared) {
  const a = realOf(src);
  return [shared.root, shared.memory, shared.notes, ...NOTES_DIRS.map((sub) => path.join(shared.notes, sub)),
    shared.profile, shared.wiki, shared.rules].map(realOf)
    .some((b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep));
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
    // `lstat`: a dangling link reads as absent to `existsSync` and as taken to the claim.
    if (!lstatSync(dest, { throwIfNoEntry: false })) return { dest, write: true, collision: n > 1 };
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
    for (;;) {
      const { dest, write, collision } = landing(bytes, name, destDir, host);
      try {
        if (write && !dryRun) landFile(dest, bytes, { exclusive: true });
      } catch (e) {
        if (e.code === 'EEXIST') continue;      // lost the name: walk the chain again
        throw e;
      }
      pairs.push([src, dest]);
      if (write) report[tally] += 1;
      if (collision) report.collisions += 1;
      break;
    }
  }
  return pairs;
}

/**
 * Would replacing `hostFile` replace what the tier reads? Real paths, because a link anywhere on
 * the way counts: the tier file, or a folder above it. The one safe case is a host link to a tier
 * file that is no link: the rename takes the link, and the tier file stays.
 */
function isTierFile(hostFile, tierFile) {
  if (realOf(hostFile) !== realOf(tierFile)) return false;
  const isLink = (p) => lstatSync(p).isSymbolicLink();
  return !isLink(hostFile) || isLink(tierFile);
}

/** A link the fold is about to move out from under would dangle, so it stops the move. */
function refuseLink(src, dest) {
  if (realOf(src) === realOf(dest)) throw new Error(`${dest} is a link to ${src}`);
}

function verifyCopies(pairs) {
  for (const [src, dest] of pairs) {
    refuseLink(src, dest);
    if (!readFileSync(src).equals(readFileSync(dest))) throw new Error(`${dest} does not match ${src}`);
  }
}

/**
 * Lessons are compared and rewritten as BYTES: latin1 maps each byte to one character and back, so
 * a line that is not UTF-8 survives, where a UTF-8 decode would write U+FFFD over it and then
 * verify its own damage. A newline byte never sits inside a UTF-8 sequence, so lines still split.
 */
const AS_BYTES = 'latin1';

/** A lesson file's lines: every one that is not blank, CRLF folded. */
const lessonsOf = (text) => text.split(/\r?\n/).filter((l) => l.trim());

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
    const lessons = lessonsOf(raw.toString(AS_BYTES));
    pairs.push([src, dest]);
    if (!existsSync(dest)) {
      report.lessons += lessons.filter((l) => !l.startsWith('# ')).length;
      if (!dryRun) landFile(dest, raw, { exclusive: true });
      continue;
    }
    const text = readFileSync(dest, AS_BYTES);
    const have = new Set(lessonsOf(text));
    const missing = [...new Set(lessons)].filter((l) => !have.has(l));
    if (!missing.length) continue;
    report.lessons += missing.length;
    if (dryRun) continue;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const sep = text.endsWith('\n') || !text ? '' : eol;
    landFile(dest, Buffer.from(`${text}${sep}${missing.join(eol)}${eol}`, AS_BYTES));
  }
  return pairs;
}

function verifyLessons(pairs) {
  for (const [src, dest] of pairs) {
    refuseLink(src, dest);
    const have = new Set(lessonsOf(readFileSync(dest, AS_BYTES)));
    const lost = lessonsOf(readFileSync(src, AS_BYTES)).find((l) => !have.has(l));
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

/**
 * Every file under `dir` that `carried` does not claim, as `<label>/<path>`. The archive keeps them,
 * and only the report tells the user so. A link is listed, not walked: only the link moves.
 */
function leftBehind(dir, label, carried, rel = '') {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (carried(r)) return [];
    return e.isDirectory() ? leftBehind(path.join(dir, e.name), label, carried, r) : [`${label}/${r}`];
  });
}

const factNames = (store) => [...existingSlugs(store)].map((s) => `${s}.md`).sort();

/**
 * Fold steps 1 and 6. `topics/`, `MEMORY.md`, `archive/` are not copied: the archive keeps them.
 * The tier rebuilds its index from facts, so an index with a line of the user's counts as left
 * behind. A pointer is the user's too when no fact stands behind it.
 */
function foldMemory(cfgDir, ctx) {
  const { shared, dryRun, report } = ctx;
  const store = path.join(cfgDir, 'memory');
  if (sharesTier(store, shared) || !storeHolds(store)) return;
  const names = factNames(store);
  const facts = copyFiles(names, store, shared.memory, ctx, 'facts');
  const lessons = foldLessons(store, shared.memory, ctx);
  const noted = indexNotes(store, (slug) => names.includes(`${slug}.md`)).length > 0;
  const carried = new Set([...STORE_KEEPS, ...(noted ? [] : ['MEMORY.md']), 'topics', ...names,
    ...lessons.map(([src]) => `agents/${path.basename(src)}`)].map(normcase));
  const stayed = leftBehind(store, 'memory', (r) => carried.has(normcase(r)));
  if (dryRun) {
    report.stayed.push(...stayed);
    report.archived = path.join(cfgDir, 'archived-memory');
    return;
  }
  verifyCopies(facts);
  verifyLessons(lessons);
  // A fact the `learn` hook wrote during the copy would reach only the archive: wait for the next emit.
  if (factNames(store).join('\n') !== names.join('\n')) throw new Error(`${store} changed during the fold`);
  consolidateMemory(shared.memory);
  report.archived = archiveStore(store);
  report.stayedIn.memory = report.archived;
  report.stayed.push(...stayed);
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
  const { shared, dryRun, report } = ctx;
  for (const sub of NOTES_DIRS) {
    const src = path.join(cfgDir, 'notebook', sub);
    const names = listDir(src).filter((n) => n.endsWith('.md') && isFile(path.join(src, n))).sort();
    if (!names.length || sharesTier(src, shared)) continue;
    const pairs = copyFiles(names, src, path.join(shared.notes, sub), ctx, 'notes');
    const label = `notebook/${sub}`;
    const stayed = leftBehind(src, label, (r) => names.includes(r));
    if (!dryRun) {
      verifyCopies(pairs);
      report.stayedIn[label] = archiveStore(src);
    }
    report.stayed.push(...stayed);
  }
}

const itemKey = (kind, host, bytes) => createHash('sha256').update(`${kind}\0${host}\0`).update(bytes).digest('hex');

/**
 * A block in the draft and a C7 record. The key names the host too, so two hosts holding the same
 * text are two decisions. Draft first: a stop between the writes leaves a block the next run
 * recognises, not a lost one.
 */
function draftItem(kind, key, block, tally, { host, shared, dryRun, report }) {
  const state = readFoldState(shared);
  if (state.items[key]) return;
  report[tally] += 1;
  if (dryRun) return;
  const text = existsSync(shared.draft) ? readText(shared.draft) : DRAFT_HEAD;
  if (!text.includes(`sha256: ${key}`)) writeTextAtomic(shared.draft, `${text}\n${block}`);
  state.items[key] = { kind, host, state: 'pending' };
  writeTextAtomic(shared.foldState, `${jsonDumpsIndent(state)}\n`);
}

/** A pointer in the draft, never a copy (C9): each host's differing file gets its own decision. */
function draftChoice(kind, hostFile, sharedFile, bytes, ctx) {
  const key = itemKey(kind, ctx.host, bytes);
  draftItem(kind, key, `${draftChoiceHead(path.basename(sharedFile))}\n`
    + `(hosts: shared, ${ctx.host} | paths: ${sharedFile}, ${hostFile} | sha256: ${key})\n`
    + 'Which one becomes the shared file?\n', 'pending', ctx);
}

/**
 * Fold step 4 for one whole file, over each name it has gone by. The re-seed waits for the end of
 * the walk: `ensureWikiStub` renames a legacy file it finds, and this walk has not reached it yet.
 */
function foldWholeFile(kind, hostFiles, sharedFile, reseed, ctx) {
  const { dryRun, report } = ctx;
  let setAside = false;
  for (const file of hostFiles) {
    if (!isFile(file) || sharesTier(file, ctx.shared)) continue;
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
    if (!same) landFile(sharedFile, bytes, { exclusive: held === null });
    verifyCopies([[file, sharedFile]]);
    archiveStore(file);
    setAside = true;
  }
  if (setAside) reseed();
}

/** What makes two rules one (fold step 5): metadata and number do not. Line endings are already gone. */
const ruleText = (r) => `${r.title}\n${r.body}`;

/**
 * A pending rule this host no longer holds waits for nothing: it merged, because another host's
 * copy was approved, or the user took it out. Left alone, it would count as pending for ever, and
 * approving it would raise a rule the user removed. A rule body holds no `## ` line, so a block is
 * one piece of this split. Block first: a stop between the writes is finished by the next run.
 */
function settleRules(live, { host, shared, dryRun }) {
  if (dryRun) return;
  const state = readFoldState(shared);
  const gone = Object.keys(state.items).filter((key) => {
    const item = state.items[key];
    return item.kind === 'rule' && item.host === host && item.state === 'pending' && !live.has(key);
  });
  if (!gone.length) return;
  if (existsSync(shared.draft)) {
    const pieces = readText(shared.draft).split(/^(?=## )/m);
    writeTextAtomic(shared.draft, pieces.filter((p) => !gone.some((key) => p.includes(`sha256: ${key}`))).join(''));
  }
  for (const key of gone) delete state.items[key];
  writeTextAtomic(shared.foldState, `${jsonDumpsIndent(state)}\n`);
}

/**
 * `text` without the merged rules, every other byte kept, or the seed when nothing of the user's
 * is left. Anything else stays: `parseRules` reads only `## R<n> — Title`, so a hand-written
 * section may be a rule in all but its form, and a seed would take it out of force.
 */
function withoutRules(text, merged) {
  const drop = new Set(merged.flatMap((r) => Array.from({ length: r.end - r.start }, (_, i) => r.start + i)));
  // The split keeps each break, so the line at index `i` is the piece at `2i`, its break at `2i + 1`.
  const rest = text.split(new RegExp(`(${LINE_BREAK.source})`)).filter((_, n) => !drop.has(Math.floor(n / 2))).join('');
  const seed = SESSION_SEEDS['user-rules.md'];
  const seedLines = new Set(splitLines(seed));
  return splitLines(rest).every((l) => !l.trim() || seedLines.has(l)) ? seed : rest;
}

/**
 * Fold step 5. A rule the shared file holds word for word leaves the host file: it binds from
 * there. Any other goes to the draft and stays, so nothing stops binding before the user decides
 * (C8), and an approval needs no code here: the rule Rite puts it in the shared file, and the next
 * fold finds a duplicate. A rejected rule is the exception to the merge, because "keep it on this
 * host" holds even if the shared file later says the same.
 *
 * The old file is copied aside, not moved: the host file must exist at every moment, because the
 * rules it keeps bind through it. When the shared file IS the host file (`isTierFile`), rewriting
 * it would take the merged rules out of force.
 *
 * A FILE THAT IS NOT UTF-8 IS LEFT WHOLE, and no rule in it is read: the text below has each bad
 * byte replaced, so a rewrite or a draft would change a rule the user never touched.
 */
function foldRules(cfgDir, ctx) {
  const { host, shared, dryRun, report } = ctx;
  const file = path.join(cfgDir, path.basename(shared.rules));
  if (!isFile(file) || isTierFile(file, shared.rules)) return;
  const { items } = readFoldState(shared);
  const raw = readFileSync(file);
  const text = raw.toString('utf8');
  if (!isUtf8(raw)) {
    report.notices.push(`${file} is not UTF-8, so its rules stay there and bind; save it as UTF-8 to fold them`);
    return;
  }
  const [rules] = parseRules(text);
  const held = new Set(parseRules(isFile(shared.rules) ? readFileSync(shared.rules, 'utf8') : '')[0].map(ruleText));
  const lines = splitLines(text);
  const live = new Set();
  const merged = [];
  for (const r of rules) {
    const key = itemKey('rule', host, ruleText(r));
    if (held.has(ruleText(r)) && items[key]?.state !== 'rejected') { merged.push(r); continue; }
    if (live.has(key)) continue;
    live.add(key);
    const own = lines.slice(r.start + 1, r.end).join('\n').trim();
    draftItem('rule', key, `${draftRuleHead(host, r.title)}\n(source: ${file} | old: R${r.id} | sha256: ${key})\n${own}\n`,
      'rules', ctx);
  }
  settleRules(live, ctx);
  if (!merged.length || dryRun) return;
  archiveStore(file, copyFileSync);
  landFile(file, Buffer.from(withoutRules(text, merged)));
}

/**
 * Fold one host. Never throws: a step that fails lands in `report.failed`, the steps after it
 * still run, and what it did not finish stays in place for the next emit. `dryRun` walks the same
 * code and writes nothing, so each host's preview is read against the tier as it stands.
 */
export function foldHost({ host, cfgDir, shared, dryRun = false }) {
  const report = {
    host, facts: 0, lessons: 0, notes: 0, excludes: 0, wired: 0, collisions: 0, pending: 0, rules: 0,
    moved: [], archived: null, stayed: [], stayedIn: {}, wiredPaths: [], notices: [], failed: [],
  };
  const step = (name, fn) => {
    try { fn(); } catch (e) { report.failed.push(`${name}: ${e.message}`); }
  };
  const ctx = { host, shared, dryRun, report };
  step('memory', () => foldMemory(cfgDir, ctx));
  step('notes', () => foldNotes(cfgDir, ctx));
  step(EXCLUDES_FILE, () => {
    const { added, wired, paths, notices, errors } = foldExcludes(host, cfgDir, dryRun);
    Object.assign(report, { excludes: added, wired, wiredPaths: paths, notices });
    report.failed.push(...errors.map((e) => `${EXCLUDES_FILE}: ${e}`));
  });
  step('profile', () => foldWholeFile('profile', [path.join(cfgDir, 'PROFILE.md')], shared.profile,
    () => ensureProfileStub(cfgDir), ctx));
  step('wiki', () => foldWholeFile('wiki', WIKI_NAMES.map((n) => path.join(cfgDir, n)), shared.wiki,
    () => ensureWikiStub(cfgDir), ctx));
  step('rules', () => foldRules(cfgDir, ctx));
  return report;
}

const counted = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const STAYED_SHOWN = 5;

/**
 * The files only the archive holds now, each run of them followed by its own archive (`stayedIn`,
 * by label). A dry run has moved nothing, so it has no archive to name. The line stays one line,
 * and `report.stayed` keeps them all.
 */
function stayedWords(stayed, stayedIn) {
  const more = stayed.length - STAYED_SHOWN;
  const groups = new Map();
  for (const s of stayed.slice(0, STAYED_SHOWN)) {
    const label = Object.keys(stayedIn).find((l) => s.startsWith(`${l}/`));
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  const named = [...groups].map(([label, files]) => `${files.join(', ')}${label ? ` (${stayedIn[label]})` : ''}`);
  return `${counted(stayed.length, 'file')} left in the archive: ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** A report as the words after `<host>: `, or '' when it did nothing (C7: nothing is reported twice). */
export function foldSummary(r) {
  return [
    r.facts && `${counted(r.facts, 'fact')} folded`,
    r.lessons && counted(r.lessons, 'lesson'),
    r.notes && counted(r.notes, 'note'),
    r.excludes && counted(r.excludes, 'exclude path'),
    r.wired && `${counted(r.wired, 'excluded folder')} wired${r.wiredPaths.length ? ` (${r.wiredPaths.join(', ')})` : ''}`,
    ...r.moved.map((kind) => `${kind} moved`),
    r.collisions && counted(r.collisions, 'collision'),
    r.rules && `${counted(r.rules, 'rule')} to approve`,
    r.pending && `${r.pending} to approve`,
    r.archived && 'old store moved aside',
    r.stayed.length && stayedWords(r.stayed, r.stayedIn),
  ].filter(Boolean).join(', ');
}

/** The emit's call, on a canonical install only: `diff`, Restore and a stray `--config-dir` fold nothing. */
export function foldOnEmit(host, cfgDir) {
  if (!isCanonical(cfgDir, host)) return;
  const shared = sharedPaths();
  // Both ends: the fold writes the tier, and moves the host's own files aside.
  const report = recordOwnWrites(cfgDir, () => recordOwnWrites(shared.root, () => foldHost({ host, cfgDir, shared })));
  const summary = foldSummary(report);
  if (summary) printOut(`[shared] ${host}: ${summary}\n`);
  for (const n of report.notices) printErr(`[shared] ${n}\n`);
  for (const f of report.failed) {
    printErr(`[shared] ${host}: fold stopped at ${f}; what was not folded stays in place, `
      + 'and the next emit retries\n');
  }
}
