// Install profiles (`js/maintain/profiles.mjs`): the loader, its validation, the argv a profile
// builds per host, the save path and the diff a saved profile prints. Every expectation is
// written out here; nothing is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BASE_PROFILE, PROFILE_KEYS, PROFILES_DIR, cmdProfile, listProfiles, loadProfile, profileBuildArgs,
  profileDiff, profileFromInstall, profileProblems, saveProfile, shippedProfileProblems,
} from '../../js/maintain/profiles.mjs';
import { cellEnv, makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STARTER = {
  description: 'For a first install: neutral voice, every guardrail except the ownership gate.',
  hosts: ['opencode', 'bob', 'claude', 'openclaude'],
  theme: 'neutral', footprint: 'lean', posture: 'peer', mode: 'direct', trust: 'balanced',
  doctrines: 'all', kits: [], gates: { ownershipGate: false }, login: true,
};

/** A profiles dir holding `files` (name -> object or raw text). */
function fixtureDir(files) {
  const sb = makeSandbox('gs-profiles-');
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(sb.path, `${name}.json`), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return sb;
}

test('the shipped starter profile holds the values the spec decided (D4, D5, D27)', () => {
  const r = loadProfile('starter');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.profile, STARTER);
  assert.equal(BASE_PROFILE, 'starter');
});

test('every shipped profile loads, and the doctor arm says nothing about them', () => {
  assert.deepEqual(listProfiles(), ['guillaume-claude-global', 'starter']);
  assert.deepEqual(shippedProfileProblems(), []);
});

test('the doctor arm names a shipped profile that would refuse', () => {
  const sb = fixtureDir({ ok: STARTER, bad: { ...STARTER, posture: 'nope' } });
  try {
    const probs = shippedProfileProblems(sb.path);
    assert.equal(probs.length, 1);
    assert.match(probs[0], /^\[profiles\] profiles\/bad\.json: 'posture': invalid value 'nope'/);
  } finally { sb.cleanup(); }
});

