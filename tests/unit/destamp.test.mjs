// THE NORMALISERS MUST ASSERT BEFORE THEY PASS ANYTHING THROUGH — the successor to
// `tests/test_golden_destamp.py`.
//
// Every one of these functions exists to make a recorded corpus survive a value that moves for
// reasons that are not a regression: the build date at midnight, the source fingerprint on any
// `src/` edit, the machine's own `git` path, Node's patch version. Every one of them is also a
// way to make the gate stop looking. A blind substitution that is one character too wide blanks
// a real difference and the corpus goes green having compared nothing — which is worse than no
// corpus, because it reads like proof.
//
// So each stamp is tested in BOTH directions: it fires on the shape it names, and it leaves
// verbatim the neighbouring value that must stay compared. The seeded fixtures are the sharpest
// cases — `deadbeef1234` and `0000000000000000` are constants that a pattern written for "looks
// like a hash" would eat, and the only thing separating them from a live fingerprint is the
// exact length the implementation emits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  CORPUS_STAMPS, corpusNormalise, destamp, recomputeDeclaredLengths, snapshot,
} from '../helpers/golden.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const B = (s) => Buffer.from(s, 'utf8');
const S = (b) => b.toString('utf8');
const VER = 'out/.geneseed-version';
// One snapshot through the corpus path, for the stamps that are not about `.geneseed-version`.
const stamped = (name, text) => S(corpusNormalise(new Map([[name, B(text)]])).get(name));

test('a well-formed version line is blanked', () => {
  assert.equal(S(destamp(VER, B('c81317fdc842 (built 2026-08-11) [release 1.0.0]\n'))),
    '<FP> (built <DATE>) [release <REL>]\n');
});

test('a line of an unexpected shape carrying a DATE throws', () => {
  assert.throws(() => destamp(VER, B('built on 2026-08-11 by hand\n')), /2026-08-11/);
});

test('a line carrying a live-shaped fingerprint throws', () => {
  assert.throws(() => destamp(VER, B('legacy c81317fdc842\n')), /c81317fdc842/);
});

test('a file that is not the version marker is untouched', () => {
  const body = B('c81317fdc842 (built 2026-08-11)\n');
  assert.equal(destamp('out/CLAUDE.md', body), body);
});

// `\r?` in the pattern is OBSERVED, not defensive: this file is written through a text-mode
// path, so on Windows every line carries a `\r` as its last byte. Left out, the assertion would
// fire on cell 1 of 259 rather than on a corrupted one.
test('a Windows CRLF line is blanked and the CR is kept', () => {
  assert.equal(S(destamp(VER, B('c81317fdc842 (built 2026-08-11)\r\n'))),
    '<FP> (built <DATE>)\r\n');
});

// THE SYNTHETIC MARKERS THE HARNESSES SEED. Each is deliberately odd, each is CONSTANT across
// runs and implementations, and leaving them verbatim is strictly better than blanking them —
// the bytes stay under the byte comparison in full. This is why the rule is "prove it cannot
// rot", not "enumerate the allowed shapes": the shape of a fixture is not something this file
// can know in advance.
test('the harnesses\' synthetic markers survive verbatim', () => {
  for (const marker of ['   \n', '0000000000000000\n', 'not-a-version\n']) {
    assert.equal(S(destamp(VER, B(marker))), marker, JSON.stringify(marker));
  }
});

test('a multi-line marker blanks the stamp and keeps the rest', () => {
  assert.equal(S(destamp(VER, B('c81317fdc842 (built 2026-08-11)\ntrailing junk\n'))),
    '<FP> (built <DATE>)\ntrailing junk\n');
});

