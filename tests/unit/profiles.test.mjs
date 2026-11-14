// Install profiles (`js/maintain/profiles.mjs`): the two sources, the loader, its validation, the
// argv a profile builds per host and scope, the save path and the diff a saved profile prints.
// Every expectation is written out here; nothing is recorded.
//
// NO CALL HERE READS THE REAL MACHINE TIER. The Personal dir defaults to
// `~/.config/geneseed/profiles`, so every loader call passes `NO_PERSONAL` (a dir that does not
// exist) or a sandbox of its own, and the `cmdProfile` test moves the process home first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BASE_PROFILE, PROFILE_KEYS, PROFILES_DIR, cmdProfile, isGitClone, listProfiles, loadProfile, profileBuildArgs,
  profileDiff, profileFromInstall, profileProblems, profileSetProblems, saveProfile,
} from '../../js/maintain/profiles.mjs';
import { cellEnv, makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A Personal dir that does not exist: the loader then lists no Personal profile. */
const NO_PERSONAL = path.join(ROOT, 'tests', 'fixtures', 'no-such-personal-profiles');
const SHIPPED_ONLY = { personalDir: NO_PERSONAL };
/** Only the fixture `dir` as Shipped, no Personal. */
const only = (dir) => ({ shippedDir: dir, personalDir: NO_PERSONAL });

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
  const r = loadProfile('starter', SHIPPED_ONLY);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.profile, STARTER);
  assert.equal(r.source, 'shipped');
  assert.equal(BASE_PROFILE, 'starter');
});

// `listProfiles` lists every file of both sources, Shipped first, each with its source and path.
test('every shipped profile loads, and the doctor arm says nothing about them', () => {
  assert.deepEqual(listProfiles(SHIPPED_ONLY).map((e) => [e.name, e.source, e.shadowed]),
    [['guillaume-claude-global', 'shipped', false], ['starter', 'shipped', false]]);
  assert.equal(listProfiles(SHIPPED_ONLY)[1].file, path.join(PROFILES_DIR, 'starter.json'));
  assert.deepEqual(profileSetProblems(SHIPPED_ONLY), []);
});

test('the doctor arm names a shipped profile that would refuse', () => {
  const sb = fixtureDir({ ok: STARTER, bad: { ...STARTER, posture: 'nope' } });
  try {
    const probs = profileSetProblems(only(sb.path));
    assert.equal(probs.length, 1);
    assert.match(probs[0], /^\[profiles\] profiles\/bad\.json: 'posture': invalid value 'nope'/);
  } finally { sb.cleanup(); }
});

