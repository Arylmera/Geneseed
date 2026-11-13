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
import { orphanFindings } from '../../js/maintain/migrate.mjs';
import { isRendered, retiredSkillFolders } from '../../js/build/retired-skills.mjs';
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

// The change report's log (js/hosts/store-watch.mjs) is bookkeeping, like the README: it never makes a
// seeded store look unfolded, and a folded store keeps it.
test('the own-writes log neither triggers a fold nor is lost by one', () => world(({ cfg, fold }) => {
  const store = path.join(cfg, 'memory');
  fs.writeFileSync(path.join(store, '.own-writes.json'), '{}');
  assert.deepEqual(counts(fold()), ZERO);
  assert.equal(exists(cfg, 'archived-memory'), false);
  fact(store, 'x.md', '---\nname: x\n---\nbody\n');
  fold();
  assert.equal(read(store, '.own-writes.json'), '{}');
}));

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
  const realLink = fs.linkSync;
  const r = withFsMock('linkSync', (a, b) => {
    realLink(a, b);
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
  const realLink = fs.linkSync;
  const r = withFsMock('linkSync', (a, b) => {
    realLink(a, b);
    if (String(a).endsWith('.fold-tmp')) {
      fs.rmSync(b);
      fs.writeFileSync(b, '# tester — lessons\n- one\n');
    }
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
    + 'Not active. The rule Rite or the console applies decisions.\n\n'
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
  assert.equal(lf(read(shared.draft)), '# User rules — draft\n\nNot active. The rule Rite or the console applies decisions.\n\n'
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
  for (const word of ['.fold-state.json', '`approved`', '`rejected`', '## Renumbered', 'user-rules-retired.md',
    String.raw`'<kind>\0<host>\0'`, 'installs.json']) {
    assert.ok(flow.includes(word), word);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'skills', 'rule.md'), 'utf8'), /\(rule\/approve\.md\)/);
});

// ---- The data-loss review ------------------------------------------------------------------------

test('review 1: what is no fact is named when it stays in the archive', () => world(({ cfg, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  fact(path.join(store, 'projects'), 'deep.md', 'nested\n');
  fact(store, 'data.json', '{}\n');
  fact(store, 'x.txt', 'plain\n');
  fact(path.join(store, 'topics'), 'misc.md', 'derived\n');
  const dry = fold({ dryRun: true });
  assert.deepEqual([...dry.stayed].sort(), ['memory/data.json', 'memory/projects/deep.md', 'memory/x.txt']);
  const r = fold();
  assert.deepEqual([...r.stayed].sort(), ['memory/data.json', 'memory/projects/deep.md', 'memory/x.txt']);
  assert.match(foldSummary(r), /3 files left in the archive: memory\/data\.json, memory\/projects\/deep\.md, memory\/x\.txt/);
  assert.equal(read(archiveOf(cfg), 'projects', 'deep.md'), 'nested\n');
  assert.deepEqual(fold().stayed, [], 'reported twice');
}));

test('a hand-written line in the old index is named, with where the archive is', () => world(({ cfg, fold }) => {
  // I6: the rebuilt index holds the tier's facts only, so a note of the user's stops loading. The
  // archive keeps it; only this report says so.
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  fact(store, 'MEMORY.md', '# Memory Index\n\n- [x](x.md) — a pointer\n\nAsk Pat before touching the deploy.\n');
  assert.deepEqual(fold({ dryRun: true }).stayed, ['memory/MEMORY.md']);
  const r = fold();
  assert.deepEqual(r.stayed, ['memory/MEMORY.md']);
  assert.ok(foldSummary(r).includes(`1 file left in the archive: memory/MEMORY.md (${r.archived})`), foldSummary(r));
  assert.match(read(r.archived, 'MEMORY.md'), /Ask Pat/);
}));

test('an index of the seed and generated pointers alone is not worth a line', () => world(({ cfg, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  fact(store, 'MEMORY.md', '# Memory Index\r\n\r\nEach topic file lists its facts; open the one the task needs.\r\n\r\n'
    + '- [misc](topics/misc.md) — 1 fact\r\n- [x](x.md) — a pointer\r\n');
  assert.deepEqual(fold().stayed, []);
}));

test('a hand-written pointer to a missing file is a note, and a pointer to a fact is not', () => world(({ cfg, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  fact(store, 'MEMORY.md', '# Memory Index\n\n- [x](x.md) — a pointer\n- [runbook](runbook.md) — see the wiki\n');
  assert.deepEqual(fold().stayed, ['memory/MEMORY.md']);
}));

test('each stayed file names its own archive, and a dry run names none', () => world(({ cfg, fold }) => {
  const store = path.join(cfg, 'memory');
  const notes = path.join(cfg, 'notebook', 'skill-notes');
  fact(store, 'x.md', FACT);
  fact(store, 'data.json', '{}\n');
  fact(notes, 'n.md', 'note\n');
  fact(notes, 'trace.log', 'log\n');
  const dry = foldSummary(fold({ dryRun: true }));
  assert.match(dry, /2 files left in the archive: memory\/data\.json, notebook\/skill-notes\/trace\.log/);
  assert.doesNotMatch(dry, /\(/, 'a dry run named a path that does not exist yet');
  const r = fold();
  const words = foldSummary(r);
  assert.ok(words.includes(`memory/data.json (${r.archived})`), words);
  const at = /notebook\/skill-notes\/trace\.log \((.+?)\)/.exec(words)?.[1];
  assert.ok(at && at !== r.archived, words);
  assert.equal(read(at, 'trace.log'), 'log\n');
}));

test('review 1: a long list is cut in the line and whole in the report', () => world(({ cfg, fold }) => {
  const store = path.join(cfg, 'memory');
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) fact(store, n + '.txt', 'x\n');
  const r = fold();
  assert.equal(r.stayed.length, 7);
  assert.match(foldSummary(r), /7 files left in the archive: memory\/a\.txt, memory\/b\.txt, memory\/c\.txt, memory\/d\.txt, memory\/e\.txt \(.+\) and 2 more/);
}));

test('review 1: what a notes folder holds beside its notes is named too', () => world(({ cfg, fold }) => {
  const src = path.join(cfg, 'notebook', 'skill-notes');
  fact(src, 'debug.md', 'a note\n');
  fact(src, 'trace.log', 'not a note\n');
  assert.deepEqual(fold().stayed, ['notebook/skill-notes/trace.log']);
}));

test('review 2: a notebook junction onto the tier never moves the tier notes', () => world(({ cfg, shared, fold }) => {
  fact(path.join(shared.notes, 'skill-notes'), 'debug.md', 'a note\n');
  fs.mkdirSync(path.join(cfg, 'notebook'), { recursive: true });
  fs.symlinkSync(path.join(shared.notes, 'skill-notes'), path.join(cfg, 'notebook', 'skill-notes'), 'junction');
  assert.deepEqual(fold().failed, []);
  assert.equal(read(shared.notes, 'skill-notes', 'debug.md'), 'a note\n');
  assert.ok(!exists(cfg, 'notebook', 'archived-skill-notes'));
}));

test('review 2: a whole notebook linked onto the tier notes root is the same case', () => world(({ cfg, shared, fold }) => {
  fact(path.join(shared.notes, 'agent-notes'), 'tester.md', 'a note\n');
  fs.symlinkSync(shared.notes, path.join(cfg, 'notebook'), 'junction');
  assert.deepEqual(fold().failed, []);
  assert.equal(read(shared.notes, 'agent-notes', 'tester.md'), 'a note\n');
  assert.deepEqual(fs.readdirSync(shared.notes).filter((n) => n.startsWith('archived')), []);
}));

test('review 2: a tier file linked to the host file keeps its text', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'who I am\n');
  fs.rmSync(shared.profile);
  fs.symlinkSync(path.join(cfg, 'PROFILE.md'), shared.profile, 'file');
  const r = fold();
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.moved, []);
  assert.equal(read(shared.profile), 'who I am\n');
  assert.equal(read(cfg, 'PROFILE.md'), 'who I am\n');
  assert.ok(!exists(cfg, 'archived-PROFILE.md'));
}));

