// S6: the fold moves a host's stores into the shared tier. Every test here runs in a sandboxed
// home, and every expected value is written out: a fold that "looks right" over an empty world
// proves nothing, so each row seeds the file it then asserts on.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

import { foldHost, foldSummary } from '../../js/build/fold.mjs';
import { ROOT } from '../../js/build/source.mjs';
import {
  SESSION_SEEDS, ensureExcludesStub, ensureMemoryIndex, ensureProfileStub, ensureRulesStub,
  ensureSharedTier, ensureWikiStub,
} from '../../js/build/stubs.mjs';
import { sharedPaths } from '../../js/lib/machine-dir.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI'];
const FACT = '---\nname: x\ndescription: a fact\n---\nbody\n';
const OTHER = '---\nname: x\ndescription: another fact\n---\nother body\n';
const README = 'an old render of the store README\n';

function childEnv(home) {
  const env = { ...process.env, ...homeOverrides(home) };
  for (const k of ENV_KEYS) delete env[k];
  return env;
}

function run(home, bin, args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'bin', bin), ...args],
    { cwd: ROOT, encoding: 'utf8', env: childEnv(home), windowsHide: true, maxBuffer: 1 << 26 });
}

function emit(home, name = 'claude-global', args = []) {
  const r = run(home, 'build-driver.mjs', ['--emit', name, '--theme', 'neutral', '--footprint', 'lean',
    '--out', path.join(home, 'bundle'), ...args]);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

/** A home with the tier and one seeded claude install, env moved in for `fn`, put back after. */
function world(fn) {
  const sb = makeSandbox('s6-');
  const home = sb.path;
  const env = { ...homeOverrides(home) };
  for (const k of ENV_KEYS) env[k] = undefined;
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try {
    assert.equal(ensureSharedTier(), true);
    const cfg = seedHost(path.join(home, '.claude'));
    const shared = sharedPaths();
    return fn({ home, cfg, shared, fold: (extra = {}) => foldHost({ host: 'claude', cfgDir: cfg, shared, ...extra }) });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    sb.cleanup();
  }
}

/** A host dir exactly as an emit leaves it: every file a seed, and a README of its own. */
function seedHost(cfg) {
  fs.mkdirSync(path.join(cfg, 'memory'), { recursive: true });
  ensureMemoryIndex(path.join(cfg, 'memory'));
  fs.writeFileSync(path.join(cfg, 'memory', 'README.md'), README);
  fs.writeFileSync(path.join(cfg, 'memory', '.gitignore'), '*\n');
  ensureWikiStub(cfg);
  ensureRulesStub(cfg);
  ensureProfileStub(cfg);
  ensureExcludesStub(cfg);
  return cfg;
}

const fact = (dir, name, text) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(...p));
const archiveOf = (cfg) => {
  const stamps = fs.readdirSync(path.join(cfg, 'archived-memory'));
  assert.equal(stamps.length, 1, 'one fold, one archive');
  return path.join(cfg, 'archived-memory', stamps[0]);
};

/** Every path under `dir`, a file's bytes and mtime included: a run that writes changes this. */
function snapshot(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const p = path.join(e.parentPath, e.name);
    out[path.relative(dir, p)] = e.isFile() ? `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'hex')}` : 'dir';
  }
  return out;
}

const counts = ({ facts, lessons, notes, excludes, wired, collisions, pending, rules, moved }) => (
  { facts, lessons, notes, excludes, wired, collisions, pending, rules, moved });
const ZERO = { facts: 0, lessons: 0, notes: 0, excludes: 0, wired: 0, collisions: 0, pending: 0, rules: 0, moved: [] };

// ---- Memory -------------------------------------------------------------------------------------

