/**
 * The three functions that lay out terminal text: `wrapText`, `dwidth`, and `formatHelp`.
 *
 * WHY THESE THREE SHARE A FILE. They are the console's typography, and they compose in one
 * direction: `formatHelp` wraps option blurbs with `wrapText`, and anything that draws a column
 * measures it with `dwidth`. A change to any one of them is visible in `geneseed <verb> --help`,
 * which is the most-read text this tool prints and the only part of it a user meets before
 * deciding whether the tool works.
 *
 * WHAT IS ASSERTED, AND WHY IT IS WRITTEN OUT RATHER THAN RECORDED. Every expected value below is
 * stated in the file, chosen to pin a decision rather than to sample behaviour. That is a
 * deliberate replacement for the corpora that used to guard this surface: those were transcripts
 * of a program that no longer exists, so a red run could only ever mean "you changed something",
 * never "you broke something". A written assertion says which rule broke.
 *
 * These are decisions, not laws of nature. If a rule below is wrong, change the rule AND the line
 * that states it, in the same commit, and say why in the message — that is the whole ceremony.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cliCommand, formatHelp, wrapText } from '../../js/ui/cli.mjs';
import { dwidth, fit, truncd } from '../../js/ui/tui.mjs';

test('wrapText fills each line as full as it can before breaking', () => {
  assert.deepEqual(
    wrapText('the quick brown fox jumps over the lazy dog', 12),
    ['the quick', 'brown fox', 'jumps over', 'the lazy dog'],
  );
  // No line may exceed the width unless it is a single unbreakable token — see below.
  for (const line of wrapText('the quick brown fox jumps over the lazy dog', 12)) {
    assert.ok(line.length <= 12, `"${line}" is ${line.length} > 12`);
  }
});

test('wrapText leaves text alone when it already fits', () => {
  assert.deepEqual(wrapText('one two', 100), ['one two']);
  // Interior runs of whitespace are preserved, not collapsed: the caller may be aligning
  // something, and re-spacing their text is not this function's decision to make.
  assert.deepEqual(wrapText('a  b', 10), ['a  b']);
});

test('wrapText returns one empty line for empty input, never an empty list', () => {
  // A caller joining the result with "\n" must get "" rather than throwing on lines[0].
  assert.deepEqual(wrapText('', 10), ['']);
});

test('wrapText hard-cuts a word too long to ever fit', () => {
  // The alternative is a line wider than the terminal, which wraps in the terminal instead and
  // destroys the alignment of everything after it. A visible cut beats an invisible reflow.
  assert.deepEqual(wrapText('supercalifragilistic', 8), ['supercal', 'ifragili', 'stic']);
});

test('wrapText prefers to break a long token after a hyphen', () => {
  // "well-behaved-hyphenated-token" cannot fit in 10, so it is cut — but at the hyphen inside
  // the room left on the line, which keeps the fragments readable as words.
  assert.deepEqual(
    wrapText('well-behaved-hyphenated-token here', 10),
    ['well-', 'behaved-hy', 'phenated-', 'token here'],
  );
});

test('dwidth counts what a terminal draws, not what String.length reports', () => {
  assert.equal(dwidth('abc'), 3);
  assert.equal(dwidth(''), 0);
  // East Asian Wide and Fullwidth cost two columns each.
  assert.equal(dwidth('漢字'), 4);
  assert.equal(dwidth('a漢'), 3);
  // Halfwidth katakana are one column despite being non-Latin.
  assert.equal(dwidth('ﾊﾝｶｸ'), 4);
  // Emoji above U+1F000 are wide; a combining mark adds nothing to the width of what precedes it.
  assert.equal(dwidth('🙂'), 2);
  assert.equal(dwidth('́'), 0);
});

test('truncd and fit respect display width, so columns stay aligned', () => {
  // The bug this pins: slicing by String.length cuts a wide character in half and every column
  // to the right of it shifts by one. Both helpers must measure with dwidth.
  assert.ok(dwidth(truncd('漢字漢字', 5)) <= 5);
  assert.equal(dwidth(fit('漢字', 6)), 6);
  assert.equal(dwidth(fit('abc', 6)), 6);
});

test('formatHelp renders the usage line, then the options block', () => {
  const text = formatHelp(cliCommand('version'), 'geneseed version', 78);
  assert.equal(text, [
    'usage: geneseed version [-h] [--target TARGET]',
    '',
    'options:',
    '  -h, --help       show this help message and exit',
    '  --target TARGET  deployed dir to check (default: the OpenCode global config',
    '                   dir)',
    // Trailing newline, so the shell prompt lands on its own line after `--help`.
    '',
  ].join('\n'));
});

test('formatHelp wraps a long blurb to the given width and keeps it in its column', () => {
  const text = formatHelp(cliCommand('version'), 'geneseed version', 78);
  const lines = text.split('\n');
  for (const line of lines) assert.ok(line.length <= 78, `"${line}" exceeds 78`);
  // The continuation of a wrapped blurb aligns under the blurb, not under the flag.
  const wrapped = lines.filter((l) => l.startsWith('                   '));
  assert.ok(wrapped.length > 0, 'expected at least one continuation line');
});

test('formatHelp takes prog as a parameter rather than reading argv', () => {
  // The console renders help for verbs it is not itself invoking, so the program name cannot
  // come from process.argv — a docs page would then claim every verb is spelled "node".
  const a = formatHelp(cliCommand('version'), 'geneseed version', 78);
  const b = formatHelp(cliCommand('version'), 'other name', 78);
  assert.ok(a.startsWith('usage: geneseed version'));
  assert.ok(b.startsWith('usage: other name'));
});

test('every verb in the table renders help without throwing', () => {
  // The structural sweep the corpus used to provide, and the reason it is worth keeping: a verb
  // whose table entry is malformed fails here, by name, rather than the first time a user asks
  // that one verb for help.
  const table = JSON.parse(readFileSync(new URL('../../js/cli-table.json', import.meta.url), 'utf8'));
  const verbs = table.commands.map((c) => c.name);
  assert.ok(verbs.length > 0, 'cli-table.json declares no commands');
  for (const verb of verbs) {
    const text = formatHelp(cliCommand(verb), `geneseed ${verb}`, 78);
    assert.ok(text.startsWith(`usage: geneseed ${verb}`), `${verb}: bad usage line`);
    for (const line of text.split('\n')) {
      assert.ok(line.length <= 78, `${verb}: "${line}" exceeds 78`);
    }
  }
});
