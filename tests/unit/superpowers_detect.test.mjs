// Is the official superpowers plugin installed, and what the answer decides: the profiles that
// choose the kit by detection, the move of an install built before the kit existed, and the
// doctor and status WARN.
//
// Written out, not recorded. The rules this file holds, each with its sentence:
//   1. DETECTION READS FILES AND NAMES THEM. "seen in <file>" or "not seen in <files read>", never
//      "not enabled": a settings file can say `false` while the desktop app loads the plugin.
//   2. CLAUDE CODE is read from the settings files (`enabledPlugins`, a `superpowers@…` key that is
//      `true`) and, last, from the desktop app's manifest, which the answer labels as app state.
//      OPENCODE is read from `plugin` (V1) or `plugins` (V2). BOB and OPENCLAUDE have no plugin
//      store: nothing is read, and the kit defaults on.
//   3. `starter` and `corporate` set the kit on whatever the machine holds; `mentor`, `minimal`
//      and `autonomous` choose it by detection: on when the plugin is not seen.
//   4. AN INSTALL BUILT BEFORE THE KIT (release below 6.0.0, or no release marker, and a carrier that
//      knows nothing of the kit) gets the kit on at its next rebuild unless the plugin is seen, with
//      one notice line; one built at or after it keeps what its `Active kits:` line says. A build
//      made by this code before the release is bumped carries an old release number, so the carrier
//      is read too: it shows the kit was known.
//   5. THE WARN: kit on with the plugin seen, and kit off with no plugin seen, each naming what was read.
// Fixture homes only: every root is a sandbox path, and the process home is the sandbox's.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { restoreProcessHome, sandboxProcessHome, withSandbox } from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const { describeDetection, detectSuperpowers, superpowersKitDefault } = await import('../../js/maintain/plugin-detect.mjs');
const { loadProfile, profileKits, profileProblems, profileBuildArgs } = await import('../../js/maintain/profiles.mjs');
const { SUPERPOWERS_KIT_SINCE, builtByRelease, migrateSuperpowersKit, providerWarning } = await import('../../js/maintain/kit-migration.mjs');
const { installProfile } = await import('../../js/build/generate.mjs');
const { claudeConfigDir } = await import('../../js/hosts/hosts.mjs');
const { emitGlobalInto } = await import('../../js/build/driver.mjs');

const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const json = (o) => JSON.stringify(o);

/** Roots under `d`, all of them in the sandbox. */
const roots = (d) => ({ claudeDir: path.join(d, 'claude'), opencodeDir: path.join(d, 'opencode'), appDataDir: path.join(d, 'appdata') });