test('fresh: a fact lands byte for byte, the store moves aside and returns to its seed', () => world(({ cfg, shared, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', '---\r\nname: x\r\n---\r\nbody with CRLF kept\r\n');
  const r = fold();
  assert.deepEqual(r.failed, []);
  assert.deepEqual(counts(r), { ...ZERO, facts: 1 });
  assert.equal(read(shared.memory, 'x.md'), '---\r\nname: x\r\n---\r\nbody with CRLF kept\r\n');
  assert.equal(read(archiveOf(cfg), 'x.md'), '---\r\nname: x\r\n---\r\nbody with CRLF kept\r\n');
  assert.equal(r.archived, archiveOf(cfg));
  assert.deepEqual(fs.readdirSync(store).sort(), ['.gitignore', 'MEMORY.md', 'README.md']);
  assert.equal(read(store, 'README.md'), README, 'the re-seed restores the host README');
  assert.equal(read(store, 'MEMORY.md').replaceAll('\r\n', '\n'), '# Memory Index\n');
  assert.ok(fs.readdirSync(path.join(shared.memory, 'topics')).length, 'the tier index was not rebuilt');
}));

test('duplicate: a byte-identical fact is skipped, and the store still moves aside', () => world(({ cfg, shared, fold }) => {
  fact(shared.memory, 'x.md', FACT);
  fact(path.join(cfg, 'memory'), 'x.md', FACT);
  const r = fold();
  assert.deepEqual(counts(r), ZERO);
  assert.deepEqual(fs.readdirSync(shared.memory).filter((n) => n.startsWith('x')), ['x.md']);
  assert.ok(!exists(cfg, 'memory', 'x.md'));
  assert.ok(exists(archiveOf(cfg), 'x.md'));
}));

test('collision: the same name with other bytes lands as <name>-<host>.md, and the tier file stays', () => world(({ cfg, shared, fold }) => {
  fact(shared.memory, 'x.md', FACT);
  fact(path.join(cfg, 'memory'), 'x.md', OTHER);
  const r = fold();
  assert.deepEqual(counts(r), { ...ZERO, facts: 1, collisions: 1 });
  assert.equal(read(shared.memory, 'x.md'), FACT);
  assert.equal(read(shared.memory, 'x-claude.md'), OTHER);
}));

test('second collision: a taken suffix that differs goes on to -2, then -3', () => world(({ cfg, shared, fold }) => {
  fact(shared.memory, 'x.md', FACT);
  fact(shared.memory, 'x-claude.md', 'taken\n');
  fact(shared.memory, 'x-claude-2.md', 'taken too\n');
  fact(path.join(cfg, 'memory'), 'x.md', OTHER);
  assert.deepEqual(counts(fold()), { ...ZERO, facts: 1, collisions: 1 });
  assert.equal(read(shared.memory, 'x-claude-3.md'), OTHER);
}));

test('second collision: the first numbered suffix is -2, with no gap', () => world(({ cfg, shared, fold }) => {
  fact(shared.memory, 'x.md', FACT);
  fact(shared.memory, 'x-claude.md', 'taken\n');
  fact(path.join(cfg, 'memory'), 'x.md', OTHER);
  assert.deepEqual(counts(fold()), { ...ZERO, facts: 1, collisions: 1 });
  assert.equal(read(shared.memory, 'x-claude-2.md'), OTHER);
}));

test('a collision repeats: its suffixed copy is byte-identical, so nothing is written', () => world(({ cfg, shared, fold }) => {
  fact(shared.memory, 'x.md', FACT);
  fact(shared.memory, 'x-claude.md', OTHER);
  fact(path.join(cfg, 'memory'), 'x.md', OTHER);
  assert.deepEqual(counts(fold()), ZERO);
  assert.ok(!exists(shared.memory, 'x-claude-2.md'));
}));

test('agents: only lessons not present are appended, in the tier file\'s own line ending', () => world(({ cfg, shared, fold }) => {
  fact(path.join(shared.memory, 'agents'), 'tester.md', '# tester — lessons\r\n- 2026-01-01: one\r\n- 2026-01-02: two\r\n');
  fact(path.join(cfg, 'memory', 'agents'), 'tester.md', '# tester — lessons\n- 2026-01-02: two\n- 2026-01-03: three\n');
  fact(path.join(cfg, 'memory', 'agents'), 'fresh.md', '# fresh — lessons\n- 2026-01-04: four\n');
  assert.deepEqual(counts(fold()), { ...ZERO, lessons: 2 });
  assert.equal(read(shared.memory, 'agents', 'tester.md'),
    '# tester — lessons\r\n- 2026-01-01: one\r\n- 2026-01-02: two\r\n- 2026-01-03: three\r\n');
  assert.equal(read(shared.memory, 'agents', 'fresh.md'), '# fresh — lessons\n- 2026-01-04: four\n');
  assert.ok(exists(archiveOf(cfg), 'agents', 'tester.md'));
}));

test('a hand-written index, archive/ and topics/ stay in the archive and never reach the tier', () => world(({ cfg, shared, fold }) => {
  const store = path.join(cfg, 'memory');
  fs.writeFileSync(path.join(store, 'MEMORY.md'), '# Memory Index\n\nmy own words\n');
  fact(path.join(store, 'archive'), 'old.md', 'retired\n');
  const r = fold();
  assert.deepEqual(r.failed, []);
  assert.ok(!exists(shared.memory, 'archive'));
  assert.doesNotMatch(read(shared.memory, 'MEMORY.md'), /my own words/);
  assert.match(read(archiveOf(cfg), 'MEMORY.md'), /my own words/);
  assert.equal(read(archiveOf(cfg), 'archive', 'old.md'), 'retired\n');
  assert.equal(read(store, 'MEMORY.md').replaceAll('\r\n', '\n'), '# Memory Index\n');
}));

test('a seeded store folds to nothing: a differing README or .gitignore does not trigger it', () => world(({ cfg, fold }) => {
  const before = snapshot(cfg);
  const r = fold();
  assert.deepEqual(counts(r), ZERO);
  assert.equal(r.archived, null);
  assert.equal(foldSummary(r), '');
  assert.deepEqual(snapshot(cfg), before);
}));

test('a host store linked to the tier folds nothing and is not moved', () => world(({ cfg, shared, fold }) => {
  fs.rmSync(path.join(cfg, 'memory'), { recursive: true });
  fs.symlinkSync(shared.memory, path.join(cfg, 'memory'), 'junction');
  fact(shared.memory, 'x.md', FACT);
  const r = fold();
  assert.deepEqual(r.failed, []);
  assert.equal(r.archived, null);
  assert.ok(exists(shared.memory, 'x.md'));
  assert.ok(!exists(cfg, 'archived-memory'));
}));

test('a fact that lands after a fold folds on the next one, even within the same second', () => world(({ cfg, shared, fold }) => {
  fact(path.join(cfg, 'memory'), 'one.md', FACT);
  fact(path.join(cfg, 'memory'), 'one-more.md', OTHER);
  assert.deepEqual(fold().failed, []);
  fact(path.join(cfg, 'memory'), 'two.md', FACT);
  const r = fold();
  assert.deepEqual(r.failed, []);
  assert.deepEqual(counts(r), { ...ZERO, facts: 1 });
  assert.ok(exists(shared.memory, 'two.md'));
  assert.equal(fs.readdirSync(path.join(cfg, 'archived-memory')).length, 2);
}));

// ---- Failure ------------------------------------------------------------------------------------

test('copy failure keeps the store, reports it, and the next run finishes the job', () => world(({ cfg, shared, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'a.md', FACT);
  fact(store, 'b.md', OTHER);
  fs.mkdirSync(path.join(shared.memory, 'b.md'));         // reading it back fails: EISDIR
  const r = fold();
  assert.equal(r.failed.length, 1, r.failed.join());
  assert.match(r.failed[0], /^memory: /);
  assert.equal(r.archived, null);
  assert.equal(read(store, 'a.md'), FACT, 'the old store stays readable');
  assert.equal(read(store, 'b.md'), OTHER);
  assert.ok(!exists(cfg, 'archived-memory'));
  fs.rmdirSync(path.join(shared.memory, 'b.md'));
  const retry = fold();
  assert.deepEqual(retry.failed, []);
  assert.deepEqual(counts(retry), { ...ZERO, facts: 1 }, 'a.md is a duplicate of its first copy now');
  assert.equal(read(shared.memory, 'a.md'), FACT);
  assert.equal(read(shared.memory, 'b.md'), OTHER);
  assert.ok(!exists(shared.memory, 'a-claude.md'), 'a retry made a collision of its own copy');
}));

/** Run `fn` with `fs[name]` replaced, the ESM named bindings included. */
function withFsMock(name, impl, fn) {
  const m = mock.method(fs, name, impl);
  syncBuiltinESMExports();
  try { return fn(); } finally { m.mock.restore(); syncBuiltinESMExports(); }
}

test('a short write never reaches its real name, so a retry is no collision', () => world(({ cfg, shared, fold }) => {
  fact(path.join(cfg, 'memory'), 'x.md', FACT);
  const realWrite = fs.writeFileSync;
  const r = withFsMock('writeFileSync', (p, data, ...rest) => {
    realWrite(p, String(p).endsWith('.fold-tmp') ? 'torn' : data, ...rest);
  }, () => fold());
  assert.match(r.failed.join(), /short write/);
  assert.ok(!exists(shared.memory, 'x.md'));
  assert.deepEqual(fs.readdirSync(shared.memory).filter((n) => n.includes('fold-tmp')), []);
  assert.equal(read(cfg, 'memory', 'x.md'), FACT);
}));

test('verification fails on a tier file that does not match: nothing moves aside', () => world(({ cfg, shared, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  const realRename = fs.renameSync;
  const r = withFsMock('renameSync', (a, b) => {
    realRename(a, b);
    if (String(a).endsWith('.fold-tmp')) fs.appendFileSync(b, 'changed under the fold');
  }, () => fold());
  assert.match(r.failed.join(), /does not match/);
  assert.equal(read(store, 'x.md'), FACT);
  assert.ok(!exists(cfg, 'archived-memory'));
  assert.equal(read(shared.memory, 'x.md'), `${FACT}changed under the fold`);
  const retry = fold();
  assert.deepEqual(retry.failed, []);
  assert.equal(read(shared.memory, 'x-claude.md'), FACT, 'the next emit rescues the fact');
}));

test('verification of agents fails when a lesson line is missing: nothing moves aside', () => world(({ cfg, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(path.join(store, 'agents'), 'tester.md', '# tester — lessons\n- one\n- two\n');
  const realRename = fs.renameSync;
  const r = withFsMock('renameSync', (a, b) => {
    realRename(a, b);
    if (String(a).endsWith('.fold-tmp')) fs.writeFileSync(b, '# tester — lessons\n- one\n');
  }, () => fold());
  assert.match(r.failed.join(), /lacks a lesson/);
  assert.ok(exists(store, 'agents', 'tester.md'));
  assert.ok(!exists(cfg, 'archived-memory'));
}));

test('a fact written during the fold waits for the next emit, so it is never only in an archive', () => world(({ cfg, shared, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  const realWrite = fs.writeFileSync;
  const r = withFsMock('writeFileSync', (p, ...rest) => {
    realWrite(p, ...rest);
    if (String(p).endsWith('.fold-tmp')) realWrite(path.join(store, 'late.md'), OTHER);
  }, () => fold());
  assert.match(r.failed.join(), /changed during the fold/);
  assert.equal(read(store, 'late.md'), OTHER);
  assert.ok(!exists(cfg, 'archived-memory'));
  assert.deepEqual(fold().failed, []);
  assert.equal(read(shared.memory, 'late.md'), OTHER);
}));

test('a store that cannot move aside stays readable, and the tier copy waits for the retry', () => world(({ cfg, shared, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  const realRename = fs.renameSync;
  const r = withFsMock('renameSync', (a, b) => {
    if (a === store) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    realRename(a, b);
  }, () => fold());
  assert.match(r.failed.join(), /EBUSY/);
  assert.equal(read(store, 'x.md'), FACT);
  assert.equal(read(shared.memory, 'x.md'), FACT);
  assert.deepEqual(fold().failed, []);
  assert.ok(exists(archiveOf(cfg), 'x.md'));
}));

// ---- Notes --------------------------------------------------------------------------------------

test('notes copy like facts, move aside, and a tier edit afterwards makes no stale collision', () => world(({ cfg, shared, fold }) => {
  const src = path.join(cfg, 'notebook', 'skill-notes');
  fact(src, 'debug.md', 'a note\n');
  fact(path.join(cfg, 'notebook', 'agent-notes'), 'tester.md', 'another\n');
  fact(path.join(cfg, 'notebook'), 'scratch.md', 'stays per host\n');
  assert.deepEqual(counts(fold()), { ...ZERO, notes: 2 });
  assert.equal(read(shared.notes, 'skill-notes', 'debug.md'), 'a note\n');
  assert.equal(read(shared.notes, 'agent-notes', 'tester.md'), 'another\n');
  assert.equal(read(cfg, 'notebook', 'scratch.md'), 'stays per host\n');
  assert.ok(!exists(src));
  const [stamp] = fs.readdirSync(path.join(cfg, 'notebook', 'archived-skill-notes'));
  assert.equal(read(cfg, 'notebook', 'archived-skill-notes', stamp, 'debug.md'), 'a note\n');
  fs.writeFileSync(path.join(shared.notes, 'skill-notes', 'debug.md'), 'an agent edited this\n');
  assert.deepEqual(counts(fold()), ZERO);
  assert.ok(!exists(shared.notes, 'skill-notes', 'debug-claude.md'));
}));

test('a note collision follows the fact rule', () => world(({ cfg, shared, fold }) => {
  fact(path.join(cfg, 'notebook', 'skill-notes'), 'debug.md', 'host text\n');
  fact(path.join(shared.notes, 'skill-notes'), 'debug.md', 'tier text\n');
  assert.deepEqual(counts(fold()), { ...ZERO, notes: 1, collisions: 1 });
  assert.equal(read(shared.notes, 'skill-notes', 'debug.md'), 'tier text\n');
  assert.equal(read(shared.notes, 'skill-notes', 'debug-claude.md'), 'host text\n');
}));

// ---- Excludes -----------------------------------------------------------------------------------

const excludesOf = (dir) => JSON.parse(read(dir, 'excludes.json')).excludes;
const spelled = (p) => p.split(path.sep).join('/');

test('exclude paths: a host path joins the shared list once, with no wired key', () => world(({ home, cfg, shared, fold }) => {
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(cfg, 'excludes.json'), JSON.stringify(
    { excludes: [{ path: spelled(repo), wired: { claude_md_excludes: ['x'] } }] }));
  assert.deepEqual(counts(fold()), { ...ZERO, excludes: 1 });
  assert.deepEqual(excludesOf(shared.root), [{ path: spelled(repo) }]);
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(excludesOf(shared.root).length, 1);
}));

test('a host installed after an exclude add gets the wiring for shared paths, with its receipt', () => world(({ home, cfg, shared, fold }) => {
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(shared.excludes, JSON.stringify({ excludes: [{ path: spelled(repo) }] }));
  assert.deepEqual(counts(fold()), { ...ZERO, wired: 1 });
  const local = JSON.parse(read(repo, '.claude', 'settings.local.json'));
  assert.deepEqual(local.claudeMdExcludes, [`${spelled(cfg)}/CLAUDE.md`]);
  assert.deepEqual(excludesOf(cfg), [{ path: spelled(repo), wired: { claude_md_excludes: [`${spelled(cfg)}/CLAUDE.md`] } }]);
  const before = snapshot(repo);
  assert.deepEqual(counts(fold()), ZERO);
  assert.deepEqual(snapshot(repo), before);
}));

test('a list that does not parse is left as it is, and the other steps still run', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.excludes, '{ torn');
  fact(path.join(cfg, 'memory'), 'x.md', FACT);
  const r = fold();
  assert.match(r.failed.join(), /^excludes\.json: .*does not parse/);
  assert.equal(read(shared.excludes), '{ torn');
  assert.ok(exists(shared.memory, 'x.md'));
}));

// ---- Profile and wiki ---------------------------------------------------------------------------

const OLD_WIKI_SEED = SESSION_SEEDS['geneseed-wiki.jsonc'].replace('// geneseed-wiki.jsonc —', '// Geneseed wiki.jsonc —');
const hashOf = (s) => createHash('sha256').update(s).digest('hex');

test('seed: a host seed never moves, in LF or CRLF, and the old wiki seed counts as one', () => world(({ cfg, shared, fold }) => {
  assert.equal(hashOf(OLD_WIKI_SEED), 'cccc917c34e6b990e821620bdb4739090151885ab71b6e85046f30a3b71fa5e8');
  fs.writeFileSync(path.join(cfg, 'geneseed-wiki.jsonc'), OLD_WIKI_SEED.replaceAll('\n', '\r\n'));
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), SESSION_SEEDS['PROFILE.md']);
  fs.writeFileSync(shared.profile, 'mine\n');
  const before = snapshot(cfg);
  assert.deepEqual(counts(fold()), ZERO);
  assert.deepEqual(snapshot(cfg), before);
  assert.equal(read(shared.profile), 'mine\n');
}));

