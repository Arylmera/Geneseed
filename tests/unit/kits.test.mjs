// Kits — opt-in bundles of skills, agents and rules, off unless `--kits <a,b>` names them.
//
// Written out, not recorded. The properties this file holds (manifest, loader, flag; rendering is
// another file's):
//   1. `loadKits` reads one manifest per `src/kits/<kit>.json`, keyed by file stem in sorted
//      order; the `<kit>/` folder beside it and any non-json file are not manifests, and a tree
//      without `src/kits/` has no kits
//   2. `kitMembers` unions the skills and agents of the kits it is handed, and only those
//   3. `--kits` takes `none` or '' as no kits, sorts and dedupes the rest, and refuses an
//      unknown kit with exit 2, naming every known kit (spec R1)
//   4. `setupBuildArgs` omits `--kits` when there are none, so every argv that names no kit
//      stays the bytes it was; `geneseed build` forwards the flag to the driver
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RETIRED_KIT_IDS, kitMembers, loadKits, makeCfg } from '../../js/build/source.mjs';
import { parseKits } from '../../js/build/args.mjs';
import { parseDriverArgs } from '../../js/build/driver.mjs';
import { cmdBuild, setupBuildArgs } from '../../js/build/generate.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

function quiet(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
}

function withDir(fn) {
  const sb = makeSandbox('gskits-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/** A `src/` holding two kits, a kit's rules folder and a stray non-manifest file. */
function kitTree(d) {
  const kits = path.join(d, 'kits');
  fs.mkdirSync(path.join(kits, 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(kits, 'alpha', 'rules.md'), '# alpha rules\n');
  fs.writeFileSync(path.join(kits, 'notes.md'), 'not a manifest\n');
  fs.writeFileSync(path.join(kits, 'beta.json'), JSON.stringify({
    description: 'Beta', skills: ['b-one', 'shared'], agents: [], rules: 'kits/beta/rules.md',
    rulesWordBudget: 300, catalogue: { skills: [], agents: [] },
  }));
  fs.writeFileSync(path.join(kits, 'alpha.json'), JSON.stringify({
    description: 'Alpha', skills: ['a-one', 'shared'], agents: ['a-agent'], rules: 'kits/alpha/rules.md',
    rulesWordBudget: 300, catalogue: { skills: ['| [a-one]({{DIR_SKILLS}}/a-one.md) | x |'], agents: [] },
  }));
  return d;
}

/** The exit code and message `die` threw, or a failure when nothing was thrown. */
function refusal(fn) {
  try { quiet(fn); } catch (e) { return { code: e.exitCode, msg: e.message }; }
  assert.fail('expected a refusal, got a value');
}

test('loadKits reads one manifest per json file, sorted, and nothing else', () => {
  withDir((d) => {
    const kits = loadKits(kitTree(d));
    assert.deepEqual([...kits.keys()], ['alpha', 'beta']);
    assert.equal(kits.get('alpha').description, 'Alpha');
    assert.deepEqual(kits.get('beta').skills, ['b-one', 'shared']);
  });
});

test('a tree without src/kits has no kits', () => {
  withDir((d) => { assert.deepEqual([...loadKits(d).keys()], []); });
});

test('kitMembers unions the skills and agents of the kits handed to it', () => {
  withDir((d) => {
    const kits = loadKits(kitTree(d));
    const all = kitMembers(kits);
    assert.deepEqual([...all.skills].sort(), ['a-one', 'b-one', 'shared']);
    assert.deepEqual([...all.agents], ['a-agent']);
    const betaOnly = kitMembers(new Map([['beta', kits.get('beta')]]));
    assert.deepEqual([...betaOnly.skills].sort(), ['b-one', 'shared']);
    assert.deepEqual([...betaOnly.agents], []);
    assert.deepEqual([...kitMembers(new Map()).skills], []);
  });
});

test('none is reserved, so it can never be a kit name', () => {
  assert.ok(Object.hasOwn(RETIRED_KIT_IDS, 'none'));
});

test('parseKits: none and empty mean no kits; the rest is sorted and deduped', () => {
  const known = ['alpha', 'beta'];
  assert.deepEqual(parseKits('none', known), []);
  assert.deepEqual(parseKits('', known), []);
  assert.deepEqual(parseKits('  ', known), []);
  assert.deepEqual(parseKits('beta, alpha,beta', known), ['alpha', 'beta']);
});

test('parseKits refuses an unknown kit with exit 2 and names every known kit', () => {
  const r = refusal(() => parseKits('alpha,gamma', ['alpha', 'beta']));
  assert.equal(r.code, 2);
  assert.equal(r.msg, "argument --kits: unknown kit 'gamma' (choose from alpha, beta, or 'none')");
});

// The shipped tree has two kits, `react` and `spring-boot`, listed sorted: no flag, `none` and an
// empty value all mean no kits; `--kits spring-boot` selects one, `--kits react,spring-boot` both; any
// other name is refused with exit 2, naming the real kits and the reserved `none`.
test('the shipped tree has the react and spring-boot kits: --kits none passes, each name selects its kit, any other name is refused', () => {
  assert.deepEqual([...loadKits().keys()], ['react', 'spring-boot']);
  assert.deepEqual(parseDriverArgs(['--emit', 'files', '--kits', 'spring-boot']).kits, ['spring-boot']);
  assert.deepEqual(parseDriverArgs(['--emit', 'files', '--kits', 'react,spring-boot']).kits, ['react', 'spring-boot']);
  assert.deepEqual(parseDriverArgs(['--emit', 'files']).kits, []);
  assert.deepEqual(parseDriverArgs(['--emit', 'files', '--kits', 'none']).kits, []);
  assert.deepEqual(parseDriverArgs(['--emit', 'files', '--kits=']).kits, []);
  const r = refusal(() => parseDriverArgs(['--emit', 'files', '--kits', 'foo']));
  assert.equal(r.code, 2);
  assert.equal(r.msg, "argument --kits: unknown kit 'foo' (choose from react, spring-boot, or 'none')");
});

test('makeCfg carries kits as a copy, and defaults to none', () => {
  assert.deepEqual(makeCfg().kits, []);
  const kits = ['alpha'];
  const cfg = makeCfg({ kits });
  assert.deepEqual(cfg.kits, ['alpha']);
  assert.notEqual(cfg.kits, kits);
});

test('setupBuildArgs omits --kits when empty and appends it sorted otherwise', () => {
  const base = setupBuildArgs('neutral', 'files', null, null, 'lean', 'peer', 'direct', null,
    undefined, null, undefined, null, {});
  assert.deepEqual(setupBuildArgs('neutral', 'files', null, null, 'lean', 'peer', 'direct', null,
    undefined, null, undefined, null, {}, []), base);
  assert.deepEqual(setupBuildArgs('neutral', 'files', null, null, 'lean', 'peer', 'direct', null,
    undefined, null, undefined, null, {}, ['beta', 'alpha']), [...base, '--kits', 'alpha,beta']);
});

test('geneseed build forwards --kits to the driver', () => {
  // The driver refuses the unknown kit: proof the flag reached it rather than being dropped.
  // `out` is a sandbox, so a dropped flag builds there instead of into the checkout.
  withDir((d) => { assert.equal(quiet(() => cmdBuild({ emit: 'files', kits: 'foo', out: d })), 2); });
});
