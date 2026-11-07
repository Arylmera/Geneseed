// The decisions on the draft, against a draft the REAL fold wrote and a real fold after, because
// what proves "the lines went in unchanged" is the fold finding the host copy by them. Every home
// here is a sandbox: `installTargets` reads the machine's retired files otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { foldHost, itemKey } from '../../js/build/fold.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { SESSION_SEEDS } from '../../js/build/stubs.mjs';
import { decideItem, draftItems } from '../../js/build/rule-decide.mjs';
import { parseDraft, readFoldState } from '../../js/hosts/memory-files.mjs';
import { storeReport, writeBaseline } from '../../js/hosts/store-watch.mjs';
import { sharedPaths } from '../../js/lib/machine-dir.mjs';
import { writeTextAtomic } from '../../js/lib/fs.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR'];
const HOST_RULES = '# User rules\n\n## R2 — Mine\n(scope: global | trial until: 2026-12-01)\nBe terse.\nAlways.\n';
const SHARED_RULES = '# User rules\n\n## R1 — Shared rule\n(scope: global)\nBe kind.\n';

function withHome(fn) {
  const sb = makeSandbox('rule-decide-');
  const env = homeOverrides(sb.path);
  const saved = Object.fromEntries([...Object.keys(env), ...ENV_KEYS].map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const shared = sharedPaths();
    const cfg = path.join(sb.path, '.claude');
    fs.mkdirSync(shared.memory, { recursive: true });
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(shared.rules, SHARED_RULES);
    return fn({ home: sb.path, shared, cfg });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    sb.cleanup();
  }
}

const lf = (f) => fs.readFileSync(f, 'utf8').replaceAll('\r\n', '\n');
const fold = ({ cfg, shared }) => foldHost({ host: 'claude', cfgDir: cfg, shared });
const rowOf = (shared, key) => readFoldState(shared).items[key];
const blocks = (shared) => parseDraft(lf(shared.draft));

/** One drafted rule, by the fold. */
function drafted(w) {
  fs.writeFileSync(path.join(w.cfg, 'user-rules.md'), HOST_RULES);
  assert.equal(fold(w).rules, 1);
  return blocks(w.shared)[0].key;
}

/** One drafted `Choose`, by the fold: the tier and the host hold different profiles. */
function chosen(w) {
  fs.writeFileSync(w.shared.profile, 'shared profile\n');
  fs.writeFileSync(path.join(w.cfg, 'PROFILE.md'), 'host profile\n');
  assert.equal(fold(w).pending, 1);
  return blocks(w.shared)[0].key;
}

function tree(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) out[path.relative(dir, path.join(e.parentPath, e.name))] = fs.readFileSync(path.join(e.parentPath, e.name), 'latin1');
  }
  return out;
}

/** The real writers, with one target's write failing. */
const failing = (target) => ({
  text: (f, t) => { if (f === target) throw new Error('disk full'); writeTextAtomic(f, t); },
  bytes: (f) => { throw new Error(`no copy expected to ${f}`); },
});