// THE MOVE THAT P1'S REVIEW FOUND. `destamp` was wired into `snapshot`, which all three
// harnesses share, so the emit matrix compared `.geneseed-version` as `<FP> (built <DATE>)` on
// BOTH sides — i.e. did not compare its contents at all — while the corpus table's own preamble
// claimed the live gate keeps every one of those fields. It belongs on the record/replay path,
// because the threat it answers is a threat between two RUNS.
test('the destamp is on the corpus path and not the live one', () => {
  const sb = makeSandbox('destamp-');
  try {
    fs.mkdirSync(path.join(sb.path, 'out'), { recursive: true });
    const line = 'c81317fdc842 (built 2026-08-11)\n';
    fs.writeFileSync(path.join(sb.path, VER), line);
    const live = snapshot(sb.path, []);
    assert.equal(S(live.get(VER)), line,
      'a LIVE snapshot must compare the version marker byte for byte');
    assert.equal(S(corpusNormalise(live).get(VER)), '<FP> (built <DATE>)\n');
  } finally { sb.cleanup(); }
});

// ---- the toolchain stamps: shapes, not blind replaces -----------------------------------

test('a well-formed node banner is normalised and two patch releases agree', () => {
  const a = stamped('<stderr>', 'SyntaxError: bad\nNode.js v22.23.1\n');
  const b = stamped('<stderr>', 'SyntaxError: bad\nNode.js v22.23.2\n');
  assert.equal(a, 'SyntaxError: bad\nNode.js v<NODE>\n');
  assert.equal(a, b);
});

// THE VACUITY GUARD. A two-segment version, a different wording, a bare version with no
// banner: none is the declared shape, so none is tagged — the bytes stay under the comparison
// and a cell carrying them still fails on a real change.
//
// `Node.js v23.0.0-pre` IS NOT ONE OF THESE, and the first draft of this test wrongly claimed
// it was. The declared pattern matches the three-segment prefix and leaves the suffix, so a
// pre-release banner is tagged as `Node.js v<NODE>-pre` — in the reference exactly as here. A
// port test that asserts a property the reference does not have is a port test that will be
// "fixed" by breaking the port.
test('a node banner of another shape is left verbatim and still compared', () => {
  for (const line of ['Node.js v22\n', 'node v1.2.3\n', 'Node.js version 1.2.3\n', 'v1.2.3\n',
    'Node.js v1.2\n']) {
    assert.equal(stamped('<stderr>', line), line, JSON.stringify(line));
  }
});

// A port that reported the wrong FILE, or dropped the check entirely, must still be caught:
// only the version is tolerant, never the sentence carrying it.
test('the message around the banner is still compared', () => {
  const a = stamped('<stderr>', 'node --check failed for geneseed-learn.js: Node.js v22.23.1\n');
  const b = stamped('<stderr>', 'node --check failed for geneseed-notify.js: Node.js v22.23.2\n');
  assert.notEqual(a, b);
});

test('the resolved git executable is normalised on either platform', () => {
  const win = '(git: C:\\Program Files\\Git\\mingw64\\bin\\git.EXE, timeout: 30s)';
  const nix = '(git: /usr/bin/git, timeout: 30s)';
  assert.equal(stamped('<stdout>', win), '(git: <GIT>, timeout: 30s)');
  assert.equal(stamped('<stdout>', nix), '(git: <GIT>, timeout: 30s)');
});

// Anchored on the message and requiring a non-empty single-line value: a side that stopped
// naming the executable, or dropped the `timeout:` that follows it, leaves the line untagged
// and fails.
test('a git line of another shape is left verbatim', () => {
  const odd = '(git: , timeout: 30s)';
  assert.equal(stamped('<stdout>', odd), odd);
  const noTimeout = '(git: /usr/bin/git)';
  assert.equal(stamped('<stdout>', noTimeout), noTimeout);
});

test('the timeout beside it is still compared', () => {
  assert.match(stamped('<stdout>', '(git: /usr/bin/git, timeout: 30s)'), /timeout: 30s/);
});

// EXACTLY TWELVE HEX is what keeps the seeded fixtures out of reach, and it is the only thing
// separating them. The pattern must not be widened while that is true.
test('a live-shaped installed fingerprint is normalised and the fixture is not', () => {
  assert.equal(stamped('<stdout>', '"installed_fp": "240280e0c4d9"'),
    '"installed_fp": "<FP>"');
  const fixture = '"installed_fp": "0000000000000000"';
  assert.equal(stamped('<stdout>', fixture), fixture);
});

