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
import { catalogLines } from '../../js/catalog.mjs';
import { tuiInventory } from '../../js/inventory.mjs';
import { doctrinesForBuild, doctrinesOfDir, themeFiles } from '../../js/installs.mjs';
import { ROOT, SRC, PACK_ORDER, discoverNames } from '../../js/checkout.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

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
// The doctrines flag, which is the only one of the four that carries a SET — and the only one
// whose absence lands on a CONFIG-DRIVEN default rather than a frozen literal. Two states:
// `null` (no opinion, no flag) is NOT the same as `[]` (a deliberate empty selection).

const ARGS = (doctrines, allPacks = PACK_ORDER) => setupBuildArgs('neutral', 'opencode-global',
  null, null, 'lean', 'peer', 'direct', doctrines, allPacks);

test('a KNOWN pack selection is always passed — never elided against any default', () => {
  // ⚠ THE REGRESSION THIS PINS IS THE ONE THAT SHIPPED. `--doctrines` used to elide when the
  // selection equalled the full pack list, by analogy with `--posture`/`--mode`. Those two
  // compare against a FROZEN LITERAL; a missing `--doctrines` lands on `configDefaults()`,
  // which reads `harness.config.json`. So with `{"doctrines":["craft"]}` in that file, an
  // install carrying all four packs was re-emitted by `upgrade` carrying ONE — and losing the
  // process pack takes the commit/push consent gate off an install whose owner never asked.
  //
  // The property is therefore not "the full set is spelled out": it is that the argv NAMES the
  // selection for every selection a caller actually knows, so no reader of it has to consult a
  // file that may have moved underneath. Restoring any elision fails all four of these.
  for (const sel of [[...PACK_ORDER], [...PACK_ORDER].reverse(), ['craft'], []]) {
    assert.ok(ARGS(sel).includes('--doctrines'),
      `a known selection went unspoken and will be re-read from harness.config.json: ${sel}`);
  }
  // The one legitimate elision, and the only one: nothing was read back off an install, so the
  // caller has no opinion to state and the generator's own config default is the right answer.
  assert.ok(!ARGS(null).includes('--doctrines'));
});

test('a selection is passed in PACK_ORDER, and an empty one is spelled none', () => {
  assert.deepEqual(ARGS(['rigor', 'craft']).slice(-2), ['--doctrines', 'craft,rigor']);
  assert.deepEqual(ARGS(['process']).slice(-2), ['--doctrines', 'process']);
  assert.deepEqual(ARGS([...PACK_ORDER]).slice(-2),
    ['--doctrines', 'craft,rigor,ops,process']);
  // Order is not what the canonicalisation preserves: the SET is, re-ordered through the pack
  // order, because the `Active packs:` marker the build writes is compared against itself.
  assert.deepEqual(ARGS([...PACK_ORDER].reverse()).slice(-2),
    ['--doctrines', 'craft,rigor,ops,process']);
  // The empty list cannot be `--doctrines ` — the driver's parser rejects that as a usage
  // error — so it has to become the literal `none` it also accepts.
  assert.deepEqual(ARGS([]).slice(-2), ['--doctrines', 'none']);
});

