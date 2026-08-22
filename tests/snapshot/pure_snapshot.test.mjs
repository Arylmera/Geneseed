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
 *     counterpart, which is why `js/ui/tui.mjs` carries hand-written range tables and why
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
import {
  chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { EOL, homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DWIDTH_UNIDATA } from '../../js/ui/tui.mjs';
import { makeCfg } from '../../js/build/source.mjs';
import { winUserPathScript } from '../../js/hosts/link.mjs';
import { wrapText } from '../../js/ui/cli.mjs';
import { splitLines } from '../../js/lib/udiff.mjs';
import { renderAll } from '../../js/build/render.mjs';
import { modeOptions, postureOptions, themeOptions } from '../../js/maintain/setup.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
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

/**
 * `extraEnv` drives an axis whose two states are "set" and "NOT PRESENT AT ALL" — a `null`
 * value REMOVES the variable, which is the only way to reach the second state of
 * `NoDefaultCurrentDirectoryInExePath`. Removed CASE-INSENSITIVELY: `{ ...process.env }` is a
 * snapshot of the OS's own spelling, and Windows hands the block back in whatever case it was
 * set in, so a `delete env.NoDefault…` matching nothing leaves the variable in the child and
 * the axis silently runs one state twice. (The same trap the reference's `_run` documents.)
 */
function runProbe(cases, asciiMode, extraEnv = null) {
  const job = path.join(makeSandbox('pure-snap-').path, 'job.json');
  writeFileSync(job, JSON.stringify({ cases }), 'utf8');
  const env = { ...process.env };
  delete env.GENESEED_TUI_ASCII;
  if (asciiMode) env.GENESEED_TUI_ASCII = '1';
  for (const [k, v] of Object.entries(extraEnv ?? {})) {
    for (const existing of Object.keys(env).filter((e) => e.toLowerCase() === k.toLowerCase())) {
      delete env[existing];
    }
    if (v !== null) env[k] = v;
  }
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
    + 'half was recorded on that platform by a job that no longer exists, so a missing half can '
    + 'never be filled)' }, () => {
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
  for (const c of noted) assert.match(c.note, /docs\/limits\.md/);
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
  // `splitLines` exists for the boundaries `split('\n')` does not break on — \v, \f, \x1c,
  // U+2028 and the rest. A corpus without one is an equality between two `split('\n')`s.
  const extra = argsFor('py_split_lines')
    .filter(([s]) => splitLines(s).length !== s.split('\n').length);
  assert.ok(extra.length > 0, "no case breaks on a boundary split('\\n') misses, so the "
    + 'splitLines gate is vacuous');
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
    + 'codePointLength gate is vacuous');
});