test('Claude Code: an enabledPlugins superpowers key set to true is seen, naming the file', async () => {
  await withSandbox('gs-det-claude-', (d) => {
    const r = roots(d);
    write(path.join(r.claudeDir, 'settings.json'), json({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
    const got = detectSuperpowers('claude', r);
    assert.equal(got.seen, true);
    assert.equal(got.where, path.join(r.claudeDir, 'settings.json'));
    assert.equal(got.state, false);
    assert.equal(describeDetection(got), `seen in ${path.join(r.claudeDir, 'settings.json')}`);
  });
});

test('Claude Code: false, another plugin, settings.local.json and the project file', async () => {
  await withSandbox('gs-det-claude2-', (d) => {
    const r = roots(d);
    write(path.join(r.claudeDir, 'settings.json'), json({ enabledPlugins: { 'superpowers@claude-plugins-official': false, 'other@x': true } }));
    const miss = detectSuperpowers('claude', r);
    assert.equal(miss.seen, false);
    // The sentence never says "not enabled": the file was read, and the plugin was not seen in it.
    assert.equal(describeDetection(miss), `not seen in ${path.join(r.claudeDir, 'settings.json')}`);
    assert.doesNotMatch(describeDetection(miss), /enabled/);
    write(path.join(r.claudeDir, 'settings.local.json'), json({ enabledPlugins: { 'superpowers@m': true } }));
    assert.equal(detectSuperpowers('claude', r).where, path.join(r.claudeDir, 'settings.local.json'));
    fs.rmSync(path.join(r.claudeDir, 'settings.local.json'));
    const proj = path.join(d, 'proj');
    write(path.join(proj, '.claude', 'settings.json'), json({ enabledPlugins: { 'superpowers@m': true } }));
    assert.equal(detectSuperpowers('claude', { ...r, projectDir: proj }).where, path.join(proj, '.claude', 'settings.json'));
    assert.equal(detectSuperpowers('claude', r).seen, false, 'the project file leaked into a global read');
  });
});

test('Claude Code desktop app: a manifest entry for obra/superpowers is seen and labelled as app state', async () => {
  await withSandbox('gs-det-app-', (d) => {
    const r = roots(d);
    const manifest = path.join(r.appDataDir, 'Claude', 'rpm', 'aaa', 'bbb', 'manifest.json');
    write(manifest, json({ plugins: [{ name: 'x', upstreamRepoUrl: 'https://github.com/anthropics/knowledge-work-plugins' },
      { name: 'superpowers', upstreamRepoUrl: 'https://github.com/obra/superpowers' }] }));
    // The settings file says false while the app loads the plugin: the case that made this file worth reading.
    write(path.join(r.claudeDir, 'settings.json'), json({ enabledPlugins: { 'superpowers@m': false } }));
    const got = detectSuperpowers('claude', r);
    assert.equal(got.seen, true);
    assert.equal(got.state, true);
    assert.equal(got.where, manifest);
    assert.match(describeDetection(got), /\(desktop app state, best-effort\)$/);
    write(manifest, json({ plugins: [{ upstreamRepoUrl: 'https://github.com/obra/other' }] }));
    assert.equal(detectSuperpowers('claude', r).seen, false);
  });
});

test('OpenCode: `plugin` (V1) and `plugins` (V2), in json and jsonc, global and project', async () => {
  await withSandbox('gs-det-oc-', (d) => {
    const r = roots(d);
    write(path.join(r.opencodeDir, 'opencode.json'), json({ plugin: ['superpowers@git+https://github.com/obra/superpowers.git'] }));
    assert.equal(detectSuperpowers('opencode', r).where, path.join(r.opencodeDir, 'opencode.json'));
    fs.rmSync(path.join(r.opencodeDir, 'opencode.json'));
    write(path.join(r.opencodeDir, 'opencode.jsonc'), '// comment\n{ "plugins": { "superpowers@2.0.4": {} } }\n');
    assert.equal(detectSuperpowers('opencode', r).where, path.join(r.opencodeDir, 'opencode.jsonc'));
    fs.rmSync(path.join(r.opencodeDir, 'opencode.jsonc'));
    write(path.join(r.opencodeDir, 'opencode.json'), json({ plugin: ['other-plugin'] }));
    assert.equal(detectSuperpowers('opencode', r).seen, false);
    const proj = path.join(d, 'proj');
    write(path.join(proj, 'opencode.json'), json({ plugin: [['superpowers@1.0.0', {}]] }));
    assert.equal(detectSuperpowers('opencode', { ...r, projectDir: proj }).where, path.join(proj, 'opencode.json'));
  });
});

test('Bob and OpenClaude have no plugin store: nothing is read, and the kit defaults on', async () => {
  await withSandbox('gs-det-bob-', (d) => {
    const r = roots(d);
    write(path.join(r.claudeDir, 'settings.json'), json({ enabledPlugins: { 'superpowers@m': true } }));
    for (const host of ['bob', 'openclaude', 'files', '']) {
      const got = detectSuperpowers(host, r);
      assert.deepEqual([got.seen, got.supported, got.read], [false, false, []], host);
      assert.equal(superpowersKitDefault(host, r).on, true, host);
    }
    assert.equal(superpowersKitDefault('claude', r).on, false, 'a seen plugin must default the kit off');
    assert.equal(superpowersKitDefault('claude', roots(path.join(d, 'empty'))).on, true);
  });
});

test('profiles: starter and corporate set the kit on; mentor, minimal and autonomous choose it by detection', async () => {
  await withSandbox('gs-det-prof-', (d) => {
    const seen = roots(path.join(d, 'seen'));
    write(path.join(seen.claudeDir, 'settings.json'), json({ enabledPlugins: { 'superpowers@m': true } }));
    const absent = roots(path.join(d, 'absent'));
    for (const name of ['starter', 'corporate']) {
      const p = loadProfile(name).profile;
      assert.deepEqual(p.kits, ['superpowers'], name);
      assert.equal(p.kitsByDetection, undefined, name);
      assert.deepEqual(profileKits(p, 'claude', null, seen), ['superpowers'], `${name}, plugin seen: still on`);
      assert.deepEqual(profileKits(p, 'claude', null, absent), ['superpowers'], name);
    }
    for (const name of ['mentor', 'minimal', 'autonomous']) {
      const p = loadProfile(name).profile;
      assert.deepEqual([p.kits, p.kitsByDetection], [[], ['superpowers']], name);
      assert.deepEqual(profileKits(p, 'claude', null, seen), [], `${name}, plugin seen`);
      assert.deepEqual(profileKits(p, 'claude', null, absent), ['superpowers'], `${name}, plugin not seen`);
      assert.deepEqual(profileKits(p, 'bob', null, seen), ['superpowers'], `${name} on Bob: no plugin store`);
      // The build argv carries the resolved kit, the one `--kits` flag.
      const argv = profileBuildArgs(p, 'claude', null, absent);
      assert.equal(argv[argv.indexOf('--kits') + 1], 'superpowers', name);
      assert.equal(profileBuildArgs(p, 'claude', null, seen).includes('--kits'), false, 'the plugin is seen: no kit flag');
    }
  });
});

test('profileProblems: kitsByDetection is validated like kits, and a kit may not sit in both keys', () => {
  const base = loadProfile('starter').profile;
  const bad = (patch) => profileProblems({ ...base, ...patch });
  assert.deepEqual(bad({ kits: [], kitsByDetection: ['superpowers'] }), []);
  assert.deepEqual(bad({ kitsByDetection: ['nope'] }).filter((e) => /kitsByDetection/.test(e)),
    ["'kitsByDetection': unknown kit 'nope' (valid: 'superpowers')"]);
  assert.deepEqual(bad({ kitsByDetection: ['docker'] }), ["'kitsByDetection': kit 'docker' has no plugin to detect (valid: 'superpowers')"]);
  assert.deepEqual(bad({ kits: ['superpowers'], kitsByDetection: ['superpowers'] }),
    ["'kitsByDetection': kit 'superpowers' is also in 'kits' — name it in one"]);
  assert.deepEqual(bad({ kitsByDetection: 'superpowers' }), ["'kitsByDetection' must be a list of: 'superpowers'"]);
});

/**
 * The sandbox process home's own global Claude install (`claudeConfigDir()`: where detection reads by
 * default), emptied first, built with `kits`, its marker stamped as built by `release`.
 */
function oldInstall(home, kits, release, legacy = true) {
  const cfgDir = claudeConfigDir();
  fs.rmSync(cfgDir, { recursive: true, force: true });
  const w = process.stdout.write;
  const e = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    emitGlobalInto('claude', { theme: 'neutral', out: path.join(home, 'bundle'), cfgDir, footprint: 'full', kits });
  } finally { process.stdout.write = w; process.stderr.write = e; }
  // A build made before the kit knew nothing of it: no Workflow provider block, no kit line.
  const carrier = path.join(cfgDir, 'CLAUDE.md');
  if (legacy) fs.writeFileSync(carrier, fs.readFileSync(carrier, 'utf8').replace('### Workflow provider', '### Something else').replace(/^Active kits:.*$/m, () => (kits.filter((k) => k !== 'superpowers').length ? `Active kits: ${kits.filter((k) => k !== 'superpowers').join(', ')}` : '')));
  const marker = path.join(cfgDir, '.geneseed-version');
  if (release === null) fs.writeFileSync(marker, 'abc123def456 (built 2026-01-01)\n');
  else fs.writeFileSync(marker, fs.readFileSync(marker, 'utf8').replace(/\[release [^\]]+\]/, `[release ${release}]`));
  return cfgDir;
}

test('migration: an install built before the kit gets it on, one line says so; the plugin seen leaves it off', async () => {
  await withSandbox('gs-mig-', (d) => {
    const notes = [];
    const cfg = oldInstall(d, [], '5.4.0');
    assert.equal(builtByRelease(cfg), '5.4.0');
    assert.deepEqual(installProfile('claude', 'global', cfg, (n) => notes.push(n)).kits, ['superpowers']);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^superpowers kit: on — built by 5\.4\.0, before the kit existed, so it keeps its five Rites; the official plugin is not seen in /);
    // The plugin enabled in the sandbox's own Claude settings: the same install now stays off.
    const settings = path.join(cfg, 'settings.json');
    fs.writeFileSync(settings, json({ ...JSON.parse(fs.readFileSync(settings, 'utf8')), enabledPlugins: { 'superpowers@m': true } }));
    const seenNotes = [];
    assert.deepEqual(installProfile('claude', 'global', cfg, (n) => seenNotes.push(n)).kits, []);
    assert.equal(seenNotes.length, 1);
    assert.match(seenNotes[0], /^superpowers kit: off — built by 5\.4\.0, before the kit existed; the official plugin is seen in .*settings\.json$/);
  });
});

