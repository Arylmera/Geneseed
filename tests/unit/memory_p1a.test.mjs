// P1a of the memory-at-scale work (docs/specs/2026-11-18-memory-scale.md): the tier's store gets the
// topic index at emit (D1), a stem in capitals is a store document and never a fact (D2), the
// migration loses no line (D4), a migrated store never nudges (D23), the standing rules a flat index
// loaded become drafts with a bridge slot until decided (D31), and status says whether learn runs (D12).
//
// Every test runs in a sandboxed home (`sandboxProcessHome`), because the code under test writes
// `~/.config/geneseed`. Every expected value is written out, with the rule it follows above it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { decideItem, draftItems } from '../../js/build/rule-decide.mjs';
import { SESSION_SEEDS, ensureSharedTier } from '../../js/build/stubs.mjs';
import { bridgeSlot, cmdContext, memoryNudge, sessionFiles, OUTPUT_BUDGET } from '../../js/hosts/hooks-context.mjs';
import {
  LEGACY_INJECT_CHARS, MAX_ALWAYS_ON, alwaysOnCandidates, existingSlugs, isReservedStem, learnState,
  migrateMemoryIndex, readFacts,
} from '../../js/hosts/memory-files.mjs';
import { statusLines } from '../../js/inspect/status.mjs';
import { changedFiles, storeScan } from '../../js/hosts/store-watch.mjs';
import { isFactName } from '../../js/maintain/memory.mjs';
import { sharedPaths } from '../../js/lib/machine-dir.mjs';
import { isFurniture } from '../../js/web/catalog.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

let home;
before(() => { home = sandboxProcessHome(); });
after(() => { restoreProcessHome(); });

/** A fresh, empty tier for one test: the sandbox home's `~/.config/geneseed`, wiped. */
function freshTier() {
  fs.rmSync(path.join(home, '.config'), { recursive: true, force: true });
  const tier = sharedPaths();
  fs.mkdirSync(tier.memory, { recursive: true });
  return tier;
}

const write = (dir, name, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};
// CRLF folded: the store writes the platform's line ending, and the hook folds it back.
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replaceAll('\r\n', '\n');
const fm = (name, type, desc, extra = '') => `---\nname: ${name}\ndescription: ${desc}\ntype: ${type}\n${extra}---\n\nBody of ${name}.\n`;

/** Every file under `dir` as `relative path -> bytes`, to prove a run left the facts alone. */
function bytesOf(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) out[path.relative(dir, path.join(e.parentPath, e.name)).replaceAll('\\', '/')] = fs.readFileSync(path.join(e.parentPath, e.name), 'hex');
  }
  return out;
}

/** What `fn` writes to stdout, with its return value: `[result, out]`. */
function capturedOut(fn) {
  const w = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = (c) => { out += c; return true; };
  try { return [fn(), out]; } finally { process.stdout.write = w; }
}

// ---- D2: a stem in capitals is a store document ---------------------------------------------------

// The rule: `memory` and `readme` in any case, or a stem with at least one letter and no lower-case
// one. A fact is a lower-case slug; a stem with no letter has no case, so it is no document.
const STEM_ROWS = [
  ['MEMORY', true], ['memory', true], ['Memory', true], ['README', true], ['Readme', true],
  ['ARCHIVE-INDEX', true], ['INDEX', true], ['V2', true], ['A', true],
  ['archive-index', false], ['Archive-Index', false], ['user-prefs', false], ['feedback_x', false],
  ['2026', false], ['---', false], ['readme-first', false],
];
for (const [stem, reserved] of STEM_ROWS) {
  test(`a stem in capitals is a store document: ${JSON.stringify(stem)} -> ${reserved}`, () => {
    assert.equal(isReservedStem(stem), reserved);
  });
}