// Each row: a change to starter, and the sentence the loader must refuse it with. An unknown key
// is an error, never ignored (D10): a typo must not fall back to a default in silence.
// `sharedTier` is a key since D37 (a profile has no scope), so only a non-boolean is refused.
const REFUSALS = [
  [{ posure: 'peer' }, /unknown key 'posure' \(valid keys: 'description', 'hosts'/],
  [{ sharedTier: 'on' }, /'sharedTier' must be true or false/],
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
      const r = loadProfile('x', only(sb.path));
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

test('an unknown profile name lists both sources; a path is not a name', () => {
  const sb = fixtureDir({ alpha: STARTER, beta: STARTER });
  const broken = fixtureDir({ broken: '{ nope' });
  try {
    assert.deepEqual(loadProfile('nope', only(sb.path)),
      { ok: false, error: "no profile 'nope' — shipped: alpha, beta; personal: none" });
    const r = loadProfile('../alpha', only(sb.path));
    assert.equal(r.ok, false);
    assert.match(r.error, /is not a profile name/);
    assert.match(loadProfile('broken', only(broken.path)).error, /^profiles\/broken\.json is not valid JSON/);
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

// Two sources (D34). A Personal profile loads by name and names its full path in an error; a
// Personal file under a Shipped name (D36) is listed as shadowed, never loaded — the Shipped one
// is — and the doctor arm names it.
test('a personal profile loads beside the shipped ones; a shipped name shadows a personal file', () => {
  const shipped = fixtureDir({ starter: STARTER });
  const personal = fixtureDir({ mine: { ...STARTER, theme: 'pirate' }, starter: { ...STARTER, theme: 'pirate' },
    bad: { ...STARTER, mode: 'auto' } });
  const src = { shippedDir: shipped.path, personalDir: personal.path };
  try {
    assert.deepEqual(listProfiles(src).map((e) => [e.name, e.source, e.shadowed]), [
      ['starter', 'shipped', false], ['bad', 'personal', false], ['mine', 'personal', false], ['starter', 'personal', true],
    ]);
    const mine = loadProfile('mine', src);
    assert.equal(mine.ok, true, mine.error);
    assert.equal(mine.source, 'personal');
    assert.equal(mine.file, path.join(personal.path, 'mine.json'));
    const starter = loadProfile('starter', src);
    assert.equal(starter.source, 'shipped');
    assert.equal(starter.profile.theme, 'neutral');
    assert.equal(loadProfile('bad', src).error.startsWith(`${path.join(personal.path, 'bad.json')}: 'mode'`), true);
    assert.deepEqual(loadProfile('nope', src).error, "no profile 'nope' — shipped: starter; personal: bad, mine");
    assert.deepEqual(profileSetProblems(src), [
      `[profiles] ${path.join(personal.path, 'bad.json')}: 'mode': invalid value 'auto' (valid: 'direct', 'foreman')`,
      `[profiles] ${path.join(personal.path, 'starter.json')} has the name of a shipped profile, so it is never loaded — rename it`,
    ]);
  } finally {
    shipped.cleanup();
    personal.cleanup();
  }
});

// Project scope (D32, D37): the host's own project emit with `--out` and `--root` on the folder,
// and the profile's `sharedTier` spelled; a global apply of the same profile ignores the field.
test('a project apply builds the project emit into the folder, and only it takes sharedTier', () => {
  const p = { ...STARTER, sharedTier: true };
  assert.deepEqual(profileBuildArgs(p, 'claude', '/work/api'), [
    '--theme', 'neutral', '--emit', 'claude', '--out', '/work/api', '--root', '/work/api', '--footprint', 'lean',
    '--doctrines', 'craft,rigor,ops,process,comms', '--exclude-rules', 'none',
    '--no-ownership-gate', '--shared-tier', 'on', '--exclude-skills', 'none', '--reset',
  ]);
  assert.deepEqual(profileBuildArgs(p, 'claude'), profileBuildArgs(STARTER, 'claude'));
  assert.equal(profileBuildArgs(STARTER, 'claude', '/work/api').includes('--shared-tier'), false);
});

test('the captured Claude profile builds its own settings, gates off included', () => {
  const r = loadProfile('guillaume-claude-global', SHIPPED_ONLY);
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
    excludeSkills: ['bruno'], kits: ['docker'], sharedTier: false, gates: { deletionGate: false }, login: true,
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
  // An absent sharedTier reads as off, so only a profile that turns it on differs.
  assert.deepEqual(profileDiff({ ...STARTER, sharedTier: true }, STARTER), [{ key: 'sharedTier', base: 'off', now: 'on' }]);
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
    assert.equal(loadProfile('team', only(sb.path)).ok, true);
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

test('a clone is a folder with .git, a file or a dir; anything else is not', () => {
  const sb = makeSandbox('gs-profiles-');
  try {
    assert.equal(isGitClone(sb.path), false);
    fs.writeFileSync(path.join(sb.path, '.git'), 'gitdir: elsewhere\n');
    assert.equal(isGitClone(sb.path), true);
  } finally { sb.cleanup(); }
});

/** Build one install into the sandboxed `home` with the real generator; asserts it worked. */
function buildInto(home, extra) {
  const built = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
    '--theme', 'pirate', '--footprint', 'lean', '--posture', 'expert',
    '--doctrines', 'craft,rigor,ops,process,comms', '--exclude-rules', 'ops.1', '--no-deletion-gate', ...extra],
  { cwd: home, env: cellEnv(home), encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, built.stderr);
}

// What `profile save` writes from the pirate install `buildInto` makes, the source line aside.
const SAVED = {
  hosts: ['claude'], theme: 'pirate', footprint: 'lean', posture: 'expert', mode: 'direct', trust: 'balanced',
  doctrines: 'all', excludeRules: ['ops.1'], excludeSkills: [], kits: [], gates: { deletionGate: false }, login: true,
};

test('profile save writes a personal profile by default, a shipped one only from a clone', { timeout: 300_000 }, () => {
  const home = sandboxProcessHome();
  const shipped = makeSandbox('gs-profiles-');
  const personal = path.join(home, 'personal-profiles');
  const clone = makeSandbox('gs-profiles-');
  const notClone = makeSandbox('gs-profiles-');
  fs.mkdirSync(path.join(clone.path, '.git'));
  const seams = (root) => ({ shippedDir: shipped.path, personalDir: personal, root });
  const save = (args, root = clone.path) => captured(() => cmdProfile({ action: 'save', ...args }, seams(root)));
  try {
    // Refusals first: no install, no --from, a --from that is not an install mode.
    assert.equal(save({ name: 'x', from: 'claude-global' }).rc, 1);
    assert.match(save({ name: 'x', from: null }).out,
      /profile save needs --from, one of: opencode-global, claude-global, bob-global, openclaude-global, opencode, claude, bob, openclaude/);
    assert.equal(save({ name: 'x', from: 'vim' }).rc, 2);
    assert.match(save({ name: 'x', from: 'claude' }).out, /--from claude reads a project install: add --project <dir>/);

    buildInto(home, ['--emit', 'claude-global']);
    fs.copyFileSync(path.join(PROFILES_DIR, 'starter.json'), path.join(shipped.path, 'starter.json'));

    // D35: Personal by default, with the dir created on first save.
    const r = save({ name: 'team', from: 'claude-global' });
    assert.equal(r.rc, 0, r.out);
    const saved = JSON.parse(fs.readFileSync(path.join(personal, 'team.json'), 'utf8'));
    assert.deepEqual(saved, { description: 'Saved from the claude global install.', ...SAVED, sharedTier: false });
    assert.equal(fs.existsSync(path.join(shipped.path, 'team.json')), false);
    assert.ok(r.out.includes(`wrote ${path.join(personal, 'team.json')} (personal)`), r.out);
    assert.ok(r.out.indexOf('gates.deletionGate: on -> off') < r.out.indexOf('theme: neutral -> pirate'), r.out);
    for (const line of ['gates.ownershipGate: off -> on', 'hosts: bob,claude,openclaude,opencode -> claude',
      'posture: peer -> expert', 'excludeRules: none -> ops.1', 'apply it with: geneseed profile apply team']) {
      assert.ok(r.out.includes(line), line);
    }
    // A second save under the same name refuses without --force, and --force replaces.
    assert.equal(save({ name: 'team', from: 'claude-global' }).rc, 1);
    assert.equal(save({ name: 'team', from: 'claude-global', force: true }).rc, 0);
    // D29: nothing personal can reach it — the keys are the build settings and nothing else.
    assert.deepEqual(Object.keys(saved), PROFILE_KEYS);

    // D36: a Personal save under a Shipped name is refused, --force included, and writes nothing.
    const clash = save({ name: 'starter', from: 'claude-global', force: true });
    assert.equal(clash.rc, 1);
    assert.match(clash.out, /'starter' is already a shipped profile .* a personal profile may not reuse a shipped name/);
    assert.equal(fs.existsSync(path.join(personal, 'starter.json')), false);
    // And the other way: --shipped under a name a Personal profile holds.
    assert.match(save({ name: 'team', from: 'claude-global', shipped: true }).out, /'team' is already a personal profile/);

    // D35: --shipped writes the checkout's profiles/ from a clone, and is refused anywhere else.
    const no = save({ name: 'ours', from: 'claude-global', shipped: true }, notClone.path);
    assert.equal(no.rc, 1);
    assert.match(no.out, /--shipped writes .* which only a git clone takes/);
    assert.equal(fs.existsSync(path.join(shipped.path, 'ours.json')), false);
    const yes = save({ name: 'ours', from: 'claude-global', shipped: true });
    assert.equal(yes.rc, 0, yes.out);
    assert.ok(yes.out.includes('open a pull request; a colleague installs it with: .\\install.cmd --profile ours'), yes.out);
    assert.equal(fs.existsSync(path.join(shipped.path, 'ours.json')), true);
  } finally {
    for (const sb of [shipped, clone, notClone]) sb.cleanup();
    restoreProcessHome();
  }
});

// A profile has no scope (D32), so a project install saves as well as a global one, and its
// shared tier comes with it (D37).
test('profile save reads a project install with --from <host> --project <dir>', { timeout: 300_000 }, () => {
  const home = sandboxProcessHome();
  const personal = path.join(home, 'personal-profiles');
  const proj = path.join(home, 'work', 'api');
  fs.mkdirSync(proj, { recursive: true });
  try {
    buildInto(home, ['--emit', 'claude', '--out', proj, '--root', proj, '--shared-tier', 'on']);
    const r = captured(() => cmdProfile({ action: 'save', name: 'api', from: 'claude', project: proj },
      { shippedDir: PROFILES_DIR, personalDir: personal }));
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(personal, 'api.json'), 'utf8')),
      { description: 'Saved from the claude project install.', ...SAVED, sharedTier: true });
    assert.equal(captured(() => cmdProfile({ action: 'save', name: 'x', from: 'claude-global', project: proj },
      { shippedDir: PROFILES_DIR, personalDir: personal })).rc, 2);
  } finally {
    restoreProcessHome();
  }
});
