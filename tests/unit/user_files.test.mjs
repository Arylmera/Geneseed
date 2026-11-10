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

import { claimer, writeNativeLayer } from '../../js/hosts/native.mjs';
import { managedBlockRead, managedBlockRemove, managedBlockWrite } from '../../js/hosts/settings.mjs';
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

// A SKILL'S SIDE FILES FOLLOW ITS SKILL.md, with one exception stated here. A side file is
// written only when the claim on its skill's SKILL.md held, so a user's own skill folder never
// gets a Geneseed file dropped into it. The exception is a side file the previous emit wrote:
// it stays written and owned when that claim no longer holds, which is a shipped skill whose
// SKILL.md the user edited. Without it the edit dropped the side files out of the manifest and
// the prune deleted them, licence files included.
test('editing a shipped SKILL.md does not cost the skill its side files', () => {
  const f = fixture();
  try {
    const items = [
      item(f.src, 'skills/probe.md', '# Skill: probe\n\n> Probes.\n'),
      item(f.src, 'skills/probe/extra.md', 'the side file\n'),
    ];
    const skill = path.join(f.skillsDir, 'probe', 'SKILL.md');
    const side = path.join(f.skillsDir, 'probe', 'extra.md');
    fs.mkdirSync(path.dirname(skill), { recursive: true });
    fs.writeFileSync(skill, 'the user edited this\n');
    fs.writeFileSync(side, 'an older side file\n');

    // The state after the edit was first refused: SKILL.md is out of `owned`, the side file in.
    const { value } = captured(() => writeNativeLayer(items, f.agentsDir, f.skillsDir, null,
      { host: 'opencode', oldOwned: ['skills/probe/extra.md'], cfg: f.cfg, src: f.src }));
    assert.equal(fs.readFileSync(skill, 'utf8'), 'the user edited this\n');
    assert.equal(fs.readFileSync(side, 'utf8').replace(/\r\n/g, '\n'), 'the side file\n');
    assert.ok(value.written.includes(side),
      'the side file left `written`, so it leaves the manifest and the prune deletes it');

    // The control: a folder this install never wrote into gets no side file.
    fs.rmSync(side);
    const { value: v2 } = captured(() => writeNativeLayer(items, f.agentsDir, f.skillsDir, null,
      { host: 'opencode', oldOwned: [], cfg: f.cfg, src: f.src }));
    assert.ok(!fs.existsSync(side), "a side file was dropped into the user's own skill folder");
    assert.ok(!v2.written.includes(side));
    assert.equal(typeof claimer([], f.cfg).owned, 'function');
  } finally { f.sb.cleanup(); }
});

// THE MANAGED BLOCK IS FOUND BY WHOLE-LINE MARKERS. The block is written with `<!-- BEGIN
// GENESEED -->` and `<!-- END GENESEED -->` each alone on a line, and only that shape is read
// back: the first END line with a BEGIN line above it, and the last such BEGIN. The marker text
// inside a sentence is the user's prose. Each row is a user's CLAUDE.md around a real block,
// and what must still be there after a rewrite and after the removal.
const BLOCK = (body) => `<!-- BEGIN GENESEED -->\n${body}\n<!-- END GENESEED -->\n`;
const BLOCK_ROWS = [
  ['a sentence that names the BEGIN marker, above the user\'s own rules',
    'Everything below the `<!-- BEGIN GENESEED -->` line is generated.\n\n- Use pnpm.\n\n',
    '',
    'Everything below the `<!-- BEGIN GENESEED -->` line is generated.\n\n- Use pnpm.\n'],
  ['a sentence that names both markers, END first',
    'It ends at <!-- END GENESEED --> and starts at <!-- BEGIN GENESEED -->.\n\n',
    '',
    'It ends at <!-- END GENESEED --> and starts at <!-- BEGIN GENESEED -->.\n'],
  ['a lone BEGIN line left from a hand-deleted block, with text under it',
    '<!-- BEGIN GENESEED -->\nmy notes\n\n',
    '',
    '<!-- BEGIN GENESEED -->\nmy notes\n'],
  ['plain text above and below',
    'above\n\n',
    '\nbelow\n',
    'above\nbelow\n'],
];
for (const [name, pre, post, afterRemove] of BLOCK_ROWS) {
  test(`the managed block leaves the user's text alone: ${name}`, () => {
    const f = fixture();
    try {
      const p = path.join(f.cfg, 'CLAUDE.md');
      fs.writeFileSync(p, pre + BLOCK('old harness') + post);
      assert.equal(managedBlockRead(p), 'old harness');
      assert.equal(managedBlockWrite(p, 'new harness'), 'updated');
      assert.equal(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'),
        pre + BLOCK('new harness') + post.replace(/^\n+/, ''));
      // Rewriting again stacks nothing.
      managedBlockWrite(p, 'new harness');
      assert.equal(fs.readFileSync(p, 'utf8').split('\n<!-- END GENESEED -->').length - 1, 1);
      managedBlockRemove(p);
      assert.equal(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), afterRemove);
    } finally { f.sb.cleanup(); }
  });
}