test('a store document is never a fact, in every reader of the store', () => {
  const sb = makeSandbox('p1a-d2-');
  try {
    const d = sb.path;
    write(d, 'ARCHIVE-INDEX.md', '# Archive\n\nNot a fact.\n');
    write(d, 'TODO.md', 'no frontmatter, no fact\n');
    write(d, 'README.md', 'about this store\n');
    write(d, 'real-fact.md', fm('real-fact', 'project', 'a fact'));
    assert.deepEqual([...existingSlugs(d)], ['real-fact']);
    assert.deepEqual([...readFacts(d).keys()], ['real-fact']);
    // The console's list and `geneseed memory rm`: the same answer, so a list and a count cannot disagree.
    assert.equal(isFurniture('ARCHIVE-INDEX.md', 'memory'), true);
    assert.equal(isFurniture('real-fact.md', 'memory'), false);
    assert.equal(isFactName('ARCHIVE-INDEX'), false);
    assert.equal(isFactName('real-fact'), true);
    // The notebook keeps its own rule: an all-capitals note is a note there.
    assert.equal(isFurniture('TODO.md', 'notebook'), false);
    // Migration files only the fact, and no `misc` topic appears for the documents.
    write(d, 'MEMORY.md', '# Memory Index\n- [Real](real-fact.md) — a fact\n');
    assert.equal(migrateMemoryIndex(d), true);
    assert.deepEqual(fs.readdirSync(path.join(d, 'topics')), ['project.md']);
    assert.equal(memoryNudge(read(d, 'MEMORY.md')), '', 'store documents never raise the misc nudge');
  } finally { sb.cleanup(); }
});

// ---- D1 + D4: the tier migrates, losing nothing ---------------------------------------------------

/**
 * A Terra-shaped flat index: hand-written headings and prose between the pointers, a pointer to a
 * store document, a pointer whose fact is not on disk, and 60 filler facts so the later facts sit past
 * the old 3 072-character cut. Returns the rows each test asserts on.
 */
function terraStore(dir) {
  const facts = {
    'no-coauthor': fm('no-coauthor', 'feedback', 'never add a Co-Authored-By trailer'),
    'commit-style': fm('commit-style', 'feedback', 'short imperative subjects'),
    'proj-in-cut': fm('proj-in-cut', 'project', 'always runs on Node 22'),
  };
  const lines = ['# Memory Index', '', '## Working rules (feedback)',
    '- [No co-author](no-coauthor.md) — never add a Co-Authored-By trailer',
    '- [Commit style](commit-style.md) — short imperative subjects', '',
    'A line of prose the user wrote, between the pointers.', '',
    '## Project', '- [Node](proj-in-cut.md) — always runs on Node 22'];
  for (let i = 0; i < 60; i += 1) {
    const slug = `filler-${String(i).padStart(2, '0')}`;
    facts[slug] = fm(slug, i % 2 ? 'project' : 'reference', `filler fact number ${i}`);
    lines.push(`- [${slug}](${slug}.md) — filler fact number ${i}, padded so the index runs past three thousand characters`);
  }
  facts['hard-limit'] = fm('hard-limit', 'project', 'a hard limit', 'force: constraint\n');
  facts['late-never'] = fm('late-never', 'feedback', 'Never push to main');
  facts['late-quiet'] = fm('late-quiet', 'feedback', 'prefers tabs');
  facts['late-toujours'] = fm('late-toujours', 'feedback', 'toujours répondre en français');
  lines.push('', '## Reference', '- [Archive hub](archive-index.md) — the old material',
    '- [Gone](gone.md) — its file was moved away',
    '- [Hard limit](hard-limit.md) — a hard limit', '- [Late never](late-never.md) — Never push to main',
    '- [Late quiet](late-quiet.md) — prefers tabs', '- [Late toujours](late-toujours.md) — toujours répondre en français');
  for (const [slug, text] of Object.entries(facts)) write(dir, `${slug}.md`, text);
  write(dir, 'ARCHIVE-INDEX.md', '# Archive hub\n\nOld facts live here.\n');
  write(dir, 'MEMORY.md', `${lines.join('\n')}\n`);
  return { facts, lines };
}

