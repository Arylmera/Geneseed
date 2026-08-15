// `tests/test_harness.py`'s LIFECYCLE tier — what an install says about itself: the source
// fingerprint, the release stamp, the downgrade guard, and the status panel that renders them.
//
// A SECOND FILE RATHER THAN MORE OF `harness.test.mjs`, at the seam the ledger row already
// names. The split is by SUBJECT and not by line count: everything here is about an install's
// own identity over time, and every test below either runs the generator or reads what the
// generator wrote.
//
// THE RULE THIS FILE FOLLOWS is `harness.test.mjs`'s, and the interesting half is which way
// each property went:
//
//   * `write_version`, `read_release_version` and `_warn_if_downgrade` are PRIVATE in the port
//     and the reference calls all three directly. They did not need exporting: `writeVersion`
//     runs on EVERY emit, so a real `--emit files` exercises the marker, the `[release X]`
//     stamp and the downgrade warning through the public face — which gates the wiring too.
//   * `version_is_newer` DID need exporting, and the argument for it is written at the export
//     site in `js/emit.mjs` rather than here. Its only caller warns or stays silent, so
//     `false` and `null` are the same observation through an emit and six of its nine claims
//     are invisible from outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { sourceFingerprint, readVersion, versionIsNewer } from '../../js/emit.mjs';
import { sourceReleaseVersion } from '../../js/opencode.mjs';
import { versionVerdict, statusData, statusLines } from '../../js/status.mjs';
import { VERSION_MARKER } from '../../js/hosts.mjs';
import { CONFIG, ROOT, SRC, makeCfg } from '../../js/checkout.mjs';
import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';

const cfg = () => makeCfg();

function withDir(fn) {
  const sb = makeSandbox('gs-life-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/**
 * Run the generator, capturing stdout — which is where the downgrade warning goes.
 *
 * IN A CHILD, not through `driverMain` in process, and the warning is the reason: it is
 * written straight to `process.stdout`, so reading it in process means monkey-patching the
 * stream and hoping nothing else in the emit writes to it. A child's stdout is the whole
 * answer with no interception.
 */
function emit(out, home, extraArgs = []) {
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'files', '--theme', 'neutral',
      '--out', out, ...extraArgs],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...homeOverrides(home) },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  if (r.status !== 0) {
    throw new Error(`emit failed (${r.status}): ${(r.stderr || r.stdout || '').slice(-1500)}`);
  }
  return `${r.stdout || ''}${r.stderr || ''}`;
}

const markerText = (d) => fs.readFileSync(path.join(d, VERSION_MARKER), 'utf8');

// ---------------------------------------------------------------------------------------------
// The source fingerprint.

test('the source fingerprint is deterministic and short', () => {
  const fp = sourceFingerprint(cfg());
  assert.equal(fp, sourceFingerprint(cfg()), 'the fingerprint moved between two calls');
  assert.match(fp, /^[0-9a-f]{12}$/);
});

test('an emit writes a marker the reader reads back', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emit(out, path.join(d, 'home'));
    assert.equal(readVersion(out), sourceFingerprint(cfg()));
    assert.ok(markerText(out).includes('built'), markerText(out));
  });
});

test('reading a version where there is no marker is null', () => {
  withDir((d) => {
    assert.equal(readVersion(d), null);
  });
});

test('the marker carries the release and the fingerprint as DIFFERENT values', () => {
  // `readVersion` is the FINGERPRINT token and the `[release X]` bracket is a different name
  // and a different value — the port's own docblock says so, and a marker that conflated them
  // would satisfy every other assertion in this file. Name both, from one real emit.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    emit(out, path.join(d, 'home'));
    const text = markerText(out);
    const release = sourceReleaseVersion(cfg());
    assert.ok(text.includes(`[release ${release}]`), text);
    assert.equal(readVersion(out), sourceFingerprint(cfg()));
    assert.notEqual(readVersion(out), release,
      'the fingerprint and the release version are the same string — one of the two readers '
      + 'is answering for the other');
  });
});

test('the release version is read from the config, not restated', () => {
  assert.equal(sourceReleaseVersion(cfg()),
    JSON.parse(fs.readFileSync(CONFIG, 'utf8')).version);
});

// ---------------------------------------------------------------------------------------------
// The version verdict and the comparator underneath it.

test('the version verdict names all three states', () => {
  assert.match(versionVerdict(null, 'abc'), /no Geneseed install/);
  assert.match(versionVerdict('abc', 'abc'), /up to date/);
  assert.match(versionVerdict('old', 'new'), /differs/);
});

test('version comparison is numeric, right-padded and strict', () => {
  assert.equal(versionIsNewer('1.2.0', '1.1.9'), true);
  assert.equal(versionIsNewer('1.1.0', '1.2.0'), false);
  assert.equal(versionIsNewer('1.2.0', '1.2.0'), false, 'equal must not be newer');
  assert.equal(versionIsNewer('1.10.0', '1.9.0'), true, 'numeric, not lexical');
  assert.equal(versionIsNewer('1.2', '1.1.9'), true, 'a short tuple is zero-padded');
  assert.equal(versionIsNewer('1.2.0', '1.2'), false, '1.2 == 1.2.0');
});

test('an unparseable version compares to null, not to false', () => {
  // THE DISTINCTION THE EMIT FACE CANNOT SEE, and the reason this function is exported at
  // all: `warnIfDowngrade` stays silent on both, so only a direct call can tell "older" from
  // "I could not tell".
  assert.equal(versionIsNewer('1.2.0-rc1', '1.1.0'), null);
  assert.equal(versionIsNewer('1.1.0', 'not-a-version'), null);
  assert.equal(versionIsNewer('abc', 'def'), null);
});

