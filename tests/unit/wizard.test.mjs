/**
 * The setup wizard, driven over a seeded fd — `tests/test_pure_function_parity.py`'s
 * `TheWizardAgreesOnEveryAnswerNoCellCanGive` and `TheWizardStillPlaysTheAnimationOnBothSides`.
 *
 * WHY A CHILD WITH A FILE ON fd 0. `setup`'s readers are the one part of this product no cell can
 * reach: `harness_golden`'s cells pipe `/dev/null` at a verb and every prompt takes its EOF arm,
 * so `ask`, `confirm`, `askChoice` and `collectSetupLines` are covered by their defaults and by
 * nothing else. The reference solved it with one probe process per job and stdin from a real FILE
 * rather than an `input=` pipe — the point being that fd 0 is a descriptor the reader walks a byte
 * at a time, which is what a terminal gives it — and this keeps that shape. A file also cannot be
 * a TTY, which matters here more than it looks: on Windows `< /dev/null` reads as a TTY to the
 * reference, and a wizard that decides it is interactive rebuilds the developer's live install.
 *
 * WHAT DIED AND WHAT REPLACED IT. The reference's first test was `every job produces the same
 * BYTES` — one equality covering all twelve jobs, and the only reason six of them existed. It dies
 * with the comparison, and dropping the jobs with it would have quietly retired the EOF-vs-empty
 * distinction, the first-character confirm rule, the unterminated last line and both wizard arms.
 * So every job is still run, and each now carries the absolute answer the reference was asked for
 * — `PYTHONUTF8=1 python -m unittest tests.test_pure_function_parity` while it is still here.
 *
 * THE NEWLINE TRANSLATION IS REAL, and measuring it took two attempts. The retiring test's message
 * says a decode-equal byte-unequal pair means "the newline translation"; the first measurement here
 * asked whether the output contained the four characters backslash-r-backslash-n instead of the two
 * bytes, answered "none, anywhere", and would have shipped an assertion that the writer does NOT
 * translate. Asked properly: of the twelve jobs, five print no newline at all (a prompt has no
 * trailing one and the results envelope has none either) and the other seven write 273 line
 * endings between them — every one of which is CRLF on this host, with a bare LF count of ZERO.
 * So the prompt writer goes through the same os.linesep rule `writeText` does (gated as M1), and
 * what is asserted below is the platform's own spelling rather than a literal.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cellEnv, makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PROBE = path.join(ROOT, 'tests', 'fixtures', 'pure_probe.mjs');

/**
 * The install the wizard reads its PRE-SELECTED defaults out of. The manifest is what
 * `setupSummaryLines`' "a global install exists at" row keys on, and it is the one row in that
 * function with behaviour rather than text in it — without the file, the bundle and project cases
 * are three identical shapes. The emit marker says `claude-global` while the install sits in the
 * OpenCode config dir, deliberately: a port that inferred the emit from the DIRECTORY answers
 * `opencode-global` and this is the only input that can tell.
 *
 * ⚠ THE `Active packs:` LINE IS LOAD-BEARING FOR DETERMINISM, not just for coverage. Every other
 * register here is answered by this seeded tree, so `installedDefaults`' walk never leaves it —
 * but its candidate list ends at `cwd/Harness`, and these jobs run with `cwd: ROOT`. Without a
 * marker, `doctrines` would be the one key that falls through and reads the DEVELOPER'S OWN
 * gitignored `Harness/`: a pack set that is absent on CI and whatever the last local build wrote
 * here. Seeding it pins the answer to the fixture, which is what the fixture is for.
 */
const WIZARD_INSTALL = {
  '.config/opencode/.geneseed-manifest.json': '{"owned": []}',
  '.config/opencode/.geneseed-emit': 'claude-global\n',
  '.config/opencode/.geneseed-theme': 'pirate\n',
  '.config/opencode/.geneseed-footprint': 'full\n',
  '.config/opencode/AGENT.md': '# deployed\n\n**Artisan** — the posture lead\n\n'
    + '**Foreman** — the mode lead\n\nActive packs: craft, rigor, ops, process\n',
};

/**
 * The same install NARROWED — two packs instead of four, and nothing else changed.
 *
 * The wizard's pack question shipped before the marker reader existed, so it offered `all` to
 * everyone: an installer who had deliberately cut their packs down and then held Enter through a
 * re-run got them all back, silently. It is the one register where the default WIDENED a stated
 * selection, and posture/mode/footprint never could because they are single values read off this
 * same walk. This tree is the input that tells a wizard reading the marker from one that is not.
 */
