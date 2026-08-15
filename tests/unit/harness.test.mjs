// `tests/test_harness.py`'s unit tier — the CLI's own logic, re-aimed at `js/`.
//
// THE RULE THIS FILE FOLLOWS, because `test_harness.py` reaches into private helpers on almost
// every page and Python has no privacy to stop it. For each property:
//
//   1. drive it through the PUBLIC entry by default — strongest, gates the wiring too;
//   2. export the pure DECISION only when the property is invisible through that face, with the
//      argument written at the export site (`installAgentEntryOf` and `harnessBlocksBalanced`
//      are the precedents);
//   3. retire it only by naming the gate that already covers it.
//
// AND CHECK FOR (3) FIRST, because the port has sometimes made a claim STRUCTURAL. The clearest
// example is right below: `LEARN_PROMPT_HEAD`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  LEARN_PROMPT_HEAD, frontmatter, readNotes, existingSlugs, writeMemories,
} from '../../js/hooks.mjs';
import { themeParityProblems } from '../../js/doctor.mjs';
import { PLUGIN_SRC } from '../../js/checkout.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

// ---------------------------------------------------------------------------------------------
// The distil prompt.
//
// THE PARITY CLAIM RETIRED INTO THE ARCHITECTURE, and this is the shape to look for before
// porting any "the two copies have not drifted" test. The reference kept its own copy of the
// prompt and `PromptParityTests` existed to catch the two literals drifting apart. The port has
// no second copy: `LEARN_PROMPT_HEAD` is EXTRACTED from the plugin's literal at load time via
// `pluginLiteral()`, so drift is not something a test has to catch — there is nothing to drift
// from. What survives is that the extraction still WORKS, which is a different and smaller
// claim, and `js/doctor.mjs`'s authoring check carries the rest.

test('the learn prompt is extracted from the plugin literal, not copied', () => {
  const js = fs.readFileSync(path.join(PLUGIN_SRC, 'geneseed-learn.js'), 'utf8');
  const m = /const LEARN_PROMPT_HEAD = `([\s\S]*?)`/.exec(js);
  assert.ok(m, 'could not find the LEARN_PROMPT_HEAD literal in the plugin');
  assert.equal(LEARN_PROMPT_HEAD, m[1],
    'the extraction returned something other than the literal — silently, since a failed '
    + 'extraction degrades to a default rather than throwing');
});

// A failed extraction degrades rather than raising, so "we got a string" is not enough: an empty
// or stub prompt would satisfy the row above if the regex ever stopped matching.
test('the extracted prompt is substantive', () => {
  assert.match(LEARN_PROMPT_HEAD, /NOTHING/);
  assert.ok(LEARN_PROMPT_HEAD.length > 200, `prompt is ${LEARN_PROMPT_HEAD.length} chars`);
});

// ---------------------------------------------------------------------------------------------
// Frontmatter.

test('frontmatter parses name and description and returns the body', () => {
  const [fm, body] = frontmatter('---\nname: foo\ndescription: bar\n---\nthe body');
  assert.equal(fm.get('name'), 'foo');
  assert.equal(fm.get('description'), 'bar');
  assert.match(body, /the body/);
});

test('a document with no frontmatter comes back whole', () => {
  const [fm, body] = frontmatter('just text, no fm');
  assert.equal(fm.size, 0);
  assert.equal(body, 'just text, no fm');
});

// ---------------------------------------------------------------------------------------------
// The `learn` store writer. Its verb is gated end to end by 78 CLI cells; what no cell can reach
// is the model output itself, which is where every decision here lives.

const withDir = (fn) => {
  const sb = makeSandbox();
  try { return fn(sb.path); } finally { sb.cleanup(); }
};

test('writeMemories writes the new fact, skips the duplicate and indexes both', () => {
  withDir((d) => {
    const out = '---\nname: new-fact\ndescription: a desc\n---\nthe fact\n'
      + '---FILE---\n---\nname: dup\ndescription: x\n---\nbody';
    const written = writeMemories(out, d, new Set(['dup']));

    assert.deepEqual(written, ['new-fact']);
    assert.ok(fs.statSync(path.join(d, 'new-fact.md')).isFile());
    assert.ok(!fs.existsSync(path.join(d, 'dup.md')),
      'a slug the caller declared as existing was overwritten');

    const idx = fs.readFileSync(path.join(d, 'MEMORY.md'), 'utf8');
    assert.match(idx, /new-fact/);
    assert.match(idx, /a desc/);
  });
});

// `NOTHING` is the model's way of saying it found no durable fact. It must write NO files at
// all — not an empty index, which would look like a store that had been cleared.
test('a NOTHING answer writes no files', () => {
  withDir((d) => {
    assert.deepEqual(writeMemories('NOTHING', d, new Set()), []);
    assert.ok(!fs.existsSync(path.join(d, 'MEMORY.md')));
  });
});

test('existingSlugs skips the index and the readme', () => {
  withDir((d) => {
    for (const nm of ['README.md', 'MEMORY.md', 'real.md']) {
      fs.writeFileSync(path.join(d, nm), 'x');
    }
    assert.deepEqual([...existingSlugs(d)].sort(), ['real']);
  });
});

test('readNotes passes raw text through and returns non-transcript JSON verbatim', () => {
  assert.equal(readNotes('plain notes'), 'plain notes');
  // JSON without a `transcript_path` is not a hook payload — it is the user's own note that
  // happens to start with a brace, and rewriting it would lose what they wrote.
  assert.equal(readNotes('{"foo": 1}'), '{"foo": 1}');
});

// ---------------------------------------------------------------------------------------------
// Theme parity.

test('the shipped themes are in parity', () => {
  assert.deepEqual(themeParityProblems(), []);
});
