// A deployed path the user replaced with a LINK to their own copy — a skill dir junctioned (or
// symlinked) to a folder outside the install — is classified `linked`, never `edited`.
//
// The rule these tests hold, stated once: the emit refuses to write through a link
// (`claimLeaf`), so no rebuild can ever clear such a path, and reporting it as "edited — review
// to back-port" kept two phantom edits in the console forever. A path is `linked` exactly when
// the claimer's own test (`safeLeaf`) refuses it, and a linked path is not drift: it is left out
// of the `edited` tally, the fleet's figure and the improvements report. A plain hand edit to a
// regular file is still `edited`, as before.
//
// `fs.symlinkSync(..., 'junction')`: a junction on Windows (no admin needed), a directory
// symlink on POSIX, where the type argument is ignored — the two shapes a user makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cmdDiff, diffCollect, exportImprovements, improvementsMd } from '../../js/inspect/diff.mjs';
import { fileHash, hashesOf } from '../../js/hosts/owned.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { apiFleet } from '../../js/web/api.mjs';
import { webState } from '../../js/web/state.mjs';
import { sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

const home = sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
  '--emit', 'opencode-global', '--theme', 'neutral'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, windowsHide: true,
});
if (r.status !== 0) throw new Error(`emit (${r.status}): ${(r.stderr || r.stdout).slice(-1200)}`);
const gcfg = path.join(home, '.config', 'opencode');

// `debug` becomes the user's own linked copy, with an edit in it; `commit` gets a plain edit.
const linkedDir = path.join(gcfg, 'skills', 'debug');
const editedFile = path.join(gcfg, 'skills', 'commit', 'SKILL.md');
assert.ok(fs.existsSync(path.join(linkedDir, 'SKILL.md')), 'the emit wrote skills/debug/');
assert.ok(fs.existsSync(editedFile), 'the emit wrote skills/commit/SKILL.md');
const outside = path.join(home, 'my-skills', 'debug');
fs.cpSync(linkedDir, outside, { recursive: true });
fs.appendFileSync(path.join(outside, 'SKILL.md'), '\nmy own line\n');
fs.rmSync(linkedDir, { recursive: true, force: true });
fs.symlinkSync(outside, linkedDir, 'junction');

const statuses = (files) => files.map((f) => `${f.status} ${f.rel}`).sort();

// Runs FIRST, while the link is the only difference (node runs one file's tests in order):
// `setup` and `update` export on every run, and a link alone must not write a report each time.
test('a link alone exports no improvements file', () => {
  const out = path.join(home, 'improvements.md');
  const [written, files] = exportImprovements(gcfg, null, out);
  assert.equal(written, null);
  assert.deepEqual(statuses(files), ['linked skills/debug/SKILL.md']);
  assert.equal(fs.existsSync(out), false);
  fs.appendFileSync(editedFile, '\na hand edit\n');
});

test('a skill dir linked to an outside copy is linked, a plain hand edit is still edited', () => {
  const { files } = diffCollect({ target: gcfg });
  assert.deepEqual(statuses(files), ['edited skills/commit/SKILL.md', 'linked skills/debug/SKILL.md']);
});

test('the improvements report carries the hand edit and not the link', () => {
  const { target, theme, files } = diffCollect({ target: gcfg });
  const md = improvementsMd(target, theme, files, 'now');
  assert.match(md, /- 1 edited · 0 added in deployed · 0 missing from deployed/);
  assert.match(md, /skills\/commit\/SKILL\.md/);
  assert.doesNotMatch(md, /skills\/debug/);
});

test('the fleet counts the hand edit and keeps the link out of the edited figure', () => {
  const st = webState();
  st.stampDoctor([]);
  const fleet = apiFleet(st);
  assert.deepEqual(fleet.installs.map((i) => i.drift),
    [{ edited: 1, added: 0, missing: 0, linked: 1, stale: 0 }]);
});

// ---------------------------------------------------------------------------------------------
// `stale`: a file unmodified since its emit that differs from the CURRENT source — the install is
// behind, nobody edited it, and a rebuild updates it. The rule, stated once: when the manifest
// records hashes, a differing file whose bytes still match its recorded hash is `stale`, one that
// does not match is `edited`; a source file the deployed manifest never owned is `stale` (new in
// source), one it owned and lost is `missing`. `.geneseed-version` is a build stamp, so a
// different fingerprint in it is always `stale`. Stale is not drift: no improvements report and
// no "edited" figure counts it. Appended last, because these tests reshape the shared install.
const manifestPath = path.join(gcfg, '.geneseed-manifest.json');
const readManifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const writeManifest = (doc) => fs.writeFileSync(manifestPath, JSON.stringify(doc));

test('the emit recorded hashes, so the cases below exercise the hashed path', () => {
  assert.ok(Object.keys(hashesOf(readManifest())).length > 0, 'the emit wrote no hashes');
});

