/**
 * THE DECISIONS ON THE DRAFT: what the fold left in `user-rules.draft.md`, applied as the rule
 * Rite's approval flow says (src/skills/rule/approve.md). The console calls this; the Rite stays a
 * written procedure, because an agent's write must pass the rule gate and a verb it could run would
 * step around that prompt. So the two are held together by words: a change to one step here or there
 * is a change to both, and `tests/unit/rule_decide.test.mjs` pins the formats they share.
 *
 * THE WRITE ORDER IS THE SAFETY: target file, ledger row, draft. A rule stays in force at every
 * point, because nothing here touches a host's rule file: a stop leaves the rule bound from its
 * host, and `settle` (the flow's step 2) or the next fold finishes the rest. A ledger that does not
 * read fails before the first write.
 *
 * A POINTER IS DATA. An agent can write the draft past one prompt. So a `Rule from` block is
 * decided only when its text hashes to its key, its ledger row is pending and it holds exactly one
 * rule. A `Choose` block may only name a whole file by its own name, in its host's live config
 * directory, compared as a string before any file call, so a forged path never reaches the disk.
 * The shared side is always the tier's, whatever the block says. Nothing is deleted: a file that
 * leaves goes to `archived-<file>/`.
 *
 * THE CHANGE REPORT SEES THESE WRITES (not Reject or Keep both: those touch only the unwatched
 * draft and ledger), on purpose. The console's token is readable by anything on
 * the machine, so a POST here proves no click, and logging it as Geneseed's own would let an agent
 * blind the report. A false alarm on a real click is the safe direction, and the line names it.
 */
import { copyFileSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { HOSTS } from '../hosts/hosts.mjs';
import { readMaybe } from '../hosts/installs.mjs';
import { archiveStore, parseDraft, parseRules, readFoldState } from '../hosts/memory-files.mjs';
import { isFile, writeTextAtomic } from '../lib/fs.mjs';
import { jsonDumpsIndent } from '../lib/json.mjs';
import { WIKI_NAMES } from '../lib/machine-dir.mjs';
import { normcase } from '../lib/paths.mjs';
import { isWholeFileSeed, itemKey, landFile, ruleText } from './fold.mjs';

/** Where a retired rule goes: beside its `user-rules.md`, never loaded. */
export const RETIRED_RULES_FILE = 'user-rules-retired.md';

export const RULE_DECISIONS = ['approve', 'reject'];
export const CHOICE_DECISIONS = ['host', 'shared', 'both'];

const RENUMBERED = '## Renumbered';
const RULE_POINTER = /^\(source: .* \| old: R(\d+) \| sha256: \w+\)$/;
const CHOICE_POINTER = /^\(hosts: shared, (.+?) \| paths: (.*) \| sha256: \w+\)$/;
/** Where a block starts. A rule body holds no `## ` line (`settleRules` in fold.mjs says why). */
const pieces = (text) => text.split(/^(?=## )/m);

/** A host's live config directory, or null. `configDir` throws with no home directory. */
function configDirOf(host) {
  try { return HOSTS.find((h) => h.host === host)?.configDir() ?? null; } catch { return null; }
}

/** Is `dir` that directory? Strings only: `dir` comes from the draft, and may name a share. */
const isConfigDir = (dir, host) => {
  const cfg = configDirOf(host);
  return cfg !== null && normcase(path.resolve(dir)) === normcase(path.resolve(cfg));
};

/** A `Choose` block's facts, or nothing when its pointer does not name a whole file. */
function choiceFacts(pointer, title, shared) {
  const m = CHOICE_POINTER.exec(pointer);
  const file = title.slice('Choose: '.length);
  const whole = new Map([['PROFILE.md', ['profile', shared.profile, ['PROFILE.md']]],
    [path.basename(shared.wiki), ['wiki', shared.wiki, WIKI_NAMES]]]).get(file);
  if (!m || !whole) return {};
  const [, chooser, paths] = m;
  const at = paths.indexOf(`${file}, `);
  const spelled = at < 0 ? '' : paths.slice(at + file.length + 2);
  // Resolved, so a `sub/../` spelling cannot pass the compare and then walk a link on POSIX.
  const hostFile = spelled && path.resolve(spelled);
  const [kind, sharedFile, names] = whole;
  const trusted = names.includes(path.basename(hostFile)) && isConfigDir(path.dirname(hostFile), chooser);
  return trusted ? { file, chooser, kind, sharedFile, hostFile } : {};
}

/** The draft's blocks: `parseDraft`'s fields, the block's own text, and its pointer's facts. */
function blocksOf(text, shared) {
  return pieces(text).flatMap((piece) => {
    const [b] = parseDraft(piece);
    if (!b) return [];
    const pointer = piece.split('\n')[1]?.trim() ?? '';
    if (!b.host) return [{ ...b, piece, ...choiceFacts(pointer, b.title, shared) }];
    const m = RULE_POINTER.exec(pointer);
    return [{ ...b, piece, ...(m ? { old: m[1] } : {}) }];
  });
}

/**
 * A `Rule from` block as the fold compares rules: its metadata and number do not count. Null unless
 * it reads as exactly one rule: a `##\u00a0R900` line would raise a second one nobody was shown.
 */
function blockRule(b) {
  const [rules] = parseRules(`## R0 — ${b.title}\n${b.body}\n`);
  return rules.length === 1 ? ruleText(rules[0]) : null;
}

/** The ledger row of `key`: a key is draft text, so `constructor` must not read as a row. */
const rowOf = (items, key) => (Object.hasOwn(items, key) ? items[key] : undefined);

/** The shared file's rules, as `ruleText -> number`. */
const heldRules = (shared) => new Map(parseRules(readMaybe(shared.rules) ?? '')[0].map((r) => [ruleText(r), r.id]));

/**
 * Does a `Choose` block no longer ask anything (the flow's step 2)? An absent or seed shared file
 * counts: there is nothing to choose, and *Use the shared file* would keep a seed over the user's
 * text. The next fold moves the host file up.
 */
function staleChoice(b) {
  if (!isFile(b.hostFile) || !isFile(b.sharedFile)) return true;
  const bytes = readFileSync(b.hostFile);
  const held = readFileSync(b.sharedFile);
  return isWholeFileSeed(bytes) || isWholeFileSeed(held) || held.equals(bytes)
    || itemKey(b.kind, b.chooser, bytes) !== b.key;
}

const renumberedLine = (b, id) => `- ${b.host} R${b.old} -> R${id}: ${b.title}`;

/**
 * The draft without `drop`, with `lines` under its `## Renumbered` heading. The heading can sit
 * anywhere, because the fold appends after it. One write, so the record and the delete cannot part.
 */
function rewritten(text, drop, lines = []) {
  const kept = pieces(text).filter((p) => !drop.some((b) => b.piece === p));
  const fresh = lines.filter((l) => !text.includes(l));
  if (!fresh.length) return kept.join('');
  const at = kept.findIndex((p) => p.startsWith(RENUMBERED));
  if (at < 0) return `${kept.join('').replace(/\n+$/, '')}\n\n${RENUMBERED}\n${fresh.join('\n')}\n`;
  const body = kept[at].replace(/\n+$/, '');
  kept[at] = `${body}\n${fresh.join('\n')}${kept[at].slice(body.length) || '\n'}`;
  return kept.join('');
}

const saveLedger = (shared, state, io) => io.text(shared.foldState, `${jsonDumpsIndent(state)}\n`);

/**
 * The flow's step 2: finish what a stop left, and clear what no longer asks. A block the ledger
 * already decided goes, its row stays, and an approved rule gets its `## Renumbered` line if the
 * shared file still holds it. A stale `Choose` block goes with its row: the next fold asks about
 * the current text. Row first, because this walk starts from the blocks: a block left without a row
 * is found again, and a row left without a block would count as pending for ever.
 */
function settle(shared, io) {
  const text = readMaybe(shared.draft) ?? '';
  const state = readFoldState(shared);
  const held = heldRules(shared);
  const drop = [];
  const lines = [];
  let rowsGone = false;
  for (const b of blocksOf(text, shared)) {
    const row = rowOf(state.items, b.key);
    if (row && row.state !== 'pending') {
      const id = held.get(b.host ? blockRule(b) : null);
      if (row.state === 'approved' && b.old && id !== undefined) lines.push(renumberedLine(b, id));
      drop.push(b);
    } else if (b.hostFile && staleChoice(b)) {
      delete state.items[b.key];
      rowsGone = true;
      drop.push(b);
    }
  }
  if (!drop.length) return [];
  if (rowsGone) saveLedger(shared, state, io);
  io.text(shared.draft, rewritten(text, drop, lines));
  return drop.map((b) => b.title);
}

/**
 * One above the highest number in the shared file and in each retired file: the tier's and each
 * host's. A host keeps its own retired rules, and a retired number is never reused. A block's
 * `source` is read by nobody: the fold drafts only from these same directories, and a forged one
 * would have this read reach wherever it points.
 */
function nextRuleId(shared) {
  const retired = [shared.root, ...HOSTS.map((h) => configDirOf(h.host)).filter(Boolean)]
    .map((dir) => path.join(dir, RETIRED_RULES_FILE));
  const ids = [shared.rules, ...retired].flatMap((f) => parseRules(readMaybe(f) ?? '')[0].map((r) => r.id));
  return Math.max(0, ...ids) + 1;
}

/** `ok: false` as the rule routes answer it: the client reloads. */
const conflict = (detail, cleared) => ({ ok: false, error: 'conflict', detail, cleared });

/** The target file's write for a `Choose` decision. */
function applyChoice(b, decision, io) {
  if (decision === 'both') return;
  if (decision === 'shared') {
    archiveStore(b.hostFile);
    return;
  }
  const bytes = readFileSync(b.hostFile);
  if (itemKey(b.kind, b.chooser, bytes) !== b.key) throw new Error(`${b.hostFile} changed just now`);
  archiveStore(b.sharedFile, copyFileSync);
  io.bytes(b.sharedFile, bytes);
}

function applyDecision(shared, key, decision, io, cleared) {
  const text = readMaybe(shared.draft) ?? '';
  const b = blocksOf(text, shared).find((x) => x.key === key);
  if (!b) return conflict('That item is no longer in the draft.', cleared);
  const state = readFoldState(shared);
  const allowed = decisionsOf(b, heldRules(shared), state.items);
  if (!allowed.includes(decision)) return conflict(`"${decision}" does not decide this item.`, cleared);
  const lines = [];
  let id;
  if (decision === 'approve') {
    id = nextRuleId(shared);
    const base = (readMaybe(shared.rules) ?? '# User rules\n').replace(/\n+$/, '');
    io.text(shared.rules, `${base}\n\n## R${id} — ${b.title}\n${b.body}\n`);
    lines.push(renumberedLine(b, id));
  } else if (b.hostFile) applyChoice(b, decision, io);
  const kept = decision === 'reject' || decision === 'both';
  state.items[key] = { ...state.items[key], kind: b.kind ?? 'rule', host: b.host ?? b.chooser,
    state: kept ? 'rejected' : 'approved' };
  saveLedger(shared, state, io);
  io.text(shared.draft, rewritten(text, [b], lines));
  return { ok: true, decision, key, id, rebuild: !kept, cleared };
}

/**
 * What may decide a block now. Only what the fold drafted: a pending row, and for a rule its text
 * hashing to its key. None for a rule the shared file already holds, which the next fold clears.
 */
function decisionsOf(b, held, items) {
  if (!b.key || rowOf(items, b.key)?.state !== 'pending') return [];
  if (!b.host) return b.hostFile ? CHOICE_DECISIONS : [];
  const rule = blockRule(b);
  return b.old && rule !== null && itemKey('rule', b.host, rule) === b.key && !held.has(rule) ? RULE_DECISIONS : [];
}

/** `f` with its links resolved, so a tier file linked into a dotfiles repo stays a link. */
function through(f) {
  try { return realpathSync.native(f); } catch { return f; }
}

/**
 * Decide one item. Never throws for a failed step: it answers `ok: false`, and the steps already
 * written stand, which is the state the flow's step 2 finishes. `io` is the two writers, so a test
 * can fail each write in turn.
 */
export function decideItem(shared, key, decision, io = {
  text: (f, t) => writeTextAtomic(through(f), t),
  bytes: (f, b) => landFile(through(f), b),
}) {
  try {
    return applyDecision(shared, key, decision, io, settle(shared, io));
  } catch (e) {
    return { ok: false, error: 'failed', detail: `The decision stopped: ${e.message}. The rule stays in force.` };
  }
}

/**
 * The draft as the console shows it: each block, with what may decide it and, for a `Choose`, both
 * files' text, since the user picks between them.
 */
export function draftItems(shared) {
  const held = heldRules(shared);
  let items = {};
  try { items = readFoldState(shared).items; } catch { /* no ledger to read: nothing is decidable */ }
  return blocksOf(readMaybe(shared.draft) ?? '', shared).map((b) => ({
    title: b.title, host: b.host, body: b.body, key: b.key, decisions: decisionsOf(b, held, items),
    ...(b.host && held.has(blockRule(b)) ? { held: true } : {}),
    ...(b.hostFile ? { choice: { file: b.file, host: b.chooser, shared_path: b.sharedFile, host_path: b.hostFile,
      shared_text: readMaybe(b.sharedFile), host_text: readMaybe(b.hostFile) } } : {}),
  }));
}

/** Every text a decision rests on, for the fingerprint its POST must send back. */
export function decisionState(shared) {
  const text = readMaybe(shared.draft) ?? '';
  const files = blocksOf(text, shared).filter((b) => b.hostFile).flatMap((b) => [b.sharedFile, b.hostFile]);
  return [text, ...[shared.rules, ...files].map((f) => readMaybe(f) ?? '')].join('\0');
}
