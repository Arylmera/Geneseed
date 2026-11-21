// The one-time move of an install built before the `council` kit existed.
//
// Written out, not recorded. The rules this file holds, each with its sentence:
//   1. AN INSTALL THAT STILL OWNS A COUNCIL MEMBER (the skill, one of the seven kit seats, or the
//      OpenCode workflow, as its manifest's `owned` lists it) and whose `Active kits:` line does not
//      name the kit gets the kit on at its next rebuild, with one notice line naming the member.
//   2. ANY MEMBER COUNTS: an install that excluded the council skill alone still keeps its seats.
//   3. AN INSTALL THAT OWNS NO MEMBER keeps what its line says. That is a build made after the kit
//      with the kit off: it pruned the members, so a kit turned off on purpose stays off, whatever
//      release number the marker carries.
//   4. A CORE SEAT IS NOT A MEMBER: `skeptic`, `steward` and `user-advocate` ship in every install,
//      so owning one says nothing about the kit.
//   5. THE READERS THAT BYPASS installProfile (`migratedKitsOfDir`) give the same answer.
// Fixture homes only: every root is a sandbox path, and the process home is the sandbox's.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { restoreProcessHome, sandboxProcessHome, withSandbox } from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const { migrateCouncilKit, migratedKitsOfDir } = await import('../../js/maintain/kit-migration.mjs');
const { installProfile } = await import('../../js/build/generate.mjs');
const { claudeConfigDir } = await import('../../js/hosts/hosts.mjs');
const { emitGlobalInto, emitProjectInto } = await import('../../js/build/driver.mjs');

/**
 * The sandbox's global Claude install, built with `kits`. With `preKit`, its carrier's kit line
 * drops `council`, as a build made before the kit wrote it: the members are owned, the line is silent.
 */
function install(home, kits, preKit) {
  const cfgDir = claudeConfigDir();
  fs.rmSync(cfgDir, { recursive: true, force: true });
  const w = process.stdout.write;
  const e = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    emitGlobalInto('claude', { theme: 'neutral', out: path.join(home, 'bundle'), cfgDir, footprint: 'full', kits });
  } finally { process.stdout.write = w; process.stderr.write = e; }
  if (preKit) {
    const carrier = path.join(cfgDir, 'CLAUDE.md');
    const rest = kits.filter((k) => k !== 'council');
    fs.writeFileSync(carrier, fs.readFileSync(carrier, 'utf8').replace(/^Active kits:.*$/m, () => (rest.length ? `Active kits: ${rest.join(', ')}` : '')));
  }
  return cfgDir;
}

/** Keep only the `owned` entries `keep` accepts, as an install that excluded the rest would record. */
function ownOnly(cfgDir, keep) {
  const p = path.join(cfgDir, '.geneseed-manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.owned = m.owned.filter(keep);
  fs.writeFileSync(p, JSON.stringify(m));
}

const MEMBER = /^(skills\/council\/|agents\/(advocate|pragmatist|visionary|framer|empiricist|operator|historian)\.md$)/;

test('rule 1: an install that owns council members and does not name the kit gets it on, one line says so', async () => {
  await withSandbox('gs-council-', (d) => {
    const cfg = install(d, ['council'], true);
    const notes = [];
    assert.deepEqual(installProfile('claude', 'global', cfg, (n) => notes.push(n)).kits, ['council']);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^council kit: on — this install still holds (skills|agents)\/\S+ from before the kit existed, so it keeps the council$/);
    // Another kit on stays on; the council is added beside it.
    const both = install(d, ['council', 'docker'], true);
    assert.deepEqual(installProfile('claude', 'global', both).kits, ['council', 'docker']);
  });
});

test('rule 2: one seat owned is enough, with the skill excluded', async () => {
  await withSandbox('gs-council-seat-', (d) => {
    const cfg = install(d, ['council'], true);
    ownOnly(cfg, (r) => !MEMBER.test(r) || r === 'agents/historian.md');
    assert.deepEqual(installProfile('claude', 'global', cfg).kits, ['council']);
  });
});