test('an unmodified-since-emit file behind the source is stale, an edit stays edited', () => {
  const rel = 'skills/plan/SKILL.md';
  const p = path.join(gcfg, rel);
  assert.ok(fs.existsSync(p), `the emit wrote ${rel}`);
  // What an older source rendered: the deployed bytes differ, and the manifest hash matches them.
  fs.writeFileSync(p, `${fs.readFileSync(p, 'utf8')}\na line an older source had\n`);
  const doc = readManifest();
  doc.hashes[rel] = fileHash(p);
  // A source file this install never owned (new since its emit), and one it owned and lost.
  doc.owned = doc.owned.filter((x) => x !== 'skills/release/SKILL.md');
  delete doc.hashes['skills/release/SKILL.md'];
  writeManifest(doc);
  fs.rmSync(path.join(gcfg, 'skills', 'release', 'SKILL.md'));
  fs.rmSync(path.join(gcfg, 'skills', 'refactor', 'SKILL.md'));
  // A build stamp from another source: never an edit, whatever its hash says.
  fs.writeFileSync(path.join(gcfg, '.geneseed-version'), 'deadbeef1234 (built 2020-01-01)\n');
  const { files } = diffCollect({ target: gcfg });
  assert.deepEqual(statuses(files), [
    'edited skills/commit/SKILL.md',
    'linked skills/debug/SKILL.md',
    'missing skills/refactor/SKILL.md',
    'stale .geneseed-version',
    'stale skills/plan/SKILL.md',
    'stale skills/release/SKILL.md',
  ]);
  // The stale record keeps its hunk, so the console can show what a rebuild changes.
  const plan = files.find((f) => f.rel === rel);
  assert.ok(plan.diff.join('\n').includes('+a line an older source had'), plan.diff.join('\n'));
});

test('the improvements report and the fleet leave stale files out of the drift', () => {
  const { target, theme, files } = diffCollect({ target: gcfg });
  const md = improvementsMd(target, theme, files, 'now');
  assert.match(md, /- 1 edited · 0 added in deployed · 1 missing from deployed/);
  assert.doesNotMatch(md, /skills\/plan|skills\/release|\.geneseed-version/);
  const st = webState();
  st.stampDoctor([]);
  assert.deepEqual(apiFleet(st).installs.map((i) => i.drift),
    [{ edited: 1, added: 0, missing: 1, linked: 1, stale: 3 }]);
});

test('diff prints stale files apart and keeps them out of the edited summary', () => {
  let out = '';
  const real = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { assert.equal(cmdDiff({ target: gcfg }), 0); } finally { process.stdout.write = real; }
  assert.match(out, /\[diff\] 1 edited, 0 added-in-deployed, 1 missing-from-deployed\r?\n/);
  assert.match(out, /\[diff\] 3 file\(s\) behind source — rebuild to update them\r?\n/);
  assert.match(out, / {2}· skills\/plan\/SKILL\.md {3}\(behind source — a rebuild updates it\)\r?\n/);
  assert.doesNotMatch(out, /~ skills\/plan/);
});

test('an install only behind its source exports no improvements file', () => {
  // Turn the two remaining local changes into stale ones: the edit's bytes become the recorded
  // hash, and the lost file leaves the manifest. What is left is behind, not edited.
  const doc = readManifest();
  doc.hashes['skills/commit/SKILL.md'] = fileHash(editedFile);
  doc.owned = doc.owned.filter((x) => x !== 'skills/refactor/SKILL.md');
  delete doc.hashes['skills/refactor/SKILL.md'];
  writeManifest(doc);
  const out = path.join(home, 'improvements-stale.md');
  const [written, files] = exportImprovements(gcfg, null, out);
  assert.equal(written, null);
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(statuses(files), [
    'linked skills/debug/SKILL.md',
    'stale .geneseed-version',
    'stale skills/commit/SKILL.md',
    'stale skills/plan/SKILL.md',
    'stale skills/refactor/SKILL.md',
    'stale skills/release/SKILL.md',
  ]);
});

test('a manifest without hashes keeps the old reading, but the build stamp is still stale', () => {
  // Without hashes nothing tells an untouched file from an edited one, so a differing file is
  // `edited` and an absent one `missing`, as before; `.geneseed-version` needs no hash.
  const doc = readManifest();
  delete doc.hashes;
  writeManifest(doc);
  assert.deepEqual(statuses(diffCollect({ target: gcfg }).files), [
    'edited skills/commit/SKILL.md',
    'edited skills/plan/SKILL.md',
    'linked skills/debug/SKILL.md',
    'missing skills/refactor/SKILL.md',
    'missing skills/release/SKILL.md',
    'stale .geneseed-version',
  ]);
});
