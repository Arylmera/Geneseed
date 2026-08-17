// THE COVERAGE THE FROZEN CORPUS GAVE UP, RE-ASSERTED HERE — and deliberately made stronger than
// what it replaces.
//
// `tests/golden.mjs` no longer compares `agent-overrides.json` in any of its 259 cells. It could
// not keep comparing it: the corpus stores a sha256 of the file's CONTENT, taken while the release
// label read 1.0.0, and the label is stamped into that file. Every version bump — 2.0.0, 1.0.1,
// any of them — changes the hash in 448 recorded files, and the program that could take a new hash
// is deleted. A destamp cannot help either, because normalisation runs before hashing and a hash
// cannot be re-normalised afterwards.
//
// WHAT THE CORPUS ACTUALLY PROVED ABOUT THIS FILE WAS WEAK: "these exact bytes, on the day they
// were recorded". It could not say the emitted version tracked the configured one — a corpus that
// froze the WRONG version would have been just as green. This file asserts that relationship
// directly, which is the property anyone actually cares about, and unlike a hash it keeps working
// after the next bump.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'opencode.mjs'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness.config.json'), 'utf8'));

test('the stub the emit writes carries the CONFIGURED release, not a literal', () => {
  // Read the writer rather than a fixture: a fixture copied from the source would agree with a
  // wrong source. `ensureAgentOverridesStub` must take its value from `sourceReleaseVersion(cfg)`
  // — i.e. from harness.config.json — and must not carry a version literal of its own.
  const stub = SRC.slice(SRC.indexOf('const AGENT_OVERRIDES_STUB'));
  const writer = stub.slice(0, stub.indexOf('\n}\n') + 3);
  assert.ok(!/\d+\.\d+\.\d+/.test(writer),
    'AGENT_OVERRIDES_STUB contains a hard-coded version literal — the emitted `_version` must '
    + 'come from harness.config.json, or a bump would silently stop reaching the bundle');

  assert.match(SRC, /_version\s*[:=]/,
    'the stub no longer sets `_version` at all — if that was deliberate, this test and the '
    + 'exclusion in tests/golden.mjs both need revisiting, because the exclusion exists ONLY to '
    + 'tolerate a version that moves');
  assert.match(SRC, /sourceReleaseVersion\(/,
    'nothing calls sourceReleaseVersion — the emitted `_version` has stopped tracking the '
    + 'configured release, which is exactly what the corpus can no longer notice');
});

test('the configured release is a plain semver, and package.json mirrors it', () => {
  // The mirror itself is gated in package_manifest.test.mjs; what is asserted here is the SHAPE,
  // because the exclusion in tests/golden.mjs was justified on "the version moves" and a value
  // that is not a version at all would slip through it unnoticed.
  assert.match(cfg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    `harness.config.json's version is ${JSON.stringify(cfg.version)}, which is not a semver — `
    + 'the emit stamps this string into every bundle');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, cfg.version,
    'package.json and harness.config.json disagree on the version');
});

test('the replay really does exclude the file, and only that file', () => {
  // A POSITIVE CONTROL ON THE EXCLUSION ITSELF. Without this, "the corpus is green" would be
  // satisfied just as well by an exclusion that had quietly widened to cover something real.
  const helper = fs.readFileSync(path.join(ROOT, 'tests', 'helpers', 'golden.mjs'), 'utf8');
  const m = helper.match(/export const UNCOMPARED = '([^']+)'/);
  assert.ok(m, 'tests/helpers/golden.mjs no longer declares UNCOMPARED — if the exclusion was '
    + 'removed because the corpus can be recorded again, delete this file too');
  assert.equal(m[1], 'agent-overrides.json',
    `the exclusion has changed to ${JSON.stringify(m[1])}. Exactly one file may be excluded, and `
    + 'widening it is how a corpus stops being evidence — every other file in all 259 emit cells '
    + 'and all 317 cli cells is asserted byte for byte and must stay that way');

  // It must be applied to BOTH sides. A one-sided drop would report every cell as MISSING or
  // EXTRA rather than passing, so this guards against a future "simplification".
  assert.match(helper, /live\.delete\(k\)/, 'the exclusion no longer drops the live side');
  assert.match(helper, /delete recorded\[side\]\[k\]/,
    'the exclusion no longer drops the recorded side — a one-sided drop is not an exclusion');

  // AND BOTH REPLAYERS MUST USE IT. The first fix wired only the emit harness and left the cli
  // corpus red on one cell; a shared helper that one caller forgets to call is no better than
  // two copies.
  for (const f of ['golden.mjs', 'cli_golden.mjs']) {
    assert.match(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8'), /dropUncompared\(/,
      `tests/${f} no longer applies the exclusion — this file is in its cells too, so it will go `
      + 'red on the next version bump with no recorder left to fix it');
  }
});
