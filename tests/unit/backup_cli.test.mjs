// `geneseed backup` through the real CLI entry, in a sandboxed home. The absolute gate of a
// native verb (NATIVE, tests/unit/hook_cli.test.mjs): what it writes, what --dry-run leaves
// alone, and that it never writes over a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { readZip } from '../../js/lib/zip.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI'];

/** A home whose tier holds two of the user's files, and a cwd to run in. */
function world(fn) {
  const sb = makeSandbox('bkc-');
  try {
    const home = sb.path;
    const tier = path.join(home, '.config', 'geneseed');
    fs.mkdirSync(path.join(tier, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(tier, 'user-rules.md'), '## R1 — keep it short\nbody\n');
    fs.writeFileSync(path.join(tier, 'memory', 'nas.md'), 'port 8080\n');
    const cwd = path.join(home, 'work');
    fs.mkdirSync(cwd);
    const env = { ...process.env, ...homeOverrides(home) };
    for (const k of ENV_KEYS) delete env[k];
    const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'backup', ...args],
      { cwd, env, encoding: 'utf8', windowsHide: true });
    return fn({ home, cwd, run });
  } finally {
    sb.cleanup();
  }
}

// The default name carries the machine and the minute, so two machines' backups never collide;
// `manifest.json` comes first so a reader can list the archive without inflating it all.
test('backup writes a readable archive', () => world(({ cwd, run }) => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const made = fs.readdirSync(cwd);
  assert.equal(made.length, 1);
  assert.match(made[0], /^geneseed-backup-[A-Za-z0-9-]+-\d{8}-\d{4}\.zip$/);
  const entries = readZip(fs.readFileSync(path.join(cwd, made[0])));
  assert.equal(entries[0].name, 'manifest.json');
  const manifest = JSON.parse(entries[0].data.toString('utf8'));
  assert.deepEqual(manifest.files.map((f) => f.name), ['tier/memory/nas.md', 'tier/user-rules.md']);
  assert.deepEqual(entries.slice(1).map((e) => e.name), ['tier/memory/nas.md', 'tier/user-rules.md']);
  assert.match(r.stdout, /\[backup\] wrote .*geneseed-backup-.*\.zip: 2 files, \d+ bytes/);
}));

// A dry run names each file with its size and a total, and the cwd stays empty. 39 bytes:
// `port 8080\n` is 10, and the rule is 29 (its em dash is three UTF-8 bytes).
test('--dry-run writes nothing', () => world(({ cwd, run }) => {
  const r = run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(cwd), []);
  assert.match(r.stdout, /^ +10 {2}tier\/memory\/nas\.md$/m);
  assert.match(r.stdout, /^\[backup\] dry run: 2 files, 39 bytes — nothing written$/m);
}));

// Create-if-absent: an existing file is never written over.
test('refuses an existing --out', () => world(({ cwd, run }) => {
  const out = path.join(cwd, 'b.zip');
  fs.writeFileSync(out, 'mine');
  const r = run('--out', out);
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(out, 'utf8'), 'mine');
  assert.match(r.stderr, /\[backup\] .*b\.zip exists/);
}));

test('backup -h', () => world(({ run }) => {
  const r = run('-h');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--out/);
  assert.match(r.stdout, /--dry-run/);
}));
