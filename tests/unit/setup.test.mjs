// `tests/test_harness.py`'s SETUP tier — the wizard's argv, its voice, the LSP prerequisite it
// surfaces, and the inventory behind the catalogue.
//
// WHAT THE DROPPED PANEL TOOK AND WHAT IT DID NOT, because this block straddles the line and
// getting it wrong in either direction loses coverage or invents it:
//
//   * `setupBuildArgs`, `setupSummaryLines`, `javaMajorOk`, `lspPrereqs`, `themeFlair`,
//     `tuiInventory`, `tuiEntries` and `detailLines` ALL CROSSED. The last four live in
//     `js/tui.mjs` and `js/inventory.mjs` — the module refuses to open a SCREEN, it did not
//     stop being where the shared helpers live, and the web console is their caller now.
//   * `_setup_done_title` and `_setup_done_lines` did NOT cross, and three tests retire with
//     them. They compose the wizard's full-screen DONE panel: an `art` row carrying the
//     theme's banner, a `dim` row carrying its benediction, and a title with the sigil's
//     leading glyph stripped so the bar's badge is not doubled. That is panel chrome for a
//     panel that no longer exists. The FACTUAL half those tests assert is still in the middle
//     of the screen — `setupSummaryLines` — and it is gated below on its own terms.
//     `tests/unit/no_panel.test.mjs` keeps the screen gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { setupBuildArgs } from '../../js/generate.mjs';
import { doctrineOptions, javaMajorOk, lspPrereqs, setupSummaryLines } from '../../js/setup.mjs';
import { themeFlair, tuiEntries, detailLines } from '../../js/tui.mjs';
import { tuiInventory } from '../../js/inventory.mjs';
import { themeFiles } from '../../js/installs.mjs';
import { SRC, PACK_ORDER, discoverNames } from '../../js/checkout.mjs';

const themeNames = () => themeFiles().map((p) => path.basename(p, '.json'));

// ---------------------------------------------------------------------------------------------
// The wizard's argv.
//
// `--footprint` IS ALWAYS SPELLED OUT. It used to be elided when it matched the generator's own
// default, which tied the wizard's answer to that default: when the default moved to `lean`,
// choosing `full` would have produced a lean install. The elision is the bug; the redundancy is
// the fix.

test('a global emit omits --out and --root', () => {
  assert.deepEqual(setupBuildArgs('neutral', 'opencode-global', 'x', 'y'),
    ['--theme', 'neutral', '--emit', 'opencode-global', '--footprint', 'lean']);
});

test('a files emit carries --out', () => {
  assert.deepEqual(setupBuildArgs('imperial', 'files', 'Bundle', null),
    ['--theme', 'imperial', '--emit', 'files', '--out', 'Bundle', '--footprint', 'lean']);
});

test('a project emit carries --out and --root', () => {
  assert.deepEqual(setupBuildArgs('neutral', 'opencode', 'repo', 'repo'),
    ['--theme', 'neutral', '--emit', 'opencode', '--out', 'repo', '--root', 'repo',
      '--footprint', 'lean']);
});

test('an explicit full survives the lean default', () => {
  // The regression the elision would have caused, pinned directly.
  assert.ok(setupBuildArgs('neutral', 'opencode-global', null, null, 'full').includes('full'));
});

// ---------------------------------------------------------------------------------------------
// The doctrines elision, which is the only one of the four that compares a SET against a default
// that is itself a list. Three states, and the middle one is the one a `!== 'peer'` copy loses:
// `null` (no opinion, no flag) is NOT the same as `[]` (a deliberate empty selection).

const ARGS = (doctrines, allPacks = PACK_ORDER) => setupBuildArgs('neutral', 'opencode-global',
  null, null, 'lean', 'peer', 'direct', doctrines, allPacks);

test('a full pack selection elides --doctrines and no selection at all elides it too', () => {
  // Both take the flag off the command line, and they mean different things: an unasked build
  // falls back to `harness.config.json`, while an "all four" answer happens to agree with it.
  // They are the same ARGV on purpose — a flag that restated the default would couple the
  // answer to it, which is the exact bug `--footprint`'s docblock exists to describe.
  assert.ok(!ARGS(null).includes('--doctrines'));
  assert.ok(!ARGS([...PACK_ORDER]).includes('--doctrines'));
  // ...and order is not what makes them equal: the set is.
  assert.ok(!ARGS([...PACK_ORDER].reverse()).includes('--doctrines'));
});

