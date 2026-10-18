// `diffCollect`'s render memo (`renderMemo`): the web console's overview and fleet diff the same
// install on every refresh, and rendering the `expected` tree is ~0.6 s of each call.
//
// The rule these tests hold, stated once: ONLY THE RENDER IS MEMOISED. The memo is keyed on
// everything the render reads — the source fingerprint and every axis read off the deployment
// (theme, gate switches, excluded skills, ...) — and a change to any of them renders again. The
// COMPARE against the deployed tree is never memoised, so a hand edit shows on the very next
// call with no re-render. And the memo holds at most `cap` installs.
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
import { apiFleet, apiOverview } from '../../js/web/api.mjs';
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
function emitInstall(cfgDir = null) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
    '--emit', 'opencode-global', '--theme', 'neutral'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, windowsHide: true,
    env: cfgDir ? { ...process.env, OPENCODE_CONFIG_DIR: cfgDir } : process.env,
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
  assert.deepEqual(ov1.diff, { edited: 0, added: 0, missing: 0 });
  assert.deepEqual(ov2.diff, ov1.diff);
  assert.deepEqual(fl2.installs.map((i) => i.drift), fl1.installs.map((i) => i.drift));
  assert.deepEqual(fl1.installs.map((i) => i.drift), [{ edited: 0, added: 0, missing: 0 }]);
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

test('the memo holds at most `cap` installs, least recently used evicted first', () => {
  const [a, b, c] = ['lru-a', 'lru-b', 'lru-c'].map(copyInstall);
  const memo = renderMemo(2);
  for (const d of [a, b, c]) diffCollect({ target: d, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 3);
  assert.equal(memo.entries.size, 2);
  // `c` is still held, `a` was evicted.
  diffCollect({ target: c, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 3);
  diffCollect({ target: a, memo, sourceFp: 'fp-a' });
  assert.equal(memo.renders, 4);
  assert.equal(memo.entries.size, 2);
});
