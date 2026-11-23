// `geneseed restore` (js/maintain/backup.mjs `cmdRestore`): the user's own skills and agents put
// back claim-on-create, each recorded global install rebuilt through `profile apply`, and the
// exit code that tells a partial restore apart. In-process rows stub the apply (`deps.apply`); the
// last row is the whole round trip through two real CLI runs, with a stub `claude` on PATH as
// tests/unit/profile_apply.test.mjs does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { collectBackup, cmdRestore } from '../../js/maintain/backup.mjs';
import { writeZip } from '../../js/lib/zip.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

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

/** `fn()`'s return value and everything it printed to stdout and stderr. */
function captured(fn) {
  const out = []; const err = [];
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try { return { rc: fn(), out: out.join(''), err: err.join('') }; } finally {
    process.stdout.write = o; process.stderr.write = e;
  }
}

/** Home A: a claude config dir (no manifest: every skill is the user's), a linked skill, a wiki. */
function backupFrom(sb, file) {
  const a = path.join(sb, 'a');
  const cfg = path.join(a, '.claude');
  put(path.join(cfg, 'skills', 'my-skill', 'SKILL.md'), 'mine\n');
  put(path.join(cfg, 'agents', 'my-agent.md'), 'A agent\n');
  put(path.join(a, 'vault', 'nas', 'SKILL.md'), 'nas\n');
  fs.symlinkSync(path.join(a, 'vault', 'nas'), path.join(cfg, 'skills', 'nas'), 'junction');
  put(path.join(a, '.config', 'geneseed', 'geneseed-wiki.jsonc'), `{ "wikis": [{ "path": ${JSON.stringify(path.join(a, 'Terra'))} }] }\n`);
  let profile;
  inHome(a, () => {
    const { entries, manifest } = collectBackup({ targets: [['claude', 'global', cfg], ['claude', 'project', path.join(a, 'repo')]] });
    profile = manifest.installs[0].profile;
    fs.writeFileSync(file, writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }, ...entries]));
  });
  return { a, profile };
}

function world(fn) {
  const sb = makeSandbox('rc-');
  try {
    const file = path.join(sb.path, 'b.zip');
    const { a, profile } = backupFrom(sb.path, file);
    const b = path.join(sb.path, 'b');
    fs.mkdirSync(b);
    return fn({ a, b, file, profile });
  } finally { sb.cleanup(); }
}

// A file absent here is written; one that differs is the user's on this machine: kept, and named.
test('restores skills and agents claim-on-create', () => world(({ b, file }) => {
  put(path.join(b, '.claude', 'agents', 'my-agent.md'), 'B agent\n');
  const r = inHome(b, () => captured(() => cmdRestore({ file }, { apply: () => 0 })));
  assert.equal(r.rc, 0, r.err);
  assert.equal(read(path.join(b, '.claude', 'skills', 'my-skill', 'SKILL.md')), 'mine\n');
  assert.equal(read(path.join(b, '.claude', 'agents', 'my-agent.md')), 'B agent\n');
  assert.match(r.out, /^\[restore\] kept yours \(differs from the backup\): claude agents\/my-agent\.md$/m);
}));

// The install travels as a personal profile named for its host; a second restore finds the same
// profile and saves no second copy.
test('replays each install', () => world(({ b, file, profile }) => {
  const calls = [];
  const apply = (name) => { calls.push(name); return 0; };
  inHome(b, () => captured(() => cmdRestore({ file }, { apply })));
  inHome(b, () => captured(() => cmdRestore({ file }, { apply })));
  const dir = path.join(b, '.config', 'geneseed', 'profiles');
  assert.deepEqual(fs.readdirSync(dir), ['restored-claude.json']);
  const saved = JSON.parse(read(path.join(dir, 'restored-claude.json')));
  assert.deepEqual({ ...saved, description: '' }, { ...profile, description: '' });
  assert.deepEqual(calls, ['restored-claude', 'restored-claude']);
}));