const NARROWED_INSTALL = {
  ...WIZARD_INSTALL,
  '.config/opencode/AGENT.md': '# deployed\n\n**Artisan** — the posture lead\n\n'
    + '**Foreman** — the mode lead\n\nActive packs: rigor, process\n',
};

/**
 * All four packs, with two RULES excluded — the axis the wizard does not ask about.
 *
 * ⚠ AND THAT IS WHY IT NEEDS A FIXTURE. Five questions is the ceiling for a prompt sequence
 * somebody answers by holding Enter, so there is no per-rule question and none is planned; a
 * rule list is a console control. But an axis that is not asked about is an axis that is easy
 * to DROP, and dropping this one has a name: an installer who excluded `process 5` to work
 * without the commit/push ask, re-running the wizard, would have the consent gate wired back
 * on with nothing printed to say so — the exact failure the pack question was fixed for, one
 * tier down. This tree is the input that tells a wizard preserving the line from one ignoring
 * it, and it deliberately keeps all four packs so the PACK axis cannot be what carries the
 * claim.
 */
const EXCLUDED_INSTALL = {
  ...WIZARD_INSTALL,
  '.config/opencode/AGENT.md': '# deployed\n\n**Artisan** — the posture lead\n\n'
    + '**Foreman** — the mode lead\n\nActive packs: craft, rigor, ops, process\n'
    + 'Excluded rules: craft 2, process 5\n',
};

const OPTS = [['alpha', 'the first'], ['beta', ''], ['gamma', 'the third']];
const NUMERIC_OPTS = [['2', 'the key two'], ['1', 'the key one']];