test('D4: the migration carries every line that is not a fact pointer, and touches no fact', () => {
  const tier = freshTier();
  const { facts, lines } = terraStore(tier.memory);
  const before = bytesOf(tier.memory);
  // 60 fillers of ~95 characters push the late facts past the cut: the fixture must really be long.
  assert.ok(lines.join('\n').length > LEGACY_INJECT_CHARS * 2);
  assert.equal(ensureSharedTier(), true);
  const after = bytesOf(tier.memory);
  for (const [name, hex] of Object.entries(before)) {
    if (name === 'MEMORY.md') continue;
    assert.equal(after[name], hex, `${name} changed`);
  }
  const map = read(tier.memory, 'MEMORY.md');
  // The lines a person wrote stay: headings, prose, and the pointer to a store document. Blank lines
  // are layout, not content. A pointer whose fact file is gone is the one line that goes: the old
  // rule, pinned by harness.test.mjs, since it points at nothing.
  for (const kept of ['# Memory Index', '## Working rules (feedback)', 'A line of prose the user wrote, between the pointers.',
    '## Project', '## Reference', '- [Archive hub](archive-index.md) — the old material']) {
    assert.ok(map.split('\n').includes(kept), `lost the line ${kept}`);
  }
  assert.equal(map.includes('gone.md'), false);
  // Every fact pointer moved into exactly one topic file, with its own title and hook.
  const topicFiles = fs.readdirSync(path.join(tier.memory, 'topics'));
  assert.deepEqual(topicFiles, ['feedback.md', 'project.md', 'reference.md']);
  const topicText = topicFiles.map((f) => read(tier.memory, 'topics', f)).join('\n');
  for (const slug of Object.keys(facts)) {
    assert.equal(topicText.split('\n').filter((l) => l.includes(`(../${slug}.md)`)).length, 1, `${slug} not in one topic`);
  }
  assert.ok(topicText.includes('- [No co-author](../no-coauthor.md) — never add a Co-Authored-By trailer'));
  assert.equal(map.includes('(no-coauthor.md)'), false, 'a moved pointer is no longer flat in the map');
  // A second emit changes nothing: not a byte of the store, not the draft, not the ledger.
  const once = { store: bytesOf(tier.memory), draft: read(tier.draft), ledger: read(tier.foldState) };
  assert.equal(ensureSharedTier(), true);
  assert.deepEqual(bytesOf(tier.memory), once.store);
  assert.equal(read(tier.draft), once.draft);
  assert.equal(read(tier.foldState), once.ledger);
});

test('D1: a tier that only held a seed stays a seed, and a topic map is left alone', () => {
  const tier = freshTier();
  assert.equal(ensureSharedTier(), true);
  assert.equal(read(tier.memory, 'MEMORY.md'), SESSION_SEEDS['MEMORY.md']);
  assert.equal(fs.existsSync(tier.draft), false, 'no candidate, no draft');
});

// ---- D23: a migrated 500-fact store never nudges --------------------------------------------------

test('D23: a 500-fact store filed by type has a small map and no nudge', () => {
  const tier = freshTier();
  const types = ['feedback', 'project', 'reference', 'user'];
  const flat = ['# Memory Index'];
  for (let i = 0; i < 500; i += 1) {
    const slug = `fact-${String(i).padStart(3, '0')}`;
    write(tier.memory, `${slug}.md`, fm(slug, types[i % 4], `fact ${i} about something specific`));
    flat.push(`- [${slug}](${slug}.md) — fact ${i} about something specific`);
  }
  write(tier.memory, 'MEMORY.md', `${flat.join('\n')}\n`);
  const factBytes = bytesOf(tier.memory);
  assert.equal(ensureSharedTier(), true);
  const map = read(tier.memory, 'MEMORY.md');
  // Four topics of 125 facts: far over the old limit of 40, and nothing says so.
  assert.equal(map.split('\n').filter((l) => l.includes('125 facts')).length, 4);
  assert.equal(memoryNudge(map), '');
  assert.ok(map.length < 600, `the map is ${map.length} characters; it was 112 000 as a flat index`);
  const now = bytesOf(tier.memory);
  for (const [name, hex] of Object.entries(factBytes)) if (name !== 'MEMORY.md') assert.equal(now[name], hex);
  // The session payload carries the map, then the bridge slot for the 30 rules the migration drafted
  // (the feedback facts whose pointers sat in the first 3 072 characters of the flat index), and
  // the memory part stays under a quarter of the host's cap: map under 600 + slot under 1 800.
  const hookRoot = path.join(home, '.claude');
  fs.mkdirSync(hookRoot, { recursive: true });
  const [mem] = sessionFiles(hookRoot).filter((f) => f.rel === 'memory/MEMORY.md');
  assert.ok(mem.text.startsWith(map.replace(/\n+$/, '')));
  assert.ok(mem.text.length < OUTPUT_BUDGET / 4, `${mem.text.length}`);
});

