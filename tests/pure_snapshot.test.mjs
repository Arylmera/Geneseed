/**
 * The three recorded corpora, replayed against the port.
 *
 * WHY THIS FILE EXISTS. `tests/test_pure_function_parity.py` and `tests/test_win_user_path.py`
 * are COMPARISONS: they run both implementations and require them to agree. That gate dies
 * with `rituals/harness.py`. These three documents are the reference's own answers, written
 * down while a CPython was still there to ask — and unlike the cell corpora, some of them
 * cannot be recomputed by anything afterwards at all:
 *
 *   - `str(Path(x))` is `ntpath`/`posixpath`, not `path.win32`/`path.posix`;
 *   - `difflib`'s autojunk and its longest-block recursion have no Node twin at any rung;
 *   - `unicodedata.east_asian_width` and `unicodedata.combining` have NO JavaScript
 *     counterpart, which is why `js/tui.mjs` carries hand-written range tables and why
 *     `.github/workflows/ci.yml` pins the interpreter. After the cut, `dwidth.json` is what
 *     pins those tables: a sha256 over the whole sweep plus the Unicode version DECLARED
 *     beside them. This file checks both without a Python anywhere on the machine.
 *
 * THE PROBE IS SPAWNED, not imported. `pure_probe.mjs` is a script that reads `argv[2]`, and
 * the glyph tier is an environment axis the reference drives with one process per setting —
 * so this drives it the same way. Two processes, not two calls with `process.env` poked in
 * between, because a module that read the tier at import would make the second axis silently
 * re-run the first.
 *
 * A FAILURE NAMES THE CASE. `fn`, the arguments and the corpus index, because a snapshot test
 * that can only say "something differed" is one nobody acts on.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DWIDTH_UNIDATA } from '../js/tui.mjs';
import { winUserPathScript } from '../js/link.mjs';
import { pyTextWrap } from '../js/cli.mjs';
import { pySplitLines } from '../js/lib/pydiff.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROBE = path.join(ROOT, 'tests', 'fixtures', 'pure_probe.mjs');
const SNAPSHOTS = path.join(ROOT, 'tests', '__snapshots__');
// The same key vocabulary as `harness_golden.PLATFORM_ONLY` and `PLATFORM_EXPECTED`. Three
// mechanisms in this suite declare a platform and they all spell it these two ways.
const PLATFORM = process.platform === 'win32' ? 'win32' : 'posix';

/**
 * The machine literals, longest first — see the recorder's `_machine_prefixes`, which this
 * mirrors spelling for spelling. `<TMP>` is here because a POSIX temp directory is NOT under
 * `$HOME` (a Windows one is, which is why `<HOME>` covered it here by accident), and every
 * literal is registered through `realpathSync` as well: macOS resolves `/tmp` to
 * `/private/tmp`, Windows can hand back `%TEMP%` as an 8.3 short form, and `py_resolve`
 * answers with the resolved path either way.
 */
function machinePrefixes() {
  const pairs = [];
  for (const [literal, token] of [[ROOT, '<CWD>'], [path.dirname(ROOT), '<CWD_PARENT>'],
    [homedir(), '<HOME>'], [tmpdir(), '<TMP>']]) {
    for (const spelling of [literal, realpathSync(literal)]) {
      for (const s of [spelling, spelling.replaceAll('\\', '/')]) {
        if (s && !pairs.some(([l, t]) => l === s && t === token)) pairs.push([s, token]);
      }
    }
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

function normalise(value, prefixes) {
  if (typeof value === 'string') {
    let out = value;
    for (const [literal, token] of prefixes) out = out.replaceAll(literal, token);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => normalise(v, prefixes));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v, prefixes)]));
  }
  return value;
}

function runProbe(cases, asciiMode) {
  const job = path.join(makeSandbox('pure-snap-').path, 'job.json');
  writeFileSync(job, JSON.stringify({ cases }), 'utf8');
  const env = { ...process.env };
  delete env.GENESEED_TUI_ASCII;
  if (asciiMode) env.GENESEED_TUI_ASCII = '1';
  const p = spawnSync(process.execPath, [PROBE, job], { cwd: ROOT, env, encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024 });
  assert.equal(p.status, 0, `pure_probe.mjs failed (${p.status}):\n${p.stderr}`);
  return JSON.parse(p.stdout).results;
}