/** (name, cases, stdin) — each its own probe process, because stdin is consumed. */
function wizardJobs() {
  return [
    // ---- the readers, alone, so a failure names the reader and not the wizard.
    ['ask', [['ask', ['Name', 'dflt']], ['ask', ['Bare', '']], ['ask', ['Spaces', 'd']],
      // ...and then EOF, twice: the branch a piped caller always takes.
      ['ask', ['AtEof', 'fallback']], ['ask', ['AtEofAgain', '']]],
    // The THIRD line is CRLF-terminated — what a Windows console sends. It is NOT the gate for
    // that branch and this says so rather than implying it: `ask` trims afterwards, which eats a
    // stray CR either way, so dropping it in the reader is INDISTINGUISHABLE from not dropping it.
    'typed\n\n   padded   \r\n'],
    // A last line with NO trailing newline is not EOF — both return the characters — and the read
    // AFTER it is.
    ['ask-unterminated', [['ask', ['Last', 'd']], ['ask', ['Then', 'd']]], 'no-newline'],
    // The web reader, and the one thing `ask` cannot do: EOF told apart from an empty line.
    // `serve`'s npm prompt accepts '' as YES, so a reader that returned the empty string at EOF
    // would start an `npm install` nobody asked for.
    ['prompt-line', [
      ['prompt_line', ['[web] UI not built — run npm install && npm run build now? [Y/n] ']],
      ['prompt_line', ['empty> ']],
      ['prompt_line', ['at-eof> ']],
    ], 'y\n\n'],
    ['confirm', [['confirm', ['Yes default', true]], ['confirm', ['No default', false]],
      ['confirm', ['Yes default', true]], ['confirm', ['No default', false]],
      ['confirm', ['Yes default', true]],
      // Only the FIRST character is read, so `yes` and `yellow` are both yes.
      ['confirm', ['First char only', true]], ['confirm', ['At eof', true]]],
    'y\ny\nn\nn\nYES\nyellow\n'],
    // ---- the menu, and its three fallback arms in order.
    ['ask-choice', [
      ['ask_choice', ['Pick', OPTS, 'beta']],    // `3` — an in-range index
      ['ask_choice', ['Pick', OPTS, 'beta']],    // empty — the default
      ['ask_choice', ['Pick', OPTS, 'beta']],    // `9` — parsed, out of range
      ['ask_choice', ['Pick', OPTS, 'beta']],    // `gamma` — a KEY, not an index
      ['ask_choice', ['Pick', OPTS, 'beta']],    // `nosuch` — an unknown key
      // An answer that PARSES never reaches the key match. `0` is parseable and out of range.
      ['ask_choice', ['Pick', OPTS, 'alpha']],
      ['ask_choice', ['Pick', OPTS, 'gamma']],   // a Unicode decimal — `int` takes it, `Number` not
      ['ask_choice', ['Pick', OPTS, 'alpha']],   // EOF — the default
    ], '3\n\n9\ngamma\nnosuch\n0\n٢\n'],
    // A menu whose KEYS are numerals, and it exists because a mutation asked for it: with the
    // corpus above alone, matching keys BEFORE parsing an index is the same function, since no
    // numeric answer is also a key. Here `2` is both, and it resolves as an INDEX.
    ['ask-choice-numeric-keys', [['ask_choice', ['Pick', NUMERIC_OPTS, '1']],
      // ...and the same menu answered `1`, which inverts the pair. Two cases that swap under the
      // mutation and cannot both be right by accident.
      ['ask_choice', ['Pick', NUMERIC_OPTS, '1']]], '2\n1\n'],
    // ---- and the wizard itself, six ways through it.
    // Every sequence below carries a FOURTH answer, between mode and the install mode: the
    // Doctrine-packs gate. It is the one question with two levels, so the count of answers a
    // run consumes is no longer fixed — `all` costs one line and `choose` costs five.
    ['wizard-defaults', [['collect_setup_lines', []]], '\n\n\n\n\n\n\n'],
    ['wizard-declined', [['collect_setup_lines', []]], '\n\n\n\n\n\nn\n'],
    // A PROJECT emit, the arm that asks a seventh question — `out` and `root` both from one
    // answer. `1` at the packs gate is `all`, the same answer an empty line gives.
    ['wizard-project', [['collect_setup_lines', []]], '1\n1\n1\n1\n3\n1\n/tmp/somerepo\ny\n'],
    // `files`, the other arm: one answer, `out` only, `root` left null. This is also the
    // per-pack arm — `choose`, then four y/n — and the subset it keeps is NON-CONTIGUOUS
    // (rigor and process, skipping craft and ops), so a port that dropped the filter and kept
    // a prefix, a suffix or the whole list answers differently from one that reads each y/n.
    ['wizard-files', [['collect_setup_lines', []]],
      'neutral\nexpert\nforeman\nchoose\nno\nyes\nno\nyes\n9\nfull\n\ny\n'],
    // Every pack declined. A real configuration (invariants and ontology only), and the only
    // input that reaches `--doctrines none` — the spelling an empty list has to take, because
    // an empty `--doctrines ` is a usage error at the driver.
    ['wizard-no-packs', [['collect_setup_lines', []]],
      '\n\n\nchoose\nno\nno\nno\nno\n\n\n\n'],
    // EOF before the first question. Every reader returns its default, which is the PRE-SELECTED
    // one — so this is the case that fails if `installedDefaults` stopped answering posture, mode
    // or footprint.
    ['wizard-eof', [['collect_setup_lines', []]], ''],
    // The SAME EOF run against an install that carries only two packs. Nothing is typed, so every
    // answer is a pre-selection and the pack set that comes back is the one on disk — which is
    // the whole claim: holding Enter through a re-run KEEPS a narrowed constitution instead of
    // silently restoring the two packs its owner removed. Against `wizard-eof` above (same input,
    // all-four install, all four packs back) it is a matched pair, so an implementation that
    // ignores the marker and always answers `all` fails exactly one of the two.
    ['wizard-eof-narrowed', [['collect_setup_lines', []]], '', NARROW_HOME],
    // The THIRD member of that pair, one tier down: same empty stdin, all four packs, two rules
    // excluded. The wizard never asks about rules, so this cell is entirely about what it
    // PRESERVES — and it is matched against `wizard-eof` (same input, nothing excluded, no flag
    // at all), so a wizard that always emits the flag and one that never does each fail exactly
    // one of the two.
    ['wizard-eof-excluded', [['collect_setup_lines', []]], '', EXCLUDED_HOME],
  ].map(([name, cases, stdin, home]) => [name, cases.map(([fn, args]) => ({ fn, args })),
    stdin, home]);
}

/**
 * `setupSummaryLines` over the five shapes its rows can take. Not a wizard job — it reads no
 * stdin — but it runs in the same seeded HOME, because three of its rows name the OpenCode config
 * dir and one branches on a manifest being there. `lspPrereqs` really does run `java -version`;
 * the answer is whatever this machine gives.
 */