test('every RE-EMIT of an existing install states its pack selection', () => {
  // The flag being un-elidable (above) only helps a caller that PASSES it. `migrate`'s re-emit
  // loop called `setupBuildArgs` with seven arguments and no selection — so a migration read
  // theme, emit, footprint, posture and mode back off each install and then handed the sixth
  // register to `harness.config.json`, silently WIDENING a constitution its owner had cut down.
  // Its own comment ("same reads as `cmdRebuildAll`") had gone false without anything failing.
  //
  // A source gate rather than a fixture, because both loops walk the machine's real install
  // registry: what is actually being asserted is that neither call site can quietly lose the
  // argument again, and that is a property of the call, not of a run.
  for (const rel of JS_SOURCES.filter((r) => /setupBuildArgs\(/.test(readSrc(r)))) {
    const src = readSrc(rel);
    const calls = [...src.matchAll(/setupBuildArgs\(([\s\S]*?)\);/g)].map((m) => m[1]);
    for (const args of calls) {
      if (/^\s*$/.test(args)) continue;                    // the declaration, not a call
      assert.ok(/doctrines/.test(args),
        `${rel} re-emits an install without naming its packs: setupBuildArgs(${args})`);
    }
    // ...and NAMING them is not the same as RESOLVING them. `apiDeployCmd` satisfied the check
    // above with `const doctrines = bodyDoctrines(body);` — a local whose value is `null` for
    // every Deploy the console actually sends, because that form posts host/path/theme/
    // footprint/posture/mode and no pack selection. The flag was then elided and the generator
    // fell back to `harness.config.json`; deploying onto an existing all-four Claude install
    // took it to one pack and its `PreToolUse::Bash` hook with it. The gate certified the bug.
    // So the binding on the way IN is asserted too: whatever is handed to `setupBuildArgs` must
    // trace to the fail-closed resolver or to a literal — never to a bare reader that can answer
    // `null`.
    // `askDoctrines()` is exempt, and the exemption is tied to the property that earns it: the
    // wizard's answer is a STATED selection, not an unknown, so there is no install to fail
    // closed about. The cell below proves it cannot answer null; if it ever can, this exemption
    // fails there rather than silently widening the hole here.
    for (const [, name, rhs] of src.matchAll(/(?:const|let)\s+(\w*[Dd]octrines\w*)\s*=\s*([^;]+);/g)) {
      if (!new RegExp(`setupBuildArgs\\([^;]*\\b${name}\\b`).test(src)) continue;
      assert.ok(/doctrinesForBuild|PACK_ORDER|askDoctrines|\[/.test(rhs),
        `${rel}: \`${name}\` reaches setupBuildArgs without the fail-closed resolver — `
        + `\`${rhs.trim()}\` can answer null, which elides the flag and hands the pack set to `
        + 'harness.config.json. Use `doctrinesForBuild(root)` as the fallback.');
    }
  }
  // The one exemption above, kept honest: every return in `askDoctrines` is an array. The
  // parameter list is `[^)]*` and not `\(\)` on purpose — the function grew a `deployed`
  // argument (the wizard now pre-selects the installed packs) and an anchored-empty match
  // would have made this gate VACUOUS rather than red, which is the failure mode a source
  // gate has and a fixture does not.
  const ask = readSrc('js/setup.mjs').match(/function askDoctrines\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(ask, 'askDoctrines has moved — re-site the exemption in the gate above');
  assert.ok(!/return\s+(null|undefined)/.test(ask),
    'askDoctrines can now answer null, so it is no longer a stated selection — it must go '
    + 'through doctrinesForBuild like every other consumer, and lose its exemption above');
  // The set it walks must not be able to go empty — a rename would pass this gate vacuously.
  assert.ok(JS_SOURCES.some((r) => /setupBuildArgs\(/.test(readSrc(r))),
    'nothing calls setupBuildArgs any more — move this gate');
});

// ---------------------------------------------------------------------------------------------
// ⚠ INVARIANT 1 — "unknown" resolves to ALL PACKS, never to a config value.
//
// `doctrinesOfDir` answers `null` for "this install does not say", and its docblock puts the
// obligation on the reader: read it as the process pack being ACTIVE. Every consumer instead
// wrote `?? defaultDoctrines()`, which reads `harness.config.json` — so with
// `{"doctrines":["craft"]}` in that file, `upgrade`/`rebuild-all`/`migrate`/the web console
// re-emitted EVERY pre-2.3 install at one pack and took its commit/push consent gate off. The
// reader had been made fail-closed into consumers that were not, and hardening it (a folded
// marker now answers `null` too) widened the hole rather than narrowing it.
//
// The two cells below are written to catch a consumer added LATER, not only the five that had
// it: one bans the config-backed fallback from the source outright, the other measures the
// resolver against a real config file that says something narrower.

const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** A throwaway directory, removed even when the body throws. `makeSandbox` resolves the
 *  8.3/symlink split that a bare `mkdtemp` under the system temp root reintroduces. */
function withDir(fn) {
  const sb = makeSandbox('geneseed-packs-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/** Every shipped `.mjs` under `js/` and `bin/` — the whole build side, not a hand-kept list. */
const JS_SOURCES = (function walk(dir, acc = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, acc);
    else if (e.name.endsWith('.mjs')) acc.push(rel);
  }
  return acc;
}('js', (function walkBin(acc) {
  for (const e of fs.readdirSync(path.join(ROOT, 'bin'), { withFileTypes: true })) {
    if (e.name.endsWith('.mjs')) acc.push(`bin/${e.name}`);
  }
  return acc;
}([]))));

test('no build-side consumer can resolve an unknown pack set out of harness.config.json', () => {
  // THE GATE IS ON THE SOURCE BECAUSE THE DEFECT IS A HABIT. Any consumer may read the config
  // for theme, posture or mode — the worst a wrong answer does there is cosmetic. The pack
  // selection decides whether a boundary is installed, so the config key has exactly ONE
  // legitimate reader: `configDefaults()` in `bin/geneseed.mjs`, which answers `geneseed build`
  // — the case where there is no install to ask. Anything else holding a directory calls
  // `doctrinesForBuild`, whose `null` arm is `[...PACK_ORDER]`.
  assert.ok(JS_SOURCES.length > 20, `the source walk found ${JS_SOURCES.length} files`);
  assert.ok(JS_SOURCES.includes('js/installs.mjs') && JS_SOURCES.includes('bin/geneseed.mjs'));
  for (const rel of JS_SOURCES) {
    const src = readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/defaultDoctrines/.test(src),
      `${rel} resolves an install's packs out of harness.config.json — unknown must resolve `
      + 'to the FULL pack set (js/installs.mjs `doctrinesForBuild`), never to a config value');
    if (rel === 'bin/geneseed.mjs') continue;      // configDefaults: the no-install-to-ask case
    assert.ok(!/configuredDefault\(\s*'doctrines'/.test(src),
      `${rel} reads the doctrines config key directly — see above`);
  }
});

test('an unknown pack set resolves to ALL packs even when the config names fewer', () => {
  // THE VERDICT'S OWN SCENARIO, measured rather than argued: a markerless install (every
  // pre-2.3 one) and a `harness.config.json` that names one pack. The resolver must answer all
  // four, so the re-emit keeps the gate; the config value must reach it by no route at all.
  withDir((d) => {
    assert.equal(doctrinesOfDir(d), null, 'the fixture is not markerless');
    assert.deepEqual(doctrinesForBuild(d), [...PACK_ORDER]);
    // A folded/corrupt marker is the input the hardened reader added, and it lands here too.
    fs.writeFileSync(path.join(d, 'AGENT.md'), 'Active packs: craft, rigor,\nops, process\n');
    assert.equal(doctrinesOfDir(d), null, 'the fixture is not a corrupt marker');
    assert.deepEqual(doctrinesForBuild(d), [...PACK_ORDER]);
    // A marker that DOES read is an answer and passes through untouched — including `none`,
    // which is a deliberate empty selection and not a silence.
    fs.writeFileSync(path.join(d, 'AGENT.md'), 'Active packs: craft\n');
    assert.deepEqual(doctrinesForBuild(d), ['craft']);
    fs.writeFileSync(path.join(d, 'AGENT.md'), 'Active packs: none\n');
    assert.deepEqual(doctrinesForBuild(d), []);
  });
});

test('the canonical order is the one passed in, not one this function reached for', () => {
  // `setupBuildArgs` is pure and has no discovery, which is why `allPacks` survived the
  // elision's removal: it is what orders the flag. Hand it a checkout with three packs and the
  // value is spelled in THAT order, not in this module's frozen `PACK_ORDER`.
  const three = ['ops', 'craft', 'rigor'];
  assert.deepEqual(ARGS(['craft', 'ops'], three).slice(-2), ['--doctrines', 'ops,craft']);
  assert.deepEqual(ARGS([...three], three).slice(-2), ['--doctrines', 'ops,craft,rigor']);
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

test('the inventory carries all three tiers, and the pack ids are contiguous', () => {
  // Every count is DERIVED from the source the same way the law count above is — a transcribed
  // 23 would go stale the first time a rule is added, and would then be testing the number
  // rather than the parse.
  const inv = tuiInventory('neutral');
  assert.deepEqual(inv.ontology.map((s) => s.id), ['telos', 'evidence', 'decisions', 'conduct']);
  assert.ok(inv.ontology.every((s) => s.title && s.body), 'an ontology section has no body');

  // ⚠ FOUR PACKS, NOT FIVE, AND IN NARRATIVE ORDER. `src/doctrines/README.md` passes the
  // `_`-scaffold filter, so publishing whatever the walk found would put a fifth pack with zero
  // rules in the catalogue; `PACK_ORDER` is the single owner of both the set and the order, and
  // this equality is the cell that reddens if the list is ever built from the walk instead. The
  // existence check keeps it from passing vacuously once the README is gone.
  assert.deepEqual(inv.doctrines.map((p) => p.pack), [...PACK_ORDER]);
  assert.ok(fs.existsSync(path.join(SRC, 'doctrines', 'README.md')),
    'the README that makes the assertion above non-vacuous is gone — re-site this gate');
  assert.notDeepEqual([...PACK_ORDER], [...PACK_ORDER].sort(),
    'PACK_ORDER is now in alphabetical order, so this cell no longer tells the narrative order '
    + 'from what discovery would have produced');

  for (const p of inv.doctrines) {
    const src = fs.readFileSync(path.join(SRC, 'doctrines', `${p.pack}.md`), 'utf8');
    const want = [...src.matchAll(/^### \{\{DOCTRINE\}\} (\w+) (\d+)\b/gm)];
    assert.equal(p.rules.length, want.length, `${p.pack}: parsed ${p.rules.length} of ${want.length}`);
    assert.ok(p.rules.length > 0, `${p.pack} parsed to no rules at all`);
    // Contiguous from 1, and every rule filed under the pack whose file it is in. The `pack`
    // field is read from the HEADING, so this is the cell that catches a rule mis-addressed as
    // `ops 3` inside `craft.md` rather than letting its container silently rename it.
    assert.deepEqual(p.rules.map((r) => r.n), p.rules.map((_, i) => i + 1),
      `${p.pack}'s rule ids are not 1..${p.rules.length}`);
    assert.ok(p.rules.every((r) => r.pack === p.pack),
      `${p.pack}.md contains a rule addressed to another pack`);
    // The pack id IS the class — there is no six-class chip over a doctrine rule.
    assert.ok(p.rules.every((r) => r.klass === p.pack && r.title && r.body),
      `${p.pack} has a rule with no title, no body, or a class that is not its pack`);
    assert.ok(p.title && p.desc, `${p.pack} has no themed name or blurb`);
  }
  // 9 + 23 + the four absorbed-into-prose sections is the whole constitution.
  assert.equal(inv.doctrines.reduce((n, p) => n + p.rules.length, 0), 23);
});

test('every theme parses to the same three tiers, whatever it calls them', () => {
  // ⚠ THE TIER NOUN IS THEMED AND BOTH HEADING REGEXES MATCH IT WITH `\\S+`. A theme whose
  // `DOCTRINE` value is two words does not error — it stops matching, and that pack parses to
  // ZERO rules while everything downstream reports a smaller constitution in perfect silence.
  // Nothing but running all fourteen can see it, so all fourteen are run.
  const counts = (inv) => [inv.laws.length, inv.ontology.length, inv.doctrines.length,
    inv.doctrines.reduce((n, p) => n + p.rules.length, 0)];
  const base = counts(tuiInventory('neutral'));
  assert.deepEqual(base, [9, 4, 4, 23]);
  for (const t of themeNames()) {
    const inv = tuiInventory(t);
    assert.deepEqual(counts(inv), base, `${t} parses to a different constitution`);
    // The ontology's ids are ADDRESSES — a deep link must survive a theme change — so they
    // come from STRUCTURE and must be identical in every voice. The pack TITLES are themed and
    // deliberately differ; only the ids are pinned.
    assert.deepEqual(inv.ontology.map((s) => s.id),
      ['telos', 'evidence', 'decisions', 'conduct'], `${t} renamed an ontology address`);
    assert.deepEqual(inv.doctrines.map((p) => p.pack), [...PACK_ORDER],
      `${t} renamed a pack address`);
  }
  assert.ok(themeNames().length >= 14, 'the theme list went short — this gate is now weaker');
});

test('a pack is listed whether or not it is built in, and only `active` moves', () => {
  // THE WHOLE CATALOGUE SHIPS IN EVERY BUNDLE, which is what lets a cross-pack citation resolve
  // when its pack is off and what lets the console offer the command to turn one back on. So a
  // narrowed selection must not shorten the list — if it did, an inactive pack would be
  // indistinguishable from one that does not exist.
  const all = tuiInventory('neutral');
  const one = tuiInventory('neutral', ['craft']);
  const none = tuiInventory('neutral', []);
  for (const inv of [all, one, none]) {
    assert.deepEqual(inv.doctrines.map((p) => p.pack), [...PACK_ORDER], 'a pack left the catalogue');
    assert.deepEqual(inv.doctrines.map((p) => p.rules.length),
      all.doctrines.map((p) => p.rules.length), 'a narrowed build lost a pack\'s rules');
  }
  assert.deepEqual(all.doctrines.map((p) => p.active), [true, true, true, true]);
  assert.deepEqual(one.doctrines.map((p) => p.active), [true, false, false, false]);
  assert.deepEqual(none.doctrines.map((p) => p.active), [false, false, false, false]);
  // ⚠ `null` IS NOT `[]`. No argument means "no install to ask" and resolves to every pack, the
  // same answer `doctrinesForBuild` gives an unknown; an explicit empty list is a stated
  // `--doctrines none`. `catalog`, `status` and the graph all pass nothing, so a reader that
  // collapsed the two would report every pack inactive on three verbs at once.
  assert.deepEqual(tuiInventory('neutral', null).doctrines.map((p) => p.active),
    [true, true, true, true], 'unknown was read as none');
});

test('the entry rows carry every kind, and a selection yields real detail', () => {
  const inv = tuiInventory('neutral');
  const rows = tuiEntries(inv);
  assert.deepEqual(new Set(rows.map(([k]) => k)),
    new Set(['head', 'agent', 'skill', 'ontology', 'law', 'doctrine']));
  const heads = rows.filter(([k]) => k === 'head').map(([, l]) => l);
  assert.ok(heads.some((h) => h.startsWith('AGENTS')), JSON.stringify(heads));
  // The constitution reads in ITS order, not alphabetically and not in walk order: ontology,
  // then invariants, then doctrines — the order AGENT.md renders them and the order the
  // console's three bands appear in.
  const at = (p) => heads.findIndex((h) => h.startsWith(p));
  assert.ok(at('ONTOLOGY') > 0 && at('ONTOLOGY') < at('LAWS') && at('LAWS') < at('DOCTRINES'),
    `the tiers are out of constitutional order: ${JSON.stringify(heads)}`);
  // The doctrines head names the FRACTION, because an inactive pack is still listed — greyed
  // rather than gone — and a bare total over a narrowed install would be the one lying number.
  assert.match(heads.find((h) => h.startsWith('DOCTRINES')), /\(\d+ in \d+\/\d+ packs\)/);
  // Every constitutional kind yields multi-line detail: the title AND the body, not the label.
  for (const kind of ['law', 'doctrine', 'ontology']) {
    const row = rows.find(([k]) => k === kind);
    assert.ok(row, `no ${kind} row at all`);
    assert.ok(detailLines(...row).length > 2, `a ${kind} rendered as one line`);
  }
  // An agent's detail is its full rendered spec.
  const agentRow = rows.find(([k]) => k === 'agent');
  assert.ok(detailLines(...agentRow).some((ln) => ln.includes('##') || ln.includes('When')),
    'an agent detail does not look like a rendered spec');
});

test('a pack that is not built in is listed and MARKED, never quietly dropped', () => {
  // ⚠ THE ONE THING THE CATALOGUE MUST NOT DO IS HIDE AN INACTIVE PACK. Hiding it makes "off"
  // indistinguishable from "never existed", and the reader cannot then tell a constitution
  // they narrowed from one that shipped smaller. So every rule is always listed, the head
  // carries the fraction, and the badge says `(off)` — which is the only part of the row a
  // reader cannot infer from the text.
  const rows = tuiEntries(tuiInventory('neutral', ['craft']));
  const doctrine = rows.filter(([k]) => k === 'doctrine');
  assert.equal(doctrine.length, 23, 'a narrowed install lost rows instead of marking them');
  const off = doctrine.filter(([, , d]) => d.active === false);
  assert.equal(off.length, 17, 'the inactive packs are not marked inactive');
  assert.ok(doctrine.every(([, , d]) => (d.pack === 'craft') === (d.active === true)),
    'the active flag does not follow the selection');
  const head = rows.filter(([k]) => k === 'head').find((h) => h[1].startsWith('DOCTRINES'));
  assert.equal(head[1], 'DOCTRINES (6 in 1/4 packs)', head[1]);
  // ...and the badge column says so, which is what a reader of `geneseed catalog` sees.
  const lines = catalogLines(tuiInventory('neutral', ['craft']), 'doctrines', 200);
  assert.ok(lines.some((l) => l.includes('(off)')), 'no row is marked off in the listing');
  assert.ok(lines.some((l) => /rigor \(off\)/.test(l)), lines.slice(0, 4).join('\n'));
  assert.ok(!catalogLines(tuiInventory('neutral'), 'doctrines', 200).some((l) => l.includes('(off)')),
    'an all-packs install marked something off');
});