test('review 2: a tier rules file linked to the host file keeps every rule', () => world(({ cfg, shared, fold }) => {
  const rules = '# User rules\n\n## R1 — Mine\nBe terse.\n';
  fs.writeFileSync(path.join(cfg, 'user-rules.md'), rules);
  fs.rmSync(shared.rules);
  fs.symlinkSync(path.join(cfg, 'user-rules.md'), shared.rules, 'file');
  assert.deepEqual(fold().failed, []);
  assert.equal(read(shared.rules), rules);
}));

test('review 3: a tier root junctioned onto the host folder is one file: no rule leaves it', () => world(({ cfg, shared, fold }) => {
  const rules = '# User rules\n\n## R1 — Mine\nBe terse.\n';
  fs.rmSync(shared.root, { recursive: true });
  fs.symlinkSync(cfg, shared.root, 'junction');
  fs.writeFileSync(path.join(cfg, 'user-rules.md'), rules);
  assert.deepEqual(fold().failed, []);
  assert.equal(read(cfg, 'user-rules.md'), rules);
  assert.ok(!exists(cfg, 'archived-user-rules.md'));
}));

test('review 3: a host link stays when the tier reads through it, by folder or by a link of its own', () => world(({ home, cfg, shared, fold }) => {
  const rules = '# User rules\n\n## R1 — Mine\nBe terse.\n';
  const real = path.join(home, 'rules-elsewhere.md');
  fs.writeFileSync(real, rules);
  const hostFile = path.join(cfg, 'user-rules.md');
  fs.rmSync(hostFile);
  fs.symlinkSync(real, hostFile, 'file');
  fs.rmSync(shared.rules);
  fs.symlinkSync(hostFile, shared.rules, 'file');
  assert.deepEqual(fold().failed, []);
  assert.equal(read(shared.rules), rules, 'through a link of its own');
  fs.rmSync(shared.root, { recursive: true });
  fs.symlinkSync(cfg, shared.root, 'junction');
  assert.deepEqual(fold().failed, []);
  assert.equal(read(shared.rules), rules, 'through the folder');
}));

