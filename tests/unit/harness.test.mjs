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
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  LEARN_PROMPT_HEAD, frontmatter, readNotes, existingSlugs, writeMemories,
} from '../../js/hooks.mjs';
import {
  themeParityProblems, countTableProblems, proseMirrorProblems, lawMetaProblems, romanToInt,
  themesToCheck,
} from '../../js/doctor.mjs';
import { themeOfDir } from '../../js/installs.mjs';
import { LAW_CLASS, LAW_CLASSES } from '../../js/inventory.mjs';
import { PLUGIN_SRC, ROOT, SRC } from '../../js/checkout.mjs';
import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';

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

// ---------------------------------------------------------------------------------------------
// THE AUTHORING GATES' OWN SELF-TESTS, and the fixture that made them portable.
//
// THE MONKEYPATCH HAD NO ESM EQUIVALENT, and this is the third shape from the porting rule
// rather than a fourth. The reference corrupts a theme by assigning `_build_core.THEMES = tmp`
// and a source tree by assigning `_build_core.SRC = tmp` — Python has no privacy to stop it.
// `js/doctor.mjs` imports `SRC` and `THEMES` as bindings from `js/checkout.mjs`, where they are
// derived from `import.meta.url`; an imported binding cannot be rebound, and there is no
// environment variable that moves them (`--root` is the emit TARGET, not the source tree). So
// the injection point the reference used simply does not exist here.
//
// WHAT REPLACES IT IS DISCOVERY, WHICH IS WHAT THE MONKEYPATCH WAS STANDING IN FOR ALL ALONG:
// copy the checkout, plant the fault in the COPY, and run the gate out of the copy so its own
// `ROOT` resolves there. `tests/helpers/cli_golden.mjs`'s `copyCheckout` already exists for
// exactly this — P5g built it because eleven of doctor's checks read the checkout and no cell
// could plant a fault in two thirds of the verb. Measured: 2010 files in 1.2s, and each gate
// run out of the copy is 0.07s, so one copy for the whole file is cheaper than the emit tests
// that follow it.
//
// AND IT IS STRICTLY STRONGER THAN THE REFERENCE'S FIXTURE. The reference REPLACED the theme
// directory with two or three hand-written files, so its gate never ran against the real set;
// here the fourteen shipped themes stay and the fault is planted BESIDE them, which is the
// arrangement a real drift arrives in.

let FIXTURE = null;

/** One copy of the checkout for this file, built on first use. */
function fixture() {
  if (!FIXTURE) {
    const sb = makeSandbox('gs-fix-');
    copyCheckout(sb.path, {});
    FIXTURE = sb;
  }
  return FIXTURE.path;
}

after(() => { FIXTURE?.cleanup(); });

/**
 * Plant `faults` in the fixture, run `fn`, and put the tree back.
 *
 * RESTORES BOTH DIRECTIONS, because the two kinds of fault undo differently: a file the
 * checkout does not have is deleted again, and one it does have is rewritten from the bytes
 * that were there. A helper that only deleted would leave `src/laws/universal.md` corrupted for
 * every test after it, and the failure would land somewhere else entirely.
 */
