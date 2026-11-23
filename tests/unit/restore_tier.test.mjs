// `restore` into the shared tier (js/maintain/backup.mjs `readBackup`/`restoreTier`/`rewriteHome`).
// Two sandboxed homes: A writes a backup, B receives it. An empty B takes a straight copy; a B
// already in use is merged by the fold's own rules (`foldHost`, as host `restored`), so nothing
// of B's is overwritten and a second restore writes nothing. Expected values are written out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { collectBackup, readBackup, restoreTier, rewriteHome } from '../../js/maintain/backup.mjs';
import { readZip, writeZip } from '../../js/lib/zip.mjs';

const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI'];
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (p) => fs.readFileSync(p, 'utf8');

/** Run `fn` with `home` as the process's home; put the environment back after. */
function inHome(home, fn) {
  const env = homeOverrides(home);
  const saved = Object.fromEntries([...Object.keys(env), ...ENV_KEYS].map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const RULE = '## R1 — keep it short\nAnswer in three lines.\n';
const FACT = '---\nname: nas\n---\nport 8080\n';

/** Home A with a tier worth carrying, its backup written to `file`; returns A's home. */
function backupFrom(sb, file, extra = () => {}) {
  const a = path.join(sb, 'a');
  const tier = path.join(a, '.config', 'geneseed');
  put(path.join(tier, 'user-rules.md'), RULE);
  put(path.join(tier, 'PROFILE.md'), '# Your profile\n\nGuillaume, from A.\n');
  put(path.join(tier, 'memory', 'nas.md'), FACT);
  put(path.join(tier, 'memory', 'paths.md'), `---\nname: paths\n---\nrepo at ${a}/git\n`);
  put(path.join(tier, 'notes', 'skill-notes', 'ship.md'), 'lesson one\n');
  put(path.join(tier, 'notebook', 'ledger.md'), 'A ledger\n');
  put(path.join(tier, 'geneseed-wiki.jsonc'), `// my wiki\n{ "wikis": [{ "path": ${JSON.stringify(path.join(a, 'Terra'))} }] }\n`);
  put(path.join(tier, 'excludes.json'), `${JSON.stringify({ excludes: [{ path: path.join(a, 'secret').split(path.sep).join('/') }] })}\n`);
  put(path.join(tier, 'profiles', 'mine.json'), `${JSON.stringify({ description: path.join(a, 'x') })}\n`);
  put(path.join(tier, '.fold-state.json'), `${JSON.stringify({ version: 1, items: { k1: { kind: 'rule', state: 'approved' }, k2: { kind: 'rule', state: 'approved' } } })}\n`);
  put(path.join(tier, 'user-rules-retired.md'), '## R7 — old one\nbody\n## R8 — old two\nbody\n');
  extra(tier);
  inHome(a, () => {
    const { entries, manifest } = collectBackup({ targets: [] });
    fs.writeFileSync(file, writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }, ...entries]));
  });
  return a;
}

/** Every file under `dir` with its mtime, to prove a run wrote nothing. */
function mtimes(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.statSync(p).mtimeMs;
    }
  };
  walk(dir);
  return out;
}

// Only string literals change, in the spelling they were written in; a comment keeps the old home.
test('rewriteHome keeps comments and handles three spellings', () => {
  const text = '// C:\\Users\\old\n{ "a": "C:/Users/old/Terra", "b": "C:\\\\Users\\\\old\\\\Terra", "c": "c:/users/old", "d": "D:/x" }\n';
  assert.equal(rewriteHome(text, 'C:\\Users\\old', 'D:\\Home\\new'),
    '// C:\\Users\\old\n{ "a": "D:/Home/new/Terra", "b": "D:\\\\Home\\\\new\\\\Terra", "c": "D:/Home/new", "d": "D:/x" }\n');
  assert.equal(rewriteHome('{ "p": "/home/old/x", "q": "/home/older" }', '/home/old', '/Users/new'),
    '{ "p": "/Users/new/x", "q": "/home/older" }');
  // Across operating systems the whole path takes the target's separator, JSON-escaped on Windows.
  assert.equal(rewriteHome('{ "a": "C:/Users/old/Terra/x", "b": "C:\\\\Users\\\\old\\\\Terra\\\\x" }', 'C:\\Users\\old', '/home/new'),
    '{ "a": "/home/new/Terra/x", "b": "/home/new/Terra/x" }');
  assert.equal(rewriteHome('{ "p": "/home/old/x/y" }', '/home/old', 'C:\\Users\\new'),
    '{ "p": "C:\\\\Users\\\\new\\\\x\\\\y" }');
});