test('a shared seed gives way: the host file moves, is set aside and returns to its seed', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'who I am\n');
  fs.writeFileSync(shared.wiki, OLD_WIKI_SEED);
  fs.writeFileSync(path.join(cfg, 'geneseed-wiki.jsonc'), '{ "wikis": [{ "name": "Brain" }] }\n');
  assert.deepEqual(counts(fold()), { ...ZERO, moved: ['profile', 'wiki'] });
  assert.equal(read(shared.profile), 'who I am\n');
  assert.equal(read(shared.wiki), '{ "wikis": [{ "name": "Brain" }] }\n');
  assert.equal(read(cfg, 'PROFILE.md').replaceAll('\r\n', '\n'), SESSION_SEEDS['PROFILE.md']);
  assert.equal(read(cfg, 'geneseed-wiki.jsonc').replaceAll('\r\n', '\n'), SESSION_SEEDS['geneseed-wiki.jsonc']);
  const [stamp] = fs.readdirSync(path.join(cfg, 'archived-PROFILE.md'));
  assert.equal(read(cfg, 'archived-PROFILE.md', stamp), 'who I am\n');
}));

test('a legacy wiki name folds too, and the host keeps one seeded manifest', () => world(({ cfg, shared, fold }) => {
  fs.rmSync(path.join(cfg, 'geneseed-wiki.jsonc'));
  fs.writeFileSync(path.join(cfg, 'wiki.jsonc'), '{ "wikis": [{ "name": "Old" }] }\n');
  assert.deepEqual(counts(fold()), { ...ZERO, moved: ['wiki'] });
  assert.equal(read(shared.wiki), '{ "wikis": [{ "name": "Old" }] }\n');
  assert.ok(!exists(cfg, 'wiki.jsonc'));
  assert.equal(read(cfg, 'geneseed-wiki.jsonc').replaceAll('\r\n', '\n'), SESSION_SEEDS['geneseed-wiki.jsonc']);
}));