test('Approve: one above every number, the lines unchanged, and the next fold finds the host copy', () => withHome((w) => {
  const { shared, cfg, home } = w;
  const key = drafted(w);
  // R7 beside the shared file, R9 in this host's config directory, R12 in another host's: the
  // highest of the three names the new number, and only a read of all three reaches it.
  fs.writeFileSync(path.join(shared.root, 'user-rules-retired.md'), '## R7 — Old\nGone.\n');
  fs.writeFileSync(path.join(cfg, 'user-rules-retired.md'), '## R9 — Older\nGone.\n');
  fs.mkdirSync(path.join(home, '.bob'), { recursive: true });
  fs.writeFileSync(path.join(home, '.bob', 'user-rules-retired.md'), '## R12 — Oldest\nGone.\n');
  const res = decideItem(shared, key, 'approve');
  assert.deepEqual(res, { ok: true, decision: 'approve', key, id: 13, rebuild: true, cleared: [] });
  assert.equal(lf(shared.rules), `${SHARED_RULES}\n## R13 — Mine\n(scope: global | trial until: 2026-12-01)\nBe terse.\nAlways.\n`);
  assert.equal(rowOf(shared, key).state, 'approved');
  assert.deepEqual(rowOf(shared, key), { kind: 'rule', host: 'claude', state: 'approved' });
  assert.deepEqual(blocks(shared), []);
  assert.match(lf(shared.draft), /\n## Renumbered\n- claude R2 -> R13: Mine\n$/);
  assert.equal(lf(path.join(cfg, 'user-rules.md')), HOST_RULES, 'a decision never touches the host file');
  fold(w);
  assert.doesNotMatch(lf(path.join(cfg, 'user-rules.md')), /Mine/, 'the fold did not read the rule as the same rule');
}));

test('a second approval adds its line under the same Renumbered heading', () => withHome((w) => {
  const { shared, cfg } = w;
  fs.writeFileSync(path.join(cfg, 'user-rules.md'), `${HOST_RULES}\n## R3 — Other\nStay.\n`);
  assert.equal(fold(w).rules, 2);
  const [a, b] = blocks(shared).map((x) => x.key);
  assert.equal(decideItem(shared, a, 'approve').id, 2);
  assert.equal(decideItem(shared, b, 'approve').id, 3);
  assert.match(lf(shared.draft), /\n## Renumbered\n- claude R2 -> R2: Mine\n- claude R3 -> R3: Other\n$/);
}));

test('Reject: the rule stays on its host, and the fold never drafts it again', () => withHome((w) => {
  const { shared, cfg } = w;
  const key = drafted(w);
  const res = decideItem(shared, key, 'reject');
  assert.deepEqual([res.ok, res.rebuild, res.id], [true, false, undefined]);
  assert.equal(lf(shared.rules), SHARED_RULES);
  assert.equal(rowOf(shared, key).state, 'rejected');
  assert.deepEqual(blocks(shared), []);
  assert.doesNotMatch(lf(shared.draft), /Renumbered/);
  assert.equal(fold(w).rules, 0);
  assert.deepEqual(blocks(shared), []);
  assert.equal(lf(path.join(cfg, 'user-rules.md')), HOST_RULES);
}));

test('Choose, the host file: it becomes the shared file, the old one is archived, and the fold reseeds the host', () => withHome((w) => {
  const { shared, cfg } = w;
  const key = chosen(w);
  assert.equal(decideItem(shared, key, 'host').ok, true);
  assert.equal(lf(shared.profile), 'host profile\n');
  const dir = path.join(shared.root, 'archived-PROFILE.md');
  assert.deepEqual(fs.readdirSync(dir).map((n) => lf(path.join(dir, n))), ['shared profile\n']);
  assert.equal(rowOf(shared, key).state, 'approved');
  assert.deepEqual(rowOf(shared, key).kind, 'profile');
  assert.deepEqual(blocks(shared), []);
  fold(w);
  assert.doesNotMatch(lf(path.join(cfg, 'PROFILE.md')), /host profile/);
}));

test('Choose, the shared file: the host file moves aside, and nothing is deleted', () => withHome((w) => {
  const { shared, cfg } = w;
  const key = chosen(w);
  assert.equal(decideItem(shared, key, 'shared').ok, true);
  assert.equal(lf(shared.profile), 'shared profile\n');
  assert.ok(!fs.existsSync(path.join(cfg, 'PROFILE.md')));
  const dir = path.join(cfg, 'archived-PROFILE.md');
  assert.deepEqual(fs.readdirSync(dir).map((n) => lf(path.join(dir, n))), ['host profile\n']);
  assert.equal(rowOf(shared, key).state, 'approved');
}));

test('Choose, keep both: both files stay, and the fold never asks about these bytes again', () => withHome((w) => {
  const { shared, cfg } = w;
  const key = chosen(w);
  const res = decideItem(shared, key, 'both');
  assert.deepEqual([res.ok, res.rebuild], [true, false]);
  assert.equal(rowOf(shared, key).state, 'rejected');
  assert.equal(lf(shared.profile), 'shared profile\n');
  assert.equal(lf(path.join(cfg, 'PROFILE.md')), 'host profile\n');
  assert.equal(fold(w).pending, 0);
  assert.deepEqual(blocks(shared), []);
}));

for (const [name, touch] of [
  ['changed', (w) => fs.writeFileSync(path.join(w.cfg, 'PROFILE.md'), 'edited since\n')],
  ['absent', (w) => fs.rmSync(path.join(w.cfg, 'PROFILE.md'))],
  ['now the shared text', (w) => fs.writeFileSync(path.join(w.cfg, 'PROFILE.md'), 'shared profile\n')],
]) {
  test(`a Choose whose host file is ${name} is cleared with its row, and nothing is applied`, () => withHome((w) => {
    const { shared } = w;
    const key = chosen(w);
    touch(w);
    assert.deepEqual(decideItem(shared, key, 'host'), { ok: false, error: 'conflict',
      detail: 'That item is no longer in the draft.', cleared: ['Choose: PROFILE.md'] });
    assert.equal(rowOf(shared, key), undefined);
    assert.deepEqual(blocks(shared), []);
    assert.equal(lf(shared.profile), 'shared profile\n');
  }));
}

test('a failed write to the shared file changes nothing', () => withHome((w) => {
  const key = drafted(w);
  const before = tree(w.home);
  const res = decideItem(w.shared, key, 'approve', failing(w.shared.rules));
  assert.equal(res.ok, false);
  assert.equal(res.error, 'failed');
  assert.match(res.detail, /disk full\. The rule stays in force\./);
  assert.deepEqual(tree(w.home), before);
}));

// A stop after the target: the rule binds from both files, the block still waits, and a retry
// must not raise a second copy. The shared file now holds it, so the flow skips it and the fold
// clears it.
test('a stop before the ledger row leaves the rule in force, and the fold finishes it', () => withHome((w) => {
  const { shared, cfg } = w;
  const key = drafted(w);
  assert.equal(decideItem(shared, key, 'approve', failing(shared.foldState)).ok, false);
  assert.match(lf(shared.rules), /## R2 — Mine/);
  assert.equal(rowOf(shared, key).state, 'pending');
  assert.equal(lf(path.join(cfg, 'user-rules.md')), HOST_RULES);
  assert.deepEqual(draftItems(shared).map((d) => [d.held, d.decisions]), [[true, []]]);
  const held = lf(shared.rules);
  assert.equal(decideItem(shared, key, 'approve').ok, false);
  assert.equal(lf(shared.rules), held, 'a retry raised the rule twice');
  fold(w);
  assert.deepEqual(blocks(shared), []);
  assert.equal(rowOf(shared, key), undefined);
}));

test('a stop before the draft write is finished by the next decision: its line once, its row kept', () => withHome((w) => {
  const { shared, cfg } = w;
  fs.writeFileSync(path.join(cfg, 'user-rules.md'), `${HOST_RULES}\n## R3 — Other\nStay.\n`);
  fold(w);
  const [a, b] = blocks(shared).map((x) => x.key);
  assert.equal(decideItem(shared, a, 'approve', failing(shared.draft)).ok, false);
  assert.equal(rowOf(shared, a).state, 'approved');
  assert.equal(blocks(shared).length, 2);
  const res = decideItem(shared, b, 'reject');
  assert.deepEqual(res.cleared, ['Mine']);
  assert.deepEqual(blocks(shared), []);
  assert.equal(lf(shared.draft).split('- claude R2 -> R2: Mine').length, 2);
  assert.equal(rowOf(shared, a).state, 'approved');
}));

test('a ledger that does not read stops the decision before the first write', () => withHome((w) => {
  const key = drafted(w);
  fs.writeFileSync(w.shared.foldState, 'not json');
  const before = tree(w.home);
  assert.equal(decideItem(w.shared, key, 'approve').error, 'failed');
  assert.deepEqual(tree(w.home), before);
}));

// What the fold left half written: the next fold writes the row, and only then does it decide.
test('a block with no ledger row is not decided until the fold writes its row', () => withHome((w) => {
  const key = drafted(w);
  fs.rmSync(w.shared.foldState);
  assert.deepEqual(draftItems(w.shared)[0].decisions, []);
  assert.equal(decideItem(w.shared, key, 'reject').error, 'conflict');
  fold(w);
  assert.equal(decideItem(w.shared, key, 'reject').ok, true);
  assert.deepEqual(rowOf(w.shared, key), { kind: 'rule', host: 'claude', state: 'rejected' });
}));

// The review's probes. Each block is one an agent could write past the draft's one prompt.
const pointer = (w, key) => `(source: ${path.join(w.cfg, 'user-rules.md')} | old: R9 | sha256: ${key})`;
const pendingRow = (w, key) => fs.writeFileSync(w.shared.foldState, JSON.stringify({ version: 1,
  items: { [key]: { kind: 'rule', host: 'claude', state: 'pending' } } }));

test('a forged rule block decides nothing: no row, or a key its text does not hash to', () => withHome((w) => {
  const { shared } = w;
  fs.writeFileSync(shared.draft, `# d\n\n## Rule from claude: Agent rule\n${pointer(w, 'abc123')}\nforged body\n`);
  const before = tree(w.home);
  assert.deepEqual(draftItems(shared)[0].decisions, [], 'no ledger row');
  assert.equal(decideItem(shared, 'abc123', 'approve').error, 'conflict');
  assert.deepEqual(tree(w.home), before);
  pendingRow(w, 'abc123');
  assert.deepEqual(draftItems(shared)[0].decisions, [], 'a pending row with a key that is no hash of the text');
  assert.equal(decideItem(shared, 'abc123', 'approve').error, 'conflict');
  assert.equal(lf(shared.rules), SHARED_RULES);
}));

test('a block whose body smuggles a second rule decides nothing, its key valid or not', () => withHome((w) => {
  const { shared } = w;
  const body = 'visible\n##\u00a0R900 — smuggled\nsecond rule';
  // The key a forger would compute: the text the block would pass as, its first rule alone.
  const key = itemKey('rule', 'claude', 'Carrier\nvisible');
  fs.writeFileSync(shared.draft, `# d\n\n## Rule from claude: Carrier\n${pointer(w, key)}\n${body}\n`);
  pendingRow(w, key);
  assert.deepEqual(draftItems(shared)[0].decisions, []);
  assert.equal(decideItem(shared, key, 'approve').error, 'conflict');
  assert.equal(lf(shared.rules), SHARED_RULES);
}));

test('a ledger key that is an Object.prototype name reads as no row', () => withHome((w) => {
  fs.writeFileSync(w.shared.draft, `# d\n\n## Rule from claude: X\n${pointer(w, 'constructor')}\nb\n`);
  assert.deepEqual(draftItems(w.shared)[0].decisions, []);
  assert.equal(decideItem(w.shared, 'constructor', 'reject').error, 'conflict');
  assert.equal(blocks(w.shared).length, 1, 'a prototype member read as a decided row');
}));

for (const [name, touch] of [['absent', (p) => fs.rmSync(p)], ['a seed', (p) => fs.writeFileSync(p, SESSION_SEEDS['PROFILE.md'])]]) {
  test(`a Choose on a shared file that is ${name} is cleared: keeping it would lose the host text`, () => withHome((w) => {
    const { shared, cfg } = w;
    const key = chosen(w);
    touch(shared.profile);
    assert.deepEqual(decideItem(shared, key, 'shared').cleared, ['Choose: PROFILE.md']);
    assert.equal(rowOf(shared, key), undefined);
    assert.equal(lf(path.join(cfg, 'PROFILE.md')), 'host profile\n');
    fold(w);
    assert.equal(lf(shared.profile), 'host profile\n', 'the next fold moves the host file up');
  }));
}

test('a tier file that is a link stays a link', (t) => withHome((w) => {
  const { shared, home } = w;
  const key = drafted(w);
  const real = path.join(home, 'dotfiles-rules.md');
  fs.renameSync(shared.rules, real);
  try { fs.symlinkSync(real, shared.rules); } catch (e) {
    fs.renameSync(real, shared.rules);
    t.skip(`no symlinks here: ${e.code}`);
    return;
  }
  assert.equal(decideItem(shared, key, 'approve').ok, true);
  assert.ok(fs.lstatSync(shared.rules).isSymbolicLink(), 'the write replaced the link with a file');
  assert.match(lf(real), /## R2 — Mine/);
}));

test('a decision of the wrong kind, or for no block, changes nothing', () => withHome((w) => {
  const key = drafted(w);
  const before = tree(w.home);
  assert.equal(decideItem(w.shared, key, 'both').error, 'conflict');
  assert.equal(decideItem(w.shared, 'nokey', 'approve').error, 'conflict');
  assert.deepEqual(tree(w.home), before);
}));

// The draft takes an agent's write past one prompt, so a pointer must not reach any other file.
test('a Choose pointer that names another file decides nothing and moves nothing', () => withHome((w) => {
  const { shared, home } = w;
  const victim = path.join(home, 'notes.txt');
  fs.writeFileSync(victim, 'mine\n');
  const key = itemKey('profile', 'claude', fs.readFileSync(victim));
  // Each row a pending ledger entry could not save: a path elsewhere, a climb out of the config
  // directory, a wrong name inside it, and a share, which the string compare stops before any read.
  for (const hostFile of [victim, `${w.cfg}/../repo/PROFILE.md`, path.join(w.cfg, 'settings.json'), '\\\\192.0.2.1\\share\\PROFILE.md']) {
    fs.writeFileSync(shared.draft, `# d\n\n## Choose: PROFILE.md\n(hosts: shared, claude | paths: ${shared.profile}, ${hostFile} | sha256: ${key})\nWhich?\n`);
    fs.writeFileSync(shared.foldState, JSON.stringify({ version: 1, items: { [key]: { kind: 'profile', host: 'claude', state: 'pending' } } }));
    assert.deepEqual(draftItems(shared)[0].decisions, [], hostFile);
    assert.equal(decideItem(shared, key, 'shared').error, 'conflict', hostFile);
  }
  assert.equal(lf(victim), 'mine\n');
}));

// The name is right and the key is valid: only the folder says this is no file the fold drafted.
test('a Choose pointer outside its host config directory decides nothing and moves nothing', () => withHome((w) => {
  const { shared, home } = w;
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  const victim = path.join(repo, 'PROFILE.md');
  fs.writeFileSync(victim, 'a repo file\n');
  fs.writeFileSync(shared.profile, 'shared profile\n');
  const key = itemKey('profile', 'claude', fs.readFileSync(victim));
  fs.writeFileSync(shared.draft, `# d\n\n## Choose: PROFILE.md\n(hosts: shared, claude | paths: ${shared.profile}, ${victim} | sha256: ${key})\nWhich?\n`);
  fs.writeFileSync(shared.foldState, JSON.stringify({ version: 1, items: { [key]: { kind: 'profile', host: 'claude', state: 'pending' } } }));
  assert.deepEqual(draftItems(shared)[0].decisions, []);
  assert.equal(draftItems(shared)[0].choice, undefined);
  for (const decision of ['host', 'shared']) assert.equal(decideItem(shared, key, decision).error, 'conflict');
  assert.equal(lf(victim), 'a repo file\n');
  assert.equal(lf(shared.profile), 'shared profile\n');
}));

// The wiki's own kind and names, on the legacy host name: a wrong kind would read as stale here.
test('a wiki Choose decides under its own kind, on a legacy host file name', () => withHome((w) => {
  const { shared, cfg } = w;
  fs.writeFileSync(shared.wiki, '{"wikis": [{"name": "shared"}]}\n');
  fs.writeFileSync(path.join(cfg, 'wiki.jsonc'), '{"wikis": [{"name": "host"}]}\n');
  assert.equal(fold(w).pending, 1);
  const [item] = draftItems(shared);
  assert.deepEqual(item.decisions, ['host', 'shared', 'both']);
  assert.equal(item.choice.host_path, path.join(cfg, 'wiki.jsonc'));
  assert.equal(decideItem(shared, item.key, 'host').ok, true);
  assert.equal(lf(shared.wiki), '{"wikis": [{"name": "host"}]}\n');
  assert.deepEqual(rowOf(shared, item.key), { kind: 'wiki', host: 'claude', state: 'approved' });
}));

// The console's token is readable by anything on the machine, so a decision proves no click. It
// must stay in the report, and must not excuse what else changed around it.
test('the change report lists a decision, in words that name it', () => withHome((w) => {
  const { shared, cfg } = w;
  fs.mkdirSync(path.join(cfg, 'notebook'), { recursive: true });
  const key = drafted(w);
  writeBaseline(cfg, 's1');
  assert.equal(decideItem(shared, key, 'approve').ok, true);
  const line = storeReport(cfg, 's1', { host: 'claude' });
  assert.match(line, /a decision of yours in the web console, may have made it/);
  assert.ok(line.includes('geneseed/user-rules.md'), line);
}));

test('an unapproved edit made before a decision is still reported after it', () => withHome((w) => {
  const { shared, cfg } = w;
  fs.mkdirSync(path.join(cfg, 'notebook'), { recursive: true });
  const key = drafted(w);
  writeBaseline(cfg, 's1');
  fs.appendFileSync(shared.rules, '\n## R51 — unapproved edit\nx\n');
  assert.equal(decideItem(shared, key, 'approve').ok, true);
  assert.ok(storeReport(cfg, 's1', { host: 'claude' })?.includes('geneseed/user-rules.md'), 'the decision laundered the edit');
  assert.ok(!fs.existsSync(path.join(shared.memory, '.own-writes.json')), 'a decision logged itself as Geneseed\'s own');
}));

// The Rite cannot call this module, so these words are the two's one contract.
test('approve.md states the formats and the write order this module applies', () => {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'skills', 'rule', 'approve.md'), 'utf8');
  for (const words of ['the target file, the ledger row, the draft', '`- <host> R<old> -> R<new>: <title>`',
    '`## R<new> — <title>`', 'js/build/rule-decide.mjs', "The console's Pending section"]) {
    assert.ok(text.includes(words), `approve.md no longer says: ${words}`);
  }
});