// Each row: a change to starter, and the sentence the loader must refuse it with. An unknown key
// is an error, never ignored (D10): a typo must not fall back to a default in silence.
const REFUSALS = [
  [{ posure: 'peer' }, /unknown key 'posure' \(valid keys: 'description', 'hosts'/],
  [{ sharedTier: true }, /unknown key 'sharedTier'/],
  [{ posture: 'boss' }, /'posture': invalid value 'boss' \(valid: 'peer', /],
  [{ mode: 'auto' }, /'mode': invalid value 'auto' \(valid: 'direct', 'foreman'\)/],
  [{ trust: 'yolo' }, /'trust': invalid value 'yolo'/],
  [{ footprint: 'tiny' }, /'footprint': invalid value 'tiny' \(valid: 'lean', 'full'\)/],
  [{ theme: 'klingon' }, /'theme': unknown theme 'klingon' \(valid: .*'neutral'/],
  [{ hosts: ['vim'] }, /'hosts': unknown host 'vim' \(valid: 'opencode', 'claude', 'bob', 'openclaude'\)/],
  [{ hosts: [] }, /'hosts' must be a non-empty list/],
  [{ doctrines: ['craft', 'magic'] }, /'doctrines': unknown pack 'magic'/],
  [{ gates: { fooGate: false } }, /'gates': unknown gate 'fooGate' \(valid: 'secretsGate'/],
  [{ gates: { deletionGate: true } }, /'gates\.deletionGate' must be false/],
  [{ excludeRules: ['craft.99'] }, /'excludeRules': unknown rule 'craft\.99'/],
  [{ excludeSkills: ['no-such-skill'] }, /'excludeSkills': unknown skill 'no-such-skill'/],
  [{ excludeSkills: ['rule'] }, /'excludeSkills': 'rule' cannot be excluded/],
  [{ kits: ['cobol'] }, /'kits': unknown kit 'cobol'/],
  [{ login: 'yes' }, /'login' must be true or false/],
];

for (const [change, want] of REFUSALS) {
  test(`a profile with ${JSON.stringify(change)} is refused, naming the field`, () => {
    const sb = fixtureDir({ x: { ...STARTER, ...change } });
    try {
      const r = loadProfile('x', sb.path);
      assert.equal(r.ok, false);
      assert.match(r.error, want);
    } finally { sb.cleanup(); }
  });
}

test('a missing required field is named', () => {
  const { theme, ...rest } = STARTER;
  assert.ok(theme);
  assert.deepEqual(profileProblems(rest), ["'theme' is missing"]);
});

test('an unknown profile name lists the shipped ones; a path is not a name', () => {
  const sb = fixtureDir({ alpha: STARTER, beta: STARTER });
  const broken = fixtureDir({ broken: '{ nope' });
  try {
    assert.deepEqual(loadProfile('nope', sb.path), { ok: false, error: "no profile 'nope' — shipped profiles: alpha, beta" });
    const r = loadProfile('../alpha', sb.path);
    assert.equal(r.ok, false);
    assert.match(r.error, /is not a profile name/);
    assert.match(loadProfile('broken', broken.path).error, /is not valid JSON/);
  } finally {
    sb.cleanup();
    broken.cleanup();
  }
});

// The argv per host, written out. Explicit on every axis (D18): `--exclude-rules none` and
// `--exclude-skills none` are spelled, `--doctrines` lists every pack, `--reset` ends it.
test('starter builds the same explicit argv for each of the four global emits', () => {
  for (const host of ['opencode', 'claude', 'bob', 'openclaude']) {
    assert.deepEqual(profileBuildArgs(STARTER, host), [
      '--theme', 'neutral', '--emit', `${host}-global`, '--footprint', 'lean',
      '--doctrines', 'craft,rigor,ops,process,comms', '--exclude-rules', 'none',
      '--no-ownership-gate', '--exclude-skills', 'none', '--reset',
    ]);
  }
});

test('the captured Claude profile builds its own settings, gates off included', () => {
  const r = loadProfile('guillaume-claude-global');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(profileBuildArgs(r.profile, 'claude'), [
    '--theme', 'imperial', '--emit', 'claude-global', '--footprint', 'lean',
    '--posture', 'expert', '--mode', 'foreman', '--doctrines', 'craft,rigor,ops,process,comms',
    '--exclude-rules', 'craft.4,ops.1,process.3,process.4,process.5,rigor.5',
    '--no-deletion-gate', '--no-ownership-gate', '--no-external-gate', '--exclude-skills', 'none', '--reset',
  ]);
});

// What `installProfile(host, 'global', root)` hands back, trimmed to the keys the save reads.
const INSTALL = {
  host: 'claude', theme: 'pirate', footprint: 'full', posture: 'expert', mode: 'foreman', trust: 'balanced',
  doctrines: ['craft', 'rigor', 'ops', 'process', 'comms'], excludeRules: ['ops.1', 'craft.4'],
  excludeSkills: ['bruno'], kits: ['docker'], sharedTier: false,
  secretsGate: true, doneGate: true, deletionGate: false, ownershipGate: true, externalGate: true,
  testNote: true, ownBranchPass: true,
};

test('a profile saved from an install copies every setting, gates off included (D28)', () => {
  const p = profileFromInstall(INSTALL, 'mine');
  assert.deepEqual(p, {
    description: 'mine', hosts: ['claude'], theme: 'pirate', footprint: 'full', posture: 'expert',
    mode: 'foreman', trust: 'balanced', doctrines: 'all', excludeRules: ['craft.4', 'ops.1'],
    excludeSkills: ['bruno'], kits: ['docker'], gates: { deletionGate: false }, login: true,
  });
  assert.deepEqual(profileProblems(p), []);
  // A narrowed pack list stays a list.
  assert.deepEqual(profileFromInstall({ ...INSTALL, doctrines: ['rigor', 'craft'] }).doctrines, ['craft', 'rigor']);
});

test('the diff from starter lists the gates first, then each setting that moved', () => {
  const p = profileFromInstall(INSTALL);
  assert.deepEqual(profileDiff(p, STARTER), [
    { key: 'gates.deletionGate', base: 'on', now: 'off' },
    { key: 'gates.ownershipGate', base: 'off', now: 'on' },
    { key: 'hosts', base: 'bob,claude,openclaude,opencode', now: 'claude' },
    { key: 'theme', base: 'neutral', now: 'pirate' },
    { key: 'footprint', base: 'lean', now: 'full' },
    { key: 'posture', base: 'peer', now: 'expert' },
    { key: 'mode', base: 'direct', now: 'foreman' },
    { key: 'excludeRules', base: 'none', now: 'craft.4,ops.1' },
    { key: 'excludeSkills', base: 'none', now: 'bruno' },
    { key: 'kits', base: 'none', now: 'docker' },
  ]);
  assert.deepEqual(profileDiff(STARTER, STARTER), []);
});

test('save writes the keys in order, refuses an existing file without force, and refuses a path', () => {
  const sb = makeSandbox('gs-profiles-');
  try {
    const p = profileFromInstall(INSTALL, 'mine');
    const r = saveProfile('team', p, { dir: sb.path });
    assert.equal(r.ok, true);
    const text = fs.readFileSync(path.join(sb.path, 'team.json'), 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(text)), PROFILE_KEYS);
    assert.ok(text.endsWith('}\n'));
    assert.equal(loadProfile('team', sb.path).ok, true);
    const again = saveProfile('team', { ...p, theme: 'neutral' }, { dir: sb.path });
    assert.equal(again.ok, false);
    assert.match(again.error, /already exists — pick another name, or add --force/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(sb.path, 'team.json'), 'utf8')).theme, 'pirate');
    assert.equal(saveProfile('team', { ...p, theme: 'neutral' }, { dir: sb.path, force: true }).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(sb.path, 'team.json'), 'utf8')).theme, 'neutral');
    for (const bad of ['../x', 'a/b', 'a\\b', '']) {
      assert.equal(saveProfile(bad, p, { dir: sb.path }).ok, false, bad);
    }
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// `geneseed profile save`, over a real Claude global install in a sandboxed home. The process
// home is moved into the sandbox (`sandboxProcessHome`) so `installProfile` reads that install,
// and the save writes into a temp profiles dir, never the checkout's.
// ---------------------------------------------------------------------------------------------

/** Run `fn` with stdout and stderr captured; `{ rc, out }`. */
function captured(fn) {
  const lines = [];
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { return { rc: fn(), out: lines.join('').replaceAll('\r\n', '\n') }; } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

test('profile save writes the install as a profile and prints its difference from starter', { timeout: 300_000 }, () => {
  const home = sandboxProcessHome();
  const out = makeSandbox('gs-profiles-');
  try {
    // Refusals first: no install, no --from, a --from that is not a global emit.
    assert.equal(captured(() => cmdProfile({ action: 'save', name: 'x', from: 'claude-global' }, { dir: out.path })).rc, 1);
    assert.match(captured(() => cmdProfile({ action: 'save', name: 'x', from: null }, { dir: out.path })).out,
      /profile save needs --from, one of: opencode-global, claude-global, bob-global, openclaude-global/);
    assert.equal(captured(() => cmdProfile({ action: 'save', name: 'x', from: 'claude' }, { dir: out.path })).rc, 2);

    const built = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
      '--theme', 'pirate', '--emit', 'claude-global', '--footprint', 'lean', '--posture', 'expert',
      '--doctrines', 'craft,rigor,ops,process,comms', '--exclude-rules', 'ops.1', '--no-deletion-gate'],
    { cwd: home, env: cellEnv(home), encoding: 'utf8', windowsHide: true });
    assert.equal(built.status, 0, built.stderr);
    fs.copyFileSync(path.join(PROFILES_DIR, 'starter.json'), path.join(out.path, 'starter.json'));

    const r = captured(() => cmdProfile({ action: 'save', name: 'team', from: 'claude-global' }, { dir: out.path }));
    assert.equal(r.rc, 0, r.out);
    const saved = JSON.parse(fs.readFileSync(path.join(out.path, 'team.json'), 'utf8'));
    assert.deepEqual(saved, {
      description: 'Saved from the claude global install.', hosts: ['claude'], theme: 'pirate',
      footprint: 'lean', posture: 'expert', mode: 'direct', trust: 'balanced', doctrines: 'all',
      excludeRules: ['ops.1'], excludeSkills: [], kits: [], gates: { deletionGate: false }, login: true,
    });
    assert.ok(r.out.indexOf('gates.deletionGate: on -> off') < r.out.indexOf('theme: neutral -> pirate'), r.out);
    for (const line of ['gates.ownershipGate: off -> on', 'hosts: bob,claude,openclaude,opencode -> claude',
      'posture: peer -> expert', 'excludeRules: none -> ops.1']) assert.ok(r.out.includes(line), line);
    // A second save under the same name refuses without --force, and --force replaces.
    assert.equal(captured(() => cmdProfile({ action: 'save', name: 'team', from: 'claude-global' }, { dir: out.path })).rc, 1);
    assert.equal(captured(() => cmdProfile({ action: 'save', name: 'team', from: 'claude-global', force: true }, { dir: out.path })).rc, 0);
    // D29: nothing personal can reach it — the keys are the build settings and nothing else.
    assert.deepEqual(Object.keys(saved), PROFILE_KEYS);
  } finally {
    out.cleanup();
    restoreProcessHome();
  }
});