test('review 3: a host file that is not UTF-8 keeps every byte and every rule, and says so', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.rules, '## R1 — Mine\nBe terse.\n');
  const bytes = Buffer.concat([Buffer.from('## R1 — Mine\nBe terse.\n\n## R2 — Caf'), Buffer.from([0xe9]), Buffer.from('\nBe kind.\n')]);
  fs.writeFileSync(path.join(cfg, 'user-rules.md'), bytes);
  const dry = fold({ dryRun: true });
  const r = fold();
  assert.deepEqual(counts(r), ZERO);
  assert.deepEqual(r.notices, [`${path.join(cfg, 'user-rules.md')} is not UTF-8, so its rules stay there and bind; save it as UTF-8 to fold them`]);
  assert.deepEqual(dry.notices, r.notices);
  assert.ok(fs.readFileSync(path.join(cfg, 'user-rules.md')).equals(bytes));
  assert.ok(!exists(shared.draft), 'a draft would carry the text with its byte replaced');
}));

test('review 2: a tier fact linked to its host fact stops the move, so the link cannot dangle', () => world(({ cfg, shared, fold }) => {
  const store = path.join(cfg, 'memory');
  fact(store, 'x.md', FACT);
  fs.symlinkSync(path.join(store, 'x.md'), path.join(shared.memory, 'x.md'), 'file');
  const r = fold();
  assert.match(r.failed.join(), /is a link to/);
  assert.equal(read(shared.memory, 'x.md'), FACT);
  assert.ok(!exists(cfg, 'archived-memory'));
}));

test('review 3: lesson bytes that are not UTF-8 survive unchanged, in the tier and through verify', () => world(({ cfg, shared, fold }) => {
  const dir = path.join(cfg, 'memory', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(shared.memory, 'agents'), { recursive: true });
  const line = Buffer.from([0x2d, 0x20, 0x63, 0x61, 0x66, 0xe9]);
  const tierOld = Buffer.from([0x2d, 0x20, 0x74, 0xe9, 0x0a]);
  fs.writeFileSync(path.join(dir, 'tester.md'), Buffer.concat([line, Buffer.from('\n')]));
  fs.writeFileSync(path.join(shared.memory, 'agents', 'tester.md'), tierOld);
  assert.deepEqual(fold().failed, []);
  assert.deepEqual(fs.readFileSync(path.join(shared.memory, 'agents', 'tester.md')),
    Buffer.concat([tierOld, line, Buffer.from('\n')]));
}));

test('review 4: each repo file the wiring wrote is named, and "not ours" reaches the report', () => world(({ home, cfg, shared }) => {
  const repo = path.join(home, 'repo');
  const taken = path.join(home, 'taken');
  fs.mkdirSync(repo);
  fact(path.join(taken, '.bob', 'rules'), 'geneseed.md', 'my own rules\n');
  fs.writeFileSync(shared.excludes, JSON.stringify({ excludes: [{ path: spelled(repo) }, { path: spelled(taken) }] }));
  const bob = seedHost(path.join(home, '.bob'));
  const stub = path.join(repo, '.bob', 'rules', 'geneseed.md');
  const dry = foldHost({ host: 'bob', cfgDir: bob, shared, dryRun: true });
  assert.deepEqual(dry.wiredPaths, [stub]);
  const r = foldHost({ host: 'bob', cfgDir: bob, shared });
  assert.deepEqual(r.wiredPaths, [stub]);
  assert.ok(foldSummary(r).includes('2 excluded folders wired (' + stub + ')'), foldSummary(r));
  assert.deepEqual(r.notices, ['bob: rules/geneseed.md already exists (kept, not ours)']);
  const c = foldHost({ host: 'claude', cfgDir: cfg, shared });
  assert.deepEqual([...c.wiredPaths].sort(), [path.join(repo, '.claude', 'settings.local.json'),
    path.join(taken, '.claude', 'settings.local.json')].sort());
}));

test('review 5: a #hash lesson and a heading reach an existing tier file', () => world(({ cfg, shared, fold }) => {
  fact(path.join(shared.memory, 'agents'), 'tester.md', '# tester — lessons\n- one\n');
  fact(path.join(cfg, 'memory', 'agents'), 'tester.md', '# tester — lessons\n#hash lesson\n## Build\n- one\n');
  assert.deepEqual(fold().failed, []);
  assert.equal(read(shared.memory, 'agents', 'tester.md'), '# tester — lessons\n- one\n#hash lesson\n## Build\n');
}));

for (const empty of ['', '[]', 'null', '{"version":1,"items":[]}']) {
  test('review 6: an empty ledger (' + JSON.stringify(empty) + ') persists, so an item is reported once', () => world(({ cfg, shared, fold }) => {
    fs.writeFileSync(shared.profile, 'shared self\n');
    fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'host self\n');
    fs.writeFileSync(shared.foldState, empty);
    const first = fold();
    assert.deepEqual(first.failed, []);
    assert.equal(first.pending, 1);
    assert.equal(fold().pending, 0, 'reported again');
    assert.equal(Object.keys(JSON.parse(read(shared.foldState)).items).length, 1);
  }));
}