test('a file that only mentions the markers gets the block appended, and loses nothing', () => {
  const f = fixture();
  try {
    const p = path.join(f.cfg, 'CLAUDE.md');
    const prose = 'The block sits between `<!-- BEGIN GENESEED -->` and `<!-- END GENESEED -->`.\n';
    fs.writeFileSync(p, prose);
    assert.equal(managedBlockRead(p), null);
    assert.equal(managedBlockWrite(p, 'harness'), 'merged');
    assert.equal(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), `${prose}\n${BLOCK('harness')}`);
    managedBlockRemove(p);
    assert.equal(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), prose);
  } finally { f.sb.cleanup(); }
});

// `--force`, AT THE CLAIM. Both refusals above become overwrites, each named on stderr, and
// nothing else changes: `claim` is only ever asked about a path Geneseed ships, so a skill
// under the user's own name is not in question, forced or not. `claim.kept` is the other
// half: every rel an unforced emit left to the user, which the manifest records for the console.
test('--force replaces an edited file and a pre-existing one, and nothing under another name', () => {
  const f = fixture();
  try {
    const items = [
      item(f.src, 'agents/scribe.md', "GENESEED'S SCRIBE\n"),
      item(f.src, 'agents/clerk.md', "GENESEED'S CLERK\n"),
    ];
    const scribe = path.join(f.agentsDir, 'scribe.md');   // pre-existing, never owned
    const clerk = path.join(f.agentsDir, 'clerk.md');     // owned, then edited
    const mine = path.join(f.agentsDir, 'my-own.md');     // a name Geneseed does not ship
    fs.writeFileSync(scribe, 'THE USER WROTE THIS\n');
    fs.writeFileSync(clerk, 'the user edited this\n');
    fs.writeFileSync(mine, 'mine\n');
    const opts = (force) => ({
      host: 'opencode', src: f.src,
      claim: claimer(['agents/clerk.md'], f.cfg, true, { 'agents/clerk.md': 'sha256:not-this' }, force),
    });

    // Unforced: both kept, both in `kept`.
    const plain = opts(false);
    captured(() => writeNativeLayer(items, f.agentsDir, f.skillsDir, null, plain));
    assert.equal(fs.readFileSync(scribe, 'utf8'), 'THE USER WROTE THIS\n');
    assert.equal(fs.readFileSync(clerk, 'utf8'), 'the user edited this\n');
    assert.deepEqual([...plain.claim.kept].sort(), ['agents/clerk.md', 'agents/scribe.md']);

    const forced = opts(true);
    const { value, err } = captured(() => writeNativeLayer(items, f.agentsDir, f.skillsDir, null, forced));
    assert.match(fs.readFileSync(scribe, 'utf8'), /GENESEED'S SCRIBE/);
    assert.match(fs.readFileSync(clerk, 'utf8'), /GENESEED'S CLERK/);
    assert.equal(fs.readFileSync(mine, 'utf8'), 'mine\n');
    assert.equal(value.written.length, 2);
    assert.deepEqual([...forced.claim.kept], []);
    assert.match(err, /--force: replaced your existing agents\/scribe\.md/);
    assert.match(err, /--force: replaced your edited agents\/clerk\.md/);
  } finally { f.sb.cleanup(); }
});
