// USER-FILE SAFETY — the class of bug that destroys something the user wrote, and the reason it
// cannot live in a cell.
//
// The ownership claim only fires when a file EXISTS at the destination and was never owned by a
// previous emit. A fresh-sandbox emit never reaches that state BY CONSTRUCTION: nothing is there
// before the first write. So all 691 recorded cells are blind to it, and `tests/mutate.mjs`'s M5
// — break the claim so an emit overwrites a file it never owned — survived a cell gate for
// exactly that reason and was reclassified `gate: null` until this file existed.
//
// THAT IS THE WHOLE ARGUMENT FOR A UNIT TIER. A corpus can only record states a cell can reach;
// the states worth fearing most are the ones a clean fixture cannot produce.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { writeNativeLayer } from '../../js/hosts/native.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

// One install root with a `src` tree beside it, shaped the way `writeNativeLayer` reads: each
// item is `{ text, src }` where `src` is an absolute path whose two path segments under the
// source root are `<folder>/<name>.md`.
function fixture() {
  const sb = makeSandbox();
  const src = path.join(sb.path, 'src');
  const cfg = path.join(sb.path, 'cfg');
  const agentsDir = path.join(cfg, 'agents');
  const skillsDir = path.join(cfg, 'skills');
  for (const d of [path.join(src, 'agents'), agentsDir, skillsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return { sb, src, cfg, agentsDir, skillsDir };
}

const item = (src, rel, text) => ({ text, src: path.join(src, ...rel.split('/')) });

// The warnings go to stderr through the product's own printer, so they are captured rather than
// re-implemented. A silent refusal is half a defect: the file survives and the user is never
// told their copy was kept instead of Geneseed's.
function captured(fn) {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (c) => { chunks.push(String(c)); return true; };
  try { return { value: fn(), err: chunks.join('') }; } finally { process.stderr.write = original; }
}

test('a pre-existing file this install never owned is kept, not clobbered', () => {
  const f = fixture();
  try {
    const dest = path.join(f.agentsDir, 'scribe.md');
    fs.writeFileSync(dest, 'THE USER WROTE THIS\n');

    const { value, err } = captured(() => writeNativeLayer(
      [item(f.src, 'agents/scribe.md', "GENESEED'S COPY\n")],
      f.agentsDir, f.skillsDir, null,
      // `oldOwned: []` is an install whose manifest exists and claims nothing — the state a
      // user reaches by deleting a component from their config and re-emitting.
      { host: 'opencode', oldOwned: [], cfg: f.cfg, manifestExisted: true, src: f.src },
    ));

    assert.equal(fs.readFileSync(dest, 'utf8'), 'THE USER WROTE THIS\n',
      "the emit overwrote a file it never owned — this is the class of bug that destroys a "
      + "user's own work, and no recorded cell can see it because a fresh sandbox never has a "
      + 'file there to destroy');
    assert.ok(!value.written.includes(dest),
      'a file the emit refused to write must stay OUT of the manifest, or the next prune '
      + "deletes the user's copy on the grounds that this install owns it");
    assert.match(err, /kept your existing/,
      'the refusal was silent — the user is never told their copy was kept');
  } finally { f.sb.cleanup(); }
});

test('a file this install DID own is overwritten', () => {
  const f = fixture();
  try {
    const dest = path.join(f.agentsDir, 'scribe.md');
    fs.writeFileSync(dest, 'a previous emit wrote this\n');

    const { value } = captured(() => writeNativeLayer(
      [item(f.src, 'agents/scribe.md', "GENESEED'S COPY\n")],
      f.agentsDir, f.skillsDir, null,
      { host: 'opencode', oldOwned: ['agents/scribe.md'], cfg: f.cfg, manifestExisted: true, src: f.src },
    ));

    // THE POSITIVE CONTROL, and it is not decoration: a claim guard that refused EVERYTHING
    // would satisfy the test above perfectly while making every re-emit a no-op.
    assert.match(fs.readFileSync(dest, 'utf8'), /GENESEED'S COPY/,
      'the emit refused to update a file it owns — an ownership gate that never says yes is a '
      + 'gate that has stopped working, not one that is being careful');
    assert.ok(value.written.includes(dest));
  } finally { f.sb.cleanup(); }
});

test('the first emit over a pre-manifest install says so once, not per file', () => {
  const f = fixture();
  try {
    for (const n of ['one.md', 'two.md']) {
      fs.writeFileSync(path.join(f.agentsDir, n), 'the user had this already\n');
    }
    const { err } = captured(() => writeNativeLayer(
      [item(f.src, 'agents/one.md', 'x\n'), item(f.src, 'agents/two.md', 'y\n')],
      f.agentsDir, f.skillsDir, null,
      { host: 'opencode', oldOwned: [], cfg: f.cfg, manifestExisted: false, src: f.src },
    ));
    const header = err.split('first emit over a pre-manifest install').length - 1;
    assert.equal(header, 1,
      `the pre-manifest header printed ${header} times — it is a statement about the INSTALL, `
      + 'and one per kept file turns a readable warning into a wall');
    assert.equal(err.split('kept your existing').length - 1, 2,
      'each kept file must still be named individually');
  } finally { f.sb.cleanup(); }
});

// `oldOwned: null` is a DIFFERENT state from `oldOwned: []`, and conflating them is how a guard
// that looks careful becomes one that never fires. Null means "this caller is not doing
// ownership at all" — the claim returns true unconditionally — and the empty array means "an
// install that owns nothing", where every pre-existing file is the user's.
test('a caller that passes no ownership at all is not silently refused', () => {
  const f = fixture();
  try {
    const dest = path.join(f.agentsDir, 'scribe.md');
    fs.writeFileSync(dest, 'whatever was here\n');
    const { value } = captured(() => writeNativeLayer(
      [item(f.src, 'agents/scribe.md', 'written\n')],
      f.agentsDir, f.skillsDir, null,
      { host: 'opencode', oldOwned: null, cfg: f.cfg, manifestExisted: true, src: f.src },
    ));
    assert.ok(value.written.includes(dest));
    assert.match(fs.readFileSync(dest, 'utf8'), /written/);
  } finally { f.sb.cleanup(); }
});