test('a host file identical to a non-seed shared file is set aside, so it no longer overrides', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.profile, 'who I am\n');
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'who I am\n');
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(read(cfg, 'PROFILE.md').replaceAll('\r\n', '\n'), SESSION_SEEDS['PROFILE.md']);
  assert.ok(exists(cfg, 'archived-PROFILE.md'));
}));

test('a differing profile stays in force, gets one pointer and one ledger row, however often it folds', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.profile, 'shared self\n');
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'host self\n');
  assert.deepEqual(counts(fold()), { ...ZERO, pending: 1 });
  assert.equal(read(cfg, 'PROFILE.md'), 'host self\n');
  assert.equal(read(shared.profile), 'shared self\n');
  const key = createHash('sha256').update('profile\0claude\0').update('host self\n').digest('hex');
  assert.deepEqual(JSON.parse(read(shared.foldState)),
    { version: 1, items: { [key]: { kind: 'profile', host: 'claude', state: 'pending' } } });
  assert.equal(read(shared.draft).replaceAll('\r\n', '\n'), '# User rules — draft\n\n'
    + 'Not active. The rule Rite applies decisions.\n\n'
    + '## Choose: PROFILE.md\n'
    + `(hosts: shared, claude | paths: ${shared.profile}, ${path.join(cfg, 'PROFILE.md')} | sha256: ${key})\n`
    + 'Which one becomes the shared file?\n');
  assert.doesNotMatch(read(shared.draft), /host self/, 'a pointer, never a copy');
  const draft = read(shared.draft);
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(read(shared.draft), draft);
}));

