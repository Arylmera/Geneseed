// `tests/test_harness.py`'s `TuiHelperTests` — the drawing helpers that OUTLIVED the panel.
//
// The screen is dropped and `tests/unit/no_panel.test.mjs` keeps it dropped, but nine of these
// eleven tests are not about a screen at all. `dwidth`, `fit`, `truncd`, `clamp`, `glyphs`,
// `icon`, `mark`, `spin`, `logoLines` and `progressBar` are column arithmetic and glyph tiers,
// and they still have callers: the status panel pads its box with them, `setup` draws with
// them, and every one of them is a place a wrong answer becomes a misaligned frame on somebody
// else's terminal.
//
// TWO RETIRE, both genuinely screen-only:
//   * `_clear_frame(win)` takes a CURSES WINDOW and asserts it was sent `erase()` then
//     `clearok(True)`. There is no curses, no window and no full-repaint flag in the port.
//   * `_wrap_lines` reflowed a body into a fixed-width detail pane. The pane is gone and no
//     `wrapLines` crossed; the web console reflows in CSS.
//
// THE MONKEYPATCH BECOMES DISCOVERY, and the port's own docblock already said how. The
// reference reaches into `_spin.__globals__` and `_progress_bar.__globals__` to flip
// `_TUI_ANIM`/`_TUI_ASCII`, because both are module constants read once at import. The port
// reads them from the ENVIRONMENT at import for exactly the same reason — so a tier is chosen
// by starting a process with `GENESEED_TUI_ASCII` / `GENESEED_TUI_PLAIN` set, and the module
// under test is the real one rather than one with its globals rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  glyphs, GLYPH, dwidth, truncd, fit, icon, mark, spin, logoLines, clamp, progressBar,
} from '../../js/ui/tui.mjs';
import { CATALOG_KINDS } from '../../js/build/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TUI_URL = pathToFileURL(path.join(ROOT, 'js', 'ui', 'tui.mjs')).href;

/**
 * Evaluate an expression against `js/tui.mjs` in a child with `env` applied.
 *
 * ONE PROCESS PER TIER. `TUI_ASCII` and friends are `const`s computed at import, so nothing
 * this process does can change them — which is the same constraint the reference works around
 * by patching `__globals__`, and the port turns into an honest one: the tier really is decided
 * by the environment the program starts in.
 */