// An empty tier takes each file as it was, with the home rewritten in the three JSON files only.
test('empty tier gets a straight copy', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    const a = backupFrom(sb.path, file);
    const b = path.join(sb.path, 'b');
    fs.mkdirSync(b);
    const r = inHome(b, () => restoreTier(readBackup(file)));
    const tier = path.join(b, '.config', 'geneseed');
    assert.deepEqual(r.failed, []);
    assert.equal(read(path.join(tier, 'user-rules.md')), RULE);
    assert.equal(read(path.join(tier, 'memory', 'nas.md')), FACT);
    assert.equal(read(path.join(tier, 'notes', 'skill-notes', 'ship.md')), 'lesson one\n');
    assert.equal(read(path.join(tier, 'notebook', 'ledger.md')), 'A ledger\n');
    assert.ok(read(path.join(tier, 'memory', 'paths.md')).includes(`${a}/git`), 'memory prose is never rewritten');
    assert.equal(JSON.parse(read(path.join(tier, 'excludes.json'))).excludes[0].path, path.join(b, 'secret').split(path.sep).join('/'));
    assert.equal(JSON.parse(read(path.join(tier, 'profiles', 'mine.json'))).description, path.join(b, 'x'));
    const wiki = read(path.join(tier, 'geneseed-wiki.jsonc'));
    assert.ok(wiki.startsWith('// my wiki\n'));
    assert.ok(wiki.includes(JSON.stringify(path.join(b, 'Terra'))));
  } finally { sb.cleanup(); }
});

/** Home B already in use: its own fact, rule, profile, ledger, decisions and retired rule. */
function inUse(sb) {
  const b = path.join(sb, 'b');
  const tier = path.join(b, '.config', 'geneseed');
  put(path.join(tier, 'user-rules.md'), '## R1 — B rule\nB body.\n');
  put(path.join(tier, 'PROFILE.md'), '# Your profile\n\nGuillaume, on B.\n');
  put(path.join(tier, 'memory', 'nas.md'), '---\nname: nas\n---\nport 9090\n');
  put(path.join(tier, 'notebook', 'ledger.md'), 'B ledger\n');
  put(path.join(tier, '.fold-state.json'), `${JSON.stringify({ version: 1, items: { k1: { kind: 'rule', state: 'rejected' } } })}\n`);
  put(path.join(tier, 'user-rules-retired.md'), '## R7 — old one\nbody\n');
  return { b, tier };
}

// Nothing of B's is overwritten: a differing fact lands beside it as `-restored`, a rule waits
// in the draft, a differing profile lands beside B's as `PROFILE-restored.md` (a draft pointer
// would name a staging file that is gone), and B's decision on a shared key stands.
test('in-use tier merges without overwrite', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    backupFrom(sb.path, file);
    const { b, tier } = inUse(sb.path);
    const r = inHome(b, () => restoreTier(readBackup(file)));
    assert.deepEqual(r.failed, []);
    assert.equal(read(path.join(tier, 'memory', 'nas.md')), '---\nname: nas\n---\nport 9090\n');
    assert.equal(read(path.join(tier, 'memory', 'nas-restored.md')), FACT);
    assert.equal(read(path.join(tier, 'user-rules.md')), '## R1 — B rule\nB body.\n');
    const draft = read(path.join(tier, 'user-rules.draft.md'));
    assert.ok(draft.includes('keep it short'), 'the rule waits in the draft');
    assert.equal(read(path.join(tier, 'PROFILE.md')), '# Your profile\n\nGuillaume, on B.\n');
    assert.equal(read(path.join(tier, 'PROFILE-restored.md')), '# Your profile\n\nGuillaume, from A.\n',
      'the backup profile stays readable beside yours');
    assert.equal(read(path.join(tier, 'notebook', 'ledger.md')), 'B ledger\n');
    assert.equal(read(path.join(tier, 'notebook', 'ledger-restored.md')), 'A ledger\n');
    const items = JSON.parse(read(path.join(tier, '.fold-state.json'))).items;
    assert.equal(items.k1.state, 'rejected');
    assert.equal(items.k2.state, 'approved');
    assert.equal(read(path.join(tier, 'user-rules-retired.md')), '## R7 — old one\nbody\n## R8 — old two\nbody\n');
  } finally { sb.cleanup(); }
});