test('the other spellings of a fingerprint are untouched', () => {
  const seeded = 'installed: deadbeef1234';
  assert.equal(stamped('<stdout>', seeded), seeded);
});

// ---- the declared length -----------------------------------------------------------------

test('a Content-Length header is rewritten to its own recorded body length', () => {
  const out = new Map([
    ['<r1 headers>', B('HTTP/1.1 200 OK\nContent-Length: 4177\n')],
    ['<r1 body>', B('x'.repeat(3565))],
  ]);
  recomputeDeclaredLengths(out);
  assert.match(S(out.get('<r1 headers>')), /Content-Length: 3565/);
});

test('a tagged length carries no digits and is left alone', () => {
  const out = new Map([
    ['<r1 headers>', B('Content-Length: <CLEN>\n')],
    ['<r1 body>', B('xxx')],
  ]);
  recomputeDeclaredLengths(out);
  assert.match(S(out.get('<r1 headers>')), /Content-Length: <CLEN>/);
});

test('a header with no body beside it is left alone', () => {
  const out = new Map([['<r9 headers>', B('Content-Length: 12\n')]]);
  recomputeDeclaredLengths(out);
  assert.match(S(out.get('<r9 headers>')), /Content-Length: 12/);
});

// LAST, after every stamp above, because a stamp that shrinks a body must be counted too.
test('the recompute runs after the stamps that shrink a body', () => {
  const body = 'Node.js v22.23.1\n'; // 17 bytes; the stamp makes it 'Node.js v<NODE>\n' = 16
  const out = corpusNormalise(new Map([
    ['<r1 headers>', B(`Content-Length: ${body.length}\n`)],
    ['<r1 body>', B(body)],
  ]));
  assert.match(S(out.get('<r1 headers>')), /Content-Length: 16/);
});

// ---- the panel padding: a LENGTH, not a value ---------------------------------------------

// The `status` panel pads each row out to the box; `normalise` shrinks the row's path to
// `<HOME>` AFTERWARDS, so the surviving padding run is a direct readout of the recorder's home
// directory length. Invisible to diffing two recordings as text, which is why the
// cross-platform sweep walked past it.
test('the two platform halves converge on the same padded row', () => {
  const win = '│ AGENT.md   <HOME>/x (present)│\n';
  const nix = `│ AGENT.md   <HOME>/x (present)${' '.repeat(29)}│\n`;
  assert.equal(stamped('<stdout>', win), stamped('<stdout>', nix));
});

test('the row content and its terminator are still compared', () => {
  const got = stamped('<stdout>', '│ AGENT.md   <HOME>/x (present)     │\n');
  assert.match(got, /AGENT\.md {3}<HOME>\/x \(present\)│/);
});

// NARROW, AND THE NARROWNESS IS THE POINT: pre-normalisation padding is a FEATURE, and a port
// that padded the panel differently must still be caught. A row with no normalised path keeps
// every space it was given.
test('a row with no normalised path keeps its padding', () => {
  const row = '│ components   17 agents · 47 skills          │\n';
  assert.equal(stamped('<stdout>', row), row);
});

// THE GATE ON THE TABLE ITSELF. Every entry must be a two-element [RegExp, string] pair with the
// global flag — a pattern without `g` replaces only the first occurrence, which for a stream
// carrying two fingerprints would blank one and compare the other, silently.
test('every corpus stamp is a global pattern', () => {
  assert.ok(CORPUS_STAMPS.length > 0);
  for (const [pat, repl] of CORPUS_STAMPS) {
    assert.ok(pat instanceof RegExp, String(pat));
    assert.ok(pat.flags.includes('g'), `${pat} is not global — it would tag only the first hit`);
    assert.equal(typeof repl, 'string');
  }
});
