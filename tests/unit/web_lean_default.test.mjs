// A NEW INSTALL FROM THE WEB CONSOLE IS LEAN, LIKE ONE FROM THE CLI (`--footprint` defaults to
// `lean`; the user chose parity on 2026-10-24). "New" is the whole rule: a Deploy into a folder,
// or the Install button on an ABSENT row, gets `lean` when the body names no footprint. An
// EXISTING install is not new — a rebuild without a footprint keeps the one it has, `full`
// included, so this change can never flip a live install. And an explicit `full` still wins.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { apiDeployCmd, apiInstallCmd, buildActionCmds } from '../../js/web/actions.mjs';
import { webState } from '../../js/web/state.mjs';
import { installState } from '../../js/hosts/installs.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

const fpOf = (plan) => {
  assert.ok('cmd' in plan, JSON.stringify(plan));
  const cmd = plan.cmd.map(String);
  return cmd[cmd.indexOf('--footprint') + 1];
};

let home;
let savedOc;
before(() => {
  home = sandboxProcessHome();
  savedOc = process.env.OPENCODE_CONFIG_DIR;
});
after(() => {
  if (savedOc === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = savedOc;
  restoreProcessHome();
});

// The OpenCode global dir is moved into the sandbox, so its row is a detected target whose
// state the product decides: nothing there is `absent`, a manifest makes it `active`.
const ocDir = (name, { manifest = false, footprint = null } = {}) => {
  const dir = path.join(home, name);
  fs.mkdirSync(dir, { recursive: true });
  if (manifest) fs.writeFileSync(path.join(dir, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
  if (footprint) fs.writeFileSync(path.join(dir, '.geneseed-footprint'), footprint);
  process.env.OPENCODE_CONFIG_DIR = dir;
  return dir;
};

test('a deploy with no footprint is lean; an explicit full is full', () => {
  const sb = makeSandbox();
  try {
    const st = webState('neutral');
    assert.equal(fpOf(apiDeployCmd(st, { host: 'opencode', path: sb.path })), 'lean');
    assert.equal(fpOf(apiDeployCmd(st, { host: 'opencode', path: sb.path, footprint: 'full' })),
      'full');
    // A bogus value is not a choice: it falls back to the default, never reaches the argv.
    assert.equal(fpOf(apiDeployCmd(st, { host: 'opencode', path: sb.path, footprint: 'x' })),
      'lean');
  } finally { sb.cleanup(); }
});

test('installing an absent row with no footprint is lean; an explicit full is full', () => {
  const dir = ocDir('oc-absent');
  assert.equal(installState(dir, 'opencode', 'global'), 'absent');
  const st = webState('neutral');
  assert.equal(fpOf(apiInstallCmd(st, { host: 'opencode', path: dir })), 'lean');
  assert.equal(fpOf(apiInstallCmd(st, { host: 'opencode', path: dir, footprint: 'full' })),
    'full');
});

test('rebuilding an active install with no footprint keeps its own, full included', () => {
  const st = webState('neutral');
  const full = ocDir('oc-full', { manifest: true, footprint: 'full' });
  assert.equal(installState(full, 'opencode', 'global'), 'active');
  assert.equal(fpOf(apiInstallCmd(st, { host: 'opencode', path: full })), 'full');
  // A pre-marker install was built full, and `footprintOfDir` reads it that way: kept.
  const legacy = ocDir('oc-legacy', { manifest: true });
  assert.equal(fpOf(apiInstallCmd(st, { host: 'opencode', path: legacy })), 'full');
  const lean = ocDir('oc-lean', { manifest: true, footprint: 'lean' });
  assert.equal(fpOf(apiInstallCmd(st, { host: 'opencode', path: lean })), 'lean');
});

// The first-run Onboarding Build (and a theme switch) with NOTHING deployed is a new global
// install too. A re-target from a deployed view to another emit keeps the viewed footprint, as
// it always has: that is an install's own choice, not the no-marker `full`.
test('a console Build with nothing deployed is lean; a re-target keeps the viewed footprint', () => {
  const buildFp = (st, emit) => {
    const [cmd] = buildActionCmds(st, { theme: 'neutral', emit });
    const argv = cmd.map(String);
    return argv[argv.indexOf('--footprint') + 1];
  };
  const empty = ocDir('oc-empty');
  assert.equal(buildFp(webState('neutral', empty), 'opencode-global'), 'lean');
  const full = ocDir('oc-viewed-full', { manifest: true, footprint: 'full' });
  const st = webState('neutral', full);
  st.selectView(full);
  assert.equal(buildFp(st, 'claude-global'), 'full');
});
