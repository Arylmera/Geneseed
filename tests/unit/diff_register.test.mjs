// The POSTURE and the MODE are inputs to the render, so they are inputs to the DRIFT
// COMPARISON — and until this file they were neither.
//
// `diffCollect` builds its `expected` tree by re-rendering `src/`, and it read the theme, the
// emit and the footprint off the deployment precisely so that a legitimately-different install
// would not be reported as edited. It did not read the posture or the mode: `makeCfg`'s
// defaults are `peer`/`direct` (the reference's, inherited — `rituals/harness.py` never set
// them either), so every install that chose any other register was diffed against a Peer/Direct
// AGENT.md and reported its own `## Posture` and `## Mode` sections as a local edit. The report
// was permanent: no rebuild could clear it, because the rebuild wrote the register back.
//
// The write side is where it had teeth. `apiRestore` renders the same `expected` tree and
// COPIES from it, so "Restore" on the falsely-flagged AGENT.md silently reverted the user's
// posture and mode to the defaults — the panel offered the revert and then performed it.
//
// Every test here therefore comes in a pair: the false positive must be gone, AND the
// comparison must still be able to see a real edit. A `diffCollect` that reported nothing at
// all would satisfy the first half of every one of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { diffCollect } from '../../js/inspect/diff.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { postureOfDir, modeOfDir, doctrinesOfDir } from '../../js/hosts/installs.mjs';
import {
  makeSandbox, homeOverrides, sandboxProcessHome, restoreProcessHome,
} from '../helpers/sandbox.mjs';

// `diffCollect` renders IN PROCESS through the emit path, whose hook-shim writer targets the
// environment's home. Same reason as diff_scope.test.mjs.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

/**
 * A global install emitted at `posture`/`mode`, returned as its config dir.
 *
 * The emit runs as a CHILD PROCESS with `--posture`/`--mode`, which is the only route that
 * exercises the flags the user actually reaches — `driverMain` in-process would share this
 * process's module state with the `diffCollect` call under test.
 */
function install(d, { posture, mode, doctrines }) {
  const gcfg = path.join(d, 'gcfg');
  fs.mkdirSync(gcfg, { recursive: true });
  const argv = ['--emit', 'opencode-global', '--theme', 'neutral'];
  if (posture) argv.push('--posture', posture);
  if (mode) argv.push('--mode', mode);
  if (doctrines) argv.push('--doctrines', doctrines);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env, ...homeOverrides(path.join(d, 'home')), OPENCODE_CONFIG_DIR: gcfg,
    },
    maxBuffer: 1 << 26,
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`emit (${r.status}): ${(r.stderr || r.stdout).slice(-1200)}`);
  return gcfg;
}