test('a decided item is not drafted again, and a stop between the two writes makes no second block', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.profile, 'shared self\n');
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'host self\n');
  fold();
  const state = JSON.parse(read(shared.foldState));
  const [key] = Object.keys(state.items);
  state.items[key].state = 'rejected';
  fs.writeFileSync(shared.foldState, JSON.stringify(state));
  fs.rmSync(shared.draft);
  assert.deepEqual(counts(fold()), ZERO);
  assert.ok(!fs.existsSync(shared.draft), 'a rejected item was drafted again');
  fold();
  fs.writeFileSync(shared.foldState, JSON.stringify({ version: 1, items: {} }));
  fs.writeFileSync(shared.draft, `head\n(sha256: ${key})\n`);
  assert.deepEqual(counts(fold()), { ...ZERO, pending: 1 });
  assert.equal(read(shared.draft), `head\n(sha256: ${key})\n`);
}));

test('a ledger that does not parse stops that step: nothing is drafted again', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.profile, 'shared self\n');
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'host self\n');
  fs.writeFileSync(shared.foldState, '{ torn');
  const r = fold();
  assert.match(r.failed.join(), /^profile: /);
  assert.equal(read(shared.foldState), '{ torn');
  assert.ok(!fs.existsSync(shared.draft));
}));

// ---- Whole-host properties ----------------------------------------------------------------------

/** A host that exercises every step at once. */
function fullHost({ home, cfg, shared }) {
  const store = path.join(cfg, 'memory');
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  fact(store, 'x.md', FACT);
  fact(store, 'y.md', OTHER);
  fact(shared.memory, 'y.md', FACT);
  fact(path.join(store, 'agents'), 'tester.md', '# tester — lessons\n- one\n');
  fact(path.join(cfg, 'notebook', 'skill-notes'), 'debug.md', 'a note\n');
  fs.writeFileSync(path.join(cfg, 'excludes.json'), JSON.stringify({ excludes: [{ path: spelled(repo), wired: {} }] }));
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'who I am\n');
  fs.writeFileSync(path.join(cfg, 'geneseed-wiki.jsonc'), '{ "wikis": [] } // mine\n');
  fs.writeFileSync(shared.wiki, '{ "wikis": [] } // shared\n');
}

test('second run writes nothing: no byte, no mtime, anywhere in the home', () => world((w) => {
  fullHost(w);
  const first = w.fold();
  assert.deepEqual(first.failed, []);
  const before = snapshot(w.home);
  const second = w.fold();
  assert.deepEqual(counts(second), ZERO);
  assert.equal(second.archived, null);
  assert.deepEqual(snapshot(w.home), before);
}));

test('a dry run reports the real run\'s numbers and writes nothing', () => world((w) => {
  fullHost(w);
  const before = snapshot(w.home);
  const dry = w.fold({ dryRun: true });
  assert.deepEqual(snapshot(w.home), before, 'the dry run wrote');
  const wet = w.fold();
  assert.deepEqual(counts(dry), counts(wet));
  assert.deepEqual(counts(wet), { ...ZERO, facts: 2, lessons: 1, notes: 1, excludes: 1, collisions: 1, pending: 1, moved: ['profile'] });
  assert.equal(foldSummary(wet), '2 facts folded, 1 lesson, 1 note, 1 exclude path, profile moved, 1 collision, '
    + '1 to approve, old store moved aside');
}));

// ---- Fold step 5: rules ---------------------------------------------------------------------------

const SEED = SESSION_SEEDS['user-rules.md'];
const lf = (s) => s.replaceAll('\r\n', '\n');
const rulesOf = (cfg) => read(cfg, 'user-rules.md');
const hostRules = (cfg, text) => fs.writeFileSync(path.join(cfg, 'user-rules.md'), text);
const ruleKey = (host, title, body) => createHash('sha256').update(`rule\0${host}\0`).update(`${title}\n${body}`).digest('hex');
/** What the rule Rite writes on a decision: the ledger row, and the block gone. */
function decide(shared, key, state) {
  const ledger = JSON.parse(read(shared.foldState));
  ledger.items[key].state = state;
  fs.writeFileSync(shared.foldState, JSON.stringify(ledger));
  fs.writeFileSync(shared.draft, read(shared.draft).split(/^(?=## )/m).filter((p) => !p.includes(key)).join(''));
}

test('duplicate: a rule the shared file holds leaves the host silently, whatever its number and metadata', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '# User rules\n\n## R7 — Mine\n(scope: global)\nBe terse.\n');
  hostRules(cfg, `${SEED}\n## R1 — Mine\n(scope: project | source: me)\nBe terse.\n\n## R2 — Other\nBe kind.\n`);
  const r = fold();
  assert.deepEqual(counts(r), { ...ZERO, rules: 1 });
  assert.equal(foldSummary(r), '1 rule to approve', 'a merge reports nothing');
  assert.equal(rulesOf(cfg), `${SEED}\n## R2 — Other\nBe kind.\n`);
  assert.doesNotMatch(read(shared.draft), /Mine/);
  const [stamp] = fs.readdirSync(path.join(cfg, 'archived-user-rules.md'));
  assert.match(read(cfg, 'archived-user-rules.md', stamp), /source: me/, 'the replaced file is kept (D10)');
}));

test('a same title with another body is no duplicate, and neither is a same body under another title', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\n\n## R2 — Other\nBe kind.\n');
  const text = '## R1 — Mine\nBe brief.\n\n## R2 — Another\nBe kind.\n';
  hostRules(cfg, text);
  assert.deepEqual(counts(fold()), { ...ZERO, rules: 2 });
  assert.equal(rulesOf(cfg), text);
}));