test('review 6: a ledger of another shape is refused and left as it is', () => world(({ cfg, shared, fold }) => {
  fs.writeFileSync(shared.profile, 'shared self\n');
  fs.writeFileSync(path.join(cfg, 'PROFILE.md'), 'host self\n');
  fs.writeFileSync(shared.foldState, '["decided"]');
  assert.match(fold().failed.join(), /is not a ledger/);
  assert.equal(read(shared.foldState), '["decided"]');
}));

test('review 7: a wiring failure neither skips the share nor the next repo', () => world(({ home, shared }) => {
  const cfg = seedHost(path.join(home, '.bob'));
  const own = path.join(home, 'own');
  const bad = path.join(home, 'bad');
  const good = path.join(home, 'good');
  for (const d of [own, bad, good]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(bad, '.bob'), 'a file where the folder goes');
  fs.writeFileSync(path.join(cfg, 'excludes.json'), JSON.stringify({ excludes: [{ path: spelled(own), wired: {} }] }));
  fs.writeFileSync(shared.excludes, JSON.stringify({ excludes: [{ path: spelled(bad) }, { path: spelled(good) }] }));
  const r = foldHost({ host: 'bob', cfgDir: cfg, shared });
  assert.equal(r.failed.length, 1, r.failed.join());
  assert.ok(r.failed[0].includes(bad), r.failed[0]);
  assert.ok(excludesOf(shared.root).some((e) => e.path === spelled(own)), 'the share was skipped');
  assert.ok(exists(good, '.bob', 'rules', 'geneseed.md'), 'the next repo was skipped');
  assert.equal(r.wired, 1);
}));

test('review 8: a tier file that appears under the fold is never replaced', () => world(({ cfg, shared, fold }) => {
  fact(path.join(cfg, 'memory'), 'x.md', FACT);
  const realWrite = fs.writeFileSync;
  let raced = false;
  const r = withFsMock('writeFileSync', (p, ...rest) => {
    realWrite(p, ...rest);
    if (String(p).endsWith('.fold-tmp') && !raced) {
      raced = true;
      realWrite(String(p).replace(/\.\d+\.fold-tmp$/, ''), OTHER);
    }
  }, () => fold());
  assert.deepEqual(r.failed, []);
  assert.equal(read(shared.memory, 'x.md'), OTHER, 'the other writer lost its file');
  assert.equal(read(shared.memory, 'x-claude.md'), FACT);
}));

test('a dangling link at a tier name fails the step: it neither spins nor moves the store', () => world(({ cfg, shared, fold }) => {
  fact(path.join(cfg, 'memory'), 'x.md', FACT);
  fs.symlinkSync(path.join(shared.root, 'gone.md'), path.join(shared.memory, 'x.md'), 'file');
  const r = fold();
  assert.match(r.failed.join(), /^memory: /);
  assert.equal(read(cfg, 'memory', 'x.md'), FACT);
  assert.ok(!exists(cfg, 'archived-memory'));
}));

