// `--learn off|light|standard|session` — the model memory learning distils with (spec
// docs/specs/2026-11-18-learn-model-row.md, work unit A1: the setting only; no host reads it yet).
//
// Written out, not recorded. The rules this file holds:
//   1. `learnModel` is pure and resolves a tier through `tierModel` (one precedence home):
//      `off` -> no model, from `off`; `session` -> no model, from `session`; `light`/`standard` -> the
//      tier's model, from `tier`; a tier that gives none (OpenCode or OpenClaude with no map value)
//      falls back to `session`; Bob learns nothing (`n/a`). An unknown value is the default, `light`.
//   2. The default is `light` (user decision D2). The choice is recorded in the carrier
//      (`Learn model: off`, only OFF the default, so a default build is byte-identical), read back by
//      `learnOfDir`, kept by the rebuild argv, and held by the preserve guard.
//   3. A hand-edited marker value reads as the default, so it can never reach `--learn`.
//   4. `status` names the setting in an install's row only when it is not the default.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { main as driverMain } from '../../js/build/driver.mjs';
import { installProfile, setupBuildArgs } from '../../js/build/generate.mjs';
import { DEFAULT_LEARN, LEARN_CHOICES, makeCfg } from '../../js/build/source.mjs';
import { claudeConfigDir } from '../../js/hosts/hosts.mjs';
import { installedDefaults, learnOfDir } from '../../js/hosts/installs.mjs';
import { learnModel } from '../../js/hosts/native.mjs';
import { statusData } from '../../js/inspect/status.mjs';
import { diffCollect } from '../../js/inspect/diff.mjs';
import { loadProfile, profileBuildArgs, profileDiff, profileFromInstall, profileProblems } from '../../js/maintain/profiles.mjs';
import { targetLearn } from '../../js/maintain/setup.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// FIRST: every emit writes the hook shim and the registry into the environment's home.
sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });
const sandbox = (prefix) => { const sb = makeSandbox(prefix); sandboxes.push(sb); return sb.path; };

function capture(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  let out = ''; let err = '';
  process.stdout.write = (s) => { out += String(s); return true; };
  process.stderr.write = (s) => { err += String(s); return true; };
  try { return { value: fn(), out, err }; } finally { process.stdout.write = o; process.stderr.write = e; }
}
const build = (...argv) => capture(() => driverMain(argv));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

// ---- 1. the resolver ------------------------------------------------------------------------------

test('learnModel: one row per host and setting, the tier through tierModel', () => {
  const none = {};
  const lightMap = { light: 'p/m' };
  /** [learn, map, host, want] */
  const rows = [
    ['light', none, 'claude', { model: 'haiku', from: 'tier' }],
    ['standard', none, 'claude', { model: 'sonnet', from: 'tier' }],
    ['light', { light: 'claude-haiku-4-5' }, 'claude', { model: 'claude-haiku-4-5', from: 'tier' }],
    ['light', none, 'opencode', { model: null, from: 'session' }],
    ['light', lightMap, 'opencode', { model: 'p/m', from: 'tier' }],
    ['standard', lightMap, 'opencode', { model: null, from: 'session' }],
    ['light', none, 'openclaude', { model: null, from: 'session' }],
    ['standard', { standard: 'corp-std' }, 'openclaude', { model: 'corp-std', from: 'tier' }],
    ['off', none, 'claude', { model: null, from: 'off' }],
    ['off', lightMap, 'opencode', { model: null, from: 'off' }],
    ['session', none, 'claude', { model: null, from: 'session' }],
    ['session', lightMap, 'opencode', { model: null, from: 'session' }],
    ['light', none, 'bob', { model: null, from: 'n/a' }],
    ['off', none, 'bob', { model: null, from: 'n/a' }],
    ['session', none, 'bob', { model: null, from: 'n/a' }],
    // An empty map value is the user choosing inherit: the tier gives none, so the session model.
    ['light', { light: '' }, 'claude', { model: null, from: 'session' }],
    // An unknown setting is the default, light.
    ['bogus', none, 'claude', { model: 'haiku', from: 'tier' }],
  ];
  for (const [learn, map, host, want] of rows) {
    const got = learnModel(learn, map, {}, host);
    assert.deepEqual({ model: got.model, from: got.from }, want, `${learn} on ${host} with ${JSON.stringify(map)}`);
  }
});