test('a narrowed selection is passed, in PACK_ORDER, and an empty one is spelled none', () => {
  assert.deepEqual(ARGS(['rigor', 'craft']).slice(-2), ['--doctrines', 'craft,rigor']);
  assert.deepEqual(ARGS(['process']).slice(-2), ['--doctrines', 'process']);
  // The empty list cannot be `--doctrines ` — the driver's parser rejects that as a usage
  // error — so it has to become the literal `none` it also accepts.
  assert.deepEqual(ARGS([]).slice(-2), ['--doctrines', 'none']);
});

test('the elision default is the one passed in, not one this function reached for', () => {
  // `setupBuildArgs` is pure and has no discovery. Hand it a checkout with three packs and
  // "all three" must still elide — a function that compared against its own frozen `PACK_ORDER`
  // would emit `--doctrines craft,rigor,ops` here and pin an install to a list that stops being
  // "all of them" the moment a fourth pack file lands.
  const three = ['craft', 'rigor', 'ops'];
  assert.ok(!ARGS([...three], three).includes('--doctrines'));
  // ...and the same selection against the real four-pack default is a genuine narrowing.
  assert.deepEqual(ARGS([...three]).slice(-2), ['--doctrines', 'craft,rigor,ops']);
});

test('the wizard menu lists every shipped pack, in narrative order, each with a blurb', () => {
  // `doctrineOptions` orders by `PACK_ORDER` and takes membership from discovery. Ordering by
  // discovery instead yields `craft, ops, process, rigor` — it `.sort()`s — and the menu would
  // stop matching the `Active packs:` marker the build normalises into `PACK_ORDER`.
  const opts = doctrineOptions();
  assert.deepEqual(opts.map(([n]) => n),
    PACK_ORDER.filter((p) => discoverNames('doctrines', PACK_ORDER[0]).includes(p)));
  assert.deepEqual(opts.map(([n]) => n), ['craft', 'rigor', 'ops', 'process']);
  for (const [name, blurb] of opts) {
    assert.ok(blurb.length > 20, `pack ${name} has no usable blurb: ${JSON.stringify(blurb)}`);
  }
  // Turning `process` off is what removes the commit/push consent gate. The one blurb that has
  // to say what it costs, asserted so it cannot quietly stop saying it.
  const process$ = opts.find(([n]) => n === 'process');
  assert.match(process$[1], /consent gate on every commit and push/);
});

// ---------------------------------------------------------------------------------------------
// The wizard's voice. The theme is picked first, and everything after it speaks in that voice.

const VALID_ACCENTS = new Set(['cyan', 'yellow', 'red', 'green', 'magenta', 'blue', 'white']);

test('every theme supplies a full set of flair', () => {
  // Parity: each theme must give the wizard a usable voice, not blanks.
  const names = themeNames();
  assert.ok(names.length > 1, `only ${names.length} themes found — this loop proves nothing`);
  for (const t of names) {
    const f = themeFlair(t);
    assert.ok(VALID_ACCENTS.has(f.accent), `${t}: accent ${JSON.stringify(f.accent)}`);
    assert.ok(f.tagline, `${t}: no tagline`);
    assert.ok(f.sigil, `${t}: no sigil`);
    assert.ok(f.banner.length && f.banner.every((ln) => typeof ln === 'string'),
      `${t}: banner is ${JSON.stringify(f.banner)}`);
    assert.ok(f.benediction, `${t}: no benediction`);
  }
});

test('an unknown theme degrades safely rather than throwing', () => {
  const f = themeFlair('no-such-theme');
  assert.equal(f.accent, 'cyan');
  assert.equal(f.tagline, '');
  // `[]`, not `['']` — `pySplitLines` on the empty string, which is the difference between a
  // themeless banner and a banner made of one blank row.
  assert.deepEqual(f.banner, []);
});

// ---------------------------------------------------------------------------------------------
// The one prerequisite the wizard checks, and the emit it belongs to.