test('migration: an install built at or after the kit keeps its line; no release marker reads as old', async () => {
  await withSandbox('gs-mig2-', (d) => {
    const cfg = oldInstall(d, [], SUPERPOWERS_KIT_SINCE);
    const notes = [];
    assert.deepEqual(installProfile('claude', 'global', cfg, (n) => notes.push(n)).kits, [], 'a kit turned off on purpose came back');
    assert.deepEqual(notes, []);
    fs.writeFileSync(path.join(cfg, '.geneseed-version'), fs.readFileSync(path.join(cfg, '.geneseed-version'), 'utf8').replace(SUPERPOWERS_KIT_SINCE, '7.2.0'));
    assert.deepEqual(installProfile('claude', 'global', cfg).kits, [], 'a later release');
    const bare = oldInstall(d, [], null);
    assert.equal(builtByRelease(bare), null);
    assert.deepEqual(installProfile('claude', 'global', bare).kits, ['superpowers'], 'no marker: built before');
    // An install that already names the kit is left as it is, old or not.
    const on = oldInstall(d, ['superpowers'], '5.0.0', false);
    assert.deepEqual(installProfile('claude', 'global', on).kits, ['superpowers']);
  });
});

test('migration: a build made after the kit but stamped with an older release is not migrated (the carrier knows the kit)', async () => {
  await withSandbox('gs-mig-aware-', (d) => {
    const cfg = oldInstall(d, [], '5.6.0', false);
    const notes = [];
    assert.deepEqual(installProfile('claude', 'global', cfg, (n) => notes.push(n)).kits, [], 'a kit turned off came back');
    assert.deepEqual(notes, []);
    const on = oldInstall(d, ['superpowers'], '5.6.0', false);
    assert.deepEqual(installProfile('claude', 'global', on).kits, ['superpowers']);
  });
});