// ---------------------------------------------------------------------------------------------
// The downgrade guard — driven through a real emit, because that is its only caller.

test('installing over a NEWER deployed release warns, and re-stamping does not', () => {
  withDir((d) => {
    const out = path.join(d, 'bundle');
    const home = path.join(d, 'home');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, VERSION_MARKER),
      'abc123 (built 2026-01-01) [release 999.0.0]\n', 'utf8');
    const current = sourceReleaseVersion(cfg());
    const first = emit(out, home);
    assert.match(first, /older Geneseed/, first);
    assert.ok(first.includes(current), first);
    assert.ok(first.includes('999.0.0'), first);
    assert.match(first, /did you forget git pull/, first);
    // The emit just re-stamped the marker with the current release, so a second run compares
    // equal versions and must NOT warn. This half is what makes the warning a downgrade
    // guard rather than a banner.
    assert.ok(!/older Geneseed/.test(emit(out, home)), 'the warning fired on an equal release');
  });
});

test('an OLDER or unparseable deployed release does not warn', () => {
  for (const stamp of ['[release 0.0.1]', '[release rc-weird]', '']) {
    withDir((d) => {
      const out = path.join(d, 'bundle');
      fs.mkdirSync(out, { recursive: true });
      // The empty case is the LEGACY marker: written before the `[release X]` stamp existed,
      // so the reader finds no bracket at all. It is here rather than in its own test because
      // the reference's `read_release_version(...) is None` claim is only ever observable as
      // this silence.
      fs.writeFileSync(path.join(out, VERSION_MARKER),
        `abc123 (built 2026-01-01) ${stamp}\n`.replace(/ \n$/, '\n'), 'utf8');
      const said = emit(out, path.join(d, 'home'));
      assert.ok(!/older Geneseed/.test(said), `${stamp || '(legacy marker)'}: ${said}`);
    });
  }
});

test('a first write with no prior marker does not warn', () => {
  withDir((d) => {
    const said = emit(path.join(d, 'bundle'), path.join(d, 'home'));
    assert.ok(!/older Geneseed/.test(said), said);
  });
});

test('the downgrade warning can actually be produced', () => {
  // The positive control for the three silences above. Three tests asserting "no warning" are
  // all satisfied by a guard that never warns at all, and the reference has no such control —
  // its downgrade test happens to carry one only because it checks both directions in one
  // method. Named here so the silences cannot go quietly vacuous.
  withDir((d) => {
    const out = path.join(d, 'bundle');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, VERSION_MARKER),
      'abc123 (built 2026-01-01) [release 999.0.0]\n', 'utf8');
    assert.match(emit(out, path.join(d, 'home')), /older Geneseed/);
  });
});

// ---------------------------------------------------------------------------------------------
// The status panel.

/** `src/<folder>/*.md` minus `_`-scaffolds, derived HERE rather than borrowed from the port. */
function specStems(folder) {
  return fs.readdirSync(path.join(SRC, folder))
    .filter((n) => n.endsWith('.md') && !n.startsWith('_'));
}

test('status reports derived counts, a well-formed version and every structural key', () => {
  const d = statusData();
  // DERIVED INDEPENDENTLY, not with the port's own `srcStems`. The reference asserts
  // `d["agents"] == len(harness._src_stems("agents"))` — the same function on both sides of
  // the equals, which is satisfied by any function at all as long as it is used twice. A
  // plain directory listing is a second opinion.
  assert.equal(d.agents, specStems('agents').length);
  assert.equal(d.skills, specStems('skills').length);
  // AND THE LAW COUNT IS DERIVED TOO, where the reference transcribes `37`. A hard-coded
  // count is a second copy of a value under test: add a law and the test fails for being
  // out of date rather than because anything is wrong.
  const laws = [...fs.readFileSync(path.join(SRC, 'laws', 'universal.md'), 'utf8')
    .matchAll(/^### \{\{LAW\}\} ([IVXLCDM]+)\b/gm)].length;
  assert.equal(d.laws, laws);
  assert.ok(laws > 30, `only ${laws} laws parsed — the heading regex has stopped matching`);

  assert.match(d.source_fp, /^[0-9a-f]{12}$/);
  assert.equal(typeof d.version_verdict, 'string');
  assert.ok(d.version_verdict);
  for (const k of ['theme', 'accent', 'emit', 'memory_dir', 'facts', 'installed_fp',
    'agent_md', 'agent_md_present']) {
    assert.ok(k in d, `the status payload has no '${k}' — the panel reads it`);
  }
});

test('the status box is a uniform-width frame', () => {
  const lines = statusLines(statusData(), false);
  assert.ok(lines.length >= 7, `only ${lines.length} lines`);
  assert.equal(new Set(lines.map((l) => l.length)).size, 1,
    'the box rows are not all the same width');
  assert.ok('┌+'.includes(lines[0][0]), JSON.stringify(lines[0][0]));
  assert.ok('└+'.includes(lines.at(-1)[0]), JSON.stringify(lines.at(-1)[0]));
  const blob = lines.join('\n');
  for (const token of ['Geneseed', 'theme', 'components', 'version', 'source']) {
    assert.ok(blob.includes(token), `the panel never says '${token}'`);
  }
});

test('colour adds ANSI without changing the line count', () => {
  const d = statusData();
  const plain = statusLines(d, false);
  const colored = statusLines(d, true);
  assert.equal(plain.length, colored.length);
  assert.ok(!plain.join('').includes('['), 'the plain panel carries ANSI');
  assert.ok(colored.join('').includes('['), 'the coloured panel carries no ANSI');
});