function summaryCases() {
  return [
    // opencode-global with the AGENT.md present: the ok row, the platform hint, the LSP rows.
    ['pirate', 'opencode-global', null, null, true],
    // ...and with `ok` false, the only row that can say "build failed".
    ['pirate', 'opencode-global', null, null, false],
    // A bundle: the "point your tool" row AND the global-install warning.
    ['neutral', 'files', 'some/bundle', null, true],
    // A project emit: no LSP rows (not an `opencode` prefix), and the warning still fires.
    ['imperial', 'claude', 'repo', 'repo', true],
    // An `opencode` PROJECT emit — the prefix match, so the LSP rows come back.
    ['cyberpunk', 'opencode', 'repo', 'repo', true],
    // `out` unset on a non-global emit falls back to the literal "Harness".
    ['neutral', 'bob', null, null, true],
  ].map((args) => ({ fn: 'setup_summary_lines', args }))
    .concat([{ fn: 'installed_defaults', args: [] }]);
}

const sandbox = makeSandbox('wizard-');
after(() => sandbox.cleanup());

/** Seed one install tree under its own HOME and return that HOME. */
function seed(name, tree) {
  const home = path.join(sandbox.path, name);
  for (const [rel, text] of Object.entries(tree)) {
    const p = path.join(home, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text, 'utf8');
  }
  return home;
}

const HOME = seed('home', WIZARD_INSTALL);
const NARROW_HOME = seed('home-narrow', NARROWED_INSTALL);
const EXCLUDED_HOME = seed('home-excluded', EXCLUDED_INSTALL);