test('crash injection: a stop before any write leaves nothing lost, and the retry makes no collision', () => {
  const NAMES = ['writeFileSync', 'linkSync', 'renameSync', 'copyFileSync', 'mkdirSync', 'rmSync'];
  let survived = false;
  for (let stopAt = 1; !survived; stopAt += 1) {
    assert.ok(stopAt < 200, 'the fold never finished');
    world((w) => {
      fullHost(w);
      const { cfg, shared, fold } = w;
      let calls = 0;
      const mocks = NAMES.map((name) => {
        const real = fs[name];
        return mock.method(fs, name, (...args) => {
          calls += 1;
          if (calls >= stopAt) throw new Error('crash at write ' + calls);
          return real(...args);
        });
      });
      syncBuiltinESMExports();
      try { fold(); } finally { for (const m of mocks) m.mock.restore(); syncBuiltinESMExports(); }
      survived = calls < stopAt;
      const seen = (name, text) => {
        const archives = exists(cfg, 'archived-memory') ? fs.readdirSync(path.join(cfg, 'archived-memory')) : [];
        const places = [path.join(cfg, 'memory', name), path.join(shared.memory, name),
          ...archives.map((a) => path.join(cfg, 'archived-memory', a, name))];
        return places.some((p) => fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text);
      };
      assert.ok(seen('x.md', FACT), 'stop ' + stopAt + ' lost x.md');
      assert.ok(seen('y.md', OTHER), 'stop ' + stopAt + ' lost y.md');
      fs.mkdirSync(path.join(cfg, 'memory'), { recursive: true });   // the next emit seeds it
      const retry = fold();
      assert.deepEqual(retry.failed, [], 'stop ' + stopAt);
      assert.equal(read(shared.memory, 'x.md'), FACT, 'stop ' + stopAt);
      assert.ok(!exists(shared.memory, 'x-claude.md'), 'stop ' + stopAt + ' made a collision of its own copy');
      assert.equal(read(shared.memory, 'y-claude.md'), OTHER, 'stop ' + stopAt);
      assert.ok(!exists(shared.memory, 'y-claude-2.md'), 'stop ' + stopAt);
      assert.equal(read(shared.profile), 'who I am\n', 'stop ' + stopAt);
    });
  }
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

// M5: an orphan is a file an earlier build wrote that no manifest owns. The report lists it and
// moves nothing; a live skill, an alias whose folder the manifest owns, and an owned file are not.
test('M5: migrate --dry-run lists an unowned AGENT.md and a retired skill folder, and moves nothing', () => withHome((home) => {
  emit(home);
  fs.mkdirSync(path.join(home, '.geneseed'), { recursive: true });
  fs.writeFileSync(path.join(home, '.geneseed', '.migrated'), `${ROOT}\n`);
  const cfg = path.join(home, '.claude');
  const r0 = run(home, 'geneseed-cli.mjs', ['migrate', '--dry-run']);
  assert.doesNotMatch(r0.stdout, /orphan/, 'a clean emit reported an orphan');
  fs.writeFileSync(path.join(cfg, 'AGENT.md'), 'an old carrier\n');
  fs.mkdirSync(path.join(cfg, 'skills', 'tickets'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'skills', 'tickets', 'SKILL.md'), 'gone\n');
  const r = run(home, 'geneseed-cli.mjs', ['migrate', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('[migrate] orphan:'));
  assert.equal(lines.length, 2, r.stdout);
  assert.ok(lines.some((l) => l.includes(path.join(cfg, 'AGENT.md'))), r.stdout);
  assert.ok(lines.some((l) => l.includes(path.join(cfg, 'skills', 'tickets'))), r.stdout);
  // An alias is a plain word: the folder may be the user's, so the report never says who wrote it.
  for (const l of lines) assert.match(l, /may have written it, or it may be yours\). Nothing moves it: if it is not yours, move it by hand\.$/);
  assert.equal(read(cfg, 'AGENT.md'), 'an old carrier\n', 'the report moved a file');
}));

test('M5: a live skill is never an orphan, and neither is a path the manifest owns', () => {
  const home = makeSandbox('m5-').path;
  fs.mkdirSync(path.join(home, 'skills', 'teach'), { recursive: true });
  fs.mkdirSync(path.join(home, 'skills', 'quiz'), { recursive: true });
  fs.writeFileSync(path.join(home, 'AGENT.md'), 'x\n');
  const at = (owned) => orphanFindings(home, owned).map((p) => path.relative(home, p).replaceAll(path.sep, '/'));
  // `teach` is live, so it is never listed, owned or not. `quiz` is its alias: the folder is stale
  // unless the manifest owns it, and then the next emit prunes it.
  assert.deepEqual(at([]), ['AGENT.md', 'skills/quiz']);
  assert.deepEqual(at(['AGENT.md', 'skills/quiz/SKILL.md']), []);
});

// M6: a skill folder an earlier build rendered and no manifest owns is moved aside on a canonical
// global emit, to `<cfg>/archived-skills/<name>/<stamp>/`. A same-name folder that is a link, holds
// a link, or lacks the render's fingerprint is the user's: it stays and is still an orphan.
/** A SKILL.md as every past native writer rendered it: `name:`, a JSON-quoted `description:`, a `# <Label>: <name>` heading. */
const oldRender = (name, { crlf = false, comment = false, extra = '' } = {}) => {
  const text = `---\nname: ${name}\ndescription: "Turn it green \\u2014 an old ${name}."\n${extra}---\n\n`
    + `${comment ? '<!-- Authoring note: kept long on purpose. -->\n\n' : ''}# Rite: ${name}\n\n> An old ${name}.\n`;
  return crlf ? text.replace(/\n/g, '\r\n') : text;
};
const seedSkill = (cfg, name, text) => {
  fs.mkdirSync(path.join(cfg, 'skills', name), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'skills', name, 'SKILL.md'), text);
};
const archivedSkills = (cfg) => (exists(cfg, 'archived-skills')
  ? fs.readdirSync(path.join(cfg, 'archived-skills')).sort() : []);
const pruneLines = (out) => out.split(/\r?\n/).filter((l) => /^\[geneseed\] \w+: pruned retired skill /.test(l));
const ownedOf = (cfg) => JSON.parse(read(cfg, '.geneseed-manifest.json')).owned;

test('M6: claude-global moves an unowned old render aside, writes the alias, and a second emit does nothing', () => withHome((home) => {
  const cfg = path.join(home, '.claude');
  seedSkill(cfg, 'ci-fix', oldRender('ci-fix'));
  const r = emit(home);
  const lines = pruneLines(r.stdout);
  assert.equal(lines.length, 1, r.stdout);
  assert.match(lines[0], /^\[geneseed\] claude: pruned retired skill skills\/ci-fix \(moved to .*archived-skills.ci-fix.\d{8}-\d{6}\)$/);
  assert.deepEqual(archivedSkills(cfg), ['ci-fix']);
  const [stamp] = fs.readdirSync(path.join(cfg, 'archived-skills', 'ci-fix'));
  assert.equal(read(cfg, 'archived-skills', 'ci-fix', stamp, 'SKILL.md'), oldRender('ci-fix'));
  // The folder freed, the alias claim held in the same emit: the next one has nothing to add.
  assert.match(read(cfg, 'skills', 'ci-fix', 'SKILL.md'), /^description: "Alias of debug\."/m);
  assert.ok(ownedOf(cfg).includes('skills/ci-fix/SKILL.md'));
  const r2 = emit(home);
  assert.deepEqual(pruneLines(r2.stdout), [], r2.stdout);
  assert.deepEqual(fs.readdirSync(path.join(cfg, 'archived-skills', 'ci-fix')), [stamp]);
}));

// The authoring-comment seed is `tickets`, a name that is still retired. It was `herdr` until the
// terminal-tools kit revived that name; a revived name has its own two cases below.
test('M6: bob-global prunes a CRLF render and one with a leading authoring comment, and recreates neither', () => withHome((home) => {
  const cfg = path.join(home, '.bob');
  seedSkill(cfg, 'ci-fix', oldRender('ci-fix', { crlf: true }));
  seedSkill(cfg, 'tickets', oldRender('tickets', { comment: true, extra: 'compatibility: opencode\n' }));
  const r = emit(home, 'bob-global');
  assert.equal(pruneLines(r.stdout).length, 2, r.stdout);
  assert.deepEqual(archivedSkills(cfg), ['ci-fix', 'tickets']);
  assert.ok(!exists(cfg, 'skills', 'ci-fix'), 'Bob writes aliases as commands, never as a skill folder');
  assert.ok(!exists(cfg, 'skills', 'tickets'));
}));

test('M6: opencode-global prunes an old render too (host parity)', () => withHome((home) => {
  const cfg = path.join(home, '.config', 'opencode');
  seedSkill(cfg, 'repo-map', oldRender('repo-map', { extra: 'compatibility: opencode\n' }));
  const r = emit(home, 'opencode-global');
  assert.equal(pruneLines(r.stdout).length, 1, r.stdout);
  assert.match(pruneLines(r.stdout)[0], /^\[geneseed\] opencode: pruned retired skill skills\/repo-map /);
  assert.deepEqual(archivedSkills(cfg), ['repo-map']);
}));

// A REVIVED name (`herdr`: retired 2026-10, a terminal-tools kit skill since 2026-11) is live
// again, but an unowned render under it is an older build's copy. With the kit off, the emit moves
// it aside exactly as it did while the name was retired, and writes no herdr folder back.
test('M6: a revived name with its kit off — the old unowned herdr render is archived, nothing replaces it', () => withHome((home) => {
  const cfg = path.join(home, '.claude');
  seedSkill(cfg, 'herdr', oldRender('herdr', { comment: true }));
  const r = emit(home);
  assert.equal(pruneLines(r.stdout).length, 1, r.stdout);
  assert.match(pruneLines(r.stdout)[0], /^\[geneseed\] claude: pruned retired skill skills\/herdr /);
  assert.deepEqual(archivedSkills(cfg), ['herdr']);
  assert.ok(!exists(cfg, 'skills', 'herdr'), 'a kit-off emit wrote a herdr folder');
  assert.ok(!ownedOf(cfg).some((p) => p.startsWith('skills/herdr')));
}));

// With the kit on, the same old copy is archived first, and the freed folder takes the CURRENT
// render: the kit's skill, with its credit line and its licence beside it, owned by the manifest.
// Without the revived entry `claimer` would keep the stale file as the user's and skip the kit's
// copy. A second kit-on emit moves nothing: the folder is owned now, so it is the ordinary prune's.
test('M6: a revived name with its kit on — the old herdr render is archived and the kit copy installed', () => withHome((home) => {
  const cfg = path.join(home, '.claude');
  const old = oldRender('herdr', { comment: true });
  seedSkill(cfg, 'herdr', old);
  const r = emit(home, 'claude-global', ['--kits', 'terminal-tools']);
  assert.equal(pruneLines(r.stdout).length, 1, r.stdout);
  assert.deepEqual(archivedSkills(cfg), ['herdr']);
  const [stamp] = fs.readdirSync(path.join(cfg, 'archived-skills', 'herdr'));
  assert.equal(read(cfg, 'archived-skills', 'herdr', stamp, 'SKILL.md'), old);
  const now = read(cfg, 'skills', 'herdr', 'SKILL.md');
  assert.notEqual(now, old);
  assert.ok(now.includes('*Adapted from [herdrdev/herdr](https://github.com/herdrdev/herdr)'), now.slice(0, 400));
  assert.ok(exists(cfg, 'skills', 'herdr', 'LICENSE-herdr.txt'));
  assert.ok(ownedOf(cfg).includes('skills/herdr/SKILL.md'));
  const r2 = emit(home, 'claude-global', ['--kits', 'terminal-tools']);
  assert.deepEqual(pruneLines(r2.stdout), [], r2.stdout);
  assert.deepEqual(fs.readdirSync(path.join(cfg, 'archived-skills', 'herdr')), [stamp]);
}));

// A user's edit of the revived skill is theirs, as an edit of compose-ops is. Once an emit has
// declined to overwrite it (`kept` in the manifest, out of `owned`), no emit may archive it: not
// the first kit-off emit, not the second (by then the owned LICENSE is pruned, so nothing owned is
// left under the folder and only the `kept` record protects it), and not a kit-on emit after that.
// Each emit records `skills/herdr/SKILL.md` in `kept` again, so the record never lapses.
test('M6: a kept edit of a revived skill survives kit off twice and kit on again', () => withHome((home) => {
  const cfg = path.join(home, '.claude');
  const on = ['--kits', 'terminal-tools'];
  emit(home, 'claude-global', on);
  const file = path.join(cfg, 'skills', 'herdr', 'SKILL.md');
  const edited = `${fs.readFileSync(file, 'utf8')}\nMy own herdr note.\n`;
  fs.writeFileSync(file, edited);
  const keptOf = () => JSON.parse(read(cfg, '.geneseed-manifest.json')).kept ?? [];
  emit(home, 'claude-global', on);
  assert.ok(keptOf().includes('skills/herdr/SKILL.md'), 'the kit-on emit did not record the edit as kept');
  assert.ok(!ownedOf(cfg).includes('skills/herdr/SKILL.md'));
  for (const [i, args] of [[1, []], [2, []], [3, on]]) {
    const r = emit(home, 'claude-global', args);
    assert.deepEqual(pruneLines(r.stdout), [], `emit ${i}: ${r.stdout}`);
    assert.equal(fs.readFileSync(file, 'utf8'), edited, `emit ${i} changed the user's edit`);
    assert.deepEqual(archivedSkills(cfg), [], `emit ${i} archived something`);
    assert.ok(keptOf().includes('skills/herdr/SKILL.md'), `emit ${i} let the kept record lapse`);
  }
  // The record ends with the edit: once the user deletes the file (as the "kept your edited"
  // line tells them to), a kit-on emit writes Geneseed's copy and owns it, and `kept` must drop
  // the entry, or the manifest would call one file both Geneseed's and the user's. Two emits, so
  // a record carried by `held` in the first would still show in the second.
  fs.rmSync(file);
  for (const i of [4, 5]) {
    const r = emit(home, 'claude-global', on);
    assert.deepEqual(pruneLines(r.stdout), [], `emit ${i}: ${r.stdout}`);
    assert.deepEqual(keptOf(), [], `emit ${i} kept a record of a deleted edit`);
    assert.ok(ownedOf(cfg).includes('skills/herdr/SKILL.md'), `emit ${i} did not own the fresh copy`);
    assert.notEqual(fs.readFileSync(file, 'utf8'), edited);
  }
  assert.ok(!exists(cfg, 'skills', 'herdr', 'LICENSE-herdr.txt') || ownedOf(cfg).includes('skills/herdr/LICENSE-herdr.txt'));
}));

test('M6: a same-name folder without the fingerprint, or holding a link, stays', () => withHome((home) => {
  const cfg = path.join(home, '.bob');
  // The upstream grill-me: unquoted description, no `# <Label>:` heading.
  const upstream = '---\nname: grill-me\ndescription: Interview the user relentlessly about a plan.\n---\n\nInterview me.\n';
  seedSkill(cfg, 'grill-me', upstream);
  // Quoted and headed, but the folder also holds a link: not a plain render, so not ours to move.
  seedSkill(cfg, 'slides', oldRender('slides'));
  const elsewhere = path.join(home, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(cfg, 'skills', 'slides', 'refs'), 'junction');
  // A hand-written `quiz` (a retired alias name): quoted description and a colon heading, but the
  // label is no theme's and the name is neither the folder nor its target.
  const mine = '---\nname: quiz\ndescription: "Quiz me on a topic."\n---\n\n# Step 1: Understand\n';
  seedSkill(cfg, 'quiz', mine);
  const r = emit(home, 'bob-global');
  assert.deepEqual(pruneLines(r.stdout), [], r.stdout);
  assert.deepEqual(archivedSkills(cfg), []);
  assert.equal(read(cfg, 'skills', 'grill-me', 'SKILL.md'), upstream);
  assert.equal(read(cfg, 'skills', 'slides', 'SKILL.md'), oldRender('slides'));
  assert.equal(read(cfg, 'skills', 'quiz', 'SKILL.md'), mine);
}));

// The reviewer's counter-examples: a hand-written `grill-me` with a quoted description and some
// colon heading is not a render. The heading's label must be a theme's `SKILL` label, its name the
// folder or the skill the folder aliases, and a heading inside a code fence does not count.
test('M6: the fingerprint refuses a hand-written skill with a quoted description and a colon heading', () => {
  const dir = makeSandbox('m6fp-').path;
  const at = (body, extra = '') => {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: grill-me\ndescription: "Grill me."\n${extra}---\n\n${body}`);
    return isRendered(dir, 'grill-me');
  };
  assert.equal(at('# Step 1: Understand\n'), false);
  assert.equal(at('# Grill Me: overview\n'), false);
  assert.equal(at('# Phase 2: Review\n', 'license: MIT\n'), false);
  assert.equal(at('```md\n# Example: foo\n```\n'), false);
  assert.equal(at('```md\n# Rite: grill-me\n```\n'), false);
  assert.equal(at('# Rite: debug\n'), false, 'grill-me aliases brainstorm, not debug');
  assert.equal(at('# Overview: grill-me\n'), false, 'the right id under no theme label');
  // What a render looks like: a theme label and the folder's own name, or its alias target.
  assert.equal(at('# Rite: grill-me\n'), true);
  assert.equal(at('# Spell: brainstorm\n'), true);
  assert.equal(at('<!-- note -->\n\n# Skill: grill-me\n'), true);
});

test('M6: an unreadable folder is kept and reported, never a throw', () => {
  const cfg = makeSandbox('m6rd-').path;
  seedSkill(cfg, 'ci-fix', oldRender('ci-fix'));
  const readdir = () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };
  const { prune, keep, unreadable } = retiredSkillFolders(cfg, [], { readdir });
  assert.deepEqual(prune, []);
  assert.deepEqual(keep, [path.join(cfg, 'skills', 'ci-fix')]);
  assert.deepEqual(unreadable, [`${path.join(cfg, 'skills', 'ci-fix')} (EACCES: permission denied)`]);
});

test('M6: a fingerprinted folder that is itself a link stays, and so does its target', () => withHome((home) => {
  const cfg = path.join(home, '.claude');
  const mine = path.join(home, 'my-skills', 'grill-me');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'SKILL.md'), oldRender('grill-me'));
  fs.mkdirSync(path.join(cfg, 'skills'), { recursive: true });
  fs.symlinkSync(mine, path.join(cfg, 'skills', 'grill-me'), 'junction');
  assert.ok(fs.lstatSync(path.join(cfg, 'skills', 'grill-me')).isSymbolicLink(), 'the fixture is a link');
  const r = emit(home);
  assert.deepEqual(pruneLines(r.stdout), [], r.stdout);
  assert.ok(fs.lstatSync(path.join(cfg, 'skills', 'grill-me')).isSymbolicLink());
  assert.equal(read(mine, 'SKILL.md'), oldRender('grill-me'));
}));