test('rule 3: an install built with the kit off owns no member and stays off', async () => {
  await withSandbox('gs-council-off-', (d) => {
    const cfg = install(d, [], false);
    const owned = JSON.parse(fs.readFileSync(path.join(cfg, '.geneseed-manifest.json'), 'utf8')).owned;
    assert.equal(owned.some((r) => MEMBER.test(r)), false, 'a kit-off build wrote a council member');
    const notes = [];
    assert.deepEqual(installProfile('claude', 'global', cfg, (n) => notes.push(n)).kits, []);
    assert.deepEqual(notes, []);
    // A line that names the kit is left as it is.
    const on = install(d, ['council'], false);
    assert.deepEqual(installProfile('claude', 'global', on).kits, ['council']);
  });
});

test('rule 4: owning only the core seats says nothing about the kit', async () => {
  await withSandbox('gs-council-core-', (d) => {
    const cfg = install(d, ['council'], true);
    ownOnly(cfg, (r) => !MEMBER.test(r));
    const owned = JSON.parse(fs.readFileSync(path.join(cfg, '.geneseed-manifest.json'), 'utf8')).owned;
    assert.ok(owned.includes('agents/skeptic.md') && owned.includes('agents/steward.md') && owned.includes('agents/user-advocate.md'));
    assert.deepEqual(migrateCouncilKit({ host: 'claude', scope: 'global', root: cfg, kits: [], knownKits: ['council'] }), []);
    // A checkout that does not ship the kit adds nothing, members owned or not.
    const pre = install(d, ['council'], true);
    assert.deepEqual(migrateCouncilKit({ host: 'claude', scope: 'global', root: pre, kits: [], knownKits: [] }), []);
  });
});

test('rule 5: migratedKitsOfDir reads the same kits as installProfile', async () => {
  await withSandbox('gs-council-readers-', (d) => {
    const cfg = install(d, ['council'], true);
    assert.deepEqual(migratedKitsOfDir(cfg, 'claude'), ['council']);
    assert.deepEqual(migratedKitsOfDir(cfg, 'claude'), installProfile('claude', 'global', cfg).kits, 'two readers, two answers');
  });
});

// Rule 1 holds for a PROJECT install too: its manifest sits in the host's layer folder
// (`<repo>/.opencode`, `<repo>/.claude`), which `claudeCfg` names for every host.
test('rule 1, project scope: an OpenCode and a Claude project install that own members get the kit on', async () => {
  await withSandbox('gs-council-proj-', (d) => {
    for (const [host, layer] of [['opencode', '.opencode'], ['claude', '.claude']]) {
      const repo = path.join(d, `repo-${host}`);
      fs.mkdirSync(repo, { recursive: true });
      const w = process.stdout.write;
      const e = process.stderr.write;
      process.stdout.write = () => true;
      process.stderr.write = () => true;
      try { emitProjectInto(host, { theme: 'neutral', out: repo, root: repo, footprint: 'full', kits: ['council'], seed: false }); }
      finally { process.stdout.write = w; process.stderr.write = e; }
      const carrier = [path.join(repo, layer, 'AGENT.md'), path.join(repo, layer, 'CLAUDE.md'), path.join(repo, 'AGENT.md'), path.join(repo, 'CLAUDE.md')]
        .filter((c) => fs.existsSync(c) && /^Active kits:/m.test(fs.readFileSync(c, 'utf8')));
      assert.ok(carrier.length, `${host}: no carrier names the kit`);
      for (const c of carrier) fs.writeFileSync(c, fs.readFileSync(c, 'utf8').replace(/^Active kits:.*$/m, ''));
      assert.deepEqual(installProfile(host, 'project', repo).kits, ['council'], `${host} project`);
      assert.deepEqual(migratedKitsOfDir(repo, host), ['council'], `${host} project, migratedKitsOfDir`);
    }
  });
});