function withFault(faults, fn) {
  const root = fixture();
  const saved = new Map();
  for (const [rel, text] of Object.entries(faults)) {
    const p = path.join(root, rel);
    saved.set(rel, fs.existsSync(p) ? fs.readFileSync(p) : null);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  try {
    return fn(root);
  } finally {
    for (const [rel, before] of saved) {
      const p = path.join(root, rel);
      if (before === null) fs.rmSync(p, { force: true });
      else fs.writeFileSync(p, before);
    }
  }
}

/**
 * Evaluate one `js/doctor.mjs` expression INSIDE the copy.
 *
 * A child process, and it has to be: the copy's `doctor.mjs` is a different module URL, so
 * importing it here would load a second copy of the module graph into this process — with a
 * `ROOT` pointing at the fixture — and every later in-process test in this file would then be
 * reading whichever one the import cache handed back.
 */
function gate(root, expr) {
  const url = pathToFileURL(path.join(root, 'js', 'doctor.mjs')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(url)});`
    + `process.stdout.write(JSON.stringify(${expr}));`],
  { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, windowsHide: true });
  if (r.status !== 0) {
    throw new Error(`the gate could not be run from the copy (${r.status}): `
      + `${(r.stderr || '').slice(-1500)}`);
  }
  return JSON.parse(r.stdout);
}

test('the fixture can actually reproduce a clean run', () => {
  // THE CONTROL THE REFERENCE DID NOT NEED AND THIS FILE DOES. Every assertion below reads
  // "the gate flagged the fault I planted"; all of them are equally satisfied by a copy so
  // broken that the gate flags everything. Assert first that the untouched copy is silent —
  // then a problem in a later test is the fault, not the fixture.
  assert.deepEqual(gate(fixture(), 'm.themeParityProblems()'), []);
  assert.deepEqual(gate(fixture(), 'm.countTableProblems()'), []);
});

test('a theme missing a key is flagged', () => {
  const good = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'themes', 'neutral.json'), 'utf8'));
  const broken = { ...good };
  delete broken.VOICE;
  const problems = withFault({ 'themes/broken.json': JSON.stringify(broken) },
    (root) => gate(root, 'm.themeParityProblems()'));
  assert.ok(problems.length, 'a theme missing a key must be flagged');
  assert.ok(problems.some((p) => p.includes('VOICE') && p.includes('broken')),
    `expected a VOICE/broken problem, got ${JSON.stringify(problems)}`);
});

test('a malformed theme is flagged as unreadable', () => {
  const problems = withFault({ 'themes/broken.json': '{ not valid json' },
    (root) => gate(root, 'm.themeParityProblems()'));
  assert.ok(problems.some((p) => p.includes('unreadable')),
    `expected an 'unreadable' problem, got ${JSON.stringify(problems)}`);
});

test('an underscore scaffold is ignored', () => {
  // A `_`-prefixed scaffold (e.g. _TEMPLATE.json) is skipped, so an intentionally partial
  // template never trips the gate.
  const problems = withFault({ 'themes/_TEMPLATE.json': JSON.stringify({ VOICE: '<placeholder>' }) },
    (root) => gate(root, 'm.themeParityProblems()'));
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------------------------
// The count-table gate: the AGENT.md capability tables and the README count badges against
// `src/`. Self-tested both ways — clean on the shipped tree, and actually flagging a mismatch.

test('the shipped tables and badges are consistent', () => {
  assert.deepEqual(countTableProblems(), []);
});

test('the gate flags table and badge drift', () => {
  // ONE EXTRA SPEC FILE, where the reference replaced the whole source tree with three stubs.
  // The claim is the same and the fault is sharper: an agent that exists and is in no table is
  // the drift that actually happens, and it trips BOTH arms at once — the hand-written table
  // omits it and every badge that counts agents is now one short.
  const problems = withFault({ 'src/agents/zzz-fixture-probe.md': '> p\n' },
    (root) => gate(root, 'm.countTableProblems()'));
  assert.ok(problems.length);
  assert.ok(problems.some((p) => p.includes('badge')),
    `no badge problem in ${JSON.stringify(problems)}`);
  assert.ok(problems.some((p) => p.includes('omits') || p.includes('AGENT.md table')),
    `no table problem in ${JSON.stringify(problems)}`);
});

test('the gate flags a law missing from LAW_CLASS', () => {
  // The gate that would have caught the Law XXXV 'craft' fallback: a numeral parsed out of
  // universal.md but absent from LAW_CLASS.
  const laws = fs.readFileSync(path.join(SRC, 'laws', 'universal.md'), 'utf8');
  const problems = withFault({ 'src/laws/universal.md': `${laws}\n### {{LAW}} XL — z\n` },
    (root) => gate(root, 'm.countTableProblems()'));
  assert.ok(problems.some((p) => p.includes('XL') && p.includes('LAW_CLASS')),
    `no XL/LAW_CLASS problem in ${JSON.stringify(problems)}`);
});