test('learnModel: the tier\'s cloud-alias warning passes through, and only for a model the tier gave', () => {
  const cloud = { CLAUDE_CODE_USE_BEDROCK: '1' };
  const got = learnModel('light', {}, cloud, 'claude');
  assert.equal(got.model, 'haiku');
  assert.match(got.warning, /ANTHROPIC_DEFAULT_HAIKU_MODEL/);
  assert.equal(learnModel('off', {}, cloud, 'claude').warning, null);
  assert.equal(learnModel('session', {}, cloud, 'claude').warning, null);
  assert.equal(learnModel('light', {}, { ...cloud, ANTHROPIC_DEFAULT_HAIKU_MODEL: 'x' }, 'claude').warning, null);
});

test('the choices are the four settings and the default is light', () => {
  assert.deepEqual([...LEARN_CHOICES], ['off', 'light', 'standard', 'session']);
  assert.equal(DEFAULT_LEARN, 'light');
  assert.equal(makeCfg().learn, 'light');
  assert.equal(makeCfg({ learn: 'off' }).learn, 'off');
  assert.equal(makeCfg({ learn: 'max' }).learn, 'light', 'an unknown value is the default');
});

// ---- 2. the flag, the marker and the read-back ----------------------------------------------------

test('the flag takes the four settings and refuses anything else by name', () => {
  const r = build('--emit', 'claude', '--out', sandbox('lrn-bad-'), '--learn', 'max');
  assert.equal(r.value, 2);
  assert.match(r.err, /argument --learn: invalid choice: 'max' \(choose from 'off', 'light', 'standard', 'session'\)/);
});

test('a default emit writes no marker; a non-default one records it, and the install reads it back', () => {
  const dflt = sandbox('lrn-dflt-');
  assert.equal(build('--emit', 'claude', '--out', dflt, '--theme', 'neutral').value, 0);
  assert.doesNotMatch(read(dflt, 'CLAUDE.md'), /^Learn model:/m);
  assert.equal(learnOfDir(dflt, 'claude'), 'light');
  // Naming the default is still the default: no line.
  const same = sandbox('lrn-same-');
  assert.equal(build('--emit', 'claude', '--out', same, '--theme', 'neutral', '--learn', 'light').value, 0);
  assert.doesNotMatch(read(same, 'CLAUDE.md'), /^Learn model:/m);
  for (const value of ['off', 'standard', 'session']) {
    const d = sandbox(`lrn-${value}-`);
    assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--learn', value).value, 0);
    assert.match(read(d, 'CLAUDE.md'), new RegExp(`^Learn model: ${value}$`, 'm'));
    assert.equal(learnOfDir(d, 'claude'), value);
  }
});

test('a hand-edited marker value reads as the default, so it can never reach --learn', () => {
  const d = sandbox('lrn-edit-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--learn', 'off').value, 0);
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), read(d, 'CLAUDE.md').replace('Learn model: off', 'Learn model: max'));
  assert.equal(learnOfDir(d, 'claude'), 'light');
});

// ---- 3. the settings that carry it forward --------------------------------------------------------
// A `--reset` rebuild is a WHOLE selection, and `setupBuildArgs` elides the default, so a path that
// never heard of the option would put an `off` install back to `light`.

const learnFlag = (argv) => (argv.includes('--learn') ? argv[argv.indexOf('--learn') + 1] : null);

test('setupBuildArgs elides the default and speaks otherwise; installProfile reads the install\'s own', () => {
  assert.equal(learnFlag(setupBuildArgs('neutral', 'claude', null, null, 'lean')), null);
  assert.equal(learnFlag(setupBuildArgs('neutral', 'claude', null, null, 'lean', 'peer', 'direct', null, undefined,
    null, undefined, null, {}, null, false, '200k', 'off', 'off')), 'off');
  const d = sandbox('lrn-prof-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--learn', 'session').value, 0);
  const p = installProfile('claude', 'project', d);
  assert.equal(p.learn, 'session');
  assert.equal(learnFlag(p.argv), 'session', 'rebuild-all would have dropped the setting');
});