// A host that does not build here is named, and the exit code says the restore is partial.
test('absent host gives exit 2', () => world(({ b, file }) => {
  const r = inHome(b, () => captured(() => cmdRestore({ file }, { apply: () => 1 })));
  assert.equal(r.rc, 2);
  assert.match(r.out, /^\[restore\] claude: not rebuilt \(profile apply exit 1\) — run: geneseed profile apply restored-claude$/m);
  assert.equal(read(path.join(b, '.claude', 'skills', 'my-skill', 'SKILL.md')), 'mine\n', 'the rest is restored');
}));

// What the backup could not carry is named once each: the link with its old target, the project
// install, and a wiki path the home rewrite points at but this machine lacks.
test('report lists links, projects, missing wiki paths', () => world(({ a, b, file }) => {
  const r = inHome(b, () => captured(() => cmdRestore({ file }, { apply: () => 0 })));
  const once = (re) => assert.equal((r.out.match(new RegExp(re.source, 'gm')) ?? []).length, 1, re.source);
  once(/^\[restore\] link to recreate by hand: claude skill nas -> .+nas$/);
  assert.ok(r.out.includes(path.join(a, 'vault', 'nas')));
  once(/^\[restore\] project install to re-run there: claude .+repo$/);
  once(/^\[restore\] wiki path not found on this machine: .+Terra$/);
  assert.ok(r.out.includes(path.join(b, 'Terra')));
}));

test('bad file gives exit 1, nothing written', () => world(({ b }) => {
  const bad = path.join(b, 'bad.zip');
  fs.writeFileSync(bad, 'not a zip');
  const r = inHome(b, () => captured(() => cmdRestore({ file: bad }, { apply: () => 0 })));
  assert.equal(r.rc, 1);
  assert.match(r.err, /^\[restore\] refused: .+; nothing written$/m);
  assert.deepEqual(fs.readdirSync(b), ['bad.zip']);
}));

// The whole path, two real CLI runs: an emit and a backup on A, a restore on a fresh B. B ends
// with A's rules and A's theme, rebuilt by `profile apply`.
test('full round-trip', { timeout: 300_000 }, () => {
  const sb = makeSandbox('rc-');
  try {
    const env = (home) => {
      const e = { ...process.env, ...homeOverrides(home) };
      for (const k of ENV_KEYS) delete e[k];
      const bin = path.join(home, 'fakebin');
      fs.mkdirSync(bin, { recursive: true });
      for (const f of ['claude', 'claude.cmd']) fs.writeFileSync(path.join(bin, f), '', { mode: 0o755 });
      e.PATH = `${bin}${path.delimiter}${e.PATH ?? e.Path ?? ''}`;
      delete e.Path;
      return e;
    };
    const run = (home, bin, args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', bin), ...args],
      { cwd: home, env: env(home), encoding: 'utf8', windowsHide: true });
    const a = path.join(sb.path, 'a'); const b = path.join(sb.path, 'b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    const emit = run(a, 'build-driver.mjs', ['--emit', 'claude-global', '--theme', 'imperial', '--footprint', 'lean',
      '--out', path.join(a, 'bundle')]);
    assert.equal(emit.status, 0, emit.stderr);
    put(path.join(a, '.config', 'geneseed', 'user-rules.md'), '## R1 — keep it short\nAnswer in three lines.\n');
    const file = path.join(sb.path, 'carry.zip');
    const back = run(a, 'geneseed-cli.mjs', ['backup', '--out', file]);
    assert.equal(back.status, 0, back.stdout + back.stderr);
    const res = run(b, 'geneseed-cli.mjs', ['restore', file]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(read(path.join(b, '.config', 'geneseed', 'user-rules.md')), '## R1 — keep it short\nAnswer in three lines.\n');
    assert.equal(read(path.join(b, '.claude', '.geneseed-theme')).trim(), 'imperial');
  } finally { sb.cleanup(); }
});