test('the gate flags an unknown LAW_CLASS value', () => {
  // NO FIXTURE FOR THIS ONE, and the asymmetry is the point: `LAW_CLASS` is an exported
  // OBJECT, and `const` freezes the binding rather than the contents — so the reference's
  // in-place mutation ports verbatim where its module-level reassignment could not. The
  // restore is in a `finally` because every later test in this process reads the same object.
  const saved = LAW_CLASS.I;
  let problems;
  try {
    LAW_CLASS.I = 'bogus';
    problems = countTableProblems();
  } finally {
    LAW_CLASS.I = saved;
  }
  assert.ok(problems.some((p) => p.includes('bogus')),
    `no 'bogus' problem in ${JSON.stringify(problems)}`);
  assert.deepEqual(countTableProblems(), [], 'the restore did not take');
});

test('the prose mirror gate catches every drift class the badge regex is blind to', () => {
  // Pure over its inputs, so the drift can be crafted without touching the tree — a wrong
  // prose count, a dropped skill name, a stale web law count, and a self-inconsistent
  // 'N repeatable workflows' subset.
  const counts = { laws: 35, agents: 16, skills: 3 };
  const stems = new Set(['alpha', 'beta', 'gamma']);
  const readme = '| **🛡️ Rules** (`laws/`) | 35 universal laws the agent obeys — … |\n'
    + '| **🤖 Agents** (16) | capability specialists: … |\n'
    + '| **🛠 Skills** (3) | repeatable workflows: alpha · **beta** · gamma |\n';
  const web = '- **`AGENT.md`** — 35 universal Rules the agent obeys.\n'
    + '16 capability specialists — reviewer, tester …\n'
    + '35 universal laws the agent obeys — secrets handling …\n'
    + '3 repeatable workflows the agent can invoke by name — '
    + '[[alpha]], [[beta]], [[gamma]]. A skill is a markdown '
    + 'playbook under `src/skills/`.\n';
  const shipped = '| **Laws / Agents / Skills** | 35 laws, 16 agents, 3 skills, … |\n';
  assert.deepEqual(proseMirrorProblems(readme, web, counts, stems, shipped), []);

  const drift = (r, w, s) => proseMirrorProblems(r, w, counts, stems, s);
  // SHIPPED.md capability row drifts (any of the three counts).
  assert.ok(drift(readme, web, shipped.replace('35 laws', '34 laws'))
    .some((x) => x.includes("SHIPPED.md says '34 laws'")));
  // README law-count prose drifts.
  assert.ok(drift(readme.replace('35 universal laws', '34 universal laws'), web, '')
    .some((x) => x.includes('universal laws')));
  // README Skills (N) count drifts.
  assert.ok(drift(readme.replace('Skills** (3)', 'Skills** (9)'), web, '')
    .some((x) => x.includes('Skills (9)')));
  // README skills list drops a name — invisible to the count, caught here.
  assert.ok(drift(readme.replace('alpha · **beta** · gamma', 'alpha · **beta**'), web, '')
    .some((x) => x.includes("omits 'gamma'")));
  // web law count drifts.
  assert.ok(drift(readme, web.replace('35 universal Rules', '34 universal Rules'), '')
    .some((x) => x.includes('universal laws/Rules')));
  // web "N repeatable workflows" no longer matches its own wikilink list.
  assert.ok(drift(readme, web.replace('3 repeatable workflows', '9 repeatable workflows'), '')
    .some((x) => x.includes('repeatable workflows')));
});

// ---------------------------------------------------------------------------------------------
// LAW_META — the web Laws ledger's per-rule Principle, copy that exists nowhere else.