test('profileBuildArgs: the profile key wins, else the install value, else light; --reset stays last', () => {
  const p = loadProfile('starter').profile;
  assert.equal(p.learn, undefined, 'a shipped profile must not name the learn model');
  for (const [profileLearn, current, want] of [
    [undefined, 'off', 'off'],       // a profile that says nothing keeps the install's choice
    [undefined, 'light', null],
    [undefined, null, null],         // no install yet: the default
    ['session', 'off', 'session'],   // a profile that names one sets it
    ['light', 'off', null],          // and one that names the default turns it back
  ]) {
    const argv = profileBuildArgs({ ...p, ...(profileLearn ? { learn: profileLearn } : {}) }, 'claude', null, null, {}, current);
    assert.equal(learnFlag(argv), want, `${profileLearn} over ${current}`);
    assert.equal(argv.at(-1), '--reset');
  }
});

test('a profile validates its learn key, saves it only off the default, and diffs it', () => {
  const starter = () => loadProfile('starter').profile;
  assert.deepEqual(profileProblems({ ...starter(), learn: 'off' }), []);
  assert.deepEqual(profileProblems({ ...starter(), learn: 'on' }),
    ["'learn': invalid value 'on' (valid: 'off', 'light', 'standard', 'session')"]);
  const info = { ...installProfile('claude', 'project', sandbox('lrn-save-')), learn: 'off' };
  assert.equal(profileFromInstall(info).learn, 'off');
  assert.ok(!('learn' in profileFromInstall({ ...info, learn: 'light' })));
  assert.deepEqual(profileDiff({ ...starter(), learn: 'off' }, starter()).find((d) => d.key === 'learn'),
    { key: 'learn', base: 'light', now: 'off' });
});

test('the preserve guard refuses a rebuild that drops a recorded learn model, and takes one that names it', () => {
  const d = sandbox('lrn-guard-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--learn', 'off').value, 0);
  const bare = build('--emit', 'claude', '--out', d, '--theme', 'neutral');
  assert.notEqual(bare.value, 0, 'a rebuild without --learn reset the recorded setting to the default');
  assert.match(bare.err, /learn/);
  assert.equal(learnOfDir(d, 'claude'), 'off', 'the refused rebuild still changed the install');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--learn', 'light').value, 0);
  assert.equal(learnOfDir(d, 'claude'), 'light');
});

test('installedDefaults reads the setting off an installed machine', () => {
  const dir = claudeConfigDir();
  try {
    assert.equal(installedDefaults().learn, 'light');
    assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--learn', 'session').value, 0);
    assert.equal(installedDefaults().learn, 'session');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the wizard keeps the target install\'s setting and asks nothing', () => {
  const d = sandbox('lrn-wiz-');
  assert.equal(targetLearn('claude', d), 'light', 'no install: the default');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--learn', 'off').value, 0);
  assert.equal(targetLearn('claude', d), 'off');
  assert.equal(targetLearn('files', d), 'light');
});

// ---- 4. status and diff ---------------------------------------------------------------------------

test('status names the setting in an install row only off the default; diff reads no drift from it', () => {
  const d = sandbox('lrn-status-');
  assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--config-dir', d, '--learn', 'off').value, 0);
  assert.equal(learnOfDir(d, 'claude'), 'off', 'the fixture did not record the setting');
  assert.deepEqual(diffCollect({ target: d }).files.map((f) => f.rel).filter((r) => r !== 'agent-overrides.json'), [],
    'a non-default learn model read as drift');
  const dir = claudeConfigDir();
  try {
    const row = () => statusData().installs.find((p) => p.host === 'claude' && p.scope === 'global');
    assert.equal(build('--emit', 'claude-global', '--theme', 'neutral').value, 0);
    assert.equal(row().learn, 'light');
    assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--learn', 'standard', '--reset').value, 0);
    assert.equal(row().learn, 'standard');
    assert.match(row().rebuild, /--learn standard/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
