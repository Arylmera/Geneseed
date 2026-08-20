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
  themesToCheck, globalEmitProblems, renderedProblems, authoringProblems, claudeBobEmitProblems,
  doctrineMetaProblems,
} from '../../js/doctor.mjs';
import {
  memoryDropIndex, discoverContext, resolveContextSets, resolveAgentName, appendAgentLesson,
  consolidateMemory,
} from '../../js/hooks.mjs';
import { memoryFactCount } from '../../js/status.mjs';
import { stripSkillBodyLinks } from '../../js/native.mjs';
import { stripCapabilityLinks } from '../../js/emit.mjs';
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
/** One redirected home for every `gate()` child — see that function's ⚠. */
let GATE_HOME = null;

/** One copy of the checkout for this file, built on first use. */
function fixture() {
  if (!FIXTURE) {
    const sb = makeSandbox('gs-fix-');
    copyCheckout(sb.path, {});
    FIXTURE = sb;
  }
  return FIXTURE.path;
}

after(() => { FIXTURE?.cleanup(); GATE_HOME?.cleanup(); });

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
 *
 * ⚠ WITH HOME REDIRECTED, which is not decoration and was the one spawn in this file missing it.
 * `claudeBobEmitProblems` EMITS, three times, and an emit writes the machine-wide hook shim at a
 * path taken from the environment rather than from `--out` — so this gate baked
 * `<fixture>/bin/geneseed-hook.mjs` into the developer's real `~/.geneseed/bin/geneseed-hook`,
 * and killed every hook in every install on the machine the moment the fixture was cleaned up.
 * Reproduced twice in one session. `js/settings.mjs`'s `ephemeralCheckout` now refuses the
 * hijack from the other end as well; this is the near half, and it is the one that keeps a
 * FIRST-ever emit on a machine (no shim yet, nothing to protect) from writing a temp path.
 */
function gate(root, expr) {
  GATE_HOME ??= makeSandbox('gs-gatehome-');
  const url = pathToFileURL(path.join(root, 'js', 'doctor.mjs')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(url)});`
    + `process.stdout.write(JSON.stringify(${expr}));`],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...homeOverrides(GATE_HOME.path) },
    maxBuffer: 1 << 26,
    windowsHide: true,
  });
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
  assert.deepEqual(gate(fixture(), 'm.constitutionProblems()'), []);
});

// ---------------------------------------------------------------------------------------------
// The constitution gate — the doctrine twin of the LAW_CLASS family, plus the two purity rules
// the tiering rests on. Every arm below is planted and watched to redden; the control above is
// what stops any of them passing because the copy is broken.

test('the gate flags a citation into a doctrine rule that does not exist', () => {
  // The shape a 339-site citation sweep leaves behind: a rewire that lands on a plausible
  // address nobody defines. `craft 99` is chosen over `craft 7` deliberately — a rule one past
  // the end would also be caught, but a wildly wrong one proves the gate reads the CATALOGUE
  // rather than a hardcoded ceiling.
  const skill = fs.readFileSync(path.join(SRC, 'skills', 'commit.md'), 'utf8');
  const problems = withFault(
    { 'src/skills/commit.md': `${skill}\n\nSee {{DOCTRINE}} craft 99 for the rest.\n` },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(problems.some((p) => p.includes('craft 99') && p.includes('skills/commit.md')),
    `no dangling-citation problem in ${JSON.stringify(problems)}`);
});

test('the gate refuses a doctrine citation inside an always-on tier', () => {
  // ⚠ D2, AND IT IS A SAFETY RULE RATHER THAN A TIDINESS ONE. A `--doctrines craft` build
  // renders the invariants and the ontology whole and renders no rigor/ops/process rules; an
  // invariant that points at one is then an instruction to read text the install does not have.
  // Both files are planted, because the two are separate arms of the same walk and a gate
  // wired into one of them satisfies a test that only checks the other.
  for (const [rel, body] of [
    ['src/laws/universal.md', '\n\nas {{DOCTRINE}} ops 1 already requires.\n'],
    ['src/ontology/universal.md', '\n\nweighed against {{DOCTRINE}} process 3.\n'],
  ]) {
    const before = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const problems = withFault({ [rel]: before + body },
      (root) => gate(root, 'm.constitutionProblems()'));
    const short = rel.slice('src/'.length);
    assert.ok(problems.some((p) => p.includes(short) && p.includes('{{DOCTRINE}}')),
      `${rel}: no always-on-tier problem in ${JSON.stringify(problems)}`);
  }
  // ...and the SECTION noun is not the rule noun. `{{DOCTRINES}}` names the tier as a whole and
  // an invariant may point at it; a gate that matched the prefix would ban the pointer too.
  const laws = fs.readFileSync(path.join(SRC, 'laws', 'universal.md'), 'utf8');
  assert.deepEqual(withFault(
    { 'src/laws/universal.md': `${laws}\n\nThe {{DOCTRINES}} sit under this.\n` },
    (root) => gate(root, 'm.constitutionProblems()')), [],
  '{{DOCTRINES}}, the section noun, was read as a rule citation');
});

test('the gate flags a pack whose rule ids skip, and one filed under the wrong pack', () => {
  const craft = fs.readFileSync(path.join(SRC, 'doctrines', 'craft.md'), 'utf8');
  // A gap. Appending `craft 8` after six rules puts it at position 7 — the id and the position
  // disagree, which is exactly what a deletion in the middle leaves behind.
  const gap = withFault({ 'src/doctrines/craft.md': `${craft}\n### {{DOCTRINE}} craft 8 — x\nbody\n` },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(gap.some((p) => p.includes('rule 8') && p.includes('position 7')),
    `no contiguity problem in ${JSON.stringify(gap)}`);
  // A rule filed in the wrong file. `pack` is read from the HEADING, so this rule is reachable
  // at `ops.7` — a name `ops.md` also numbers — and unreachable at any craft address.
  const wrong = withFault({ 'src/doctrines/craft.md': `${craft}\n### {{DOCTRINE}} ops 7 — x\nbody\n` },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(wrong.some((p) => p.includes('craft.md') && p.includes('ops 7')),
    `no wrong-pack problem in ${JSON.stringify(wrong)}`);
});