/** The law numerals as `universal.md` really spells them. Derived, never transcribed. */
const lawNumerals = () => [...fs.readFileSync(path.join(SRC, 'laws', 'universal.md'), 'utf8')
  .matchAll(/^### \{\{LAW\}\} ([IVXLCDM]+)\b/gm)].map((m) => m[1]);

test('every law carries a LAW_META principle', () => {
  // The live check against the real tree. Laws XXXVI and XXXVII shipped without one and
  // rendered with a blank description; this is the gate for it.
  assert.deepEqual(lawMetaProblems(lawNumerals(), LAW_CLASS, LAW_CLASSES), []);
});

test('the LAW_META gate reads the real literal, wrapped rows included', () => {
  // WHY THIS SUBSUMES THE REFERENCE'S SEPARATE PRETTIER TEST, and why it states a precondition
  // the reference never had to. `test_law_meta_row_survives_prettier_wrapping` fed the row
  // regex a hand-written reflowed literal, because a row too long for prettier's print width
  // is broken across lines with a magic trailing comma — and when the regex could not read
  // that form, `prettier --write` silently dropped a law out of the gate's view and
  // `format:check` and the gate demanded contradictory formatting of one file.
  //
  // MEASURED: the shipped `Laws.jsx` CONTAINS such a row (rule 6, reflowed across four lines).
  // So the live gate above already exercises the wrapped form — if the regex lost it, rule 6
  // would report "has no row in LAW_META" and `every law carries a LAW_META principle` would
  // be red. The separate test is redundant AGAINST THIS TREE, which is a different thing from
  // redundant: reword rule 6 shorter, prettier unwraps it, and the coverage evaporates with no
  // test failing. So the precondition is asserted here rather than assumed, and the regex is
  // never reached for directly — a private constant stays private.
  const text = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx'), 'utf8');
  const block = /^const LAW_META = \{$([\s\S]*?)^\}/m.exec(text);
  assert.ok(block, 'LAW_META literal not found in Laws.jsx');
  const rows = block[1].split(/\n(?=\s*\d+:)/).filter((s) => s.trim());
  assert.equal(rows.length, lawNumerals().length,
    'LAW_META has a different number of rows than universal.md has laws');
  assert.ok(rows.some((r) => r.trim().split('\n').length > 1),
    'no LAW_META row is reflowed across lines any more, so the check above has stopped '
    + 'covering the prettier-wrapped form. Restore a wrapped row, or gate the row regex '
    + 'directly against a crafted literal.');
});

test('the LAW_META gate flags a missing row, a stale row and a class disagreement', () => {
  const klass = { I: 'security', II: 'process', XL: 'craft' };
  // XL has no LAW_META row at all — the exact Law XXXVI/XXXVII failure.
  assert.ok(lawMetaProblems(['I', 'XL'], klass, LAW_CLASSES)
    .some((x) => x.includes('XL') && x.includes('LAW_META')));
  // Rule 2 exists in LAW_META but universal.md no longer carries it.
  assert.ok(lawMetaProblems(['I'], klass, LAW_CLASSES)
    .some((x) => x.includes('lists rule 2')));
  // LAW_META's class must agree with the server-side LAW_CLASS.
  assert.ok(lawMetaProblems(['I'], { I: 'comms' }, LAW_CLASSES)
    .some((x) => x.includes('LAW_META[1]') && x.includes('comms')));
});

test('roman numerals bridge to LAW_META\'s arabic keys', () => {
  for (const [roman, n] of [['I', 1], ['IV', 4], ['IX', 9], ['XXXV', 35], ['XXXVI', 36],
    ['XXXVII', 37], ['XL', 40]]) {
    assert.equal(romanToInt(roman), n, roman);
  }
  assert.equal(romanToInt('nope'), 0);
});

// ---------------------------------------------------------------------------------------------
// Theme detection — what `doctor` decides it is looking at.

const AVAIL = ['cyberpunk', 'gamer', 'imperial', 'military', 'neutral', 'pirate', 'sports',
  'wizard'];

/**
 * Run the generator into a sandbox, with home redirected.
 *
 * The reference called `build.build(...)` / `build.emit_bob_global(...)` in process. Driving
 * `bin/geneseed.mjs` instead is the PUBLIC entry, so these tests gate the emit wiring on the
 * way to the property they are actually about — and it keeps the emit's hook-shim writer,
 * which targets the ENVIRONMENT rather than `--out`, out of the developer's real home.
 */
function generate(argv, home, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed.mjs'), ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...homeOverrides(home), ...extraEnv },
    maxBuffer: 1 << 26,
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`emit ${argv.join(' ')} failed (${r.status}): `
      + `${(r.stderr || r.stdout || '').slice(-1500)}`);
  }
}