test('migration: another kit on keeps it, and the kit is added beside it; a tree without the kit adds nothing', async () => {
  await withSandbox('gs-mig3-', (d) => {
    const cfg = oldInstall(d, ['docker'], '5.1.0');
    assert.deepEqual(installProfile('claude', 'global', cfg).kits, ['docker', 'superpowers']);
    const common = { host: 'claude', scope: 'global', root: cfg, notify: null, detectRoots: roots(path.join(d, 'none')) };
    assert.deepEqual(migrateSuperpowersKit({ ...common, kits: ['docker'], knownKits: ['docker'] }), ['docker']);
    assert.deepEqual(migrateSuperpowersKit({ ...common, kits: ['docker'], knownKits: ['docker', 'superpowers'] }), ['docker', 'superpowers']);
  });
});

test('the provider WARN: kit on with the plugin seen, kit off with none, and silence otherwise', async () => {
  await withSandbox('gs-warn-', (d) => {
    const seen = roots(path.join(d, 'seen'));
    write(path.join(seen.claudeDir, 'settings.json'), json({ enabledPlugins: { 'superpowers@m': true } }));
    const absent = roots(path.join(d, 'absent'));
    const warn = (host, kits, detectRoots) => providerWarning({ host, scope: 'global', root: path.join(d, 'x'), kits, detectRoots });
    assert.match(warn('claude', ['superpowers'], seen), /^WARN: the superpowers kit is on and the official plugin is also loaded \(seen in .*settings\.json\): the Rites are duplicated and the plugin injects about 800 tokens a session/);
    assert.match(warn('claude', [], absent), /^WARN: no workflow provider — the superpowers kit is off and the official plugin is not seen in /);
    assert.equal(warn('claude', [], seen), null, 'plugin seen, kit off: one provider');
    assert.equal(warn('claude', ['superpowers'], absent), null, 'kit on, plugin not seen: one provider');
    assert.equal(warn('bob', ['superpowers'], seen), null, 'Bob: nothing to duplicate');
    assert.equal(warn('bob', [], seen), 'WARN: no workflow provider — the superpowers kit is off and bob has no superpowers plugin');
  });
});
