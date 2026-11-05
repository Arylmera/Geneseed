// tests/unit/machine_dir.test.mjs
//
// `js/lib/machine-dir.mjs` — the one home of Geneseed's machine-wide directory and of the
// names beneath it. Expected values are written out; `XDG_CONFIG_HOME` is restored afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { machineDir, sharedPaths } from '../../js/lib/machine-dir.mjs';

function withXdg(value, fn) {
  const saved = process.env.XDG_CONFIG_HOME;
  if (value === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

test('XDG_CONFIG_HOME set: the directory is <xdg>/geneseed', () => {
  const xdg = path.join(os.tmpdir(), 'xdg-probe');
  assert.equal(withXdg(xdg, machineDir), path.join(xdg, 'geneseed'));
});

test('XDG_CONFIG_HOME unset: the directory is ~/.config/geneseed', () => {
  assert.equal(withXdg(undefined, machineDir), path.join(os.homedir(), '.config', 'geneseed'));
});

test('sharedPaths names every key under the machine directory', () => {
  const xdg = path.join(os.tmpdir(), 'xdg-probe');
  const root = path.join(xdg, 'geneseed');
  assert.deepEqual(withXdg(xdg, sharedPaths), {
    root,
    memory: path.join(root, 'memory'),
    rules: path.join(root, 'user-rules.md'),
    profile: path.join(root, 'PROFILE.md'),
    wiki: path.join(root, 'geneseed-wiki.jsonc'),
    excludes: path.join(root, 'excludes.json'),
    notes: path.join(root, 'notes'),
    draft: path.join(root, 'user-rules.draft.md'),
    foldState: path.join(root, '.fold-state.json'),
  });
});

test('the golden fence reports a write to, and a creation of, the machine dir', async () => {
  const { machineSnapshot, machineDrift } = await import('../golden.mjs');
  const { makeSandbox } = await import('../helpers/sandbox.mjs');
  const { writeFileSync } = await import('node:fs');
  const sb = makeSandbox('gs-fence-');
  const dir = path.join(sb.path, 'geneseed');
  const before = machineSnapshot(dir);
  assert.equal(before.size, 0, 'an absent dir is an empty listing');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'installs.json'), '{}');
  const drift = machineDrift(before, machineSnapshot(dir));
  assert.equal(drift.length, 1);
  assert.match(drift[0], /installs\.json: absent -> 2:/);
  assert.deepEqual(machineDrift(machineSnapshot(dir), machineSnapshot(dir)), []);
  // A directory is listed too, so an EMPTY one a cell made (a file listing cannot see it) is drift.
  const withFile = machineSnapshot(dir);
  mkdirSync(path.join(dir, 'memory'));
  const dirDrift = machineDrift(withFile, machineSnapshot(dir));
  assert.equal(dirDrift.length, 1);
  assert.match(dirDrift[0], /memory: absent -> dir/);
  sb.cleanup();
});
