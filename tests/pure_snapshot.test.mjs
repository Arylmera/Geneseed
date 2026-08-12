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
  const job = path.join(mkdtempSync(path.join(tmpdir(), 'pure-snap-')), 'job.json');
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