// ---- D31: always-on candidates become drafts, with a bridge until decided ------------------------

test('D31: the candidate pick, in priority order, from a flat index', () => {
  const tier = freshTier();
  terraStore(tier.memory);
  // constraint first; then a feedback fact whose pointer sat in the first 3 072 characters (slug
  // order); then a feedback fact past the cut whose description says never / toujours. NOT picked:
  // `late-quiet` (feedback, past the cut, no such word) and `proj-in-cut` (inside the cut, but it is a
  // project fact, whose "always" is a statement about the project and no rule).
  assert.deepEqual(alwaysOnCandidates(tier.memory).map((c) => [c.slug, c.reason]), [
    ['hard-limit', 'constraint'], ['commit-style', 'injected'], ['no-coauthor', 'injected'],
    ['late-never', 'described'], ['late-toujours', 'described'],
  ]);
});

test('D31: "feedback" is the fact\'s TYPE, never its topic', () => {
  // `topic:` only files a fact. A `type: feedback` fact under `topic: git` is a rule about how to work
  // and is picked; a `type: project` fact that someone filed under `topic: feedback` is not.
  const tier = freshTier();
  write(tier.memory, 'a-typed.md', fm('a-typed', 'feedback', 'keep it short', 'topic: git\n'));
  write(tier.memory, 'b-topic-only.md', fm('b-topic-only', 'project', 'keep it long', 'topic: feedback\n'));
  write(tier.memory, 'c-nested.md', '---\nname: c-nested\ndescription: ask first\nmetadata:\n  type: feedback\n---\nAsk.\n');
  write(tier.memory, 'MEMORY.md', '# Memory Index\n- [A](a-typed.md)\n- [B](b-topic-only.md)\n- [C](c-nested.md)\n');
  assert.deepEqual(alwaysOnCandidates(tier.memory).map((c) => c.slug), ['a-typed', 'c-nested']);
});

test('D31: the tier migration is logged as Geneseed\'s own write, so no session reports it as a change', () => {
  const tier = freshTier();
  terraStore(tier.memory);
  const before = storeScan(tier.root);
  assert.equal(ensureSharedTier(), true);
  // What this step moves: the memory store and the draft. (The emit seeds PROFILE.md and the like too.)
  const moved = changedFiles(before, storeScan(tier.root)).filter((f) => /[\\/](memory|user-rules\.draft\.md)/.test(f.slice(tier.root.length)));
  assert.equal(moved.length, 5, 'MEMORY.md, three topic files and the draft');
  assert.ok(moved.some((f) => f.endsWith('user-rules.draft.md')) && moved.some((f) => f.endsWith('MEMORY.md')));
  const log = JSON.parse(read(tier.memory, '.own-writes.json'));
  const after = storeScan(tier.root);
  for (const f of moved) assert.equal(log[f], after[f] ?? 'gone', `${f} is not in the own-writes log`);
});

test('D31: a store that is already a topic map yields no candidate', () => {
  const tier = freshTier();
  terraStore(tier.memory);
  migrateMemoryIndex(tier.memory);
  assert.deepEqual(alwaysOnCandidates(tier.memory), []);
});