function withDir(fn) {
  const sb = makeSandbox('gs-diffreg-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const rels = (files) => files.map((f) => `${f.rel} (${f.status})`).sort();

// ---------------------------------------------------------------------------------------------
// The register the user chose is not drift.

test('a freshly-built install at the DEFAULT register reports no drift', () => {
  // The baseline the bug never broke, stated so the two below are read as a difference rather
  // than as the only claim in the file.
  withDir((d) => {
    const gcfg = install(d, { posture: 'peer', mode: 'direct' });
    const { files } = diffCollect({ target: gcfg });
    assert.deepEqual(rels(files), [], 'a fresh default install reported drift');
  });
});

test('a freshly-built install at a NON-DEFAULT posture reports no drift', () => {
  withDir((d) => {
    const gcfg = install(d, { posture: 'artisan', mode: 'direct' });
    // The precondition, absolutely: if the emit did not actually deploy Artisan, the empty
    // drift below would be true for the wrong reason.
    assert.equal(postureOfDir(gcfg), 'artisan', 'the emit did not deploy the artisan posture');
    const { files } = diffCollect({ target: gcfg });
    assert.deepEqual(rels(files), [], 'the chosen posture was reported as a local edit');
  });
});

test('a freshly-built install at a NON-DEFAULT mode reports no drift', () => {
  withDir((d) => {
    const gcfg = install(d, { posture: 'peer', mode: 'foreman' });
    assert.equal(modeOfDir(gcfg), 'foreman', 'the emit did not deploy the foreman mode');
    const { files } = diffCollect({ target: gcfg });
    assert.deepEqual(rels(files), [], 'the chosen mode was reported as a local edit');
  });
});

test('both axes off the default at once report no drift', () => {
  // The combination is its own case: the two sections are rendered by ONE helper
  // (`registerBody`) through two `cfg` keys, so a fix that threaded only one of them would
  // pass both singles above and fail here.
  withDir((d) => {
    const gcfg = install(d, { posture: 'artisan', mode: 'foreman' });
    assert.equal(postureOfDir(gcfg), 'artisan');
    assert.equal(modeOfDir(gcfg), 'foreman');
    const { files } = diffCollect({ target: gcfg });
    assert.deepEqual(rels(files), [], 'the chosen register was reported as a local edit');
  });
});

test('a freshly-built install with the packs NARROWED reports no drift', () => {
  // The third register, and it arrived a phase after the other two — so `diffCollect` rendered
  // `expected` with all four packs and reported an install built at `--doctrines craft` as
  // having locally edited its entire doctrines section, `Active packs:` marker and all. Same
  // scar as the posture/mode one above, one axis over; same fix, one more value read off the
  // deployment. `[]` is deliberately covered too — the empty selection is a real configuration
  // and `null`-vs-`[]` is exactly the distinction a `|| default` would collapse.
  withDir((d) => {
    const gcfg = install(d, { doctrines: 'craft' });
    assert.deepEqual(doctrinesOfDir(gcfg), ['craft'], 'the emit did not narrow the packs');
    assert.deepEqual(rels(diffCollect({ target: gcfg }).files), [],
      'the chosen pack selection was reported as a local edit');
  });
  withDir((d) => {
    const gcfg = install(d, { doctrines: 'none' });
    assert.deepEqual(doctrinesOfDir(gcfg), [], 'the emit did not deploy an empty selection');
    assert.deepEqual(rels(diffCollect({ target: gcfg }).files), [],
      '`--doctrines none` was reported as a local edit');
  });
});

// ---------------------------------------------------------------------------------------------
// The control: a real edit is still seen, ON AN INSTALL AT THE NON-DEFAULT REGISTER.
//
// Not on a default install — that would leave open the one outcome that would be worse than the
// bug, a `diffCollect` that renders at the deployment's register and thereby goes blind to
// genuine edits on exactly the installs the fix was for.

test('a real local edit is still reported on a non-default-register install', () => {
  withDir((d) => {
    const gcfg = install(d, { posture: 'artisan', mode: 'foreman' });
    const agent = path.join(gcfg, 'AGENT.md');
    fs.writeFileSync(agent, `${fs.readFileSync(agent, 'utf8')}\n<!-- a genuine local edit -->\n`);
    const { files } = diffCollect({ target: gcfg });
    assert.deepEqual(rels(files), ['AGENT.md (edited)']);
    // And the hunk is the EDIT, not the register: a diff that reported AGENT.md for the old
    // reason would also satisfy the line above.
    const diff = files[0].diff.join('\n');
    assert.ok(diff.includes('a genuine local edit'), diff.slice(0, 2000));
    assert.ok(!diff.includes('**Peer**'), `the register leaked into the hunk:\n${diff.slice(0, 2000)}`);
  });
});

test('a file added under a non-default register is still reported', () => {
  // `added` and `missing` travel a different branch from `edited`, and the register only
  // reaches the `edited` one. Asserted rather than assumed, because "the fix broke the other
  // two statuses" is the shape of failure this file exists to catch.
  withDir((d) => {
    const gcfg = install(d, { posture: 'artisan', mode: 'foreman' });
    const { files } = diffCollect({ target: gcfg });
    assert.deepEqual(rels(files), []);
    fs.rmSync(path.join(gcfg, 'AGENT.md'));
    assert.deepEqual(rels(diffCollect({ target: gcfg }).files), ['AGENT.md (missing)']);
  });
});