test('conflict stays in force: the rule is drafted with its host and old number, and the host file keeps every byte', () => world(({ cfg, shared, fold }) => {
  const text = '# User rules\n\n## R2 — Mine\n(scope: global | trial until: 2026-12-01)\nBe terse.\nAlways.\n';
  hostRules(cfg, text);
  assert.deepEqual(counts(fold()), { ...ZERO, rules: 1 });
  assert.equal(rulesOf(cfg), text);
  assert.ok(!exists(cfg, 'archived-user-rules.md'), 'nothing was replaced');
  assert.equal(lf(read(shared.rules)), SEED, 'a drafted rule is not active in the shared file');
  const key = ruleKey('claude', 'Mine', 'Be terse.\nAlways.');
  assert.deepEqual(JSON.parse(read(shared.foldState)),
    { version: 1, items: { [key]: { kind: 'rule', host: 'claude', state: 'pending' } } });
  assert.equal(lf(read(shared.draft)), '# User rules — draft\n\nNot active. The rule Rite applies decisions.\n\n'
    + '## Rule from claude: Mine\n'
    + `(source: ${path.join(cfg, 'user-rules.md')} | old: R2 | sha256: ${key})\n`
    + '(scope: global | trial until: 2026-12-01)\nBe terse.\nAlways.\n');
}));

test('approve: the next fold finds the rule in the shared file and only then takes it from the host', () => world(({ cfg, shared, fold }) => {
  hostRules(cfg, `${SEED}\n## R2 — Mine\nBe terse.\n`);
  fold();
  const key = ruleKey('claude', 'Mine', 'Be terse.');
  decide(shared, key, 'approved');
  assert.deepEqual(counts(fold()), ZERO, 'approved but not yet in the shared file');
  assert.match(rulesOf(cfg), /Be terse/, 'it must bind from the host until the shared file holds it');
  fs.appendFileSync(shared.rules, '\n## R9 — Mine\nBe terse.\n');
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(rulesOf(cfg), SEED);
  assert.equal(JSON.parse(read(shared.foldState)).items[key].state, 'approved');
}));

test('reject: the rule stays on the host, is never drafted again, and holds even if the shared file gains it', () => world(({ cfg, shared, fold }) => {
  const text = `${SEED}\n## R2 — Mine\nBe terse.\n`;
  hostRules(cfg, text);
  fold();
  const key = ruleKey('claude', 'Mine', 'Be terse.');
  decide(shared, key, 'rejected');
  const draft = read(shared.draft);
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(read(shared.draft), draft, 'a rejected rule was drafted again');
  fs.appendFileSync(shared.rules, '\n## R9 — Mine\nBe terse.\n');
  fold();
  assert.equal(rulesOf(cfg), text);
  assert.equal(JSON.parse(read(shared.foldState)).items[key].state, 'rejected');
}));

test('empty host file: with no rules left it returns to its seed, and a seeded file folds to nothing', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\n');
  hostRules(cfg, `${SEED}\n## R3 — Mine\nBe terse.\n`);
  fold();
  assert.equal(rulesOf(cfg), SEED);
  const before = snapshot(cfg);
  fold();
  assert.deepEqual(snapshot(cfg), before);
}));

test('hand-written text is no seed: it may be a rule in all but form, so the host file keeps it', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\n');
  hostRules(cfg, '# User rules\n\nNever push on a Friday.\n\n## R1 — Mine\nBe terse.\n\n## Team\nAsk Ana first.\n');
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(rulesOf(cfg), '# User rules\n\nNever push on a Friday.\n\n## Team\nAsk Ana first.\n');
}));

test('a host file of prose alone is not a rule file: it is neither drafted nor touched', () => world(({ cfg, shared, fold }) => {
  hostRules(cfg, '# User rules\n\n- Never push on a Friday.\n');
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(rulesOf(cfg), '# User rules\n\n- Never push on a Friday.\n');
  assert.ok(!exists(shared.draft));
}));

test('CRLF: a host file in CRLF merges with an LF shared rule, keeps its own endings, and hashes as LF', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\nAlways.\n');
  hostRules(cfg, '# User rules\r\n\r\n## R1 — Mine\r\nBe terse.\r\nAlways.\r\n\r\n## R2 — Other\r\nBe kind.\r\n');
  fold();
  assert.equal(rulesOf(cfg), '# User rules\r\n\r\n## R2 — Other\r\nBe kind.\r\n');
  assert.deepEqual(Object.keys(JSON.parse(read(shared.foldState)).items), [ruleKey('claude', 'Other', 'Be kind.')]);
}));

test('a line break the parser counts, other than a newline, keeps the splice on the right lines', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\n');
  hostRules(cfg, 'one\ftwo\n## R1 — Mine\nBe terse.\n## R2 — Other\nBe kind.\n');
  fold();
  assert.equal(rulesOf(cfg), 'one\ftwo\n## R2 — Other\nBe kind.\n');
}));

