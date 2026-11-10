// WHERE THE MANAGED BLOCK IS — js/lib/managed-block.mjs, the one definition the writer and the
// hook-side readers share. Each row is a co-owned file and the block a reader must find in it:
// a marker counts only as a whole line, and the pair is the first END line with the last BEGIN
// line above it. Trailing blanks and a `\r` after a marker are allowed, because a hook reads the
// file raw.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BLOCK_RE_SOURCE, blockOf, blockSpan, withoutBlocks } from '../../js/lib/managed-block.mjs';
import { ROOT } from '../../js/build/source.mjs';

const B = '<!-- BEGIN GENESEED -->';
const E = '<!-- END GENESEED -->';
const ROWS = [
  ['a plain block', `mine\n${B}\nharness\n${E}\nmore\n`, `${B}\nharness\n${E}`, 'mine\n\nmore\n'],
  ['no block', 'just my notes\n', '', 'just my notes\n'],
  ['the BEGIN marker inside a sentence', `Below the \`${B}\` line.\n${B}\nh\n${E}\n`, `${B}\nh\n${E}`, `Below the \`${B}\` line.\n\n`],
  ['both markers inside a sentence, and nothing else', `It runs from ${B} to ${E}.\n`, '', `It runs from ${B} to ${E}.\n`],
  ['an END line with no BEGIN above it', `${E}\ntext\n`, '', `${E}\ntext\n`],
  ['a lone BEGIN line above a real block', `${B}\nmy notes\n${B}\nh\n${E}\n`, `${B}\nh\n${E}`, `${B}\nmy notes\n\n`],
  ['CRLF line endings', `mine\r\n${B}\r\nh\r\n${E}\r\nmore\r\n`, `${B}\r\nh\r\n${E}`, 'mine\r\n\r\nmore\r\n'],
  ['two blocks', `${B}\na\n${E}\nmid\n${B}\nb\n${E}\n`, `${B}\na\n${E}`, '\nmid\n\n'],
];
for (const [name, text, block, rest] of ROWS) {
  test(`the managed block: ${name}`, () => {
    assert.equal(blockOf(text), block);
    assert.equal(blockSpan(text) === null, block === '');
    assert.equal(withoutBlocks(text), rest);
  });
}

// The OpenCode plugins cannot import the module, so each carries the regex by value. Held equal
// here, and held to the same answers on every row but the one the module documents as different
// (a lone BEGIN above a real block, where the regex starts at the lone one).
test('each OpenCode plugin carries the same whole-line regex', () => {
  const literal = `/${BLOCK_RE_SOURCE}/`;
  const dir = path.join(ROOT, 'adapters', 'opencode', 'plugins');
  for (const [file, count] of [['geneseed-context.js', 1], ['geneseed-guard.js', 2]]) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.equal(src.split(literal).length - 1, count, `${file} does not carry BLOCK_RE_SOURCE ${count} time(s)`);
    assert.doesNotMatch(src, /\/<!-- BEGIN GENESEED -->\[/, `${file} still matches a marker anywhere in a line`);
  }
  const re = new RegExp(BLOCK_RE_SOURCE, 'm');
  for (const [name, text, block] of ROWS) {
    if (name.startsWith('a lone BEGIN')) continue;
    // The regex keeps the END line's trailing blanks and `\r`; the module's span stops before them.
    assert.equal((re.exec(text)?.[0] ?? '').replace(/[ \t\r]+$/, ''), block, name);
  }
});