test('second restore writes nothing', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    backupFrom(sb.path, file);
    const { b, tier } = inUse(sb.path);
    inHome(b, () => restoreTier(readBackup(file)));
    const before = mtimes(tier);
    const r = inHome(b, () => restoreTier(readBackup(file)));
    assert.deepEqual([r.copied, r.merged, r.folded], [[], [], '']);
    assert.deepEqual(mtimes(tier), before);
  } finally { sb.cleanup(); }
});

// A valid zip whose bytes no longer match the manifest is refused before anything is written.
test('restore refuses a tampered archive', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    backupFrom(sb.path, file);
    const entries = readZip(fs.readFileSync(file)).map((e) => (e.name === 'tier/memory/nas.md' ? { ...e, data: Buffer.from('forged\n') } : e));
    fs.writeFileSync(file, writeZip(entries));
    assert.throws(() => readBackup(file), /sha256 mismatch.*tier\/memory\/nas\.md/);
  } finally { sb.cleanup(); }
});

// A dry run reports what a real run would do, and writes nothing.
test('--dry-run writes nothing', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    backupFrom(sb.path, file);
    const { b, tier } = inUse(sb.path);
    const before = mtimes(tier);
    const dry = inHome(b, () => restoreTier(readBackup(file), { dryRun: true }));
    assert.deepEqual(mtimes(tier), before);
    const real = inHome(b, () => restoreTier(readBackup(file)));
    assert.deepEqual([dry.copied, dry.merged], [real.copied, real.merged]);
  } finally { sb.cleanup(); }
});

// Both machines exclude a folder: B keeps its own and gains A's, through the fold's own writer.
// No repo is wired for the staging host: wiring is the next emit's, on the real installs.
test('in-use excludes gain the backup paths and wire nothing', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    backupFrom(sb.path, file);
    const { b, tier } = inUse(sb.path);
    const own = path.join(b, 'private').split(path.sep).join('/');
    fs.mkdirSync(path.join(b, 'private'));
    fs.mkdirSync(path.join(b, 'secret'));
    put(path.join(tier, 'excludes.json'), `${JSON.stringify({ excludes: [{ path: own }] })}\n`);
    const r = inHome(b, () => restoreTier(readBackup(file)));
    assert.deepEqual(r.failed, []);
    assert.ok(r.merged.includes('excludes.json'));
    const paths = JSON.parse(read(path.join(tier, 'excludes.json'))).excludes.map((e) => e.path);
    assert.deepEqual(paths, [own, path.join(b, 'secret').split(path.sep).join('/')]);
    assert.deepEqual(fs.readdirSync(path.join(b, 'private')), [], 'nothing wired into the excluded folder');
  } finally { sb.cleanup(); }
});

// Every file the backup carries reaches the tier, including the ones the fold would not carry
// (an all-caps fact stem, a note that is not markdown), and into a tier that has no memory/ yet.
test('files the fold does not carry are restored too', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    backupFrom(sb.path, file, (tier) => {
      put(path.join(tier, 'memory', 'AWS.md'), 'aws fact\n');
      put(path.join(tier, 'notes', 'agent-notes', 'x.txt'), 'plain note\n');
    });
    const b = path.join(sb.path, 'b');
    fs.mkdirSync(b);
    const r = inHome(b, () => restoreTier(readBackup(file)));
    const tier = path.join(b, '.config', 'geneseed');
    assert.deepEqual(r.failed, []);
    assert.equal(read(path.join(tier, 'memory', 'AWS.md')), 'aws fact\n');
    assert.equal(read(path.join(tier, 'notes', 'agent-notes', 'x.txt')), 'plain note\n');
  } finally { sb.cleanup(); }
});