test('the gate flags a theme missing a doctrine title, and a dead one it still carries', () => {
  // ⚠ THE ARM `themeParityProblems` CANNOT HAVE. Parity is presence-only and SYMMETRIC over the
  // union of every theme's keys, so a key missing from ALL of them is in perfect parity — and
  // that is precisely the state a new doctrine rule creates. This arm asks the SOURCE what the
  // themes owe instead of asking the themes about each other.
  const neutral = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'neutral.json'), 'utf8'));
  const short = { ...neutral };
  delete short.DOC_CRAFT_1;
  const missing = withFault({ 'themes/neutral.json': JSON.stringify(short, null, 2) },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(missing.some((p) => p.includes('DOC_CRAFT_1') && p.includes('neutral.json')),
    `no missing-title problem in ${JSON.stringify(missing)}`);
  // The other direction: a title for a rule that does not exist. Its cost is not cosmetic —
  // it is the residue a deleted rule leaves in fifteen files at once.
  const dead = withFault(
    { 'themes/neutral.json': JSON.stringify({ ...neutral, DOC_CRAFT_9: 'Ghost' }, null, 2) },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(dead.some((p) => p.includes('DOC_CRAFT_9') && p.includes('no doctrine file uses')),
    `no dead-key problem in ${JSON.stringify(dead)}`);
});

test('the gate holds every theme to exactly LEX_I..LEX_IX', () => {
  // ⚠ I1, AND IT IS AN EQUALITY BECAUSE A PRESENCE CHECK ALREADY MISSED IT ONCE. The renumber's
  // deletion ranges skipped LEX_XXII, LEX_XXIII, LEX_XXIV and LEX_XXXVI; they survived in all
  // fifteen files, and parity was silent because a key present everywhere is missing nowhere.
  const neutral = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'neutral.json'), 'utf8'));
  const stale = withFault(
    { 'themes/neutral.json': JSON.stringify({ ...neutral, LEX_XXII: 'Ghost' }, null, 2) },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(stale.some((p) => p.includes('LEX_XXII')),
    `a survivor of the renumber went unflagged: ${JSON.stringify(stale)}`);
  const gone = { ...neutral };
  delete gone.LEX_IX;
  const short = withFault({ 'themes/neutral.json': JSON.stringify(gone, null, 2) },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(short.some((p) => p.includes('LEX_IX')),
    `a missing invariant title went unflagged: ${JSON.stringify(short)}`);
  // `_TEMPLATE.json` is HELD TO THIS TOO, unlike theme parity, which skips `_`-scaffolds. It is
  // the file `--sync-themes` seeds a new voice from, so a stale key there propagates forward.
  const tmpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', '_TEMPLATE.json'), 'utf8'));
  const tstale = withFault(
    { 'themes/_TEMPLATE.json': JSON.stringify({ ...tmpl, LEX_XL: '<x>' }, null, 2) },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(tstale.some((p) => p.includes('LEX_XL') && p.includes('_TEMPLATE')),
    `the template is exempt from the equality: ${JSON.stringify(tstale)}`);
});

test('the gate refuses a two-word tier noun in any theme', () => {
  // ⚠ M10. Both heading parsers match the tier noun with `\\S+`, so a value with a space does
  // not error — the heading stops matching, the tier parses to NOTHING, and every count
  // downstream reports a smaller constitution without a word said. `_TEMPLATE.json` is exempt
  // by design: its values are descriptive placeholders and its DOCTRINE line is the warning.
  const neutral = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'neutral.json'), 'utf8'));
  for (const key of ['LAW', 'DOCTRINE']) {
    const problems = withFault(
      { 'themes/neutral.json': JSON.stringify({ ...neutral, [key]: 'House Rule' }, null, 2) },
      (root) => gate(root, 'm.constitutionProblems()'));
    assert.ok(problems.some((p) => p.includes(`{${key}}`) && p.includes('neutral.json')),
      `${key}: a two-word tier noun was accepted — ${JSON.stringify(problems)}`);
  }
  // The template's own placeholder HAS spaces and must stay silent, or the gate is red on a
  // clean tree — which is the control at the top of this section.
  const tmpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', '_TEMPLATE.json'), 'utf8'));
  assert.match(tmpl.DOCTRINE, /\s/, 'the template placeholder lost its spaces, so the exemption '
    + 'above is no longer being exercised by anything');
});