test('the java major version parses on both numbering schemes', () => {
  // Modern scheme: the major is the leading number. Legacy `1.x`: the major is 1, so `1.8`
  // must FAIL a `>= 21` test rather than reading as "version 8".
  assert.equal(javaMajorOk('openjdk version "21.0.2" 2024-01-16'), true);
  assert.equal(javaMajorOk('java version "24" 2025-03-18'), true);
  assert.equal(javaMajorOk('java version "1.8.0_392"'), false);
  assert.equal(javaMajorOk('no version string here'), false);
});

test('the prereq list has one row with a bool and a hint', () => {
  const prereqs = lspPrereqs();
  assert.equal(prereqs.length, 1);
  const [label, present, hint] = prereqs[0];
  assert.equal(typeof label, 'string');
  // The VALUE is machine-dependent — whether a JDK is installed here is not the claim — but
  // the TYPE is not: a null would render as a blank tick rather than a cross.
  assert.equal(typeof present, 'boolean');
  assert.ok(hint.includes('JDK 21'), hint);
});

test('the LSP line is surfaced for an opencode emit and not for a portable one', () => {
  const text = (rows) => rows.map(([, t]) => t).join(' ');
  const oc = text(setupSummaryLines('neutral', 'opencode', null, '.', true));
  const files = text(setupSummaryLines('neutral', 'files', 'Bundle', null, true));
  assert.ok(oc.includes('Java 21+ (jdtls)'), oc);
  assert.ok(!files.includes('Java 21+ (jdtls)'),
    'the portable bundle advertised a language server it does not wire');
});

// ---------------------------------------------------------------------------------------------
// The inventory behind the catalogue.

/** `src/<folder>/*.md` minus `_`-scaffolds, derived here rather than borrowed from the port. */
const specStems = (folder) => fs.readdirSync(path.join(SRC, folder))
  .filter((n) => n.endsWith('.md') && !n.startsWith('_'));

test('the inventory counts match the source tree and every entry has a body', () => {
  const inv = tuiInventory('neutral');
  // DERIVED, not borrowed: the reference compares against `_src_stems`, the port's own
  // function, which any function satisfies as long as it is used on both sides.
  assert.equal(inv.agents.length, specStems('agents').length);
  assert.equal(inv.skills.length, specStems('skills').length);
  // And the law count is parsed rather than transcribed — the reference hard-codes 37.
  const laws = [...fs.readFileSync(path.join(SRC, 'laws', 'universal.md'), 'utf8')
    .matchAll(/^### \{\{LAW\}\} ([IVXLCDM]+)\b/gm)].length;
  assert.equal(inv.laws.length, laws);
  // THE FLOOR IS NOW AN EQUALITY, because the corpus stopped growing. `> 30` was a guard
  // against the regex silently matching nothing while the derived equality above stayed
  // vacuously true. The three-tier split fixed the corpus at NINE invariants — the doctrine
  // packs carry the rest — so the same guard is stated exactly rather than as a floor.
  assert.equal(laws, 9, `${laws} laws parsed — expected the nine invariants`);

  assert.ok(inv.agents.every((e) => e.desc && e.body), 'an agent entry has no desc or body');
  assert.ok(inv.skills.every((e) => e.desc && e.body), 'a skill entry has no desc or body');
  assert.ok(inv.laws.every((l) => l.title && l.body), 'a law entry has no title or body');
});

test('the entry rows carry every kind, and a selection yields real detail', () => {
  const inv = tuiInventory('neutral');
  const rows = tuiEntries(inv);
  assert.deepEqual(new Set(rows.map(([k]) => k)), new Set(['head', 'agent', 'skill', 'law']));
  const heads = rows.filter(([k]) => k === 'head').map(([, l]) => l);
  assert.ok(heads.some((h) => h.startsWith('AGENTS')), JSON.stringify(heads));
  // Selecting a law yields multi-line detail: the title AND the body, not just the label.
  const lawRow = rows.find(([k]) => k === 'law');
  assert.ok(detailLines(...lawRow).length > 2, 'a law rendered as one line');
  // An agent's detail is its full rendered spec.
  const agentRow = rows.find(([k]) => k === 'agent');
  assert.ok(detailLines(...agentRow).some((ln) => ln.includes('##') || ln.includes('When')),
    'an agent detail does not look like a rendered spec');
});