/** One probe process, stdin from a seeded FILE, WHOLE stdout back as BYTES. */
function runSeeded(cases, stdin, home = HOME) {
  const dir = path.join(sandbox.path, `job-${runSeeded.n = (runSeeded.n ?? 0) + 1}`);
  mkdirSync(dir, { recursive: true });
  const job = path.join(dir, 'job.json');
  writeFileSync(job, JSON.stringify({ cases }), 'utf8');
  const answers = path.join(dir, 'answers.txt');
  writeFileSync(answers, Buffer.from(stdin, 'utf8'));
  const fd = openSync(answers, 'r');
  try {
    const p = spawnSync(process.execPath, [PROBE, job], {
      cwd: ROOT, env: cellEnv(home), stdio: [fd, 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(p.status, 0,
      `pure_probe.mjs failed (${p.status}):\n${p.stderr?.toString('utf8') ?? ''}`);
    return p.stdout;
  } finally {
    closeSync(fd);
  }
}

/** Every job, run once and memoised: name -> { bytes, text, results }. */
let RUNS = null;
function runs() {
  if (RUNS) return RUNS;
  RUNS = {};
  for (const [name, cases, stdin, home] of [...wizardJobs(),
    ['summary', summaryCases(), '']]) {
    const bytes = runSeeded(cases, stdin, home);
    const text = bytes.toString('utf8');
    const at = text.lastIndexOf('{"results"');
    assert.ok(at >= 0, `the ${name} job printed no results envelope:\n${text}`);
    RUNS[name] = { bytes, text, results: JSON.parse(text.slice(at)).results };
  }
  return RUNS;
}

// ---------------------------------------------------------------------------------------------
// THE READERS, alone. Five of the twelve jobs existed only to be compared; these are the absolute
// answers that replace the comparison, taken from the reference before it goes.

test('the line reader trims, defaults on an empty line, and defaults again at EOF', () => {
  // Four distinct behaviours in one job: a typed answer, an EMPTY line taking the default, a
  // padded answer trimmed, then EOF twice — the branch a piped caller always takes, where Python
  // raises EOFError and the byte reader gets a zero-length read. The empty default comes back as
  // the empty string, not as null: `ask` has no null.
  assert.deepEqual(runs()['ask'].results, ['typed', '', 'padded', 'fallback', '']);
});

test('an unterminated last line is an answer, and the read after it is the EOF', () => {
  assert.deepEqual(runs()['ask-unterminated'].results, ['no-newline', 'd']);
});

test('promptLine tells EOF apart from an empty line', () => {
  // The one thing `ask` cannot do, and the reason the function exists. `serve`'s npm prompt reads
  // '' as YES, so a reader answering '' at EOF starts an `npm install` nobody asked for; only
  // null can mean "there was nobody there".
  assert.deepEqual(runs()['prompt-line'].results, ['y', '', null]);
});

test('confirm reads the first character only, and defaults at EOF', () => {
  // `YES` and `yellow` are both yes because only `ans[0]` is looked at — which is why `nope` is a
  // no. The last entry is EOF against a `true` default.
  assert.deepEqual(runs()['confirm'].results, [true, true, false, false, true, true, true]);
});

// ---------------------------------------------------------------------------------------------
// THE MENU, and the measurement behind `pyInt`.

test('the choice corpus reaches all three fallback arms', () => {
  // A menu answered only with digits and blanks never separates "parsed and out of range" from
  // "unparseable", and the key-match arm is unreachable when every answer parses. One of each,
  // named — otherwise a port that dropped the int parse and matched keys first is green.
  assert.deepEqual(runs()['ask-choice'].results, [
    'gamma',   // `3` — an in-range index
    'beta',    // empty — the default
    'beta',    // `9` — parsed, out of range
    'gamma',   // `gamma` — unparseable, matched as a key
    'beta',    // `nosuch` — unparseable, no key
    'alpha',   // `0` — parsed, out of range, so the keys are NEVER consulted
    'beta',    // `٢` — a Unicode decimal is an index to `int`
    'alpha',   // EOF — the default
  ]);
});

test('a numeric key is resolved as an index and not as a key', () => {
  // An index and a key that spell the same string are the ONE input that separates the two
  // fallback orders. Index-first gives `2`->"1" and `1`->"2"; key-first gives `2`->"2" and
  // `1`->"1". Two cases that swap together and cannot both be right by accident.
  assert.deepEqual(runs()['ask-choice-numeric-keys'].results, ['1', '2'],
    '`2` was resolved as the option NAMED 2 rather than as the second index, so the key match is '
    + 'running before the int parse');
});

// ---------------------------------------------------------------------------------------------
// THE WIZARD, four ways through it.

test('the wizard job really walks the wizard', () => {
  // THE POSITIVE CONTROL, and this corpus needs one more than most: a probe that printed nothing
  // and returned null would satisfy every equality in the reference. This names the parts a silent
  // port could not have produced — a menu line, the `(default)` marker on the PRE-SELECTED
  // deployed value, the plan, and the selection itself.
  const out = runs()['wizard-eof'].text;
  assert.ok(out.includes('Geneseed setup — answer a few questions'), out.slice(0, 200));
  assert.ok(out.includes('1) neutral — plain professional voice'), out.slice(0, 400));
  // The seeded install's six markers, each pre-selected. Theme and footprint come off marker
  // FILES, posture and mode are content-detected out of the carrier, the emit marker says
  // `claude-global` while the install sits in the OpenCode config dir, and the packs come off the
  // carrier's `Active packs:` line.
  for (const line of [
    'pirate — high-seas crew   (default)',
    'artisan — peer with toolsmith reflexes — terminal-first   (default)',
    'foreman — triages tasks, spawns pipelines for substantial work   (default)',
    'claude-global — Claude Code global config dir',
    "full — Full — every law's complete text inlined",
    // The packs gate against an install that carries all four: `all` is pre-selected, its option
    // keeps the `(default)` suffix that names it as the out-of-the-box answer, and the plan line
    // below therefore ELIDES `--doctrines`. `wizard-eof-narrowed` is the same input against a
    // two-pack install and takes the other arm, which is what makes this one an assertion about
    // the marker rather than about a constant.
    'all — craft + rigor + ops + process (default)   (default)',
    '2) choose — pick packs',
    'About to run:  geneseed build --theme pirate --emit claude-global --footprint full '
      + '--posture artisan --mode foreman',
    '{"theme":"pirate","posture":"artisan","mode":"foreman","doctrines":["craft","rigor","ops",'
      + '"process"],"excludeRules":null,"emit":"claude-global"',
  ]) assert.ok(out.includes(line), `the wizard did not print:\n  ${line}`);
  // The gate is a GATE: taking `all` must not print the four per-pack questions.
  assert.ok(!out.includes('Include craft'),
    'the packs gate asked the per-pack questions anyway, so `all` is not a shortcut');
});

test('holding Enter through a re-run keeps a narrowed pack selection instead of widening it', () => {
  // ⚠ THE ONE REGISTER WHOSE DEFAULT COULD SILENTLY UNDO A DECISION. Theme, posture, mode,
  // footprint and emit are single values, so a wizard that pre-selects the deployed one is
  // obviously right and a wizard that does not is obviously wrong. Packs are a SET, and the
  // wrong default is not a different answer — it is a WIDER one: an installer who removed
  // `process` to work without the commit/push ask, running `geneseed setup` again and pressing
  // Enter, had all four packs written back with no line printed to say so.
  //
  // Same empty stdin as `wizard-eof`, same fixture but for one marker line. The pair is the
  // gate: an implementation that ignores the marker passes exactly one of the two cells.
  const narrowed = runs()['wizard-eof-narrowed'];
  assert.deepEqual(narrowed.results, [{
    theme: 'pirate', posture: 'artisan', mode: 'foreman', doctrines: ['rigor', 'process'],
    excludeRules: null, emit: 'claude-global', out: null, root: null, footprint: 'full',
  }], 'a re-run over a two-pack install did not come back with two packs');
  assert.deepEqual(runs()['wizard-eof'].results[0].doctrines, ['craft', 'rigor', 'ops', 'process'],
    'the all-four half of the pair moved, so the narrowed half proves nothing');
  // The narrowed install opens on `choose`, not on `all` — otherwise the per-pack defaults it
  // carries are never reached, and the arm cannot be selected without a typed answer.
  assert.ok(narrowed.text.includes('choose — pick packs (installed: rigor, process)'),
    `the gate did not name the installed subset:\n${narrowed.text}`);
  assert.ok(!/\ball — craft \+ rigor \+ ops \+ process \(default\)/.test(narrowed.text),
    '`all` still advertises itself as THE default on an install that is not at all four');
  // ...and the two packs that are off are pre-answered `no`, which is the half a
  // `known.includes(name) ? 'yes' : 'no'` inversion would flip.
  for (const [pack, want] of [['craft', 'no'], ['rigor', 'yes'], ['ops', 'no'],
    ['process', 'yes']]) {
    const q = narrowed.text.slice(narrowed.text.indexOf(`Include ${pack} —`));
    assert.ok(new RegExp(`${want} — [^\\n]*\\(default\\)`).test(q.slice(0, 400)),
      `the per-pack question for ${pack} did not pre-select \`${want}\``);
  }
  // The selection has to survive into the argv the wizard prints AND runs — a pre-selection
  // that never reaches `setupBuildArgs` is a cosmetic default.
  assert.ok(narrowed.text.includes('--doctrines rigor,process'),
    'the pre-selected pack set never reached the build command');
});

test('a re-run keeps the RULES an install excluded, without asking about them', () => {
  // ⚠ AN AXIS THE WIZARD DOES NOT ASK ABOUT IS AN AXIS IT CAN SILENTLY DROP. Five registers is
  // the ceiling for a prompt sequence answered by holding Enter, so there is no per-rule
  // question — but re-running the wizard over an install that excluded `process 5` must not
  // hand back the commit/push consent gate with nothing said. Same failure the pack question
  // was fixed for, one tier down.
  const excl = runs()['wizard-eof-excluded'];
  assert.deepEqual(excl.results, [{
    theme: 'pirate', posture: 'artisan', mode: 'foreman',
    doctrines: ['craft', 'rigor', 'ops', 'process'], excludeRules: ['craft.2', 'process.5'],
    emit: 'claude-global', out: null, root: null, footprint: 'full',
  }], 'a re-run over an install with excluded rules did not carry them back');
  // ...and it reaches the argv, in the dotted form the flag parses. A selection that came back
  // right and was then dropped before the build is the same bug arriving one step later.
  assert.ok(excl.text.includes('--exclude-rules craft.2,process.5'),
    `the plan line dropped the exclusions:\n${excl.text}`);
  // THE MATCHED HALF: the all-four, nothing-excluded install must emit NO flag at all, or this
  // cell is satisfied by a wizard that always spells one — and `--exclude-rules none` in the
  // plan line would move every frozen probe that compares it.
  const plain = runs()['wizard-eof'];
  assert.equal(plain.results[0].excludeRules, null);
  assert.ok(!plain.text.includes('--exclude-rules'),
    `an install excluding nothing spelled the flag anyway:\n${plain.text}`);
  // The question count is unchanged — the axis is preserved, not asked about.
  assert.ok(!/exclude/i.test(excl.text.split('About to run:')[0]),
    'the wizard grew a per-rule question; that is a decision, not a side effect');
});

test('the packs gate offers every pack, in narrative order, with what dropping one costs', () => {
  // The blurbs are the only description of a pack an installer ever sees, so their presence is
  // asserted rather than assumed — and `process`' one names the consent gate, because turning
  // that pack off is what removes the commit/push ask. A blurb that quietly stopped saying so
  // would still render a legal menu.
  const out = runs()['wizard-no-packs'].text;
  const at = ['craft', 'rigor', 'ops', 'process'].map((p) => out.indexOf(`Include ${p} —`));
  assert.ok(at.every((i) => i >= 0), `a pack was missing from the per-pack questions:\n${out}`);
  assert.deepEqual(at, [...at].sort((a, b) => a - b),
    'the per-pack questions are not in PACK_ORDER — discovery sorts alphabetically, PACK_ORDER '
    + 'does not, and the menu must match the marker the build writes');
  assert.ok(out.includes('consent gate on every commit and push'),
    'the process blurb no longer says what dropping the pack costs');
});

test('the declined wizard returns null and the confirmed one does not', () => {
  // `collectSetupLines` returns null when the confirm is declined, and that is the difference
  // between `[setup] cancelled` and a build. Two jobs differing in one character of stdin — the
  // `n` — must differ in exactly that.
  assert.deepEqual(runs()['wizard-declined'].results, [null]);
  assert.deepEqual(runs()['wizard-defaults'].results, [{
    theme: 'pirate', posture: 'artisan', mode: 'foreman',
    doctrines: ['craft', 'rigor', 'ops', 'process'], excludeRules: null,
    emit: 'claude-global', out: null, root: null, footprint: 'full',
  }]);
});

test('the project arm asks a sixth question and the files arm does not', () => {
  // The two emit arms, and the difference is `root`. A project emit sets `out` AND `root` from the
  // one answer; `files` sets `out` only and leaves `root` null — the distinction that decides
  // whether the generator writes a repo-rooted install or a loose bundle. `lean` against `full` is
  // the second half: the project job never names a footprint and takes the default.
  assert.deepEqual(runs()['wizard-project'].results, [{
    theme: 'neutral', posture: 'peer', mode: 'direct',
    doctrines: ['craft', 'rigor', 'ops', 'process'], excludeRules: null,
    emit: 'opencode', out: '/tmp/somerepo', root: '/tmp/somerepo', footprint: 'lean',
  }]);
  assert.deepEqual(runs()['wizard-files'].results, [{
    theme: 'neutral', posture: 'expert', mode: 'foreman', doctrines: ['rigor', 'process'],
    excludeRules: null, emit: 'files', out: 'Harness', root: null, footprint: 'full',
  }]);
});

test('a narrowed pack selection reaches the plan line, and an emptied one says none', () => {
  // The whole point of the question: an answer that is not "all four" must arrive in the argv
  // the wizard prints and then runs. `all` elides the flag (asserted above), so these two are
  // the only inputs that can prove the elision is a CONDITION and not a deletion.
  assert.deepEqual(runs()['wizard-files'].results[0].doctrines, ['rigor', 'process']);
  assert.ok(runs()['wizard-files'].text.includes('--doctrines rigor,process'),
    'a partial pack selection never reached the build command');
  assert.deepEqual(runs()['wizard-no-packs'].results[0].doctrines, []);
  assert.ok(runs()['wizard-no-packs'].text.includes('--doctrines none'),
    'an empty pack selection must be spelled `none`, which is what the driver parses back');
});

test('the summary job produces rows and not an empty list', () => {
  // The positive control for `setupSummaryLines` and for the three keys P5i added to
  // `installedDefaults` — the last case in the job is the detector itself.
  const results = runs()['summary'].results;
  assert.equal(results.length, 7);
  assert.deepEqual(results[0][0], ['ok', results[0][0][1]]);
  assert.ok(results[0][0][1].includes('AGENT.md written to'), results[0][0][1]);
  assert.equal(results[1][0][0], 'warn');
  assert.ok(results[1][0][1].includes('build failed'), results[1][0][1]);
  assert.ok(results[2].some(([kind, t]) => kind === 'warn' && t.includes('a global install exists at')),
    'the bundle case did not reach the global-install warning, so that branch is not covered');
  assert.ok(results[4].some(([, t]) => t.includes('Java 21+ (jdtls)')),
    'the opencode PROJECT emit did not reach the LSP rows');
  assert.ok(!results[3].some(([, t]) => t.includes('Java 21+ (jdtls)')),
    'a claude emit reached the LSP rows, which are opencode-only');
  // Seven keys, and the two doctrine ones are the only lists. `doctrines` distinguishes three
  // states (null = no carrier said, [] = a carrier said `none`, a list = it named packs);
  // `excludeRules` has only two, because its marker is written only when something IS excluded
  // and its absence is therefore an answer. Both are present here for the same reason: the
  // wizard's pack question must not fall through this walk to `cwd/Harness`.
  assert.deepEqual(results[6], {
    theme: 'pirate', posture: 'artisan', mode: 'foreman', emit: 'claude-global', footprint: 'full',
    doctrines: ['craft', 'rigor', 'ops', 'process'], excludeRules: [],
  });
});

test('every job wrote something, and every newline in it is the platform\'s', () => {
  // WHAT IS LEFT OF `test_every_job_produces_the_same_bytes`. Its equality dies with the
  // reference; what it was really watching is that the whole of stdout is compared as BYTES and
  // not after a decode, so a newline translation on one side alone would be caught. Asking the
  // reference turns that into an absolute claim: the prompt writer translates, exactly as
  // `writeText` does (gated as M1), and nothing else in this suite can see it happen on STDOUT.
  //
  // Counted rather than sampled, because `includes('\r\n')` is satisfied by one translated line in
  // a stream of untranslated ones. A bare LF is an LF that is not the tail of a CRLF, and on
  // Windows there must be none; on POSIX there must be no CR at all.
  const all = runs();
  assert.equal(Object.keys(all).length, 15, 'a job was dropped from the table');
  const win = process.platform === 'win32';
  let newlines = 0;
  for (const [name, { bytes }] of Object.entries(all)) {
    assert.ok(bytes.length > 0, `the ${name} job wrote nothing at all`);
    const lf = bytes.filter((b) => b === 0x0a).length;
    const crlf = bytes.filter((b, i) => b === 0x0a && bytes[i - 1] === 0x0d).length;
    const cr = bytes.filter((b) => b === 0x0d).length;
    newlines += lf;
    if (win) {
      assert.equal(lf - crlf, 0, `the ${name} job wrote ${lf - crlf} BARE line feeds — the prompt `
        + 'writer has stopped translating to os.linesep on the way out');
    } else {
      assert.equal(cr, 0, `the ${name} job wrote ${cr} carriage returns on a POSIX host`);
    }
  }
  // Five of the twelve print no newline at all — a prompt has no trailing one and neither does the
  // results envelope — so "no bare LF" is vacuously true of them. This is the guard that says the
  // other seven were really measured.
  assert.ok(newlines > 200, `only ${newlines} newlines across all twelve jobs, so the rule above `
    + 'was asserted against almost nothing');
});

// ---------------------------------------------------------------------------------------------
// THE CALL SITE, which the jobs above do not reach and nothing else does either.

test('the wizard still plays the animation between the build and the summary', () => {
  // `playLine` is gated as a pure function over a corpus. That says nothing about whether anyone
  // CALLS it, and the one caller is unreachable from every gate this project has: it sits in
  // `setupLines` after a successful build, behind an isatty check (so no cell), and past the point
  // where the wizard corpus above deliberately stops (so no corpus) — because everything beyond
  // `collectSetupLines` spawns the generator and writes a real tree. Deleting the call would be
  // invisible in all 259 emit cells, all 317 CLI cells, all 1 950 corpus cases and both doctors.
  //
  // A weak test on purpose, and honest about which half it covers: the corpus proves the animation
  // is RIGHT, this proves it is WIRED, and neither claims the other.
  const whole = readFileSync(path.join(ROOT, 'js', 'maintain', 'setup.mjs'), 'utf8');
  const from = whole.indexOf('export function setupLines(');
  assert.ok(from > 0, 'js/maintain/setup.mjs no longer exports setupLines under that name');
  const rest = whole.slice(from);
  const to = rest.indexOf('\nexport function ');
  const src = to > 0 ? rest.slice(0, to) : rest;
  // The slice is a positive control of its own: a `from` that matched the last line of the file
  // would make every `includes` below vacuously false, and a `to` that matched nothing would make
  // them true of the whole module rather than of this function.
  assert.ok(src.length > 200 && src.length < whole.length,
    `the setupLines slice is ${src.length} of ${whole.length} bytes`);
  assert.ok(src.includes('playLine(theme, true)'), 'the wizard no longer plays the animation');
  assert.ok(src.indexOf('Running:') < src.indexOf('playLine(theme, true)'),
    'the animation runs BEFORE the build — it is the reveal for an install that already succeeded');
  assert.ok(src.indexOf('playLine(theme, true)') < src.indexOf('setupSummaryLines'),
    'the animation runs after the summary rather than before it');
});