test('M6: a live name and a manifest-owned folder are never candidates, rendered or not', () => {
  const cfg = makeSandbox('m6-').path;
  seedSkill(cfg, 'quiz', oldRender('quiz'));
  seedSkill(cfg, 'ci-fix', oldRender('ci-fix'));
  const rel = (ps) => ps.map((p) => path.relative(cfg, p).replaceAll(path.sep, '/'));
  const split = (owned, opts) => {
    const { prune, keep } = retiredSkillFolders(cfg, owned, opts);
    return { prune: rel(prune), keep: rel(keep) };
  };
  assert.deepEqual(split([]), { prune: ['skills/ci-fix', 'skills/quiz'], keep: [] });
  // Were `quiz` live again, its folder would be the live skill's, whatever it holds.
  assert.deepEqual(split([], { live: ['debug', 'quiz', 'teach'] }), { prune: ['skills/ci-fix'], keep: [] });
  assert.deepEqual(split(['skills/ci-fix/SKILL.md']), { prune: ['skills/quiz'], keep: [] });
});

test('M6: an alias folder the manifest owns is left to the emit, never archived', () => withHome((home) => {
  const cfg = path.join(home, '.claude');
  emit(home);
  assert.ok(ownedOf(cfg).includes('skills/quiz/SKILL.md'), 'claude writes the quiz alias');
  const before = read(cfg, 'skills', 'quiz', 'SKILL.md');
  const r = emit(home);
  assert.deepEqual(pruneLines(r.stdout), [], r.stdout);
  assert.deepEqual(archivedSkills(cfg), []);
  assert.equal(read(cfg, 'skills', 'quiz', 'SKILL.md'), before);
}));