test('D31: no more than MAX_ALWAYS_ON candidates are drafted, constraints first', () => {
  const tier = freshTier();
  const flat = ['# Memory Index'];
  for (let i = 0; i < MAX_ALWAYS_ON + 10; i += 1) {
    const slug = `rule-${String(i).padStart(2, '0')}`;
    write(tier.memory, `${slug}.md`, fm(slug, 'feedback', 'always do the thing'));
    flat.push(`- [${slug}](${slug}.md) — always do the thing`);
  }
  write(tier.memory, 'zz-constraint.md', fm('zz-constraint', 'user', 'a limit', 'force: constraint\n'));
  flat.push('- [Limit](zz-constraint.md) — a limit');
  write(tier.memory, 'MEMORY.md', `${flat.join('\n')}\n`);
  const picked = alwaysOnCandidates(tier.memory);
  assert.equal(picked.length, MAX_ALWAYS_ON);
  assert.equal(picked[0].slug, 'zz-constraint', 'the constraint outranks every slug that sorts before it');
});

test('D31: the migration drafts them, never writes user-rules.md, and a second emit drafts nothing new', () => {
  const tier = freshTier();
  terraStore(tier.memory);
  assert.equal(ensureSharedTier(), true);
  // The shared rules file is still the seed, byte for byte: only an approval writes it.
  assert.equal(read(tier.rules), SESSION_SEEDS['user-rules.md']);
  const items = draftItems(tier);
  assert.deepEqual(items.map((i) => i.title), [
    'a hard limit', 'short imperative subjects', 'never add a Co-Authored-By trailer', 'Never push to main',
    'toujours répondre en français']);
  // The console can decide each one: the block hashes to its key, and its ledger row is pending.
  assert.ok(items.every((i) => i.host === 'memory' && i.decisions.join() === 'approve,reject'));
  const ledger = JSON.parse(read(tier.foldState)).items;
  assert.deepEqual(Object.values(ledger).map((r) => [r.kind, r.host, r.state, r.fact]), [
    ['rule', 'memory', 'pending', 'hard-limit'], ['rule', 'memory', 'pending', 'commit-style'],
    ['rule', 'memory', 'pending', 'no-coauthor'], ['rule', 'memory', 'pending', 'late-never'],
    ['rule', 'memory', 'pending', 'late-toujours']]);
  const draft = read(tier.draft);
  assert.equal(draft.match(/^## Rule from memory: /gm).length, 5);
  assert.ok(draft.includes('Body of no-coauthor.'));
  const snapshot = [draft, read(tier.foldState)];
  assert.equal(ensureSharedTier(), true);
  assert.deepEqual([read(tier.draft), read(tier.foldState)], snapshot);
});

test('D31: a draft that fails to write never takes the tier down, and the next emit finishes the job', () => {
  const tier = freshTier();
  terraStore(tier.memory);
  fs.mkdirSync(tier.foldState, { recursive: true });   // a directory where the ledger should be: unreadable
  const errs = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (m) => { errs.push(String(m)); return true; };
  try { assert.equal(ensureSharedTier(), true); } finally { process.stderr.write = realWrite; }
  assert.match(errs.join(''), /could not migrate the shared memory index/);
  assert.ok(read(tier.memory, 'MEMORY.md').includes('(no-coauthor.md)'), 'the index is still flat: nothing was lost');
  fs.rmSync(tier.foldState, { recursive: true });
  assert.equal(ensureSharedTier(), true);
  assert.equal(draftItems(tier).length, 5);
  assert.equal(fs.existsSync(path.join(tier.memory, 'topics', 'feedback.md')), true);
});

test('D31: the bridge slot loads each pending candidate, and a decided one leaves it', () => {
  const tier = freshTier();
  terraStore(tier.memory);
  ensureSharedTier();
  const slot = bridgeSlot();
  assert.ok(slot.startsWith('[memory] Standing rules from your old index'), slot);
  for (const slug of ['hard-limit', 'commit-style', 'no-coauthor', 'late-never', 'late-toujours']) {
    assert.ok(slot.includes(`- ${slug}: Body of ${slug}.`), `${slug} is not in the slot:\n${slot}`);
  }
  // It is a session entry of its own, labelled shared, right after the rules, and the map stays clean.
  const hookRoot = path.join(home, '.claude');
  fs.mkdirSync(hookRoot, { recursive: true });
  const files = sessionFiles(hookRoot);
  assert.deepEqual(files.map((f) => f.rel), ['user-rules.draft.md', 'memory/MEMORY.md']);
  assert.equal(files[0].text, slot);
  assert.equal(files[0].abs, tier.draft);
  assert.equal(files[1].text.includes('Standing rules'), false);
  assert.equal(slot.includes('late-quiet'), false);
  // Approve one, reject one: both decided, both leave. The approved one is now a rule in user-rules.md.
  const [first, second] = draftItems(tier);
  assert.equal(decideItem(tier, first.key, 'approve').ok, true);
  assert.equal(decideItem(tier, second.key, 'reject').ok, true);
  const after = bridgeSlot();
  assert.equal(after.includes('- hard-limit:'), false);
  assert.equal(after.includes('- commit-style:'), false);
  assert.ok(after.includes('- no-coauthor:'));
  assert.ok(read(tier.rules).includes('## R1 — a hard limit\nBody of hard-limit.'));
  // The last three decided: the slot is empty and says nothing at all.
  for (const item of draftItems(tier)) decideItem(tier, item.key, 'reject');
  assert.equal(bridgeSlot(), '');
});

// The slot is budgeted as a rule (it IS a standing rule awaiting a decision), so the profile and the
// wiki, which come after the rules and spend the room memory used to get, cannot push it out. As a
// tail of the memory map it was cut first, and left whole when the 4th file got no room at all.
test('D31: the slot survives a payload whose rules, profile and wiki fill the budget', () => {
  const tier = freshTier();
  terraStore(tier.memory);
  ensureSharedTier();
  const slot = bridgeSlot();
  // Rules at 4 000 characters, a 9 000-character profile (whole, cut by the budget) and a wiki entry.
  const long = (n) => `${'x'.repeat(79)}\n`.repeat(n / 80);
  fs.writeFileSync(tier.rules, `## R1 — big\n${long(4000)}`);
  fs.writeFileSync(tier.profile, long(9000));
  const hookRoot = path.join(home, '.claude');
  fs.mkdirSync(hookRoot, { recursive: true });
  const empty = path.join(home, 'empty-repo');
  fs.mkdirSync(empty, { recursive: true });
  const prev = process.env.GENESEED_ROOT;
  process.env.GENESEED_ROOT = empty;
  try {
    const out = capturedOut(() => cmdContext({ root: hookRoot }))[1].replace(/\r\n/g, '\n');
    assert.ok(out.includes('truncated (session budget)') || out.includes('not injected (session budget)'),
      'the budget must bind in this fixture');
    for (const slug of ['hard-limit', 'commit-style', 'no-coauthor', 'late-never', 'late-toujours']) {
      assert.ok(out.includes(`- ${slug}: Body of ${slug}.`), `${slug} was cut from the payload`);
    }
    assert.ok(out.includes(slot));
    assert.ok(out.length < 9000, `${out.length}`);
  } finally {
    if (prev === undefined) delete process.env.GENESEED_ROOT; else process.env.GENESEED_ROOT = prev;
  }
});

test('D31: the slot is capped, and says how many rules it left out', () => {
  const tier = freshTier();
  const items = {};
  for (let i = 0; i < 30; i += 1) {
    const slug = `long-${String(i).padStart(2, '0')}`;
    write(tier.memory, `${slug}.md`, `---\nname: ${slug}\ndescription: d\n---\n${'rule text '.repeat(60)}\n`);
    items[`k${i}`] = { kind: 'rule', host: 'memory', state: 'pending', fact: slug };
  }
  write(tier.root, '.fold-state.json', JSON.stringify({ version: 1, items }));
  const slot = bridgeSlot();
  // 1 800 characters of room, a fact cut at 300: about five facts fit, and the rest are counted.
  assert.ok(slot.length <= 1800, `${slot.length}`);
  assert.match(slot, /\n- … (\d+) more drafted rules not shown \(read them in memory\/\)$/);
  const shown = slot.split('\n').filter((l) => l.startsWith('- long-')).length;
  assert.equal(shown + Number(/… (\d+) more/.exec(slot)[1]), 30);
});

test('D31: a ledger row is data: a path, a missing fact or a foreign host loads nothing', () => {
  const tier = freshTier();
  write(tier.root, 'secret.md', 'outside the store\n');
  write(tier.memory, 'ok.md', fm('ok', 'feedback', 'fine'));
  write(tier.root, '.fold-state.json', JSON.stringify({ version: 1, items: {
    a: { kind: 'rule', host: 'memory', state: 'pending', fact: '../secret' },
    b: { kind: 'rule', host: 'memory', state: 'pending', fact: 'absent' },
    c: { kind: 'rule', host: 'claude', state: 'pending', fact: 'ok' },
    d: { kind: 'rule', host: 'memory', state: 'approved', fact: 'ok' },
    e: { kind: 'rule', host: 'memory', state: 'pending', fact: 7 },
  } }));
  assert.equal(bridgeSlot(), '');
});

// ---- D12: status says whether learn runs ---------------------------------------------------------

test('D12: learn is dormant without $GENESEED_LLM and active with it, and status prints it', () => {
  assert.equal(learnState({}), 'dormant ($GENESEED_LLM unset)');
  assert.equal(learnState({ GENESEED_LLM: 'claude -p' }), 'active');
  const base = { theme: 'x', accent: 'cyan', emit: 'e', agents: 1, skills: 1, laws: 1, memory_dir: null,
    facts: 0, installed_fp: 'a', source_fp: 'a', version_verdict: 'in sync' };
  const row = (d) => statusLines(d, false, false).find((l) => /^learn\b/.test(l.trim()))?.trim();
  assert.match(row({ ...base, learn: learnState({}) }), /^learn\s+dormant \(\$GENESEED_LLM unset\)$/);
  assert.match(row({ ...base, learn: 'active' }), /^learn\s+active$/);
  assert.equal(row(base), undefined, 'a payload without the key renders the panel it always did');
});

// Per install: only the Claude-shaped hook needs `$GENESEED_LLM`, and it also takes it from the
// settings files' `"env"`, which the shell running `status` never sees. OpenCode distils with the
// session model; Bob sends no transcript. 6.0.3 read the shell alone and called a learning install dormant.
test('D12: learn is judged per installed host, and reads the settings env a Claude hook runs under', () => {
  assert.equal(learnState({}, [{ host: 'opencode' }]), 'opencode: active (session model)');
  assert.equal(learnState({}, [{ host: 'bob' }]), 'bob: n/a (Bob sends no transcript)');
  assert.equal(learnState({}, [{ host: 'claude', settingsEnv: [{ GENESEED_LLM: 'claude -p' }] }]), 'claude: active');
  assert.equal(learnState({}, [{ host: 'claude', settingsEnv: [null, { OTHER: '1' }] }]),
    'claude: dormant ($GENESEED_LLM unset)');
  assert.equal(learnState({ GENESEED_LLM: 'claude -p' }, [{ host: 'openclaude', settingsEnv: [] }]), 'openclaude: active');
  // Two installs of one host that disagree show both states; hosts keep their order.
  assert.equal(learnState({}, [
    { host: 'opencode' },
    { host: 'claude', settingsEnv: [{ GENESEED_LLM: 'x' }] },
    { host: 'claude', settingsEnv: [] },
  ]), 'opencode: active (session model) · claude: active / dormant ($GENESEED_LLM unset)');
});
