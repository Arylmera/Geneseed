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

import { diffCollect, exportImprovements, improvementsMd } from '../../js/inspect/diff.mjs';
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
    [{ edited: 1, added: 0, missing: 0, linked: 1 }]);
});