// A rule pending on A stays pending on B: its block joins B's live draft and its ledger row comes
// with it. A pending row the backup's draft does not hold would be an item nothing can show.
test('pending drafts on both machines join one live draft', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    const blockA = '## Rule from A\n(source: a | old: R2 | sha256: aaaa1111)\nA body.\n';
    backupFrom(sb.path, file, (tier) => {
      put(path.join(tier, 'user-rules.draft.md'), `# Draft\n\n${blockA}`);
      put(path.join(tier, '.fold-state.json'), `${JSON.stringify({ version: 1, items: {
        aaaa1111: { kind: 'rule', host: 'claude', state: 'pending' },
        gone0000: { kind: 'rule', host: 'claude', state: 'pending' } } })}\n`);
    });
    const { b, tier } = inUse(sb.path);
    put(path.join(tier, 'user-rules.draft.md'), '# Draft\n\n## Rule from B\n(source: b | old: R3 | sha256: bbbb2222)\nB body.\n');
    const r = inHome(b, () => restoreTier(readBackup(file)));
    assert.deepEqual(r.failed, []);
    const draft = read(path.join(tier, 'user-rules.draft.md'));
    assert.ok(draft.includes('sha256: bbbb2222'), 'B keeps its own');
    assert.ok(draft.includes('sha256: aaaa1111') && draft.includes('A body.'), "A's block joins it");
    assert.ok(!fs.existsSync(path.join(tier, 'user-rules.draft-restored.md')));
    const items = JSON.parse(read(path.join(tier, '.fold-state.json'))).items;
    assert.equal(items.aaaa1111.state, 'pending');
    assert.equal(items.gone0000, undefined);
    inHome(b, () => restoreTier(readBackup(file)));
    assert.equal(read(path.join(tier, 'user-rules.draft.md')).split('sha256: aaaa1111').length, 2, 'appended once');
  } finally { sb.cleanup(); }
});

// Each backup drafts under its own host (`restored-<id>`), so restoring a second, different backup
// does not settle away the rules the first one left pending: both wait in the draft.
test('two different backups both leave their rules pending', () => {
  const sb = makeSandbox('rt-');
  try {
    const one = path.join(sb.path, 'one.zip');
    const two = path.join(sb.path, 'two.zip');
    backupFrom(sb.path, one);
    backupFrom(path.join(sb.path, 'second'), two, (tier) => put(path.join(tier, 'user-rules.md'), '## R1 — second rule\nSecond body.\n'));
    const { b, tier } = inUse(sb.path);
    inHome(b, () => restoreTier(readBackup(one)));
    inHome(b, () => restoreTier(readBackup(two)));
    const draft = read(path.join(tier, 'user-rules.draft.md'));
    assert.ok(draft.includes('Answer in three lines.'), 'the first backup rule still waits');
    assert.ok(draft.includes('Second body.'), 'the second backup rule waits too');
    const pending = Object.values(JSON.parse(read(path.join(tier, '.fold-state.json'))).items).filter((i) => i.state === 'pending');
    assert.equal(pending.length, 2);
  } finally { sb.cleanup(); }
});

// A line the user wrote into MEMORY.md (no index writer generated it) travels: into an empty tier
// with the file, into an in-use tier appended once to B's index, which the rebuild then carries.
test('hand-written MEMORY.md lines are restored', () => {
  const sb = makeSandbox('rt-');
  try {
    const file = path.join(sb.path, 'b.zip');
    backupFrom(sb.path, file, (tier) => put(path.join(tier, 'memory', 'MEMORY.md'), '# Memory\n\nNAS sits at 10.0.0.5, ask before rebooting.\n'));
    const fresh = path.join(sb.path, 'fresh');
    fs.mkdirSync(fresh);
    inHome(fresh, () => restoreTier(readBackup(file)));
    assert.ok(read(path.join(fresh, '.config', 'geneseed', 'memory', 'MEMORY.md')).includes('NAS sits at 10.0.0.5'));
    const { b, tier } = inUse(sb.path);
    put(path.join(tier, 'memory', 'MEMORY.md'), '# Memory\n\nB keeps its own line.\n');
    const r = inHome(b, () => restoreTier(readBackup(file)));
    assert.deepEqual(r.failed, []);
    inHome(b, () => restoreTier(readBackup(file)));
    const index = read(path.join(tier, 'memory', 'MEMORY.md'));
    assert.ok(index.includes('B keeps its own line.'));
    assert.equal(index.split('NAS sits at 10.0.0.5').length, 2, 'appended once');
  } finally { sb.cleanup(); }
});
