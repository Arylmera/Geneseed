// A dead hook shim is said out loud — on every CLI run, in `status`, and repaired by an emit.
//
// The shim (`<GENESEED_HOME>/bin/geneseed-hook[.cmd]`) is machine-wide: one write naming a
// path that later disappears turns off every hook of every Claude-shaped install, and the
// hooks fail into a channel nobody reads. Each case below builds that state in a sandboxed
// home and runs the real binaries in a child, so the env the warning reads is the env a user
// has.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT } from '../../js/build/source.mjs';
import { hookShimPath, shimDead } from '../../js/hosts/shim.mjs';
import { gateSummary, statusLines, statusData } from '../../js/inspect/status.mjs';
import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const CLI = path.join(ROOT, 'bin', 'geneseed-cli.mjs');

/** Write a shim into `home` whose quoted target does not exist; returns that target. */
function deadShim(home) {
  const env = cellEnv(home);
  const p = withEnv(env, () => hookShimPath());
  const gone = path.join(home, 'moved-checkout', 'bin', 'geneseed-hook.mjs');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${gone}" "$@"\n`, 'utf8');
  return gone;
}

function withEnv(env, fn) {
  const saved = process.env.GENESEED_HOME;
  process.env.GENESEED_HOME = env.GENESEED_HOME;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.GENESEED_HOME;
    else process.env.GENESEED_HOME = saved;
  }
}

function cli(home, args, extra = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...cellEnv(home), ...extra }, windowsHide: true,
  });
}

const warning = (gone) => `[geneseed] ⚠ hooks are off on this machine: the hook shim points `
  + `at ${gone}, which no longer exists. Fix: geneseed rebuild-all`;

test('a dead shim: one warning line on stderr, stdout unchanged', () => {
  const sb = makeSandbox('shimwarn-');
  try {
    const clean = cli(sb.path, ['version']);
    assert.equal(clean.status, 0, clean.stderr);
    assert.ok(!clean.stderr.includes('hooks are off'), 'an absent shim was reported as dead');

    const gone = deadShim(sb.path);
    const r = cli(sb.path, ['version']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, clean.stdout, 'the warning moved stdout');
    const hits = r.stderr.split(/\r?\n/).filter((l) => l.includes('hooks are off'));
    assert.deepEqual(hits, [warning(gone)]);

    // The escape hatch, and help, stay silent.
    const quiet = cli(sb.path, ['version'], { GENESEED_NO_SHIM_CHECK: '1' });
    assert.ok(!quiet.stderr.includes('hooks are off'), 'GENESEED_NO_SHIM_CHECK=1 was ignored');
    const help = cli(sb.path, ['--help']);
    assert.ok(!help.stderr.includes('hooks are off'), '--help printed the shim warning');
  } finally {
    sb.cleanup();
  }
});

test('a dead shim: the status gates row says DEAD, not armed', () => {
  const sb = makeSandbox('shimstatus-');
  try {
    const gone = deadShim(sb.path);
    withEnv(cellEnv(sb.path), () => {
      const g = gateSummary([]);
      assert.deepEqual(g.dead, [gone]);
      const row = statusLines({ ...statusData(), gates: g }, false)
        .find((l) => l.includes('gates'));
      assert.ok(row.includes(`DEAD — hook shim points at ${gone}; run: geneseed rebuild-all`),
        row);
    });
  } finally {
    sb.cleanup();
  }
});

test('emitting a Claude install repairs a dead shim', () => {
  // `writeHookShim` rewrites a shim whose body differs; this pins that the emit path reaches it.
  const sb = makeSandbox('shimrepair-');
  try {
    deadShim(sb.path);
    const r = spawnSync(process.execPath,
      [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', 'claude', '--theme', 'neutral',
        '--out', path.join(sb.path, 'proj')],
      { cwd: ROOT, encoding: 'utf8', env: cellEnv(sb.path), windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, (r.stderr || r.stdout).slice(-1500));
    withEnv(cellEnv(sb.path), () => assert.deepEqual(shimDead(), []));
  } finally {
    sb.cleanup();
  }
});