function inTier(env, expr) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(TUI_URL)});`
    + `process.stdout.write(JSON.stringify(${expr}));`],
  { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
  if (r.status !== 0) {
    throw new Error(`the tier probe failed (${r.status}): ${(r.stderr || '').slice(-1200)}`);
  }
  return JSON.parse(r.stdout);
}

// The three tiers, by the variable that selects each. `EMOJI` is the default — neither knob
// set — and is listed explicitly so the table reads as a partition rather than as two
// exceptions to an unnamed default.
const EMOJI = { GENESEED_TUI_ASCII: '', GENESEED_TUI_PLAIN: '' };
const ASCII = { GENESEED_TUI_ASCII: '1', GENESEED_TUI_PLAIN: '' };
const PLAIN = { GENESEED_TUI_ASCII: '', GENESEED_TUI_PLAIN: '1' };

const isAscii = (s) => [...s].every((c) => c.codePointAt(0) < 128);

// ---------------------------------------------------------------------------------------------
// Scroll arithmetic.

test('clamp keeps the window inside the list', () => {
  assert.equal(clamp(0, 5, 10), 0);
  assert.equal(clamp(7, 5, 10), 0, 'a list shorter than the view must pin to the top');
  assert.equal(clamp(0, 100, 10), 0);
  assert.equal(clamp(95, 100, 10), 90, 'the last window must be full, not ragged');
  assert.equal(clamp(-4, 100, 10), 0, 'a negative offset must never survive');
});

// ---------------------------------------------------------------------------------------------
// Glyph tiers.

test('the glyph table honours ascii mode and keeps the same keys', () => {
  const uni = glyphs(false);
  const asc = glyphs(true);
  assert.deepEqual(new Set(Object.keys(uni)), new Set(Object.keys(asc)),
    'the two tiers disagree on which glyphs exist');
  assert.equal(uni.sel, '▸');
  assert.equal(asc.sel, '>');
  // ASCII mode must emit ONLY ascii — that is the whole point of the flag, and one stray
  // box-drawing character in it is a mojibake row on the terminal it exists for.
  for (const [k, v] of Object.entries(asc)) {
    assert.ok(isAscii(v), `ascii tier glyph ${k} is ${JSON.stringify(v)}`);
  }
  // `GLYPH` is the table this process resolved, so it must BE one of the two rather than a
  // third hand-maintained copy.
  assert.deepEqual(GLYPH, glyphs(!!process.env.GENESEED_TUI_ASCII));
});

// ---------------------------------------------------------------------------------------------
// Display width — the arithmetic every frame in the program depends on.

test('dwidth counts emoji and CJK as two columns', () => {
  assert.equal(dwidth('abc'), 3);
  // Box-drawing, section and bullet stay SINGLE width; they are the characters a naive
  // "non-ascii is wide" rule gets wrong, and they are in every panel border.
  assert.equal(dwidth('─§•'), 3);
  assert.equal(dwidth('🧬'), 2);
  assert.equal(dwidth('🧬x'), 3);
  assert.equal(dwidth('世界'), 4);
  // A U+FE0F presentation selector promotes its single-width base to two.
  assert.equal(dwidth('⚠️'), 2);
  // Combining marks add nothing.
  assert.equal(dwidth('é'), 1);
});

test('fit pads and truncates by display width, never by string length', () => {
  assert.equal(fit('ab', 5), 'ab   ');
  assert.equal(dwidth(fit('🧬x', 6)), 6);
  // Truncating must never split a wide glyph across a cell boundary: one emoji (2 columns)
  // plus a pad to 3, not half an emoji.
  assert.equal(fit('🧬🧬', 3), '🧬 ');
  assert.equal(truncd('abcdef', 3), 'abc');
  assert.equal(truncd('x', 0), '');
});

test('the logo is a rectangular block', () => {
  const rows = logoLines();
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map(dwidth)).size, 1, 'the logo rows are not all one width');
});

// ---------------------------------------------------------------------------------------------
// The tiers, each in its own process.

/**
 * Every icon key the catalogue can print, DERIVED rather than transcribed.
 *
 * ⚠ THE HAND-WRITTEN LIST WAS `["badge","agent","skill","law"]` AND IT DID NOT GROW WITH THE
 * TABLE. `icon()` falls back to a bullet for an unknown key, so a kind added to `CATALOG_KINDS`
 * without an `ICONS` entry ships a glyph nothing here ever measured — in the emoji tier that is
 * a single-width character where the column maths assumes two, and every row it appears in
 * shifts. Taking the keys from the vocabulary itself means the next kind is covered on the day
 * it is added. `badge` is not a row kind and is appended by hand.
 */
const CATALOG_ICONS = [...Object.values(CATALOG_KINDS), 'badge'];

test('every icon is one double-width codepoint in the emoji tier', () => {
  // `_fit`'s math is exact only if each icon really occupies two columns; an icon that
  // measured 1 or 3 would shift every row it appears in.
  const widths = inTier(EMOJI,
    `Object.fromEntries(${JSON.stringify(CATALOG_ICONS)}`
    + '.map(k => [k, m.dwidth(m.icon(k))]))');
  assert.equal(Object.keys(widths).length, CATALOG_ICONS.length);
  for (const [k, w] of Object.entries(widths)) {
    assert.equal(w, 2, `icon ${k} measured ${w} columns`);
  }
  // ...and the keys must really BE in the table. `icon()` answers a bullet for anything it does
  // not know, and a bullet is two columns wide in the emoji tier, so the loop above passes for
  // a key that was never added. Distinctness is what tells a real entry from the fallback.
  assert.equal(new Set(Object.values(inTier(EMOJI,
    `Object.fromEntries(${JSON.stringify(CATALOG_ICONS)}.map(k => [k, m.icon(k)]))`)))
    .size, CATALOG_ICONS.length,
  'two catalogue icons are the same glyph — at least one key is missing from ICONS and is '
    + 'falling back to the bullet');
});

test('the ascii tier is pure ascii for icons, marks and the spinner', () => {
  const out = inTier(ASCII,
    `({icons: ${JSON.stringify(CATALOG_ICONS)}.map(m.icon),`
    + ' marks: ["pending","edited","added","missing","mcp_on","mcp_off","mcp_absent"]'
    + '.map(m.mark), spin: m.spin(3), bar: m.progressBar(0.5, 10)})');
  for (const s of [...out.icons, ...out.marks, out.spin, out.bar]) {
    assert.ok(isAscii(s), `ascii tier emitted ${JSON.stringify(s)}`);
  }
  // The mark keys must EXIST — `mark()` falls back to a bullet for an unknown kind, so a
  // deleted key would still answer, in ascii, and pass the purity check above on its own.
  assert.equal(new Set(out.marks).size > 1, true,
    'every mark answered the same glyph — the table has lost its keys and is falling back');
  assert.equal(out.bar.length, 10);
  assert.ok([...out.bar].every((c) => '#-'.includes(c)), out.bar);
});

test('the spinner is static when motion is off, and whirls when it is on', () => {
  // The calm tiers must not emit a braille frame: `spin` has to be tick-INDEPENDENT there, or
  // a per-keypress redraw flickers.
  //
  // FOUR CONSECUTIVE TICKS, not two, and the widening came from `test_pure_function_parity.py`'s
  // `TheDisplayTiersAreThreeAndTheCorpusReachesTwo` on its way here: two frames prove the emoji
  // tier is not CONSTANT, four prove it is not a two-frame blink either, and the calm tiers owe
  // the same run length or "static" is asserted over a shorter window than "moving".
  assert.deepEqual(inTier(PLAIN, '[0,1,2,3].map(m.spin)'), ['·', '·', '·', '·'],
    'the plain tier animated');
  assert.deepEqual(inTier(ASCII, '[0,1,2,3].map(m.spin)'), ['-', '-', '-', '-'],
    'the ascii tier animated');
  const anim = inTier(EMOJI, '[0,1,2,3].map(m.spin)');
  assert.equal(new Set(anim).size, 4, `the emoji tier repeated a frame in four ticks: ${anim}`);
  for (const f of anim) assert.ok('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'.includes(f), JSON.stringify(f));
});

// ---------------------------------------------------------------------------------------------
// THE TIER IS A PARTITION OF THREE — `tests/test_pure_function_parity.py`'s
// `TheDisplayTiersAreThreeAndTheCorpusReachesTwo`, which the corpus above it could not carry.
//
// WHY IT WAS EVER A SEPARATE CLASS. The probe corpus varies `GENESEED_TUI_ASCII` only, so every
// glyph function is compared across TWO of its three tiers, and a cross-implementation equality
// is blind to a fault both sides share: two ports that ignored the tier entirely agree on every
// row. The reference answered that by stating what each tier must ANSWER, in one extra process
// per tier rather than by adding a third axis to a corpus of a thousand cases — the middle tier
// needs proving to be a distinct third answer, not that a hundred unrelated functions still
// agree in it. Both halves of that argument survive the reference; only the equality does not.

test('each tier answers with its own glyphs', () => {
  // `mark('ok')` is here and nowhere else in this file: the ascii-purity test above sweeps
  // pending/edited/added/missing and the three mcp keys, so the one mark the status panel uses
  // most had no tier assertion at all.
  assert.deepEqual(inTier(EMOJI, "[m.icon('agent'), m.mark('ok'), m.spin(1)]"),
    ['🤖', '✅', '⠙']);
  // `·`, not a braille frame: the animation flag follows the EMOJI tier, so PLAIN is a CALM tier
  // and not merely a de-emojified one. The reference's first draft of this row asserted `⠙` here
  // — its own expectation contradicting the tier contract asserted two tests below it.
  assert.deepEqual(inTier(PLAIN, "[m.icon('agent'), m.mark('ok'), m.spin(1)]"),
    ['◆', '✓', '·']);
  assert.deepEqual(inTier(ASCII, "[m.icon('agent'), m.mark('ok'), m.spin(1)]"),
    ['@', '+', '-']);
});

test('the three tiers are three and not two', () => {
  // The control the row above needs: if PLAIN collapsed onto either neighbour the assertions
  // would still read as three named tiers while the code had two.
  const answer = (tier) => inTier(tier, "[m.icon('agent'), m.mark('ok'), m.spin(1)]");
  const [emoji, plain, ascii] = [answer(EMOJI), answer(PLAIN), answer(ASCII)];
  assert.notDeepEqual(emoji, plain, 'the plain tier collapsed onto the emoji tier');
  assert.notDeepEqual(plain, ascii, 'the plain tier collapsed onto the ascii tier');
});

test('the logo changes ink with the tier', () => {
  // And the axis is narrower than the tier: the logo is drawn in blocks in BOTH non-ascii tiers,
  // so this is the one place the three-way partition is really a two-way one. Measured rather
  // than assumed — the reference asserted only the emoji and ascii ends.
  const row = (tier) => inTier(tier, 'm.logoLines()[0]');
  assert.ok(row(EMOJI).includes('█'), row(EMOJI));
  assert.ok(row(PLAIN).includes('█'), 'the plain tier drew the logo in ascii ink');
  assert.ok(row(ASCII).includes('#'), row(ASCII));
  assert.ok(!row(ASCII).includes('█'), 'the ascii tier drew the logo in block ink');
});

test('the progress bar is exactly its width at every fraction', () => {
  // Sub-cell (eighths) fills are the interesting ones: the bar must stay exactly `width`
  // display columns at any fraction, or it drifts the layout around it as it fills.
  for (const frac of [0.0, 0.03, 0.1, 0.5, 0.99, 1.0]) {
    assert.equal(dwidth(progressBar(frac, 24)), 24, `fraction ${frac}`);
  }
});