test('second run writes nothing with rules pending: no byte, no mtime, and nothing reported twice', () => world(({ home, cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Same\nBe terse.\n');
  hostRules(cfg, `${SEED}\n## R1 — Same\nBe terse.\n\n## R2 — Mine\nBe kind.\n`);
  fold();
  const before = snapshot(home);
  assert.deepEqual(counts(fold()), ZERO);
  assert.deepEqual(snapshot(home), before);
}));

test('a dry run counts rules as the real run does, a rule written twice once, and writes nothing', () => world(({ home, cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Same\nBe terse.\n');
  hostRules(cfg, `${SEED}\n## R1 — Same\nBe terse.\n\n## R2 — Mine\nBe kind.\n\n## R3 — Mine\nBe kind.\n`);
  const before = snapshot(home);
  const dry = fold({ dryRun: true });
  assert.deepEqual(snapshot(home), before, 'the dry run wrote');
  assert.deepEqual(counts(dry), { ...ZERO, rules: 1 });
  assert.deepEqual(counts(fold()), counts(dry));
  assert.equal(read(shared.draft).split('## Rule from').length, 2, 'one block for the two copies');
}));

test('two hosts: each gets its own decision, and approving one clears the other without a second ask', () => world(({ home, cfg, shared, fold }) => {
  const bob = seedHost(path.join(home, '.bob'));
  const foldBob = () => foldHost({ host: 'bob', cfgDir: bob, shared });
  const text = `${SEED}\n## R4 — Mine\nBe terse.\n`;
  hostRules(cfg, text);
  hostRules(bob, text);
  fold();
  foldBob();
  assert.equal(Object.keys(JSON.parse(read(shared.foldState)).items).length, 2);
  decide(shared, ruleKey('claude', 'Mine', 'Be terse.'), 'approved');
  fs.appendFileSync(shared.rules, '\n## R1 — Mine\nBe terse.\n');
  foldBob();
  assert.equal(rulesOf(bob), SEED);
  assert.deepEqual(JSON.parse(read(shared.foldState)).items,
    { [ruleKey('claude', 'Mine', 'Be terse.')]: { kind: 'rule', host: 'claude', state: 'approved' } });
  assert.doesNotMatch(read(shared.draft), /Rule from/);
}));

test('a pending rule the user took out of the host file leaves the draft, and another host\'s item stays', () => world(({ home, cfg, shared, fold }) => {
  const bob = seedHost(path.join(home, '.bob'));
  hostRules(cfg, `${SEED}\n## R1 — Gone\nBe terse.\n\n## R2 — Kept\nBe kind.\n`);
  hostRules(bob, `${SEED}\n## R1 — Theirs\nBe brief.\n`);
  fold();
  foldHost({ host: 'bob', cfgDir: bob, shared });
  hostRules(cfg, `${SEED}\n## R2 — Kept\nBe kind.\n`);
  assert.deepEqual(counts(fold()), ZERO);
  const draft = read(shared.draft);
  assert.doesNotMatch(draft, /Gone/);
  assert.match(draft, /Rule from claude: Kept/);
  assert.match(draft, /Rule from bob: Theirs/);
  assert.deepEqual(Object.keys(JSON.parse(read(shared.foldState)).items).sort(),
    [ruleKey('claude', 'Kept', 'Be kind.'), ruleKey('bob', 'Theirs', 'Be brief.')].sort());
}));

test('a ledger that does not parse stops the rules step before any rule moves', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\n');
  const text = '## R1 — Mine\nBe terse.\n';
  hostRules(cfg, text);
  fs.writeFileSync(shared.foldState, '{ torn');
  assert.match(fold().failed.join(), /^rules: /);
  assert.equal(rulesOf(cfg), text);
}));

test('a host file that cannot be replaced keeps every rule, and the next run finishes the merge', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\n');
  const text = '## R1 — Mine\nBe terse.\n\n## R2 — Other\nBe kind.\n';
  hostRules(cfg, text);
  const real = fs.renameSync;
  const m = mock.method(fs, 'renameSync', (a, b) => {
    if (String(b).endsWith('user-rules.md')) throw new Error('locked');
    return real(a, b);
  });
  syncBuiltinESMExports();
  try {
    assert.match(fold().failed.join(), /^rules: locked/);
  } finally {
    m.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(rulesOf(cfg), text);
  assert.deepEqual(fold().failed, []);
  assert.equal(rulesOf(cfg), '## R2 — Other\nBe kind.\n');
}));

test('a host file linked to the shared one loses the link, never a rule: the shared file keeps it', (t) => world(({ cfg, shared, fold }) => {
  const text = '## R1 — Mine\nBe terse.\n';
  fs.writeFileSync(shared.rules, text);
  fs.rmSync(path.join(cfg, 'user-rules.md'));
  try {
    fs.symlinkSync(shared.rules, path.join(cfg, 'user-rules.md'), 'file');
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('file links need admin rights here'); return; }
    throw e;
  }
  fold();
  assert.equal(read(shared.rules), text);
  assert.equal(rulesOf(cfg), SEED);
}));

test('a hand-made host draft is ignored: the fold reads only user-rules.md (C18)', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(path.join(cfg, 'user-rules.draft.md'), '## Rule from me: Mine\n## R1 — Mine\nBe terse.\n');
  fact(path.join(cfg, 'memory'), 'x.md', FACT);
  fold();
  assert.equal(read(cfg, 'user-rules.draft.md'), '## Rule from me: Mine\n## R1 — Mine\nBe terse.\n');
  assert.ok(!fs.existsSync(shared.draft));
  assert.doesNotMatch(read(shared.rules), /Be terse/);
}));

// ---- A decision on a profile or wiki: the Rite's writes, then the existing fold ---------------------

test('the host file chosen: with the Rite\'s copy made, the next fold sets the host file aside and seeds it', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.profile, 'shared self\n');
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'host self\n');
  fold();
  const [key] = Object.keys(JSON.parse(read(shared.foldState)).items);
  fs.copyFileSync(path.join(cfg, 'PROFILE.md'), shared.profile);
  decide(shared, key, 'approved');
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(read(shared.profile), 'host self\n');
  assert.equal(lf(read(cfg, 'PROFILE.md')), SESSION_SEEDS['PROFILE.md']);
  const [stamp] = fs.readdirSync(path.join(cfg, 'archived-PROFILE.md'));
  assert.equal(read(cfg, 'archived-PROFILE.md', stamp), 'host self\n');
}));

test('the shared file chosen: with the host file moved aside, the next emit seeds it and the fold is silent', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.profile, 'shared self\n');
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'host self\n');
  fold();
  const [key] = Object.keys(JSON.parse(read(shared.foldState)).items);
  fs.mkdirSync(path.join(cfg, 'archived-PROFILE.md'));
  fs.renameSync(path.join(cfg, 'PROFILE.md'), path.join(cfg, 'archived-PROFILE.md', '20261105-120000'));
  decide(shared, key, 'approved');
  ensureProfileStub(cfg);
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(read(shared.profile), 'shared self\n');
  assert.equal(lf(read(cfg, 'PROFILE.md')), SESSION_SEEDS['PROFILE.md']);
}));

