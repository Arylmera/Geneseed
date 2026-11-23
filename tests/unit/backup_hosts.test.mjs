// The host half of a backup, the same for EVERY host: what travels out of OpenCode, Claude Code,
// Bob and OpenClaude, and how it lands again. Each row runs against a real global emit of that
// host, because what is Geneseed's own is read from the manifest the emit wrote: a hand-made
// fixture would agree with whatever the code believes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { HOSTS } from '../../js/hosts/hosts.mjs';
import { writeZip } from '../../js/lib/zip.mjs';
import { cmdRestore, collectBackup } from '../../js/maintain/backup.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const NAMES = ['opencode', 'claude', 'bob', 'openclaude'];
const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI'];
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (p) => fs.readFileSync(p, 'utf8');

function inHome(home, fn) {
  const env = homeOverrides(home);
  const saved = Object.fromEntries([...Object.keys(env), ...ENV_KEYS].map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function captured(fn) {
  const out = [];
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { out.push(String(s)); return true; };
  try { return { rc: fn(), out: out.join('') }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

let sb; let a; let b; let clean;
const dirOf = (home, host) => inHome(home, () => HOSTS.find((h) => h.host === host).configDir());

function emit(home, host) {
  inHome(home, () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', `${host}-global`,
      '--theme', 'neutral', '--footprint', 'lean', '--out', path.join(home, 'bundle')],
    { cwd: home, env: process.env, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `${host}: ${r.stderr}`);
  });
}

const collect = (home, hosts = NAMES) => inHome(home, () => collectBackup({
  targets: hosts.map((h) => [h, 'global', HOSTS.find((x) => x.host === h).configDir()]), profileOf: () => ({}) }));

before(() => {
  sb = makeSandbox('bh-');
  a = path.join(sb.path, 'a'); b = path.join(sb.path, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  for (const h of NAMES) { emit(a, h); emit(b, h); }
  clean = collect(a);
  for (const h of NAMES) {
    const d = dirOf(a, h);
    put(path.join(d, 'skills', 'mine', 'SKILL.md'), `${h} skill\n`);
    put(path.join(d, 'skills', 'synced', 'bucket', 'x', 'SKILL.md'), 'a cache\n');
    put(path.join(d, 'skills', '.trash', 'SKILL.md'), 'deleted\n');
    put(path.join(d, 'skills', 'loose.md'), 'not a skill folder\n');
    put(path.join(d, 'agents', 'mine.md'), `${h} agent\n`);
    put(path.join(d, 'agents', 'team', 'deep.md'), 'nested agent\n');
    put(path.join(d, 'notebook', 'ledger.md'), `${h} ledger\n`);
    put(path.join(d, 'notebook', 'deep', 'n.txt'), 'nested note\n');
    put(path.join(d, 'notebook', 'gates.jsonl'), '{}\n');
    put(path.join(d, 'notebook', 'usage.jsonl'), '{}\n');
    put(path.join(d, 'notebook', 'agent-runs.jsonl'), '{}\n');
    put(path.join(d, 'notebook', 'done-gate', 's.json'), '{}');
    put(path.join(d, 'notebook', 'store-baseline', 's.json'), '{}');
    put(path.join(d, 'memory', 'fact.md'), `---\nname: fact\n---\n${h}\n`);
    put(path.join(d, 'user-rules.md'), `## R1 — ${h} rule\nBody.\n`);
    put(path.join(d, 'PROFILE.md'), `# ${h} profile\n`);
    put(path.join(d, 'context.json'), JSON.stringify({ context: [{ path: path.join(a, 'docs'), load: 'lazy' }] }));
    put(path.join(d, 'agent-overrides.json'), JSON.stringify({ agents: { reviewer: { model: 'm' } } }));
  }
});
after(() => sb?.cleanup());

// THE CONTROL. An install nobody touched carries no skill, agent or host file on any host: every
// seed and every rendered file is Geneseed's. Without it, carrying everything would pass below.
// The notebook's README is the one exception: it is the agent's charter to rewrite, and no hash
// records the rendered text, so it travels rather than risk losing a rewritten one.
test('an untouched install of any host carries nothing of its own', () => {
  const host = clean.entries.map((e) => e.name).filter((n) => !n.startsWith('tier/'));
  assert.deepEqual(host.filter((n) => !/^host\/[a-z]+\/notebook\/README\.md$/.test(n)), []);
  assert.deepEqual(clean.manifest.ambiguous, []);
});

for (const h of NAMES) {
  test(`${h}: the user's files travel, caches and machine logs do not`, () => {
    const back = collect(a);
    const got = back.entries.map((e) => e.name)
      .filter((n) => n.split('/')[1] === h && n !== `host/${h}/notebook/README.md`).sort();
    assert.deepEqual(got, [
      `agents/${h}/mine.md`, `agents/${h}/team/deep.md`,
      `host/${h}/PROFILE.md`, `host/${h}/agent-overrides.json`, `host/${h}/context.json`,
      `host/${h}/memory/fact.md`, `host/${h}/notebook/deep/n.txt`, `host/${h}/notebook/ledger.md`,
      `host/${h}/user-rules.md`, `skills/${h}/mine/SKILL.md`,
    ].sort());
    // What stays behind is named, never dropped in silence.
    const left = back.manifest.hostSkipped.filter((s) => s.startsWith(`${h} `)).sort();
    assert.deepEqual(left, [`${h} notebook/agent-runs.jsonl`, `${h} notebook/done-gate`, `${h} notebook/gates.jsonl`,
      `${h} notebook/store-baseline`, `${h} notebook/usage.jsonl`, `${h} skills/.trash`, `${h} skills/loose.md`,
      `${h} skills/synced`].sort());
  });
}

// A fresh install holds only seeds: each is replaced by the user's file, and the old home is
// rewritten in context.json. Then one of B's own files: kept, with the backup's beside it.
test('every host gets its files back, and nothing of the user is overwritten', () => {
  const back = collect(a);
  const file = path.join(sb.path, 'b.zip');
  fs.writeFileSync(file, writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ ...back.manifest, installs: [] })) }, ...back.entries]));
  for (const h of NAMES) put(path.join(dirOf(b, h), 'notebook', 'ledger.md'), 'B own ledger\n');
  const r = inHome(b, () => captured(() => cmdRestore({ file }, { apply: () => 0 })));
  assert.equal(r.rc, 0, r.out);
  for (const h of NAMES) {
    const d = dirOf(b, h);
    assert.equal(read(path.join(d, 'skills', 'mine', 'SKILL.md')), `${h} skill\n`);
    assert.equal(read(path.join(d, 'agents', 'team', 'deep.md')), 'nested agent\n');
    assert.equal(read(path.join(d, 'user-rules.md')), `## R1 — ${h} rule\nBody.\n`);
    assert.equal(read(path.join(d, 'PROFILE.md')), `# ${h} profile\n`);
    assert.deepEqual(JSON.parse(read(path.join(d, 'agent-overrides.json'))), { agents: { reviewer: { model: 'm' } } });
    assert.equal(JSON.parse(read(path.join(d, 'context.json'))).context[0].path, path.join(b, 'docs'));
    assert.equal(read(path.join(d, 'memory', 'fact.md')), `---\nname: fact\n---\n${h}\n`);
    assert.equal(read(path.join(d, 'notebook', 'ledger.md')), 'B own ledger\n');
    assert.equal(read(path.join(d, 'notebook', 'ledger-restored.md')), `${h} ledger\n`);
  }
  const again = inHome(b, () => captured(() => cmdRestore({ file }, { apply: () => 0 })));
  assert.equal(again.rc, 0, again.out);
  for (const h of NAMES) assert.ok(!fs.existsSync(path.join(dirOf(b, h), 'notebook', 'ledger-restored-2.md')), h);
  assert.match(again.out, /skills, agents and host files: 0 written/);
});