/** An argument list can be four hundred lines long; a failure message must still be read. */
function brief(args) {
  const s = JSON.stringify(args);
  return s.length > 160 ? `${s.slice(0, 160)}… (${s.length} chars)` : s;
}

function load(name) {
  const file = path.join(SNAPSHOTS, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The facts a case demands of the machine replaying it. A guard that does not hold means the
 * answer was never comparable here — so the case is SKIPPED and counted, and the count is
 * asserted, because the width sweep's rule is that a skip is not a pass.
 */
function guardHolds(row) {
  const g = row.guard;
  if (!g) return true;
  if ('utcoffset' in g) {
    return -new Date(row.args[0] * 1000).getTimezoneOffset() * 60 === g.utcoffset;
  }
  if ('anchor' in g) return path.parse(ROOT).root === g.anchor;
  throw new Error(`unknown guard ${JSON.stringify(g)} on ${row.fn} — a guard this replay `
    + 'cannot evaluate is a case it would silently assert or silently skip, and neither is '
    + 'acceptable. Teach it the key or take the guard out.');
}

const primitives = load(path.join('primitives', `${PLATFORM}.json`));
const dwidth = load('dwidth.json');
const winUserPath = load('win_user_path.json');
const textwrapCorpus = load('textwrap.json');

test('the primitive corpus replays against the port', { skip: primitives ? false
  : `tests/__snapshots__/primitives/${PLATFORM}.json has not been recorded — the ${PLATFORM} `
    + 'half comes from a run on that platform (the `record-corpus` workflow job records the '
    + 'posix one)' }, () => {
  const prefixes = machinePrefixes();
  const cases = primitives.cases.map((c) => ({ fn: c.fn, args: c.args }));
  const plain = runProbe(cases, false);
  const tiered = runProbe(cases, true);
  assert.equal(plain.length, primitives.cases.length);

  let skipped = 0;
  for (const [i, row] of primitives.cases.entries()) {
    if (!guardHolds(row)) { skipped += 1; continue; }
    const where = `case ${i}: ${row.fn}(${brief(row.args)})`;
    assert.deepStrictEqual(normalise(plain[i], prefixes), row.result,
      `${where} disagrees with the recorded answer`);
    const wantAscii = 'result_ascii' in row ? row.result_ascii : row.result;
    assert.deepStrictEqual(normalise(tiered[i], prefixes), wantAscii,
      `${where} disagrees with the recorded answer under GENESEED_TUI_ASCII=1`);
  }
  // Every skip is a case this run did NOT gate, so it is reported rather than swallowed. On
  // the machine that recorded the corpus it is zero.
  if (skipped) {
    console.log(`[pure-snapshot] ${skipped} of ${primitives.cases.length} cases were `
      + 'SKIPPED: their `guard` names a local-time offset or a drive this machine does not '
      + 'share with the recorder. They are declared, not asserted, on this run.');
  }
  assert.ok(skipped < primitives.cases.length, 'every case was skipped — nothing was gated');
});

test('the recorded corpus is the shape it claims to be', { skip: primitives ? false
  : 'not recorded on this platform' }, () => {
  // The positive controls. Each one is a way the corpus could be green while measuring
  // nothing, and each has been a real failure somewhere in this port's history.
  assert.equal(primitives.platform, PLATFORM,
    'this file is the other platform\'s half — replaying it here compares two operating '
    + 'systems, not two implementations');
  assert.ok(primitives.cases.length > 1000, 'the corpus collapsed');
  assert.ok(new Set(primitives.cases.map((c) => c.fn)).size > 50,
    'the corpus covers a handful of functions, not the file');
  // The glyph axis. Without this, a corpus recorded with the tier stuck on one setting would
  // replay green while gating one of the two states it claims to cover.
  assert.ok(primitives.cases.some((c) => 'result_ascii' in c),
    'not one case answers differently under GENESEED_TUI_ASCII — the tier axis is vacuous');
  // The reference bugs frozen by this recording each carry a marker naming where the decision
  // is written down. A note that quietly stops being emitted is a bug that quietly becomes
  // an unremarked-on fact.
  const noted = primitives.cases.filter((c) => 'note' in c);
  assert.ok(noted.length > 0, 'no case carries a reference-bug note');
  for (const c of noted) assert.match(c.note, /docs\/port-ledger\.md/);
});

// ---------------------------------------------------------------------------------------------
// THE COVERAGE TIER — `tests/test_pure_function_parity.py`'s
// `ThePureFunctionsAgreeOnEveryInputNoCellCanBuild`, minus its one comparison.
//
// WHAT CROSSES AND WHAT DIES, and the split is the whole point of the class. Its first test is
// `test_every_case_agrees_in_both_glyph_modes` — an equality between a Python probe and a Node
// one, which dies with the reference and is already replaced above by the replay against the
// RECORDED answers. Everything else in it is a claim about the CORPUS: that it reaches an arm,
// that it produced both answers of a two-valued decision, that a fallback was actually taken.
// Those are what stop the corpus from silently ceasing to exercise a function it still names,
// and none of them needs a second implementation to be true.
//
// ASSERTED ON THE PORT'S LIVE ANSWERS, not on the recorded column. The recorded column is
// already gated byte-for-byte by the replay above, so re-reading it here would prove the file
// has not changed — a fact, but not this one. Running the probe says the code still takes the
// arm today.

const coverageSkip = primitives ? false
  : `tests/__snapshots__/primitives/${PLATFORM}.json has not been recorded on this platform`;

/** The port's answers for one function, in corpus order. Loud when a function has no cases. */
function answersFor(fn, asciiMode = false) {
  const picked = primitives.cases.filter((c) => c.fn === fn);
  assert.ok(picked.length > 0, `no ${fn} cases in the corpus at all`);
  return runProbe(picked.map((c) => ({ fn: c.fn, args: c.args })), asciiMode);
}

test('the animation corpus reaches the arm no cell can reach', { skip: coverageSkip }, () => {
  // THE POSITIVE CONTROL FOR THE WHOLE ANIMATION ENTRY, and it has to name the ANIMATED arm
  // specifically. Off a TTY `playLine` prints a title and a static card — which is all any cell
  // could ever see, since none of them gets past `setup`'s isatty gate — so a corpus of static
  // cases would agree perfectly between two implementations while the scrolling half, which is
  // the entire module, went untested. `\x1b[{n}A` is the cursor move only the animation writes.
  const out = answersFor('play_line');
  const animated = out.filter((s) => typeof s === 'string' && s.includes('\x1b['));
  assert.ok(animated.length >= 3, 'the port never took the animated arm');
  assert.ok(animated.some((s) => s.includes('A\r')),
    'no cursor-up move — the frames were not redrawn in place');
  // BOTH arms, or the corpus is not separating them: a probe stuck on the animated one would
  // satisfy every assertion above and gate nothing about the static card.
  assert.ok(out.some((s) => typeof s === 'string' && !s.includes('\x1b[')),
    'the port never took the STATIC arm either, so the corpus is not separating the two');
});

test('the animation corpus can see the newline translation', { skip: coverageSkip }, (t) => {
  // `print()` and `sys.stdout.write` translate `\n` in the TEXT layer, so a capture that is not
  // a real text stream compares LF against LF and a CRLF split walks straight through it —
  // P5b's transport hole. This asserts the capture is going through the layer at all; where it
  // is not, there is nothing to see rather than nothing to check.
  if (path.sep === '/') {
    t.diagnostic('no newline translation to see on this platform');
    return;
  }
  const out = answersFor('play_line');
  assert.ok(out.some((s) => typeof s === 'string' && s.includes('\r\n')),
    'the capture shows no CRLF — it is not going through the text layer, and this corpus '
    + 'cannot see a newline bug');
});

test('the anim-ok corpus produced both answers', { skip: coverageSkip }, () => {
  // A decision table gated only where it says yes is half a gate.
  const out = answersFor('anim_ok');
  assert.ok(out.includes(true), 'no case answers true');
  assert.ok(out.includes(false), 'no case answers false');
});

test('the art table falls back without inheriting a function', { skip: coverageSkip }, () => {
  // `ART.get(theme, ART[DEFAULT])` against `ART[theme]`. `constructor` and `__proto__` are a
  // miss on the reference and a HIT on the prototype chain in JavaScript, so a port spelled
  // with `??` hands back a Function here. Every miss must land on the neutral theme — and a
  // REAL theme must not, or the fallback is all the table does.
  const out = answersFor('art_for');
  const neutral = out[7];
  assert.equal(neutral.title, 'Geneseed');
  for (const i of [8, 9, 10, 11, 12, 13]) {     // nosuchtheme, "", and the four inherited names
    assert.deepStrictEqual(out[i], neutral, `art_for case ${i} did not fall back`);
  }
  assert.notDeepStrictEqual(out[0], neutral,
    'every theme resolved to neutral — the table is not being read');
});

test('the probes produce the panel and not an empty echo', { skip: coverageSkip }, () => {
  // THE POSITIVE CONTROL FOR THE CORPUS ITSELF. Every replay assertion in this file is an
  // equality against a recorded value, and a probe that returned nothing on both sides would
  // satisfy all of them if the recording had been made the same way. So one answer is read for
  // its CONTENT — the status panel, which carries the counts and the freshness line.
  const first = runProbe([{ fn: primitives.cases[0].fn, args: primitives.cases[0].args }], false)[0];
  assert.ok(Array.isArray(first), `the first case answered ${typeof first}, not a panel`);
  assert.ok(first[0].includes('┌─ ◆ Geneseed — status '), first[0]);
  assert.ok(first.some((ln) => /\d+ agents · \d+ skills · \d+ laws/.test(ln)),
    `no counts line in the panel:\n${first.join('\n')}`);
  assert.ok(first.some((ln) => ln.includes('✓ up to date')), first.join('\n'));
});

// The remaining coverage claims are about the corpus's INPUTS, so they read the case list rather
// than run anything. Each one names a specific way the corpus could be green while comparing two
// spellings of the same rule — and each is a shape the LIVE tree cannot produce, which is why
// these functions have a corpus at all rather than a cell.

/** Every `args` list recorded for `fn`. Loud when a function has no cases. */
function argsFor(fn) {
  const picked = primitives.cases.filter((c) => c.fn === fn).map((c) => c.args);
  assert.ok(picked.length > 0, `no ${fn} cases in the corpus at all`);
  return picked;
}

test('the fence corpus actually varies the fence', { skip: coverageSkip }, () => {
  // The live tree never leaves the floor, so a corpus whose every case also returned four
  // backticks would be an equality between two constants — green forever, and green on a port
  // that hardcoded `max(4, …)`'s floor and nothing else.
  const fences = answersFor('fence_for');
  assert.ok(fences.includes('`'.repeat(4)), 'no case exercises the max(4, …) floor');
  assert.ok(fences.some((f) => f.length > 4),
    'every case returned the floor — this corpus cannot tell fenceFor from a hardcoded four');
  assert.equal(Math.max(...fences.map((f) => f.length)), 13);   // the 12-run case, + 1
});

test('the diff corpus reaches past what a cell can seed', { skip: coverageSkip }, () => {
  // Three things, because a corpus of pairs that all differ trivially is an equality between
  // two one-hunk diffs — green on any correct implementation AND on one that got `autojunk` or
  // the tie rule wrong.
  const cases = primitives.cases.filter((c) => c.fn === 'unified_diff');
  assert.ok(cases.length > 0, 'no unified_diff cases in the corpus at all');
  const out = runProbe(cases.map((c) => ({ fn: c.fn, args: c.args })), false);
  const hunks = out.map((a) => a.filter((ln) => ln.startsWith('@@')).length);
  assert.ok(hunks.some((h) => h > 1), 'no case produces two hunks — the grouping path is untested');
  assert.ok(hunks.some((h) => h === 0), "no case produces an EMPTY diff — 'identical' is untested");
  // The one difference no acceptance cell can see: SequenceMatcher purges popular elements only
  // at or past 200, so a corpus that never reaches it cannot tell autojunk from its absence.
  const long = cases.map((c, i) => [c, out[i]]).filter(([c]) => c.args[1].length >= 200);
  assert.ok(long.length > 0, 'no case reaches the 200-element autojunk threshold');
  assert.ok(long.some(([, a]) => a.length > 0),
    'every long case produced an empty diff, so "reaches 200" is a claim about the INPUT only');
});

test('the splitlines corpus breaks where a newline split does not', { skip: coverageSkip }, () => {
  // `pySplitLines` exists for the boundaries `split('\n')` does not break on — \v, \f, \x1c,
  // U+2028 and the rest. A corpus without one is an equality between two `split('\n')`s.
  const extra = argsFor('py_split_lines')
    .filter(([s]) => pySplitLines(s).length !== s.split('\n').length);
  assert.ok(extra.length > 0, "no case breaks on a boundary split('\\n') misses, so the "
    + 'pySplitLines gate is vacuous');
});

test('the capitalize corpus has a case where the rest matters', { skip: coverageSkip }, () => {
  // `str.capitalize()` lowercases the REST; `s[0].toUpperCase() + s.slice(1)` does not. Every
  // shipped posture and mode name is already lowercase, so the difference is invisible in the
  // live tree — which is the entire reason this is a corpus and not a cell.
  const naive = argsFor('py_capitalize')
    .filter(([s]) => s && `${s[0].toUpperCase()}${s.slice(1).toLowerCase()}`
      !== `${s[0].toUpperCase()}${s.slice(1)}`);
  assert.ok(naive.length > 0, 'no case distinguishes str.capitalize() from a naive '
    + 'uppercase-first, so this corpus proves nothing');
});

test('the corpus separates code points from UTF-16 units', { skip: coverageSkip }, () => {
  // `len()` counts code points and `String.length` counts UTF-16 units. Measured rather than
  // trusted: at least one case must be a string whose two lengths DIFFER.
  const astral = argsFor('py_len').filter(([s]) => [...s].length !== s.length);
  assert.ok(astral.length > 0, 'no case distinguishes code points from UTF-16 units, so the '
    + 'pyLen gate is vacuous');
});

test('the is-absolute corpus reaches the rootless shape', { skip: coverageSkip }, () => {
  // `pyIsAbsolute` exists for ONE disagreement: a rootless `/x` or `\x`, which
  // `path.isAbsolute` calls absolute and `Path.is_absolute` does not. On POSIX the two rules
  // genuinely coincide, so this asserts the SHAPE is present rather than that the answers
  // differ on this machine.
  const cases = argsFor('py_is_absolute').map(([s]) => s);
  assert.ok(cases.some((s) => '/\\'.includes(s.slice(0, 1)) && !/^([/\\])\1/.test(s)),
    'no case is a ROOTLESS absolute path, so the pyIsAbsolute gate cannot tell the rules apart');
  assert.ok(cases.some((s) => /^[A-Za-z]:[^\\/]/.test(s)),
    "no case is drive-RELATIVE (`C:x`), the shape a naive `parse().root !== ''` rule gets wrong");
});

test('the agent-entry corpus can see the absolute rule it depends on', { skip: coverageSkip }, () => {
  // `installAgentEntryOf` SKIPS an absolute entry, so a corpus whose lists hold only relative
  // ones exercises the first-match walk and never the predicate. At least one case must pair a
  // rootless-absolute entry with a relative one — the only shape where the two is-absolute
  // rules pick different ENTRIES.
  const both = argsFor('install_agent_entry_of')
    .map(([ls]) => ls)
    .filter((ls) => Array.isArray(ls)
      && ls.some((e) => typeof e === 'string' && '/\\'.includes(e.slice(0, 1)))
      && ls.some((e) => typeof e === 'string' && !'/\\'.includes(e.slice(0, 1))));
  assert.ok(both.length > 0, 'no case pairs a rootless-absolute entry with a relative one, so '
    + 'the corpus cannot see which entry the predicate skips');
});

test('every corpus names a patch-independent interpreter', () => {
  // THE TOOLCHAIN IS NOT THE CODE UNDER TEST. `recorded_with` is written by three recorders
  // and read by no gate, so its only comparison is the whole-file `diff` that `record-corpus`
  // runs after re-recording `dwidth.json` and `win_user_path.json` on ubuntu — and `3.13.5`
  // against `3.13.15` was the entire failure of run 31554447437, over a 196 608-codepoint
  // sweep that hashed identically on both machines. Major.minor is what ci.yml pins and the
  // granularity `unicodedata.unidata_version` is decided at; the patch digit is provenance no
  // second machine can reproduce.
  //
  // THE RULE IS SPELT IN TWO FILES, so this is what stops one of them drifting back — the
  // recorders cannot import each other, and a shared helper for two lines would be the
  // abstraction, not the gate.
  const docs = [[`primitives/${PLATFORM}.json`, primitives], ['dwidth.json', dwidth],
    ['win_user_path.json', winUserPath]].filter(([, d]) => d);
  assert.ok(docs.length, 'no corpus is recorded on this platform — nothing was checked');
  for (const [name, doc] of docs) {
    assert.match(doc.recorded_with.python, /^\d+\.\d+$/,
      `${name} records the interpreter as ${JSON.stringify(doc.recorded_with.python)}. A patch `
      + 'digit makes a corpus disagree with itself across two machines that both recorded it '
      + 'correctly, which is a red CI for a fact about neither implementation.');
    // The half that IS a property of the answers: `difflib`'s autojunk, `ntpath`'s spellings
    // and `unicodedata`'s tables are CPython's. A PyPy recording is a different oracle.
    assert.equal(doc.recorded_with.implementation, 'CPython',
      `${name} was recorded by ${doc.recorded_with.implementation}`);
  }
  // The companion leak, found behind the first one because the CI step runs under `bash -e`
  // and never reached the second `diff`: this document is re-recorded on Linux and compared
  // byte for byte, so it may not name the platform that typed it.
  if (winUserPath) {
    assert.ok(!('recorded_on' in winUserPath),
      'win_user_path.json declares platform_independent and records the recorder\'s platform. '
      + 'One of the two is false on every machine that is not the one that wrote it.');
  }
});

test('the width sweep still produces the recorded runs', { skip: dwidth ? false
  : 'tests/__snapshots__/dwidth.json has not been recorded' }, () => {
  // THE PIN, CHECKED WITHOUT AN INTERPRETER. While the reference exists, the sweep runs live
  // against `unicodedata` and ci.yml's `python-version: "3.13"` is what stops a floating pin
  // from switching that gate off. This is the replacement: the version the runs were measured
  // at is DECLARED in the document, and the port's own constant is checked against it.
  assert.equal(dwidth.unidata_version, DWIDTH_UNIDATA,
    `the sweep was recorded against unidata ${dwidth.unidata_version} and js/tui.mjs's `
    + `WIDE/COMBINING tables declare ${DWIDTH_UNIDATA}. Regenerating the tables means moving `
    + 'DWIDTH_UNIDATA and re-recording this corpus together.');
  assert.equal(dwidth.declared_by.value, DWIDTH_UNIDATA,
    'the constant moved after the corpus was recorded');

  // The document self-checks before it is used as an oracle: a hand-edited `rle` that no
  // longer hashes to its own `sha256` is not the reference's answer any more.
  const canonical = JSON.stringify(dwidth.rle);
  assert.equal(createHash('sha256').update(canonical, 'utf8').digest('hex'), dwidth.sha256,
    'dwidth.json\'s runs do not hash to its own sha256 — the file was edited by hand');
  assert.equal(dwidth.rle.length, dwidth.runs);

  const live = runProbe([{ fn: 'dwidth_rle', args: dwidth.range }], false)[0];
  if (JSON.stringify(live) !== canonical) {
    const n = Math.min(live.length, dwidth.rle.length);
    for (let i = 0; i < n; i += 1) {
      const [rcp, rw] = dwidth.rle[i];
      const [lcp, lw] = live[i];
      if (rcp !== lcp || rw !== lw) {
        assert.fail(`run ${i} differs: the reference recorded width ${rw} from `
          + `U+${rcp.toString(16).toUpperCase().padStart(4, '0')}, the port answers width `
          + `${lw} from U+${lcp.toString(16).toUpperCase().padStart(4, '0')} `
          + `(${dwidth.rle.length} recorded runs vs ${live.length} live)`);
      }
    }
    assert.fail(`the run lists agree on their first ${n} runs and differ in length: `
      + `${dwidth.rle.length} recorded vs ${live.length} live`);
  }

  // The positive control the sweep has always needed: two implementations that both answered
  // 1 for every codepoint would satisfy every equality above.
  assert.deepStrictEqual(new Set(dwidth.rle.map(([, w]) => w)), new Set([0, 1, 2]),
    'the recorded sweep does not carry all three widths, so it cannot tell a working dwidth '
    + 'from a constant function');
  assert.equal(dwidth.codepoints, dwidth.range[1] - dwidth.range[0]);
  // The sample is the readable window into the hash: a hash line that changed tells you the
  // tables moved, these tell you where.
  for (const [name, entry] of Object.entries(dwidth.sample)) {
    const cp = parseInt(name.slice(2), 16);
    assert.equal(dwidth.rle.filter(([start]) => start <= cp).at(-1)[1], entry.width,
      `${name}'s sample width disagrees with the runs it is drawn from`);
  }
});

test('pyTextWrap still answers every recorded wrap', { skip: textwrapCorpus ? false
  : 'tests/__snapshots__/textwrap.json has not been recorded' }, () => {
  // THE ONE CPYTHON ORACLE P1 LEFT AS A LIVE COMPARISON. `tests/test_cli_reference.py`'s
  // sweep computes its expectation from the RUNNING interpreter's `textwrap`, so it dies with
  // `rituals/harness.py` — and what would survive is 26 help fixtures at ONE wrap column,
  // which that sweep's own docstring records as having proved nothing: a greedy space-only
  // wrap passed all 26. `pyTextWrap` is ~40 lines including a hand-transcribed `WORDSEP`, and
  // Task 10b showed its payload is one term subtle. This is the frozen half.
  assert.equal(textwrapCorpus.corpus, 'textwrap');
  assert.equal(textwrapCorpus.oracle, 'textwrap.wrap, post-gh-139065',
    'the recording does not declare which side of gh-139065 it is on, so it cannot be told '
    + 'apart from a corpus frozen against the behaviour CPython already fixed');

  // The document self-checks before it is used as an oracle — a hand-edited matrix that no
  // longer hashes to its own sha256 is not the reference's answer any more. The canonical
  // form is `json.dumps(separators=(',', ':'), ensure_ascii=False)`, which is byte for byte
  // what `JSON.stringify` produces.
  assert.equal(createHash('sha256').update(JSON.stringify(textwrapCorpus.matrix), 'utf8')
    .digest('hex'), textwrapCorpus.sha256,
  'textwrap.json\'s matrix does not hash to its own sha256 — the file was edited by hand');

  // The positive controls. Every assertion below is vacuous over an empty or one-width corpus,
  // and "the widths collapsed" and "the port agrees everywhere" are the same green.
  const [lo, hi] = textwrapCorpus.widths;
  const widths = Array.from({ length: hi - lo }, (_, i) => lo + i);
  assert.ok(textwrapCorpus.cases.length > 30, 'the case list collapsed');
  assert.ok(widths.length > 100, 'the width band collapsed to a corpus at one width, which is '
    + 'not evidence about an algorithm');
  assert.equal(textwrapCorpus.rows, textwrapCorpus.cases.length * widths.length);
  assert.ok(textwrapCorpus.matrix.some((rows) => rows.some((lines) => lines.length > 1)),
    'not one recorded case wraps at all — the corpus cannot tell a line breaker from `[t]`');

  for (const [i, t] of textwrapCorpus.cases.entries()) {
    for (const [j, w] of widths.entries()) {
      assert.deepStrictEqual(pyTextWrap(t, w), textwrapCorpus.matrix[i][j],
        `case ${i} at width ${w}: the port's line breaker disagrees with the textwrap.wrap `
        + `the reference recorded, on ${JSON.stringify(t)}`);
    }
  }

  // The sample is the readable window into the hash, and it is checked against the matrix it
  // is drawn from so it cannot rot into decoration.
  for (const [key, lines] of Object.entries(textwrapCorpus.sample)) {
    const [i, w] = key.split('@').map(Number);
    assert.deepStrictEqual(textwrapCorpus.matrix[i][widths.indexOf(w)], lines,
      `sample ${key} disagrees with the matrix row it names`);
  }
});

test('winUserPathScript still builds every recorded script', { skip: winUserPath ? false
  : 'tests/__snapshots__/win_user_path.json has not been recorded' }, () => {
  // A SEPARATE CORPUS, and that is the point of it. `win_user_path_script` appears ZERO times
  // in `tests/fixtures/pure_probe.py`, so nothing in `primitives/` covers a line of it —
  // every migration plan for this branch assumed it rode along with the probe.
  assert.ok(winUserPath.cases.length > 0, 'the recorded corpus is empty');
  for (const [i, c] of winUserPath.cases.entries()) {
    assert.equal(winUserPathScript(c.action, c.directory), c.script,
      `case ${i}: winUserPathScript(${JSON.stringify(c.action)}, `
      + `${JSON.stringify(c.directory)}) [row ${c.row}] disagrees with the script the `
      + 'reference recorded');
  }
  // The severity assertion, carried over from the reference's own suite so it survives the
  // deletion: `'Machine'` needs admin AND truncates the system PATH for every user on the box.
  for (const c of winUserPath.cases) {
    assert.ok(!c.script.includes("'Machine'"), `row ${c.row} reaches the machine scope`);
    assert.ok(c.script.includes("'User'"), `row ${c.row} lost its user scope`);
  }
  // The corpus is recorded on Windows and replayed everywhere, because the BUILDER reads
  // nothing host-shaped. This run on a non-Windows host is what measures that claim.
  assert.equal(winUserPath.platform_independent, true);
});