test('the is-absolute corpus reaches the rootless shape', { skip: coverageSkip }, () => {
  // `isAbsolutePath` exists for ONE disagreement: a rootless `/x` or `\x`, which
  // `path.isAbsolute` calls absolute and `Path.is_absolute` does not. On POSIX the two rules
  // genuinely coincide, so this asserts the SHAPE is present rather than that the answers
  // differ on this machine.
  const cases = argsFor('py_is_absolute').map(([s]) => s);
  assert.ok(cases.some((s) => '/\\'.includes(s.slice(0, 1)) && !/^([/\\])\1/.test(s)),
    'no case is a ROOTLESS absolute path, so the isAbsolutePath gate cannot tell the rules apart');
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

// ---------------------------------------------------------------------------------------------
// THE THREE COVERAGE CLAIMS THAT ARE NOT ABOUT THE RECORDED CORPUS AT ALL, and finding that out
// is the whole story of this block.
//
// `tests/__snapshots__/primitives/*.json` holds 1 950 cases over 63 functions — and `build_plan`,
// `daemon_args`, `restart_args`, `py_which` and `manifest_is_claude` are in NONE of them. The
// reference's class assembles its inputs as `_cases() + _manifest_cases(tmp) + _which_cases(tmp) +
// _web_daemon_cases(tmp)`, and only the first is machine-independent enough to be written down;
// the other three seed a temporary directory and name it in their own arguments, so the recorder
// skips them. The comparison was therefore the ONLY thing that ever ran those five functions
// through a probe, and at the cut they lose their exerciser entirely — not just their oracle.
//
// So these three own their fixtures. They are NOT gated on `coverageSkip`: nothing here reads the
// recording, which means they still run on a platform whose corpus has never been recorded.

/** `_which_cases` — a seeded PATH, because `which` reads the filesystem. */
function whichCases(tmp) {
  const a = path.join(tmp, 'whichA');
  const b = path.join(tmp, 'whichB');
  for (const d of [a, b]) mkdirSync(d, { recursive: true });
  // Windows finds `zzhit` through PATHEXT; POSIX needs the name as spelled and the exec bit.
  for (const [d, names] of [[a, ['zzhit.cmd', 'zzhit']], [b, ['zzhit.cmd', 'zzhit', 'zzonly']]]) {
    for (const n of names) {
      writeFileSync(path.join(d, n), '', 'utf8');
      chmodSync(path.join(d, n), 0o755);
    }
  }
  mkdirSync(path.join(a, 'zzdir'), { recursive: true });   // a DIRECTORY with a command's name
  writeFileSync(path.join(a, 'zznotexec'), '', 'utf8');
  chmodSync(path.join(a, 'zznotexec'), 0o644);
  const sep = path.delimiter;
  const both = `${a}${sep}${b}`;
  return [
    ['zzhit', a],
    ['zzhit.cmd', a],                       // already spelled: PATHEXT is not appended
    ['zzonly', both],                       // second entry wins only because the first misses
    ['zzonly', a],                          // ...and misses entirely when it is absent
    ['zzdir', a],                           // a directory is never the answer
    ['zznotexec', a],                       // POSIX: no exec bit. Windows: found.
    ['zzmissing', both],
    ['zzhit', ''],                          // an empty PATH is one empty entry, not none
    ['zzhit', `${sep}${a}`],                // a leading empty entry is searched, as `.`
    ['zzhit', `${a}${sep}${a}`],            // deduped by normcase
    ['zzhit', `${a.replaceAll('\\', '/')}${sep}${b}`],
    [path.join(a, 'zzhit.cmd'), both],      // a path, not a name: checked as given
    ['nosuch/zzhit', both],
    // THE CASE THE WHOLE AXIS BELOW EXISTS FOR. `geneseed`/`geneseed.cmd` is a real file at the
    // repo root and the probe runs with `cwd: ROOT`, so a port that prepends `.` unconditionally
    // answers with it here. Every other case names a directory the cwd is not.
    ['geneseed', a],
    ['node', process.env.PATH ?? ''],       // the one call the verb actually makes
  ].map(([cmd, p]) => ({ fn: 'py_which', args: [cmd, p] }));
}

test('the curdir rule is driven in both of its environment states', {
  skip: process.platform === 'win32' ? false
    : 'NeedCurrentDirectoryForExePath is a Windows API — on POSIX `shutil.which` has no such axis',
}, () => {
  // `NoDefaultCurrentDirectoryInExePath` is an INPUT to `shutil.which`, and until CI ran this
  // corpus nothing varied it: Git Bash defines it and so does this repo's developer machine, so
  // every recording measured ONE state, `which` was written to match that state, and the port
  // answered null where the reference answered `.\geneseed.CMD` the first time it ran somewhere
  // the variable was absent.
  //
  // WHAT THE REFERENCE ASSERTED AND WHAT SURVIVES. It compared the two implementations under both
  // states and then guarded against vacuity — "the variable changed nothing, so this ran the same
  // state twice". The comparison dies; the vacuity guard is the half that was always the point,
  // and asking the reference (`python -m unittest tests.test_pure_function_parity`, while it is
  // still here) says exactly which case carries it: of fifteen, ONE answer moves, and it is
  // `geneseed`. That is stronger than "the two runs differ" — it says `.` went in at the FRONT of
  // the search and displaced nothing else.
  const tmp = makeSandbox('pure-which-');
  try {
    const cases = whichCases(tmp.path);
    const defined = runProbe(cases, false, { NoDefaultCurrentDirectoryInExePath: '1' });
    const absent = runProbe(cases, false, { NoDefaultCurrentDirectoryInExePath: null });
    assert.equal(defined.length, cases.length);

    const moved = cases
      .map((c, i) => i)
      .filter((i) => JSON.stringify(defined[i]) !== JSON.stringify(absent[i]));
    assert.equal(moved.length, 1, 'the variable moved '
      + `${moved.length} of ${cases.length} answers (${moved.map((i) => cases[i].args[0])}). `
      + 'Zero means this ran one state twice and the corpus still cannot see the '
      + 'current-directory rule; more than one means `.` is displacing entries rather than being '
      + 'prepended to them.');
    const [i] = moved;
    assert.equal(cases[i].args[0], 'geneseed',
      'the case that moves is not the separator-free name only the cwd can resolve');
    assert.equal(defined[i], null,
      'the current directory was searched with NoDefaultCurrentDirectoryInExePath DEFINED');
    // Derived, not transcribed: the answer must be a `.`-relative path, its extension must have
    // come from PATHEXT rather than from the disk (`geneseed.cmd` is lower case on disk and the
    // answer carries PATHEXT's spelling), and it must name a file that is really there.
    const m = /^\.[\\/]geneseed(\.[^.\\/]+)$/.exec(absent[i] ?? '');
    assert.ok(m, `with the variable absent the answer was ${JSON.stringify(absent[i])}, not a `
      + 'cwd-relative geneseed');
    const pathext = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    assert.ok(pathext.some((e) => e === m[1]),
      `${m[1]} is not one of PATHEXT's spellings (${pathext.join(';')})`);
    assert.ok(existsSync(path.join(ROOT, absent[i])), `${absent[i]} does not exist under ${ROOT}`);
  } finally {
    tmp.cleanup();
  }
});

/** `_web_daemon_cases` — P6h's three, each here for a reason no cell can cover. */
function webDaemonCases(tmp) {
  const [built, bare, nosrc] = ['web-built', 'web-bare', 'web-nosrc'].map((n) => path.join(tmp, n));
  for (const d of [built, bare, nosrc]) mkdirSync(path.join(d, 'dist'), { recursive: true });
  writeFileSync(path.join(built, 'dist', 'index.html'), '<html>', 'utf8');
  for (const d of [built, bare]) writeFileSync(path.join(d, 'package.json'), '{}', 'utf8');
  const cases = [];
  // (dist, webDir, npm, interactive) -> the five answers, in the order `buildPlan` tests them.
  // `serve` first, because a built dist short-circuits every question below it.
  for (const [dist, webDir, npm, tty] of [
    [path.join(built, 'dist'), built, 'npm', true],      // serve
    [path.join(built, 'dist'), built, null, false],      // serve — dist wins over both
    [path.join(nosrc, 'dist'), nosrc, 'npm', true],      // no-source
    [path.join(bare, 'dist'), bare, null, true],         // no-npm
    [path.join(bare, 'dist'), bare, '', true],           // no-npm — `!npm` is falsy, not null
    [path.join(bare, 'dist'), bare, 'npm', false],       // no-tty
    [path.join(bare, 'dist'), bare, 'npm', true],        // ask
  ]) cases.push({ fn: 'build_plan', args: [dist, webDir, npm, tty] });
  for (const [port, theme] of [[4747, null], [4747, 'imperial'], [0, null], [65535, 'néutral'],
    // An EMPTY theme is falsy in both languages, so the flag is DROPPED rather than passed empty
    // — which would reach the child as `--theme` with the next flag as its value.
    [4747, '']]) {
    cases.push({ fn: 'daemon_args', args: [port, theme] });
    cases.push({ fn: 'restart_args', args: [theme] });
  }
  return cases;
}

test('the web-daemon corpus reaches every answer it claims', () => {
  // The shape a green mutation keeps asking for: an equality between two functions that both
  // returned one constant satisfied the reference's whole-corpus comparison forever. `buildPlan`
  // has five answers and only two are reachable from a cell — the other three need a run that
  // then blocks forever (`serve`, `ask`) or a machine without npm — so naming all five here is
  // what makes this the gate for them.
  const tmp = makeSandbox('pure-daemon-');
  try {
    const cases = webDaemonCases(tmp.path);
    const answers = runProbe(cases, false);
    const pick = (fn) => cases.map((c, i) => [c, answers[i]]).filter(([c]) => c.fn === fn)
      .map(([, a]) => a);

    const plans = pick('build_plan');
    assert.deepEqual([...new Set(plans)].sort(), ['ask', 'no-npm', 'no-source', 'no-tty', 'serve'],
      `the build-plan corpus answers ${JSON.stringify([...new Set(plans)])}, so it cannot tell `
      + 'buildPlan from a constant');
    // The argv the daemon is LAUNCHED with. The binary differs per side by design — each
    // re-executes itself — but the flags may not, and nothing else can compare them: no cell may
    // start a daemon, so a twin that dropped `--daemon-internal` would start a server that never
    // writes a record, and every observation of it would be the same twelve-second timeout the
    // reference produces when the child genuinely fails.
    const daemon = pick('daemon_args');
    const plain = ['--daemon-internal', '--port', '4747', '--no-browser'];
    assert.ok(daemon.some((a) => JSON.stringify(a) === JSON.stringify(plain)),
      `no plain daemon argv in ${JSON.stringify(daemon)}`);
    assert.ok(daemon.some((a) => JSON.stringify(a) === JSON.stringify([...plain, '--theme',
      'imperial'])), `no themed daemon argv in ${JSON.stringify(daemon)}`);
    assert.ok(pick('restart_args').some((a) => JSON.stringify(a)
      === JSON.stringify(['restart', '--no-browser'])), 'no plain restart argv');
    // The empty theme reaches BOTH builders and is dropped by both — the case that would
    // otherwise send `--theme` with the next token as its value.
    assert.equal(daemon.filter((a) => JSON.stringify(a) === JSON.stringify(plain)).length, 2,
      'the empty theme did not produce the same argv as no theme at all');
  } finally {
    tmp.cleanup();
  }
});

test('the fence corpus still describes the real tree', () => {
  // `js/build/generate.mjs` states that no CELL can vary the fence, and that is a claim about the
  // CONTENT of `src/` rather than about the code — so it is re-derived here instead of trusted.
  // The day a source file grows a four-backtick run the claim stops holding, a `prompt` cell
  // becomes able to cover the branch, and this fails to say so.
  //
  // SWEPT WIDER THAN THE REFERENCE, which rendered one theme at the default posture. Posture and
  // mode STRIP blocks, so a single render leaves source text unscanned, and theme substitutes
  // vocabulary that lands in the rendered file — three axes, every combination. The axes are READ
  // from the option tables rather than listed, so a posture added tomorrow is swept without an
  // edit here; a list would have gone stale silently, which is the failure this whole test is
  // about. Measured: 140 renders, 13 440 files, ~1.4 s.
  let longest = 0;
  let where = null;
  let scanned = 0;
  for (const [theme] of themeOptions()) {
    for (const [posture] of postureOptions()) {
      for (const [mode] of modeOptions()) {
        const { items } = renderAll(makeCfg({ posture, mode }), theme);
        for (const { rel, text } of items) {
          if (text === null) continue;
          scanned += 1;
          for (const m of text.matchAll(/`+/g)) {
            if (m[0].length > longest) { longest = m[0].length; where = `${rel} @ ${theme}/${posture}/${mode}`; }
          }
        }
      }
    }
  }
  // A vacuous scan agrees with anything: no files, or a regex that never matched, would satisfy
  // `longest < 4` perfectly.
  assert.ok(scanned > 1000, `the sweep rendered ${scanned} files`);
  assert.ok(longest > 0, 'not one backtick in the whole rendered tree — the scan found nothing, '
    + 'so `longest < 4` is a statement about the regex and not about `src/`');
  assert.ok(longest < 4, `${where} now holds a run of ${longest} backticks, so fenceFor no longer `
    + 'always returns the floor and the matrix CAN cover it — write the prompt cell and relax '
    + 'this test');
});

// ---------------------------------------------------------------------------------------------
// THE BYTE-BEARING PRIMITIVES AND THEIR PLATFORM DECLARATION —
// `TheByteBearingPrimitivesAgree`, `ThePlatformSensitiveAnswersAreDeclared` and
// `TheTildeUserFormIsADeliberateDivergence`, whose comparisons retire into the replay above and
// whose absolute halves land here.

test('the linesep corpus records this platform\'s translation', () => {
  // A comparison alone passes on two implementations that both write LF — the RIGHT answer on
  // POSIX and the wrong one on Windows, and no equality can tell those apart. So the answer for
  // `a\nb` is stated against os.linesep absolutely: the day either the writer or the recording
  // stops translating, this names it. Both are checked, because they can rot separately — the
  // corpus was recorded on a machine whose linesep is this one's.
  const want = Buffer.from(`a${EOL}b`, 'utf8').toString('hex');
  assert.equal(runProbe([{ fn: 'write_text_linesep', args: ['a\nb'] }], false)[0], want,
    'writeText no longer translates a bare newline to this platform\'s line ending');
  const recorded = primitives?.cases.find(
    (c) => c.fn === 'write_text_linesep' && c.args.length === 1 && c.args[0] === 'a\nb');
  assert.ok(recorded, 'the corpus has no write_text_linesep case for a bare newline');
  assert.equal(recorded.result, want,
    `the recording says ${recorded.result} for a\\nb and this platform's line ending is `
    + `${JSON.stringify(EOL)} — one of the two belongs to another operating system`);
});

test('both platform halves of str(Path(x)) are recorded and cover the same inputs', () => {
  // THE HOLE THIS CLOSES, and the mechanism changed shape on the way across. The reference kept a
  // hand-written PLATFORM_EXPECTED table and checked it in five directions, because a comparison
  // between two implementations cannot say what the right answer IS — only that both sides give
  // the same one. The port needs no table: `tests/__snapshots__/primitives/win32.json` and
  // `posix.json` are BOTH in the tree, each recorded by the reference on that operating system, so
  // the two halves of the declaration are the two recordings.
  //
  // WHAT DID NOT CROSS, stated rather than left implicit. The reference could derive
  // platform-sensitivity INDEPENDENTLY, by calling `PureWindowsPath` and `PurePosixPath` from one
  // host — both import anywhere. `toPlatformPath` reads `path.sep` with no parameter, and no child
  // process can change it, so there is nothing here that can re-derive the split from the CODE. A
  // recording that drifted from the port on the platform this run is not on would be invisible;
  // what catches it is the other platform's own CI job replaying its own half.
  const halves = ['win32', 'posix'].map((p) => [p, load(path.join('primitives', `${p}.json`))]);
  for (const [name, doc] of halves) {
    assert.ok(doc, `tests/__snapshots__/primitives/${name}.json is missing — one half of the `
      + 'declaration is gone, and a half that is not there is indistinguishable from a half that '
      + 'was never true');
  }
  const pick = (doc) => new Map(doc.cases.filter((c) => c.fn === 'py_path_str')
    .map((c) => [JSON.stringify(c.args), c.result]));
  const [[, win], [, posix]] = halves;
  const w = pick(win);
  const p = pick(posix);
  assert.ok(w.size > 0, 'no py_path_str cases in the win32 half at all');
  assert.deepEqual([...w.keys()].sort(), [...p.keys()].sort(),
    'the two halves probe different inputs, so a row can be declared on one platform and not '
    + 'exercised on the other');
  const differ = [...w.keys()].filter((k) => JSON.stringify(w.get(k)) !== JSON.stringify(p.get(k)));
  // The positive control the whole mechanism rests on: if the two recordings agreed everywhere,
  // the platform axis would be a table with one side and every assertion about it vacuous.
  assert.ok(differ.length > 0, `all ${w.size} py_path_str inputs answer the same on both `
    + 'platforms, so this corpus cannot see the operating system at all');
  assert.ok(differ.length < w.size, 'every input is platform-sensitive, which means the corpus '
    + 'holds nothing that should agree — the control has no negative side');
  // Declared, not asserted: a green run says what it did NOT check on this host.
  const other = PLATFORM === 'win32' ? 'posix' : 'win32';
  const otherHalf = PLATFORM === 'win32' ? p : w;
  console.log(`[pure-snapshot] ${differ.length} of ${w.size} str(Path(x)) answers differ by `
    + `platform; the ${other} half below was DECLARED and not asserted on this ${PLATFORM} run:`);
  for (const k of differ) console.log(`    ${k} -> ${JSON.stringify(otherHalf.get(k))}`);
});

test('the tilde-user form is refused rather than guessed', () => {
  // A byte-bearing case UNTIL the project decided the port should not reproduce `ntpath`'s rule
  // for it. `ntpath.expanduser('~someuser/x')` swaps the last component of %USERPROFILE% and hands
  // back a path for an account that may not exist; the port REFUSES the form, because this is the
  // single primitive every config-dir variable and every --target/--dir/--bundle/--out passes
  // through, and the old behaviour returned it untouched so that `--target ~someone/x` created a
  // literal `~someone` directory in the cwd.
  //
  // THE REFUSAL IS THE CRASH. Nothing in the probe's dispatch catches it, so an uncaught throw
  // exits non-zero with a message — which is a normal, catchable CLI error rather than a silent
  // wrong path.
  const job = path.join(makeSandbox('pure-tilde-').path, 'job.json');
  writeFileSync(job, JSON.stringify({ cases: [{ fn: 'expanduser', args: ['~unknownuser/x'] }] }),
    'utf8');
  const r = spawnSync(process.execPath, [PROBE, job], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(r.status, 0, `the probe exited 0 for ~unknownuser/x and answered ${r.stdout}`);
  assert.match(r.stderr, /~unknownuser\/x/, r.stderr.slice(-400));
  assert.match(r.stderr, /refusing/, r.stderr.slice(-400));
});

test('the reference\'s own tilde rule is written down for both platforms', () => {
  // RECAST AS HISTORY. The reference asserted its own behaviour here, on whichever platform was
  // running, and that arm dies with it. What must not die is the FACT, because the divergence
  // above is only meaningful against what it diverges FROM — and because this table is where the
  // project's second wrong belief was caught. The class first claimed POSIX "returns the path
  // unchanged": true of `posixpath.expanduser`, false of the `Path.expanduser` the reference
  // actually calls, which raises RuntimeError for a home directory it cannot determine. The first
  // Linux run reported an ERROR rather than a failure, which is how it surfaced.
  //
  // A table with one side is exactly the shape that let the first wrong belief survive, so both
  // are written and both are checked for content.
  const REFERENCE_RULE = {
    win32: 'expands — ntpath swaps the last component of %USERPROFILE%, and pathlib hands that '
      + 'back happily even for an account that does not exist',
    posix: 'raises RuntimeError — pathlib refuses a home directory it could not determine, so '
      + 'the reference and the port already agreed in KIND there and differed only in which '
      + 'exception said so',
  };
  assert.deepEqual(Object.keys(REFERENCE_RULE).sort(), ['posix', 'win32'],
    'both operating systems\' rules have to be written down');
  for (const [name, rule] of Object.entries(REFERENCE_RULE)) {
    assert.ok(rule.trim().length > 40, `the ${name} rule is not written down, only named`);
  }
  const other = PLATFORM === 'win32' ? 'posix' : 'win32';
  console.log(`[pure-snapshot] \`~unknownuser/x\` under the deleted reference on ${other} — `
    + `declared, never run on this ${PLATFORM} host: ${REFERENCE_RULE[other]}`);
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
  // THE PIN, CHECKED WITHOUT AN INTERPRETER, and the hazard it answers is real. A width table is
  // a snapshot of ONE Unicode version, so a sweep that asks a LIVE Unicode database for the right
  // answer is only ever as stable as that database: while the answers were measured at run time,
  // the one thing holding them still was a version pinned in CI, and a floating pin does not
  // redden such a gate — it moves the oracle underneath it. Nothing here consults a live Unicode
  // database any more. The runs are RECORDED, the version they were measured at is DECLARED in
  // the document, and the port's own constant is checked against that declaration, so what
  // follows compares a frozen answer against a table obliged to name the Unicode it encodes —
  // and neither side can move without saying so.
  assert.equal(dwidth.unidata_version, DWIDTH_UNIDATA,
    `the sweep was recorded against unidata ${dwidth.unidata_version} and js/ui/tui.mjs's `
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

test('the width tables name a unicode version, in the source and at runtime', () => {
  // `tests/test_pure_function_parity.py`'s `TheWidthTablesDeclareTheUnicodeTheyEncode`, and it is
  // asserted on EVERY host — including the ones that skip the sweep, which is the whole point of
  // it being its own claim. The tables are a snapshot of one Unicode version and have to say
  // which one, or the corpus above cannot tell "the port is wrong" from "this machine's Unicode
  // is newer".
  //
  // READ OUT OF THE SOURCE BY REGEX as well as imported. A gate on a DECLARATION must not be
  // satisfiable by the declaration being deleted and the value arriving some other way; the
  // import proves the value, the regex proves the form, and the two agreeing is what says the
  // constant a reader finds beside the tables is the one the code uses.
  const src = readFileSync(path.join(ROOT, 'js', 'ui', 'tui.mjs'), 'utf8');
  const m = /export const DWIDTH_UNIDATA = '([^']+)';/.exec(src);
  assert.ok(m, 'js/ui/tui.mjs no longer declares DWIDTH_UNIDATA in that form — the width tables are '
    + 'a snapshot of one Unicode version and have to say which one');
  assert.match(m[1], /^\d+\.\d+\.\d+$/,
    `DWIDTH_UNIDATA is ${JSON.stringify(m[1])}, which is not a Unicode version`);
  assert.equal(m[1], DWIDTH_UNIDATA, 'the declaration in the source and the exported value differ');
});

test('the width sweep is a sweep and not a handful of runs', { skip: dwidth ? false
  : 'tests/__snapshots__/dwidth.json has not been recorded' }, () => {
  // The second half of the corpus's positive control, and it is separate because it fails
  // differently: "all three widths appear" is satisfied by a probe that returned three runs and
  // stopped. This asserts the SHAPE — the sweep starts where it says it starts, spans the space,
  // and reaches the two regions a BMP-only table would silently miss.
  assert.equal(dwidth.rle[0][0], dwidth.range[0], 'the sweep does not start at its own range');
  assert.ok(dwidth.rle.length > 200, `the sweep collapsed to ${dwidth.rle.length} runs`);
  assert.ok(dwidth.rle.some(([cp]) => cp >= 0x1f000), 'the sweep never reached the astral emoji '
    + 'rule, where the port stops consulting a table and answers by range');
  assert.ok(dwidth.rle.some(([cp, w]) => cp >= 0x10000 && w === 0),
    'the sweep never reached a combining mark above the BMP, so the port\'s table is untested '
    + 'there');
});

test('the display width does not read the display tier', { skip: dwidth ? false
  : 'tests/__snapshots__/dwidth.json has not been recorded' }, () => {
  // THE ASSERTION THAT LICENSES SWEEPING ONE GLYPH MODE. `dwidth` reads no tier constant, so the
  // corpus runs it once — and that is a claim, not a definition. It is the kind of coupling a
  // later phase adds by accident, because every function beside it in `js/ui/tui.mjs` DOES read the
  // tier, and the corpus would then be a half-measurement with nothing saying so.
  const plain = runProbe([{ fn: 'dwidth_rle', args: dwidth.range }], false)[0];
  const ascii = runProbe([{ fn: 'dwidth_rle', args: dwidth.range }], true)[0];
  assert.ok(plain.length > 200, `the sweep answered ${plain.length} runs`);
  assert.deepStrictEqual(ascii, plain,
    'the display width changed with GENESEED_TUI_ASCII, so the recorded sweep gates one tier and '
    + 'says nothing about the other');
});

test('wrapText still answers every recorded wrap', { skip: textwrapCorpus ? false
  : 'tests/__snapshots__/textwrap.json has not been recorded' }, () => {
  // THE ONE CPYTHON ORACLE P1 LEFT AS A LIVE COMPARISON. `tests/test_cli_reference.py`'s
  // sweep computes its expectation from the RUNNING interpreter's `textwrap`, so it dies with
  // `rituals/harness.py` — and what would survive is 26 help fixtures at ONE wrap column,
  // which that sweep's own docstring records as having proved nothing: a greedy space-only
  // wrap passed all 26. `wrapText` is ~40 lines including a hand-transcribed `WORDSEP`, and
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
      assert.deepStrictEqual(wrapText(t, w), textwrapCorpus.matrix[i][j],
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