test('the gate flags a §N pointing past the anatomy, and says what it cannot catch', () => {
  // ⚠ THE DEFECT THIS IS NARROWED AGAINST ACTUALLY SHIPPED. Inserting `## 2. Doctrines` pushed
  // every later section down one; the sweep that fixed the template's own cross-references
  // stopped at the template, and four satellites under src/skills/ and src/agents/ kept
  // pointing at the section that used to be there — rendering into every bundle, including a
  // live deny message in the OpenCode guard.
  //
  // This gate would NOT have caught those, and the cell says so rather than implying coverage:
  // §7 still existed, it had simply stopped being the Wiki. What it does catch is a pointer
  // past the END, which is what REMOVING a section leaves behind.
  const wiki = fs.readFileSync(path.join(SRC, 'skills', 'wiki.md'), 'utf8');
  const past = withFault({ 'src/skills/wiki.md': wiki.replace('§8', '§99') },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(past.some((p) => p.includes('skills/wiki.md') && p.includes('§99')),
    `a pointer past the anatomy went unflagged: ${JSON.stringify(past)}`);
  // The stated limit, asserted so it stays a limit rather than becoming a surprise: a pointer
  // moved to a DIFFERENT existing section is silent here, and only the manual sweep in
  // docs/extending.md catches it.
  assert.deepEqual(withFault({ 'src/skills/wiki.md': wiki.replace('§8', '§7') },
    (root) => gate(root, 'm.constitutionProblems()')), [],
  'the range gate has become an intent gate — if it can now tell §7 from §8, this cell and the '
    + 'docblock that promises a manual sweep are both out of date');
  // ...and the numbers it reads are the template's own, so a renumber moves the gate with it.
  const tmpl = fs.readFileSync(path.join(SRC, 'AGENT.md.tmpl'), 'utf8');
  assert.equal([...tmpl.matchAll(/^## (\d+)\.\s/gm)].length, 10,
    'the anatomy changed size — re-read the §N sweep in docs/extending.md before trusting this');
});

test('the gate flags an unknown pack in the build default, and NOTES a narrowed one', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness.config.json'), 'utf8'));
  const bogus = withFault(
    { 'harness.config.json': JSON.stringify({ ...cfg, doctrines: ['craft', 'nosuch'] }, null, 2) },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(bogus.some((p) => p.includes('nosuch') && !p.startsWith('[note]')),
    `an unknown pack in the build default is a failure, not a note: ${JSON.stringify(bogus)}`);

  // ⚠ D5 — A NARROWED DEFAULT IS LEGAL AND MUST NOT FAIL THE DOCTOR. Its citations still
  // resolve on disk: every pack file ships in every bundle. What changes is that the rendered
  // AGENT.md will not carry those rules, and that is worth SAYING rather than failing over.
  const narrow = withFault(
    { 'harness.config.json': JSON.stringify({ ...cfg, doctrines: ['craft'] }, null, 2) },
    (root) => gate(root, 'm.constitutionProblems()'));
  const notes = narrow.filter((p) => p.startsWith('[note]'));
  assert.equal(narrow.length, notes.length,
    `a legal pack-off default produced a real problem: ${JSON.stringify(narrow)}`);
  assert.equal(notes.length, 1, `expected exactly one note, got ${JSON.stringify(notes)}`);
  for (const pack of ['rigor', 'ops', 'process']) {
    assert.ok(notes[0].includes(pack), `the note did not name ${pack}: ${notes[0]}`);
  }
  // The note channel exists so `cmdDoctor` can print without counting. If a note ever reached
  // the problem list unflagged, doctor would exit 1 on a configuration its owner chose.
  assert.ok(gate(fixture(), 'm.isDoctorNote("[note] x")'), 'the note predicate stopped matching');
  assert.ok(!gate(fixture(), 'm.isDoctorNote("[authoring] x")'),
    'the note predicate now swallows real problems');
});

test('the gate holds knownRuleIds to the rules the pack files actually define', () => {
  // ⚠ TWO READERS OF ONE DIRECTORY. `constitutionProblems` walks the pack files to validate
  // citations; `knownRuleIds` walks them to decide what `--exclude-rules` accepts. Nothing but
  // this equality stops them drifting, and the drift is not cosmetic in either direction: an
  // enumerator that offers a rule the build cannot drop puts a dead switch in the console, and
  // one that omits a live rule makes that rule unswitchable while the flag's own error message
  // lists a set the user can see it is missing from.
  //
  // Planted in the ENUMERATOR rather than in the source, because a fault in a pack file moves
  // both readers together and proves nothing about their agreement.
  const checkout = fs.readFileSync(path.join(ROOT, 'js', 'checkout.mjs'), 'utf8');
  const anchor = "      if (m[1] === pack) out.push(`${pack}.${Number(m[2])}`);";
  assert.ok(checkout.includes(anchor),
    'the knownRuleIds body moved — re-aim this fault before trusting the result');

  // Offers less than the source defines: skip every rule numbered 1.
  const short = withFault(
    { 'js/checkout.mjs': checkout.replace(anchor,
      "      if (m[1] === pack && m[2] !== '1') out.push(`${pack}.${Number(m[2])}`);") },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(short.some((p) => p.includes('craft 1') && p.includes('knownRuleIds')),
    `a rule the enumerator dropped went unflagged: ${JSON.stringify(short)}`);

  // ...and the other direction, which a containment check in one direction would miss.
  const long = withFault(
    { 'js/checkout.mjs': checkout.replace(anchor,
      `${anchor}\n      if (m[2] === '1') out.push(\`\${pack}.99\`);`) },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(long.some((p) => p.includes('craft 99') && p.includes('no pack file defines')),
    `a rule the enumerator invented went unflagged: ${JSON.stringify(long)}`);
});

test('the gate flags the consent gate and the process pack naming different rules', () => {
  // ⚠ THE ONE HARDCODED RULE ADDRESS IN THE CODEBASE. `js/settings.mjs` keys the git-gate hooks
  // on the literal `process.5`, so a renumber of that pack silently re-points the TOOL BOUNDARY
  // at whichever rule inherited the number while the PROMPT still says `process 5` — and the
  // per-rule axis made that worse, because `process 5` can now be excluded on its own.
  //
  // The fault swaps two rules' titles without breaking contiguity, which is exactly what a
  // reorder looks like: every other arm of the gate stays silent, so a red here is this arm.
  const proc = fs.readFileSync(path.join(SRC, 'doctrines', 'process.md'), 'utf8');
  const swapped = proc
    .replace('### {{DOCTRINE}} process 5 — {{DOC_PROCESS_5}}', '### {{DOCTRINE}} process 5 — @@')
    .replace('### {{DOCTRINE}} process 6 — {{DOC_PROCESS_6}}',
      '### {{DOCTRINE}} process 6 — {{DOC_PROCESS_5}}')
    .replace('### {{DOCTRINE}} process 5 — @@', '### {{DOCTRINE}} process 5 — {{DOC_PROCESS_6}}');
  assert.ok(swapped.includes('process 6 — {{DOC_PROCESS_5}}'), 'the fault did not apply');
  const problems = withFault({ 'src/doctrines/process.md': swapped },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(problems.some((p) => p.includes('settings.mjs') && p.includes('process 5')),
    `the consent rule moved out from under its gate unflagged: ${JSON.stringify(problems)}`);
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
  // The numeral has to be one PAST the corpus — `XL` was free until laws XXXIX and XL landed,
  // at which point the fixture stopped introducing anything unclassified and the gate went
  // quiet while the test still read as coverage. The three-tier split cut the corpus to nine
  // invariants, so the first free numeral moved BACK to `X`, and `XLI` — still absent from
  // LAW_CLASS — would now plant a rule 32 numerals past anything the file can reach. `X` keeps
  // the fixture's claim literal: the next rule someone actually adds is the one caught here.
  const problems = withFault({ 'src/laws/universal.md': `${laws}\n### {{LAW}} X — z\n` },
    (root) => gate(root, 'm.countTableProblems()'));
  // `rule X ` with the trailing space, not a bare `X`: a one-letter substring matches half the
  // message set by accident, and a gate satisfied by accident is not a gate.
  assert.ok(problems.some((p) => p.includes('rule X ') && p.includes('LAW_CLASS')),
    `no X/LAW_CLASS problem in ${JSON.stringify(problems)}`);
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
  // WHAT THIS ROW GATES AND WHAT IT DOES NOT, stated because the gap between the two once hid
  // a dead check for a whole phase. `proseMirrorProblems` is pure, so every drift class below
  // is crafted here without touching the tree — that is the DECISION. It says nothing about
  // the WIRING, and a call site handing the web arms a string with no prose in it keeps all
  // six assertions green while the product gates nothing. That is exactly what had happened,
  // and `the count gate really reads the onboarding pages` below is the row that now watches it.
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

test('the count gate really reads the onboarding pages the prose arms are about', () => {
  // THE WIRING HALF, and the defect it was written for is worth naming: the web arms were fed
  // a file the console's onboarding prose had MOVED OUT OF. The read still succeeded, all
  // three arms scored zero on every run, and nothing was red — a check can die without ever
  // failing. The copy now lives in `docs/web/`, where the counts are rendered from
  // `{N_LAWS}` / `{N_AGENTS}` / `{N_SKILLS}` tokens and therefore cannot drift; what is left
  // to catch is a page that spells a count as a LITERAL, so that is the fault planted here.
  //
  // ABSOLUTE ABOUT THE COUNT, deliberately vague about the rest of the sentence: the message's
  // wording is frozen by the recorded primitive corpus and names a module that no longer
  // exists, so asserting on it would gate a stale word rather than the property.
  const problems = withFault({
    'docs/web/zzz-fixture-probe.md': '9 capability specialists — alpha, beta.\n',
  }, (root) => gate(root, 'm.countTableProblems()'));
  assert.ok(problems.some((p) => p.includes("'9 capability specialists'")),
    `the count gate is not reading docs/web: ${JSON.stringify(problems)}`);
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
// DOCTRINE_META — the same column, one tier over and 23 rules wide.

/** The doctrine addresses as the pack files really spell them. Derived, never transcribed. */
const doctrineAddrs = () => ['craft', 'rigor', 'ops', 'process'].flatMap((p) =>
  [...fs.readFileSync(path.join(SRC, 'doctrines', `${p}.md`), 'utf8')
    .matchAll(/^### \{\{DOCTRINE\}\} ([a-z]+) (\d+)\b/gm)].map((m) => `${m[1]}.${m[2]}`));

test('every doctrine rule carries a DOCTRINE_META principle', () => {
  const addrs = doctrineAddrs();
  assert.equal(addrs.length, 23, `${addrs.length} rules parsed — expected 23`);
  assert.deepEqual(doctrineMetaProblems(addrs), []);
});

test('the DOCTRINE_META gate reads the real literal, wrapped rows included', () => {
  // SAME PRECONDITION AS LAW_META'S, and it bites harder here: 23 rows at printWidth 100 with
  // a quoted key put SEVERAL over the line, so the wrapped form is not a rare case in this
  // literal — it is most of the long ones. A row regex that could not span newlines would lose
  // exactly the rules whose principle is longest, silently.
  const text = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx'), 'utf8');
  const block = /^const DOCTRINE_META = \{$([\s\S]*?)^\}/m.exec(text);
  assert.ok(block, 'DOCTRINE_META literal not found in Laws.jsx');
  // The split anchor has to be the KEY and not just a quote: a wrapped row's continuation lines
  // are themselves quoted strings, so `\n(?=\s*['"])` cuts one row into three and this cell
  // would then fail on a perfectly good literal — which it did, on the first run.
  const rows = block[1].split(/\n(?=\s*['"][a-z]+\.\d+['"]:)/).filter((s) => s.trim());
  assert.equal(rows.length, doctrineAddrs().length,
    'DOCTRINE_META has a different number of rows than the pack files have rules');
  assert.ok(rows.some((r) => r.trim().split('\n').length > 1),
    'no DOCTRINE_META row is reflowed across lines any more, so the check above has stopped '
    + 'covering the prettier-wrapped form. Restore a wrapped row, or gate the row regex '
    + 'directly against a crafted literal.');
});

test('the DOCTRINE_META gate flags a missing row, a stale row and a wrong pack', () => {
  // A rule with no row at all — the failure that shipped twice on the invariants side, and
  // has 23 places to happen here.
  assert.ok(doctrineMetaProblems(['craft.1', 'craft.99'])
    .some((x) => x.includes('craft.99') && x.includes('DOCTRINE_META')));
  // A row for a rule no pack file defines: the residue a deleted rule leaves in the console.
  assert.ok(doctrineMetaProblems(['craft.1'])
    .some((x) => x.includes('lists craft.2')));
  // ⚠ THE ARM WITH NO INVARIANT EQUIVALENT. A doctrine rule's class IS its pack, so this is an
  // equality rather than a vocabulary check — and it is what catches a row pasted from the
  // pack above it, which would render under the wrong colour and the wrong chip while every
  // count stayed right.
  const text = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx'), 'utf8');
  const swapped = text.replace("'ops.1': ['ops',", "'ops.1': ['craft',");
  assert.notEqual(swapped, text, 'the ops.1 row has moved — re-site this fault');
  const problems = withFault({ 'web/src/pages/Laws.jsx': swapped },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(problems.some((x) => x.includes("DOCTRINE_META['ops.1']") && x.includes("'ops'")),
    `a doctrine row filed under the wrong pack went unflagged: ${JSON.stringify(problems)}`);
});

test('the DOCTRINE_META gate flags the literal going missing entirely', () => {
  // The whole-literal arm, which the invariants' gate has and which is the one a page rewrite
  // trips: `lawMetaProblems` would still be satisfied by a Laws.jsx that kept LAW_META and
  // dropped DOCTRINE_META, and the doctrine rows would render with blank principles.
  const text = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx'), 'utf8');
  const gone = text.replace('const DOCTRINE_META = {', 'const DOCTRINE_META_RENAMED = {');
  assert.notEqual(gone, text, 'the DOCTRINE_META literal has moved — re-site this fault');
  const problems = withFault({ 'web/src/pages/Laws.jsx': gone },
    (root) => gate(root, 'm.constitutionProblems()'));
  assert.ok(problems.some((x) => x.includes('DOCTRINE_META literal not found')),
    `a missing DOCTRINE_META went unflagged: ${JSON.stringify(problems)}`);
});

// ---------------------------------------------------------------------------------------------
// The authoring gate on the specs themselves.

test('the shipped specs and plugins pass the authoring gate', () => {
  assert.deepEqual(authoringProblems(), []);
});

test('a spec whose first block is prose rather than a blockquote is flagged', () => {
  // WHY THE FIRST BLOCK AND NOT ANY BLOCK. A later `>` line would let a naive check pass,
  // and that drift is exactly what let `descOf()` silently extract the wrong description —
  // the spec read fine to a human and shipped the wrong one-liner into every bundle.
  const problems = withFault({
    'src/skills/zzz-fixture-probe.md':
      '# {{SKILL}}: zzz-fixture-probe\n\nSome prose that is NOT the description.\n\n'
      + '> {{DESC_COMMIT}}\n',
  }, (root) => gate(root, 'm.authoringProblems()'));
  assert.ok(
    problems.some((p) => p.includes('skills/zzz-fixture-probe.md')
      && p.includes("not a '>' blockquote")),
    JSON.stringify(problems));
});

// ---------------------------------------------------------------------------------------------
// The memory store's index.
//
// `_memory_facts` HAS NO SINGLE SUCCESSOR, and that is a split rather than a loss. It built one
// record per fact — name, description, body — for the TUI's memory screen, and the port kept the
// half each surviving caller needs: `memoryFactCount` (status, the number) and
// `js/web/api.mjs`'s `memoryItems` (the console's list, gated by the 114 web cells). What is
// asserted here is the part with no other owner: that the index really tracks the store.

test('the fact count sees the facts and skips the index and the readme', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'MEMORY.md'),
      '# Memory Index\n- [a](a.md)\n- [b](b.md)\n', 'utf8');
    fs.writeFileSync(path.join(d, 'README.md'), 'conv', 'utf8');
    fs.writeFileSync(path.join(d, 'a.md'),
      '---\nname: a\ndescription: alpha\n---\nbody A', 'utf8');
    fs.writeFileSync(path.join(d, 'b.md'),
      '---\nname: b\ndescription: beta\n---\nbody B', 'utf8');
    // Two facts — MEMORY.md and README.md are the store's furniture, not entries in it.
    assert.equal(memoryFactCount(d), 2);

    memoryDropIndex(d, 'b');
    const index = fs.readFileSync(path.join(d, 'MEMORY.md'), 'utf8');
    assert.ok(!index.includes('(b.md)'), index);
    assert.ok(index.includes('(a.md)'), 'dropping one pointer removed the other too');
  });
});

// ---------------------------------------------------------------------------------------------
// Context discovery — what the agent is handed when a repo has no manifest.

function contextFixture(d) {
  fs.writeFileSync(path.join(d, 'README.md'), '# r', 'utf8');
  fs.writeFileSync(path.join(d, 'CONTRIBUTING.md'), '# c', 'utf8');
  fs.writeFileSync(path.join(d, 'notes.md'), '# n', 'utf8');
  fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'docs', 'guide.md'), '# g', 'utf8');
  fs.mkdirSync(path.join(d, 'node_modules'));
  fs.writeFileSync(path.join(d, 'node_modules', 'junk.md'), 'x', 'utf8');
  fs.mkdirSync(path.join(d, 'packages', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(d, 'packages', 'foo', 'README.md'), '# foo', 'utf8');
}

const baseNames = (rows) => new Set(rows.map((r) => path.basename(r.path)));

test('discovery sorts convention files eager and the rest lazy', () => {
  withDir((d) => {
    contextFixture(d);
    const [eager, lazy] = discoverContext(d);
    const en = baseNames(eager);
    const ln = baseNames(lazy);
    assert.ok(en.has('README.md'), [...en].join(','));
    assert.ok(en.has('CONTRIBUTING.md'), [...en].join(','));
    assert.ok(ln.has('notes.md'), 'a misc root .md should be lazy');
    assert.ok(ln.has('guide.md'), 'the docs/ tree should be lazy');
    assert.ok(!ln.has('junk.md'), 'node_modules was scanned');
    assert.ok(lazy.some((l) => path.basename(path.dirname(l.path)) === 'foo'),
      'a nested package README was not found');
  });
});

test('an empty manifest falls back to discovery', () => {
  withDir((d) => {
    contextFixture(d);
    fs.writeFileSync(path.join(d, 'context.json'), '{"context": []}', 'utf8');
    const [eager, , source] = resolveContextSets(d);
    assert.ok(eager.some((e) => path.basename(e.path) === 'README.md'),
      'an empty manifest silenced discovery instead of falling back to it');
    assert.ok(source.includes('auto-discovery'), source);
  });
});

test('a manifest with extend layers on top of discovery', () => {
  withDir((d) => {
    contextFixture(d);
    fs.writeFileSync(path.join(d, 'house.md'), '# house rules', 'utf8');
    fs.writeFileSync(path.join(d, 'context.json'),
      '{"extend": true, "context": [{"path": "house.md", "load": "eager", '
      + '"description": "house rules"}]}', 'utf8');
    const [eager, , source] = resolveContextSets(d);
    const en = baseNames(eager);
    assert.ok(en.has('README.md'), 'extend dropped the discovered set');
    assert.ok(en.has('house.md'), 'extend dropped the manifest set');
    // Not "auto-discovery": the source names a manifest, because one was honoured.
    assert.ok(!source.includes('auto-discovery'), source);
  });
});

// ---------------------------------------------------------------------------------------------
// doctor's claude/bob per-repo check — the blind spot that let dead links ship.
//
// `doctorCollect` used to validate only the `files` build and opencode-global; the claude/bob
// PER-REPO emit was never checked, which is exactly why the CLAUDE.md / AGENTS.md dead
// skill-table links shipped unnoticed.

test('the claude/bob per-repo emit is clean on the shipped tree', () => {
  assert.deepEqual(claudeBobEmitProblems('neutral'), []);
});

test('the claude/bob check catches the dead link it was written for', () => {
  // REINTRODUCE THE EXACT REGRESSION. The dead link is a property of the RENDER, not of a file
  // on disk: `CAPABILITY_LINK_RE` lost its optional path-prefix group, so `.claude/skills/x.md`
  // style links stopped being stripped and pointed at nothing in the emitted bundle.
  //
  // The reference monkeypatches `_build_core.CAPABILITY_LINK_RE`. Here it is a module const in
  // `js/emit.mjs` with no injection point left (`cfg.capabilityLinkRe` was the Python driver's
  // seam and the Node path supplies none), so the narrowed pattern is PLANTED IN THE COPY and
  // the check is run out of it — the same discovery route the theme and count gates use.
  const real = fs.readFileSync(path.join(ROOT, 'js', 'emit.mjs'), 'utf8');
  const wide = '/\\[([^\\]]+)\\]\\((?:(?!https?:\\/\\/|\\/)[A-Za-z0-9_.-]+\\/)*'
    + '(?:agents|skills)\\/[A-Za-z0-9_-]+\\.md\\)/g';
  const narrow = '/\\[([^\\]]+)\\]\\((?:agents|skills)\\/[A-Za-z0-9_-]+\\.md\\)/g';
  assert.ok(real.includes(wide),
    'the CAPABILITY_LINK_RE literal has been reworded — this fault no longer plants anything');
  const problems = withFault({ 'js/emit.mjs': real.replace(wide, narrow) },
    (root) => gate(root, "m.claudeBobEmitProblems('neutral')"));
  assert.ok(problems.some((p) => p.includes('dead link') && p.includes('skills/')),
    `expected a seeded dead skill link, got: ${JSON.stringify(problems.slice(0, 5))}`);
});

// ---------------------------------------------------------------------------------------------
// Per-agent lessons — the Python twin of the OpenCode learn plugin's child-session branch.

test('an agent name is normalised or refused, never interpolated blind', () => {
  // THE REFUSALS ARE A PATH-TRAVERSAL GUARD, not tidiness: the name becomes a FILENAME under
  // `memory/agents/`, so `../evil` reaching the join is a write outside the store.
  assert.equal(resolveAgentName('Reviewer'), 'reviewer');
  assert.equal(resolveAgentName('user-advocate'), 'user-advocate');
  assert.equal(resolveAgentName('../evil'), null);
  assert.equal(resolveAgentName('has space'), null);
  assert.equal(resolveAgentName(''), null);
  assert.equal(resolveAgentName(null), null);
});

/**
 * `Path.read_text()` — INCLUDING its universal-newline decode, which is the part that matters.
 *
 * `writeText` translates `\n` to `os.linesep`, so on Windows a lesson file really is CRLF on
 * disk (M1 in the mutation matrix is exactly that translation, so the bytes are already gated).
 * The reference asserts `text.startswith("# reviewer — lessons\n")` and passes anyway, because
 * Python's text-mode read collapses `\r\n` back to `\n` before it ever sees the string — a
 * dependency its assertion never states. A raw `readFileSync(..., 'utf8')` does not, so the
 * first port of these two tests failed on the separator rather than on anything they are about.
 */
const readTextPy = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');

test('a lesson file is created, appended, and capped at a hundred', () => {
  withDir((mem) => {
    const f = appendAgentLesson(mem, 'reviewer', 'cite tests in findings');
    const text = readTextPy(f);
    assert.ok(text.startsWith('# reviewer — lessons\n'), JSON.stringify(text.slice(0, 40)));
    assert.match(text, /- \d{4}-\d{2}-\d{2}: cite tests in findings\n$/);
    for (let i = 0; i < 120; i += 1) appendAgentLesson(mem, 'reviewer', `lesson ${i}`);
    const bullets = readTextPy(f).split('\n').filter((l) => l.startsWith('- '));
    // THE CAP DROPS FROM THE FRONT. A cap that kept the FIRST hundred would freeze the file
    // after a week and quietly stop recording anything the agent learned since.
    assert.equal(bullets.length, 100);
    assert.ok(bullets.at(-1).includes('lesson 119'), bullets.at(-1));
  });
});

test('a lesson collapses its whitespace onto one bullet', () => {
  // A lesson arrives from a model and can carry newlines and tabs. One bullet per lesson is
  // what makes the cap above countable at all.
  withDir((mem) => {
    const f = appendAgentLesson(mem, 'tester', 'a  lesson\nwith\tbreaks');
    assert.match(readTextPy(f), /- \d{4}-\d{2}-\d{2}: a lesson with breaks\n$/);
  });
});

// ---------------------------------------------------------------------------------------------
// `learn --consolidate` — rebuild MEMORY.md from the fact files that are really on disk.

test('consolidate re-indexes an orphan and prunes a dead line', () => {
  withDir((mem) => {
    fs.writeFileSync(path.join(mem, 'new-fact.md'),
      '---\nname: new-fact\ndescription: a new fact\ntype: project\n---\nbody\n', 'utf8');
    fs.writeFileSync(path.join(mem, 'MEMORY.md'),
      '# Memory Index\n- [gone](gone.md) — stale\n', 'utf8');
    const report = consolidateMemory(mem);
    const index = fs.readFileSync(path.join(mem, 'MEMORY.md'), 'utf8');
    assert.ok(index.includes('new-fact.md'), index);
    assert.ok(!index.includes('gone.md'), index);
    // The DESCRIPTION is carried across, not just the link — an index of bare filenames is
    // not something the agent can choose from.
    assert.ok(index.includes('a new fact'), index);
    assert.deepEqual(report.added, ['new-fact']);
    assert.deepEqual(report.pruned, ['gone']);
  });
});

test('consolidate skips the index and the readme, and reports duplicates', () => {
  withDir((mem) => {
    for (const slug of ['a', 'b']) {
      fs.writeFileSync(path.join(mem, `${slug}.md`),
        `---\nname: ${slug}\ndescription: same desc\n---\nx\n`, 'utf8');
    }
    fs.writeFileSync(path.join(mem, 'README.md'), 'not a fact\n', 'utf8');
    const report = consolidateMemory(mem);
    const index = fs.readFileSync(path.join(mem, 'MEMORY.md'), 'utf8');
    assert.ok(!index.includes('README.md'), index);
    // REPORTED, NOT MERGED. Two facts with the same description are a judgement call for the
    // user; consolidating them automatically would delete one of their memories.
    assert.deepEqual(report.duplicates, [['a', 'b']]);
  });
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

// ---------------------------------------------------------------------------------------------
// Where the memory store is — the resolver a global install depends on.

/**
 * `resolveMemoryDir(null)` in a child, with `$GENESEED_HARNESS` set and a cwd that has no
 * store of its own. Returns `"<exit> <answer>"`.
 *
 * A SUBPROCESS, AND THE REFERENCE SAYS WHY: the defect this guards is a THROW that escapes
 * the function, and an in-process call cannot tell "returned null" from "took the process
 * down" the way an exit code can.
 *
 * THE SANDBOXED HOME IS PART OF THE QUESTION, not hygiene, and the reference does not say so
 * because it never had to — its `setUpModule` calls `sandbox_process_home()` and the child
 * inherits the result through `os.environ`. Measured here, both ways: with home sandboxed the
 * answer is `null`; with the developer's real home it is `~/.config/opencode/memory`, because
 * the resolver falls through to the OpenCode config dir and this machine HAS one. So an
 * unsandboxed version of the test below would fail here and pass on a fresh machine, which is
 * the worst shape a gate can have. It is stated rather than inherited.
 */
function memoryResolver(harnessVar, cwd, home) {
  const env = { ...process.env, ...homeOverrides(home), GENESEED_HARNESS: harnessVar };
  delete env.GENESEED_MEMORY;
  const url = pathToFileURL(path.join(ROOT, 'js', 'hosts.mjs')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {resolveMemoryDir} from ${JSON.stringify(url)};`
    + 'process.stdout.write(String(resolveMemoryDir(null)));'],
  { cwd, encoding: 'utf8', env, windowsHide: true });
  return `${r.status} ${r.stdout}`;
}

test('the memory store is found in $GENESEED_HARNESS from an unrelated cwd', () => {
  // A global install's store lives in $GENESEED_HARNESS/memory, not beside the repo — the
  // resolver must find it from a working directory that has no memory/ of its own.
  withDir((d) => {
    const store = path.join(d, 'store');
    const work = path.join(d, 'work');
    fs.mkdirSync(path.join(store, 'memory'), { recursive: true });
    fs.mkdirSync(work);
    assert.equal(memoryResolver(store, work, path.join(d, 'home')),
      `0 ${path.join(store, 'memory')}`);
  });
});

test('a ~user $GENESEED_HARNESS is skipped, not raised', () => {
  // THE FOURTH USER-CONTROLLED TILDE INPUT, and the one the `~user` refusal missed. Making
  // `expanduser` THROW on `~user` guarded excludes.json, $GENESEED_ROOT and --root, and left
  // $GENESEED_HARNESS bare. Unguarded it reaches `geneseed status` and the `learn` hook, whose
  // entry point has no top-level try — so it is a stack trace on a hook path.
  //
  // ABSOLUTE, not a cross-comparison, and that is what lets it outlive the reference: two
  // implementations that both crashed would agree with each other. Exit 0 and 'no store'.
  withDir((d) => {
    const work = path.join(d, 'work');
    fs.mkdirSync(work);
    assert.equal(memoryResolver('~nosuchuser-geneseed/store', work, path.join(d, 'home')),
      '0 null', 'the port raised on $GENESEED_HARNESS=\'~user\'');
  });
});

test('the ~user guard did not swallow a usable store', () => {
  // The vacuity guard beside it: a guard that skipped the base UNCONDITIONALLY would pass the
  // test above, so prove the same call still FINDS a real store.
  withDir((d) => {
    const store = path.join(d, 'store');
    const work = path.join(d, 'work');
    fs.mkdirSync(path.join(store, 'memory'), { recursive: true });
    fs.mkdirSync(work);
    const answer = memoryResolver(store, work, path.join(d, 'home'));
    assert.ok(answer.startsWith('0 '), answer);
    assert.ok(answer.includes('memory'), answer);
  });
});

// ---------------------------------------------------------------------------------------------
// The global emit is link-clean.

test('the global emit carries no unresolved token, dead link or escape', () => {
  // The opencode-global AGENT.md/agents/skills/memory must carry no unresolved tokens, dead
  // links, or non-hermetic escapes — memory links are relative and co-located with AGENT.md,
  // so nothing should point outside the bundle.
  for (const theme of ['neutral', 'imperial']) {
    assert.deepEqual(globalEmitProblems(theme), [], theme);
  }
});

// ---------------------------------------------------------------------------------------------
// `doctor` must name the FIX, not just the symptom.

let DOCTOR_HOME = null;

/**
 * Run the real `doctor` verb out of the fixture copy.
 *
 * THE REFERENCE MOCKED `_doctor_collect` AND RETURNED CRAFTED PROBLEMS, so its three tests
 * exercised `cmd_doctor`'s hint printing and nothing else. `cmdDoctor` calls `doctorCollect`
 * through a module-internal reference, so there is no seam to mock — and the discovery route
 * is better anyway: planting a REAL missing key proves the hint fires on the condition it
 * claims to describe, end to end, rather than on a string someone typed into a mock.
 *
 * `--no-bundle` because the committed-bundle check is about `Harness/`, not about hints, and
 * a checkout whose bundle is mid-rebuild would redden all three arms for an unrelated reason.
 * `--theme neutral` keeps it to one theme: ~1.9s instead of a fourteen-theme sweep.
 */
function doctorInCopy() {
  DOCTOR_HOME ??= makeSandbox('gs-dochome-');
  const r = spawnSync(process.execPath,
    [path.join(fixture(), 'bin', 'geneseed-cli.mjs'), 'doctor', '--theme', 'neutral',
      '--no-bundle'],
    {
      cwd: fixture(),
      encoding: 'utf8',
      env: { ...process.env, ...homeOverrides(DOCTOR_HOME.path) },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

after(() => { DOCTOR_HOME?.cleanup(); });

test('a parity failure prints the --sync-themes hint', () => {
  const good = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'themes', 'neutral.json'), 'utf8'));
  const broken = { ...good };
  delete broken.VOICE;
  const { rc, out } = withFault({ 'themes/broken.json': JSON.stringify(broken) },
    () => doctorInCopy());
  assert.equal(rc, 1, out);
  assert.ok(out.includes('missing key'), out);
  assert.ok(out.includes('--sync-themes'),
    `doctor reported a missing key without naming the fix:\n${out}`);
});

test('an unrelated failure has no --sync-themes hint', () => {
  // The other side of the same claim, and the reason the hint is conditional at all: a doctor
  // that printed it on every failure would be telling a maintainer to re-sync themes over a
  // missing purpose line.
  const { rc, out } = withFault({ 'src/skills/zzz-fixture-probe.md': 'no purpose line here\n' },
    () => doctorInCopy());
  assert.equal(rc, 1, out);
  assert.ok(!out.includes('--sync-themes'), out);
});

test('a clean doctor run has no hint at all', () => {
  const { rc, out } = doctorInCopy();
  assert.equal(rc, 0, out);
  assert.ok(!out.includes('--sync-themes'), out);
});

// ---------------------------------------------------------------------------------------------
// De-linking: what a NATIVE host's copy of a spec may not carry.

const REL_MD = /\]\((?!https?:\/\/)[^)\s]*\.md/;
const PER_ROW = /\]\((?:agents|skills)\/[A-Za-z0-9_-]+\.md\)/;

test('the skill-body stripper drops relative .md links and keeps URLs', () => {
  const out = stripSkillBodyLinks(
    'run [ship](ship.md) if unsure; via the [refactor Skill](refactor.md);\n'
    + 'dispatch the [reviewer Agent](../agents/reviewer.md); copy '
    + '[`_template.md`](_template.md); see [docs](https://example.com/x.md).');
  assert.ok(out.includes('run ship if unsure'), out);
  assert.ok(out.includes('the refactor Skill'), out);
  assert.ok(out.includes('the reviewer Agent'), out);
  assert.ok(out.includes('copy `_template.md`'), out);
  assert.ok(!REL_MD.test(out), `a relative .md link survived: ${out}`);
  assert.ok(out.includes('[docs](https://example.com/x.md)'), out);
});

test('the capability stripper drops per-row spec links and keeps folder pointers', () => {
  // `{}` is the whole cfg this needs: the pattern is overridable per theme, and an empty
  // config takes the default — which is the shape the reference's argument-less helper had.
  const out = stripCapabilityLinks({},
    '| [reviewer](agents/reviewer.md) | when ready |\n'
    + '| [brainstorm](skills/brainstorm.md) | new design |\n'
    + 'Specs live in [`agents/`](agents/) and [`skills/`](skills/).\n'
    + 'Facts live in [`memory/`](memory/).');
  assert.ok(out.includes('| reviewer | when ready |'), out);
  assert.ok(out.includes('| brainstorm | new design |'), out);
  assert.ok(!PER_ROW.test(out), `a per-row spec link survived: ${out}`);
  assert.ok(out.includes('](agents/)'), out);
  assert.ok(out.includes('](skills/)'), out);
  assert.ok(out.includes('](memory/)'), out);
});

// ---------------------------------------------------------------------------------------------
// The committed-bundle drift check — and the dialect blindness that hid inside it.
//
// The first two tests build the PORTABLE bundle, which is the only dialect a plain `build`
// fixture can produce. For as long as they were the WHOLE coverage, a bundle emitted for a host
// that catalogues natively was unreachable, and the check's dialect-blindness could not be seen:
// it reported a freshly emitted OpenCode bundle as stale on every run, with no rebuild able to
// clear it. That is the shape to look for — not a missing assertion, a missing INPUT.

/** A real OpenCode project bundle, with the markers a DEPLOYED one carries. */
function opencodeBundle(d, footprint = 'lean') {
  const out = path.join(d, 'bundle');
  generate(['--emit', 'opencode', '--theme', 'neutral', '--out', out, '--root', out,
    '--footprint', footprint], path.join(d, 'home'));
  // `.geneseed-emit` is written by the driver's `main()`, not by the emit function, so a
  // fixture that reaches the emitter directly has to write it exactly as an install does.
  fs.writeFileSync(path.join(out, '.geneseed-theme'), 'neutral\n', 'utf8');
  fs.writeFileSync(path.join(out, '.geneseed-footprint'), `${footprint}\n`, 'utf8');
  fs.writeFileSync(path.join(out, '.geneseed-emit'), 'opencode\n', 'utf8');
  return out;
}

test('a fresh portable bundle is clean, and a tampered one is stale', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    generate(['--emit', 'files', '--theme', 'neutral', '--out', out], path.join(d, 'home'));
    assert.deepEqual(renderedProblems(out), []);
    fs.writeFileSync(path.join(out, 'AGENT.md'), 'tampered', 'utf8');
    const probs = renderedProblems(out);
    assert.ok(probs.some((p) => p.includes('AGENT.md') && p.includes('stale')),
      JSON.stringify(probs));
  });
});

test('a file missing from the bundle is reported', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    generate(['--emit', 'files', '--theme', 'neutral', '--out', out], path.join(d, 'home'));
    fs.rmSync(path.join(out, 'laws', 'universal.md'));
    const probs = renderedProblems(out);
    assert.ok(probs.some((p) => p.includes('universal.md') && p.includes('missing')),
      JSON.stringify(probs));
  });
});

test('an absent bundle is a no-op, not a failure', () => {
  assert.deepEqual(renderedProblems(path.join(ROOT, 'does-not-exist')), []);
});

test('an OpenCode bundle straight out of the emitter is not drift', () => {
  // Its AGENT.md differs from a portable render BY CONSTRUCTION — the catalogue tables are
  // collapsed to a pointer and the per-row spec links are stripped — so a check that renders
  // the portable shape flags it forever and no rebuild can clear it.
  withDir((d) => {
    assert.deepEqual(renderedProblems(opencodeBundle(d)), []);
  });
});

test('an OpenCode bundle still detects real drift', () => {
  // The dialect awareness must not have bought that by switching the check off. This is the
  // control on the test above, and without it "not drift" is satisfied by "never reports".
  withDir((d) => {
    const out = opencodeBundle(d);
    const agentMd = path.join(out, 'AGENT.md');
    fs.writeFileSync(agentMd, `${fs.readFileSync(agentMd, 'utf8')}\ntampered\n`, 'utf8');
    const probs = renderedProblems(out);
    assert.ok(probs.some((p) => p.includes('AGENT.md') && p.includes('stale')),
      `real drift in an OpenCode bundle went unreported: ${JSON.stringify(probs)}`);
  });
});

test('the de-linking carve-out does not cover a spec file', () => {
  // The carve-out is scoped to AGENT.md ALONE. A tampered agent spec — a file it must not
  // cover — is still drift, and this is what stops the carve-out widening silently.
  withDir((d) => {
    const out = opencodeBundle(d);
    fs.writeFileSync(path.join(out, 'agents', 'reviewer.md'), 'tampered', 'utf8');
    const probs = renderedProblems(out);
    assert.ok(probs.some((p) => p.includes('reviewer.md') && p.includes('stale')),
      `drift in a non-AGENT.md file went unreported: ${JSON.stringify(probs)}`);
  });
});

test('a portable bundle keeps its links and a native global strips them', () => {
  // THE HALF THAT IS ABOUT THE EMIT RATHER THAN THE STRINGS, and it needs both directions:
  // a stripper wired into BOTH paths, or into NEITHER, satisfies either side alone.
  withDir((d) => {
    const home = path.join(d, 'home');
    const files = path.join(d, 'files');
    const cfg = path.join(d, 'cfg');
    fs.mkdirSync(cfg, { recursive: true });
    generate(['--emit', 'files', '--theme', 'neutral', '--out', files], home);
    assert.match(fs.readFileSync(path.join(files, 'skills', 'tdd.md'), 'utf8'), REL_MD,
      'the portable bundle lost its in-body links — tdd links refactor.md and commit.md');
    assert.match(fs.readFileSync(path.join(files, 'AGENT.md'), 'utf8'), PER_ROW,
      'the portable AGENT.md lost its per-row capability links');

    generate(['--emit', 'opencode-global', '--theme', 'neutral'], home,
      { OPENCODE_CONFIG_DIR: cfg });
    const native = fs.readFileSync(path.join(cfg, 'skills', 'tdd', 'SKILL.md'), 'utf8');
    assert.ok(!REL_MD.test(native), `the native skill kept a relative link:\n${native}`);
    assert.ok(native.includes('refactor'),
      'the link was removed along with the words around it');
    const agent = fs.readFileSync(path.join(cfg, 'AGENT.md'), 'utf8');
    assert.ok(!PER_ROW.test(agent), 'the native AGENT.md kept its per-row spec links');
  });
});
