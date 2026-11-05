import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RENAMED_FILES, ensureWikiStub, renamedFilesIn } from '../../js/build/stubs.mjs';
import { statusLines } from '../../js/inspect/status.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

// M3 (5.0.0): the `wiki.jsonc` / `wiki.json` fallback stays, with a WARNING, so a user learns the
// old name is on its way out before any release stops reading it. B6: a rename that fails used to
// say nothing, and the old name then went on being read in silence.

const withDir = (fn) => {
  const sb = makeSandbox('wikiwarn-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
};

test('the rename table maps each current name to the older names it replaced', () => {
  assert.deepEqual(RENAMED_FILES, { 'geneseed-wiki.jsonc': ['wiki.jsonc', 'wiki.json'] });
});

test('renamedFilesIn names an old file by its path and its new name, and skips clean dirs', () => {
  withDir((d) => {
    fs.mkdirSync(path.join(d, 'a'));
    fs.mkdirSync(path.join(d, 'b'));
    fs.writeFileSync(path.join(d, 'a', 'wiki.jsonc'), '{}');
    fs.writeFileSync(path.join(d, 'b', 'geneseed-wiki.jsonc'), '{}');
    assert.deepEqual(renamedFilesIn([path.join(d, 'a'), path.join(d, 'b'), path.join(d, 'c')]),
      [{ file: path.join(d, 'a', 'wiki.jsonc'), now: 'geneseed-wiki.jsonc' }]);
  });
});

test('status carries a wiki row only when the payload names an old manifest', () => {
  const base = { theme: 'x', accent: 'cyan', emit: 'e', agents: 1, skills: 1, laws: 1, memory_dir: null,
    facts: 0, installed_fp: 'a', source_fp: 'a', version_verdict: 'up to date' };
  assert.ok(!statusLines(base, false).some((l) => l.includes('old name')));
  const lines = statusLines({ ...base, renamed_files: [{ file: '/h/wiki.jsonc', now: 'geneseed-wiki.jsonc' }] }, false);
  assert.ok(lines.some((l) => l.includes('/h/wiki.jsonc') && l.includes('geneseed-wiki.jsonc')), lines.join('\n'));
});

test('B6: a failed rename is reported, and the old file stays where it is', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'wiki.jsonc'), '{"wikis": []}\n');
    const said = [];
    ensureWikiStub(d, { rename: () => { throw new Error('EBUSY: file in use'); }, warn: (m) => said.push(m) });
    assert.equal(said.length, 1);
    assert.match(said[0], /wiki\.jsonc/);
    assert.match(said[0], /EBUSY/);
    assert.ok(fs.existsSync(path.join(d, 'wiki.jsonc')), 'the user file moved or was lost');
    assert.ok(!fs.existsSync(path.join(d, 'geneseed-wiki.jsonc')), 'a seed was written beside it');
  });
});
