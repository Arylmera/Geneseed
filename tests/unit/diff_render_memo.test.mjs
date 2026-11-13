// `diffCollect`'s render memo (`renderMemo`): the web console's overview and fleet diff the same
// install on every refresh, and rendering the `expected` tree is ~0.6 s of each call.
//
// The rule these tests hold, stated once: ONLY THE RENDER IS MEMOISED. The memo is keyed on
// everything the render reads — the source fingerprint, the host and every axis read off the
// deployment (theme, footprint, gate switches, excluded skills, ...) — and a change to any of them
// renders again. The key holds no install path, so two installs alike in all of it share one
// render, and each still reads it at its own path. The COMPARE against the deployed tree is never
// memoised, so a hand edit shows on the very next call with no re-render. And the memo holds at
// most `cap` renders.
//
// A source change is simulated by passing a different `sourceFp`, never by editing `src/`: the
// suite runs concurrently on one shared checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { diffCollect, renderMemo } from '../../js/inspect/diff.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { excludedSkillsOfDir, gatesOfDir } from '../../js/hosts/installs.mjs';
import { targetView } from '../../js/web/actions.mjs';
import { apiDiff, apiFleet, apiOverview } from '../../js/web/api.mjs';
import { webState } from '../../js/web/state.mjs';
import { sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

// The emit's hook-shim writer targets the environment's home; and the fleet walks the installs
// under it. Same reason as diff_register.test.mjs.
const home = sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

/**
 * An opencode-global install emitted as a child process (the route a user reaches) — into
 * `cfgDir`, or the sandbox home's default config dir.
 */
function emitInstall(cfgDir = null, emit = 'opencode-global', args = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
    '--emit', emit, '--theme', 'neutral', ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, windowsHide: true,
    env: cfgDir ? { ...process.env, [emit === 'bob-global' ? 'BOB_CONFIG_DIR' : 'OPENCODE_CONFIG_DIR']: cfgDir }
      : process.env,
  });
  if (r.status !== 0) throw new Error(`emit (${r.status}): ${(r.stderr || r.stdout).slice(-1200)}`);
}

// ONE install at the default config dir, shared by every test below: the emit is the slow part.
const gcfg = path.join(home, '.config', 'opencode');
emitInstall();

/**
 * A COPY of that install, for a test that counts renders and reads no drift: a copy is not a
 * fresh install — its skill pointers name the dir it was copied from, which is real drift.
 */
function copyInstall(name) {
  const d = path.join(home, 'copies', name);
  fs.cpSync(gcfg, d, { recursive: true });
  return d;
}

const rels = (files) => files.map((f) => `${f.rel} (${f.status})`).sort();

test('two overview + fleet refreshes on an unchanged source render the install once', () => {
  // Counted after EACH call, from both orders: a call that skipped the memo would leave it
  // unmade (overview first) or render a second time (fleet first), and either reddens here.
  const fresh = () => { const st = webState(); st.stampDoctor([]); return st; };
  const a = fresh(); // the doctor renders on its own and is cached by #324; not this test's
  const ov1 = apiOverview(a);
  assert.equal(a.renderMemo?.renders, 1);
  const fl1 = apiFleet(a);
  assert.equal(a.renderMemo.renders, 1);
  const ov2 = apiOverview(a);
  const fl2 = apiFleet(a);
  assert.equal(a.renderMemo.renders, 1);
  const b = fresh();
  apiFleet(b);
  assert.equal(b.renderMemo?.renders, 1);
  apiOverview(b);
  assert.equal(b.renderMemo.renders, 1);
  // And the memo changes nothing anyone reads: a fresh install has no drift either way.
  assert.deepEqual(ov1.diff, { edited: 0, added: 0, missing: 0, linked: 0, stale: 0, kept: 0 });
  assert.deepEqual(ov2.diff, ov1.diff);
  assert.deepEqual(fl2.installs.map((i) => i.drift), fl1.installs.map((i) => i.drift));
  assert.deepEqual(fl1.installs.map((i) => i.drift), [{ edited: 0, added: 0, missing: 0, linked: 0, stale: 0, kept: 0 }]);
});