test('M6: migrate --dry-run says "would prune" for a render and "orphan" for the rest, and moves nothing', () => withHome((home) => {
  const cfg = path.join(home, '.bob');
  emit(home, 'bob-global');
  fs.mkdirSync(path.join(home, '.geneseed'), { recursive: true });
  fs.writeFileSync(path.join(home, '.geneseed', '.migrated'), `${ROOT}\n`);
  seedSkill(cfg, 'deps-audit', oldRender('deps-audit'));
  seedSkill(cfg, 'grill-me', 'my own grill-me\n');
  const r = run(home, 'geneseed-cli.mjs', ['migrate', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  const prunes = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('[migrate] would prune:'));
  const orphans = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('[migrate] orphan:'));
  assert.deepEqual(prunes, [`[migrate] would prune: ${path.join(cfg, 'skills', 'deps-audit')} `
    + `(Geneseed rendered it and no longer ships it; the next emit moves it to ${path.join(cfg, 'archived-skills', 'deps-audit')})`]);
  assert.equal(orphans.length, 1, r.stdout);
  assert.ok(orphans[0].includes(path.join(cfg, 'skills', 'grill-me')), r.stdout);
  assert.equal(read(cfg, 'skills', 'deps-audit', 'SKILL.md'), oldRender('deps-audit'));
  assert.deepEqual(archivedSkills(cfg), []);
}));