test('the theme marker wins, and beats a sigil that disagrees', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, '.geneseed-theme'), 'imperial\n', 'utf8');
    assert.equal(themeOfDir(d), 'imperial');
  });
  // STRONGER THAN THE REFERENCE'S, which put a marker in an EMPTY directory — where there is
  // no sigil for the marker to win against, so "the marker wins" and "the marker is read" are
  // the same assertion. Emit a real imperial bundle, then contradict it with the marker.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    generate(['--emit', 'files', '--theme', 'imperial', '--out', out], path.join(d, 'home'));
    fs.writeFileSync(path.join(out, '.geneseed-theme'), 'pirate\n', 'utf8');
    assert.equal(themeOfDir(out), 'pirate');
  });
});

test('theme detection falls back to the bundle sigil', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    generate(['--emit', 'files', '--theme', 'imperial', '--out', out], path.join(d, 'home'));
    fs.rmSync(path.join(out, '.geneseed-theme'));        // force the sigil path
    assert.equal(themeOfDir(out), 'imperial');
  });
});

test('theme detection falls back to a global Bob\'s rules sigil', () => {
  withDir((d) => {
    // A global Bob install writes no AGENTS.md — asserted, not assumed, because that absence
    // is the whole reason this arm exists. Without its marker the theme is still recognised
    // from the preamble in rules/geneseed.md.
    const cfg = path.join(d, 'bobcfg');
    fs.mkdirSync(cfg, { recursive: true });
    generate(['--emit', 'bob-global', '--theme', 'imperial'], path.join(d, 'home'),
      { BOB_CONFIG_DIR: cfg });
    assert.ok(!fs.existsSync(path.join(cfg, 'AGENTS.md')),
      'a global Bob emit grew an AGENTS.md — this arm is now testing the other fallback');
    assert.ok(fs.existsSync(path.join(cfg, 'rules', 'geneseed.md')));
    fs.rmSync(path.join(cfg, '.geneseed-theme'), { force: true });
    assert.equal(themeOfDir(cfg), 'imperial');
  });
});

test('theme detection is null when nothing says', () => {
  withDir((d) => {
    assert.equal(themeOfDir(d), null);
  });
});

test('an explicit theme wins over what was detected', () => {
  assert.deepEqual(themesToCheck('pirate', false, 'imperial', AVAIL), ['pirate']);
});

test('the sweep scopes to the detected theme', () => {
  assert.deepEqual(themesToCheck(null, false, 'imperial', AVAIL), ['imperial']);
});

test('--all sweeps every theme', () => {
  assert.deepEqual(themesToCheck(null, true, 'imperial', AVAIL), [...AVAIL].sort());
});

test('the sweep widens when what was detected is unknown or absent', () => {
  // nothing installed (fresh clone) -> full sweep
  assert.deepEqual(themesToCheck(null, false, null, AVAIL), [...AVAIL].sort());
  // a detected name not among the available themes -> full sweep, not a dead theme
  assert.deepEqual(themesToCheck(null, false, 'ghost', AVAIL), [...AVAIL].sort());
});