test('a per-install view reads the render its daemon already holds', () => {
  // The view asks first: a view with its own memo, or a diff with none, leaves the daemon's unmade.
  const base = webState();
  base.stampDoctor([]);
  const view = targetView(base, ['opencode', 'global', gcfg]);
  assert.equal(apiDiff(view).files.length, 0);
  assert.equal(base.renderMemo?.renders, 1, 'the view did not use the memo of its daemon');
  apiFleet(base);
  assert.equal(base.renderMemo.renders, 1, 'the fleet rendered what the view left');
});

test('installs alike share a render, each read at its own path; a differing axis does not', () => {
  // Bob, because its skills name their own directory: a render bound to one install would read
  // as drift at the other, so an empty diff at both is what proves the path is mapped per install.
  const a = path.join(home, 'bob-a');
  const b = path.join(home, 'bob-b');
  const full = path.join(home, 'bob-full');
  emitInstall(a, 'bob-global');
  emitInstall(b, 'bob-global');
  emitInstall(full, 'bob-global', ['--footprint', 'full']);
  const memo = renderMemo();
  assert.deepEqual(diffCollect({ target: a, memo, sourceFp: 'fp-a' }).files, []);
  assert.deepEqual(diffCollect({ target: b, memo, sourceFp: 'fp-a' }).files, []);
  assert.equal(memo.renders, 1, 'two alike installs rendered twice');
  assert.deepEqual(diffCollect({ target: full, memo, sourceFp: 'fp-a' }).files, []);
  assert.equal(memo.renders, 2, 'the footprint is not in the key');
  // The host is in the key too: the opencode install at these axes is not Bob's render.
  diffCollect({ target: gcfg, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 3, 'the host is not in the key');
});

test('a hand edit to the deployed tree shows as drift on the next call, without a render', () => {
  // A real emit, not a copy: this test reads the drift. Emitted here, after the fleet test,
  // so the fleet there sees one install.
  const d = path.join(home, 'hand-edit');
  emitInstall(d);
  const memo = renderMemo();
  assert.deepEqual(diffCollect({ target: d, memo, sourceFp: 'fp-a' }).files, []);
  fs.appendFileSync(path.join(d, 'AGENT.md'), '\nA hand edit.\n');
  const { files } = diffCollect({ target: d, memo, sourceFp: 'fp-a' });
  assert.deepEqual(rels(files), ['AGENT.md (edited)']);
  assert.equal(memo.renders, 1);
});

test('a source change re-renders, and drops the old source\'s entry', () => {
  const memo = renderMemo();
  diffCollect({ target: gcfg, memo, sourceFp: 'fp-a' });
  diffCollect({ target: gcfg, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 1);
  diffCollect({ target: gcfg, memo, sourceFp: 'fp-b' });
  assert.equal(memo.renders, 2);
  assert.equal(memo.entries.size, 1);
});

test('an axis change re-renders: the theme, a gate switch, an excluded skill', () => {
  const d = copyInstall('axes');
  const memo = renderMemo();
  diffCollect({ target: d, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 1);

  // The theme, passed by the caller as the overview does.
  diffCollect({ target: d, theme: 'imperial', memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 2);

  // A gate switch and an excluded skill, read off the deployed carrier. The precondition is
  // asserted, so a marker spelling the reader ignores fails here and not as a vacuous pass.
  const agent = path.join(d, 'AGENT.md');
  fs.appendFileSync(agent, '\nSecrets gate: off\n');
  assert.equal(gatesOfDir(d).secretsGate, false);
  diffCollect({ target: d, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 3);

  fs.appendFileSync(agent, '\nExcluded skills: commit\n');
  assert.deepEqual(excludedSkillsOfDir(d), ['commit']);
  diffCollect({ target: d, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 4);
});

test('the memo holds at most `cap` renders, least recently used evicted first', () => {
  // Three themes, so three keys: the memo counts renders, and one install holds them all.
  const d = copyInstall('lru');
  const at = (theme) => diffCollect({ target: d, theme, memo, sourceFp: 'fp-a' });
  const memo = renderMemo(2);
  for (const theme of ['neutral', 'imperial', 'biker']) at(theme);
  assert.equal(memo.renders, 3);
  assert.equal(memo.entries.size, 2);
  // `biker` is still held, `neutral` was evicted.
  at('biker');
  assert.equal(memo.renders, 3);
  at('neutral');
  assert.equal(memo.renders, 4);
  assert.equal(memo.entries.size, 2);
});