test('the rule Rite carries the approval flow, and the ledger states the fold reads', () => {
  const flow = fs.readFileSync(path.join(ROOT, 'src', 'skills', 'rule', 'approve.md'), 'utf8');
  for (const word of ['.fold-state.json', '`approved`', '`rejected`', '## Renumbered', 'user-rules-retired.md']) {
    assert.ok(flow.includes(word), word);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'skills', 'rule.md'), 'utf8'), /\(rule\/approve\.md\)/);
});

// ---- Through the real emit ----------------------------------------------------------------------

const withHome = (fn) => {
  const sb = makeSandbox('s6-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
};
const tierOf = (home) => path.join(home, '.config', 'geneseed');

for (const [emitName, dir, host] of [['claude-global', '.claude', 'claude'], ['bob-global', '.bob', 'bob'],
  ['openclaude-global', '.openclaude', 'openclaude'], ['opencode-global', path.join('.config', 'opencode'), 'opencode']]) {
  test(`${emitName}: a canonical emit folds and prints one line, and the next emit stays silent`, () => withHome((home) => {
    emit(home, emitName);
    const store = path.join(home, dir, 'memory');
    fact(store, 'x.md', FACT);
    const r = emit(home, emitName);
    assert.match(r.stdout, new RegExp(`^\\[shared\\] ${host}: 1 fact folded, old store moved aside$`, 'm'));
    assert.equal(read(tierOf(home), 'memory', 'x.md'), FACT);
    assert.ok(!exists(store, 'x.md'));
    assert.ok(exists(store, 'README.md'), 'the re-seed lost the store README');
    const tier = snapshot(tierOf(home));
    assert.doesNotMatch(emit(home, emitName).stdout, /\[shared\]/);
    assert.deepEqual(snapshot(tierOf(home)), tier);
  }));
}

test('an emit into another --config-dir does not fold', () => withHome((home) => {
  const other = path.join(home, 'elsewhere');
  emit(home, 'claude-global', ['--config-dir', other]);
  fact(path.join(other, 'memory'), 'x.md', FACT);
  const r = emit(home, 'claude-global', ['--config-dir', other]);
  assert.doesNotMatch(r.stdout, /\[shared\]/);
  assert.equal(read(other, 'memory', 'x.md'), FACT);
  assert.ok(!exists(tierOf(home), 'memory', 'x.md'));
}));

test('a project emit does not fold, even in the home directory where its .claude is the canonical one', () => withHome((home) => {
  emit(home, 'claude-global');
  fact(path.join(home, '.claude', 'memory'), 'x.md', FACT);
  const r = run(home, 'build-driver.mjs', ['--emit', 'claude', '--theme', 'neutral', '--footprint', 'lean', '--out', home]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[shared\]/);
  assert.equal(read(home, '.claude', 'memory', 'x.md'), FACT);
  assert.ok(!exists(tierOf(home), 'memory', 'x.md'));
}));

test('a rebuild-all row folds: it passes --config-dir, and the canonical check still says yes', () => withHome((home) => {
  emit(home, 'claude-global');
  fact(path.join(home, '.claude', 'memory'), 'x.md', FACT);
  const r = run(home, 'geneseed-cli.mjs', ['rebuild-all']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[shared\] claude: 1 fact folded/);
  assert.equal(read(tierOf(home), 'memory', 'x.md'), FACT);
}));

test('a legacy bundle holding facts is not copied back after a fold, so the emit stays settled', () => withHome((home) => {
  emit(home, 'claude-global');
  fact(path.join(home, 'bundle', 'memory'), 'legacy.md', FACT);
  fact(path.join(home, '.claude', 'memory'), 'x.md', FACT);
  emit(home, 'claude-global');
  const r = emit(home, 'claude-global');
  assert.doesNotMatch(r.stdout, /\[shared\]/);
  assert.ok(!exists(home, '.claude', 'memory', 'legacy.md'));
  assert.equal(fs.readdirSync(path.join(home, '.claude', 'archived-memory')).length, 1);
}));

test('a tier that cannot be created skips the fold: the store stays and the emit succeeds', () => withHome((home) => {
  emit(home, 'claude-global');
  fact(path.join(home, '.claude', 'memory'), 'x.md', FACT);
  fs.rmSync(path.join(home, '.config'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config'), 'x');
  const r = emit(home, 'claude-global');
  assert.doesNotMatch(r.stdout, /\[shared\]/);
  assert.equal(read(home, '.claude', 'memory', 'x.md'), FACT);
}));

test('a failed fold reports on stderr and the emit still succeeds', () => withHome((home) => {
  emit(home, 'claude-global');
  fact(path.join(home, '.claude', 'memory'), 'x.md', FACT);
  fs.mkdirSync(path.join(tierOf(home), 'memory', 'x.md'));
  const r = emit(home, 'claude-global');
  assert.match(r.stderr, /\[shared\] claude: fold stopped at memory: .*the next emit retries/);
  assert.equal(read(home, '.claude', 'memory', 'x.md'), FACT);
}));

test('geneseed diff folds nothing: a host fact stays where it is', () => withHome((home) => {
  emit(home, 'claude-global');
  fact(path.join(home, '.claude', 'memory'), 'x.md', FACT);
  const r = run(home, 'geneseed-cli.mjs', ['diff', '--target', path.join(home, '.claude')]);
  assert.doesNotMatch(r.stdout, /\[shared\]/);
  assert.equal(read(home, '.claude', 'memory', 'x.md'), FACT);
  assert.ok(!exists(tierOf(home), 'memory', 'x.md'));
}));

test('B7: migrate --dry-run prints the fold report on a stamped machine', () => withHome((home) => {
  emit(home);
  fs.mkdirSync(path.join(home, '.geneseed'), { recursive: true });
  fs.writeFileSync(path.join(home, '.geneseed', '.migrated'), `${ROOT}\n`);
  const store = path.join(home, '.claude', 'memory');
  fact(store, 'x.md', FACT);
  const r = run(home, 'geneseed-cli.mjs', ['migrate', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\[migrate\] would fold claude: 1 fact folded, old store moved aside$/m);
  assert.match(r.stdout, /already on the npm shape/);
  assert.equal(read(store, 'x.md'), FACT, 'a dry run moved a fact');
  assert.ok(!exists(tierOf(home), 'memory', 'x.md'));
}));
