// An edited owned file is KEPT or DIVERGED (docs/specs/2026-11-13-local-edit-tone.md, D1/D6/D8).
//
// The rule these tests hold, stated once: an `edited` record carries `diverged`. It is `false`
// when the manifest holds a base hash for the rel — `hashes[rel]` while the rel is owned, else
// `kept_hashes[rel]` — and the fresh render of the source still hashes to it: the edit loses
// nothing. It is `true` when the source renders something else, or when there is no base at all.
// The base survives rebuilds: the emit that refuses an edited rel records `kept_hashes[rel]` from
// the hash its last write left, and every later emit that still leaves the rel to the user carries
// that entry forward. A rel claimed again — the user deleted it, or `--force` — loses its entry.
//
// The fixture is a COPIED script, `skills/token-report/scripts/token_report.mjs` (the motivating
// case), not only a SKILL.md, on both global emit families: OpenCode and Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cmdDiff, diffCollect } from '../../js/inspect/diff.mjs';
import { fileHash } from '../../js/hosts/owned.mjs';
import { claudeConfigDir, opencodeConfigDir } from '../../js/hosts/hosts.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const SCRIPT = 'skills/token-report/scripts/token_report.mjs';

const emit = (name, ...extra) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
    '--emit', name, '--theme', 'neutral', ...extra], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`emit ${name} (${r.status}): ${(r.stderr || r.stdout).slice(-1200)}`);
  return r.stderr;
};

for (const [name, dirOf] of [['opencode-global', opencodeConfigDir], ['claude-global', claudeConfigDir]]) {
  const cfg = dirOf();
  const manifestPath = path.join(cfg, '.geneseed-manifest.json');
  const manifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const writeManifest = (doc) => fs.writeFileSync(manifestPath, JSON.stringify(doc));
  const script = path.join(cfg, SCRIPT);
  const record = () => diffCollect({ target: cfg }).files.find((f) => f.rel === SCRIPT);
  let base = null;

  test(`${name}: a clean emit writes no kept_hashes and owns the script`, () => {
    emit(name);
    const doc = manifest();
    assert.equal(Object.hasOwn(doc, 'kept_hashes'), false);
    assert.ok(doc.owned.includes(SCRIPT), `${SCRIPT} is owned`);
    base = doc.hashes[SCRIPT];
    assert.match(base, /^[0-9a-f]{64}$/);
  });

  test(`${name}: emitted then edited, the source unchanged -> diverged: false`, () => {
    fs.appendFileSync(script, '\n// a local repair\n');
    assert.deepEqual({ status: record().status, diverged: record().diverged },
      { status: 'edited', diverged: false });
  });

  test(`${name}: the rebuild that refuses the edit records its base in kept_hashes`, () => {
    emit(name);
    const doc = manifest();
    assert.equal(doc.owned.includes(SCRIPT), false, 'the refused edit left owned');
    assert.equal(doc.kept_hashes?.[SCRIPT], base);
    assert.equal(record().diverged, false);
  });

  test(`${name}: a second rebuild carries the base forward, still diverged: false`, () => {
    emit(name);
    assert.equal(manifest().kept_hashes?.[SCRIPT], base);
    assert.equal(record().diverged, false);
    // `cmdDiff` names the state on the `~` line.
    let out = '';
    const real = process.stdout.write;
    process.stdout.write = (s) => { out += s; return true; };
    try { cmdDiff({ target: cfg }); } finally { process.stdout.write = real; }
    assert.ok(out.includes(`~ ${SCRIPT}   (edited in deployed — source unchanged, nothing missed)`), out);
  });

  test(`${name}: the source moved (another base recorded) -> diverged: true`, () => {
    const doc = manifest();
    doc.kept_hashes[SCRIPT] = '0'.repeat(64);
    writeManifest(doc);
    assert.equal(record().diverged, true);
    let out = '';
    const real = process.stdout.write;
    process.stdout.write = (s) => { out += s; return true; };
    try { cmdDiff({ target: cfg }); } finally { process.stdout.write = real; }
    assert.ok(out.includes(
      `~ ${SCRIPT}   (edited in deployed — the source has moved; review to back-port, or restore)`), out);
  });

  test(`${name}: no base at all -> diverged: true`, () => {
    const doc = manifest();
    delete doc.kept_hashes;
    writeManifest(doc);
    assert.equal(record().diverged, true);
  });

  test(`${name}: deleting the edited file lets the rebuild claim it again, and its entry drops`, () => {
    const doc = manifest();
    doc.kept_hashes = { [SCRIPT]: base };
    writeManifest(doc);
    fs.rmSync(script);
    emit(name);
    const after = manifest();
    assert.equal(Object.hasOwn(after, 'kept_hashes'), false);
    assert.ok(after.owned.includes(SCRIPT));
    assert.equal(fileHash(script), base);
    assert.equal(record(), undefined);
  });

  test(`${name}: --force claims an edited file again, and its entry drops`, () => {
    fs.appendFileSync(script, '\n// another repair\n');
    emit(name);
    assert.equal(manifest().kept_hashes?.[SCRIPT], base);
    emit(name, '--force');
    const after = manifest();
    assert.equal(Object.hasOwn(after, 'kept_hashes'), false);
    assert.ok(after.owned.includes(SCRIPT));
    assert.equal(record(), undefined);
  });
}
