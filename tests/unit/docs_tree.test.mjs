// The docs tree is read in two places — on GitHub as plain markdown, and in the console through
// js/web/docs.mjs — and each gate below protects one way a page can read fine in one and break
// in the other. Each rule is a small pure function, tested once against a page that breaks it,
// then run over the real tree: a gate that has never been seen to fail gates nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { docSources, parseMapTable, stripHarnessBlocks } from '../../js/web/docs.mjs';

// The pre-restructure tree is read by the console but predates these rules; it is exempt until
// its pages move out, and then the folder is gone.
const NEW_TREE = (rel) => !rel.startsWith('docs/web/');
const pages = () => docSources().filter((s) => NEW_TREE(s.rel))
  .map((s) => ({ ...s, text: fs.readFileSync(path.join(ROOT, s.rel), 'utf8') }));

const LINK_RE = /\]\((?!https?:|#|mailto:)([^)\s]+?\.md)(?:#[^)\s]*)?\)/g;

/** Relative `.md` link targets outside fences, resolved against the page's folder. */
function relativeLinks(text, rel) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (const m of line.matchAll(LINK_RE)) {
      out.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
  }
  return out;
}

/** GitHub hides `<!--harness:x-->`, so the line after it must say which host the block is for. */
const HOST_LABEL = { opencode: '*(OpenCode only)*', claude: '*(Claude Code only)*' };
function unlabelledHarnessBlocks(text) {
  const lines = text.split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    const m = /^\s*<!--\s*harness:(opencode|claude)\s*-->\s*$/.exec(line);
    if (m && (lines[i + 1] ?? '').trim() !== HOST_LABEL[m[1]]) bad.push(i + 1);
  });
  return bad;
}

/** A frontmatter value, raw. */
const front = (text, key) => (new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(text) ?? [])[1];

test('each gate fails on a page that breaks it', () => {
  assert.deepEqual(relativeLinks('[a](../concepts/x.md#y)\n```\n[b](z.md)\n```', 'docs/guides/i.md'),
    ['docs/concepts/x.md']);
  assert.deepEqual(unlabelledHarnessBlocks('<!--harness:claude-->\nhooks\n<!--/harness-->'), [1]);
  assert.deepEqual(unlabelledHarnessBlocks('<!--harness:claude-->\n*(Claude Code only)*\n'), []);
  assert.equal(front('---\ngroup: guides\nkind: "map"\n---', 'kind'), 'map');
});

test('every relative .md link in the docs tree and the READMEs resolves to a file', () => {
  const sources = [...pages(), ...['README.md', 'docs/README.md']
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))];
  for (const { rel, text } of sources) {
    for (const target of relativeLinks(text, rel)) {
      assert.ok(fs.existsSync(path.join(ROOT, target)), `${rel} links to ${target}, which does not exist`);
    }
  }
});

test('no count token in understand/ or guides/ — GitHub would show it raw', () => {
  for (const { rel, text } of pages()) {
    if (!/^docs\/(understand|guides)\//.test(rel)) continue;
    assert.ok(!text.includes('{N_'), `${rel} carries a {N_*} token; write the words instead`);
  }
});

test('every harness block opens with a visible host label', () => {
  for (const { rel, text } of pages()) {
    assert.deepEqual(unlabelledHarnessBlocks(text), [],
      `${rel}: a <!--harness:x--> line must be followed by ${Object.values(HOST_LABEL).join(' or ')}`);
  }
});

test('every map page parses for each host', () => {
  for (const { rel, text } of pages()) {
    if (front(text, 'kind') !== 'map') continue;
    for (const host of ['opencode', 'claude']) {
      assert.ok(parseMapTable(stripHarnessBlocks(text, host)),
        `${rel} has no well-formed map table for ${host}`);
    }
  }
});

test('every page names a group that _groups.json declares', () => {
  const groups = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', '_groups.json'), 'utf8'))
    .map((g) => g.id));
  for (const { rel } of docSources()) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(groups.has(front(text, 'group')), `${rel} names group "${front(text, 'group')}"`);
  }
});
