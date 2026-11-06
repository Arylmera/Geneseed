// THE NORMALISERS MUST ASSERT BEFORE THEY PASS ANYTHING THROUGH — the successor to
// `tests/test_golden_destamp.py`.
//
// The destamp exists to make a version marker survive a value that moves for
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

import { destamp, snapshot } from '../helpers/golden.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const B = (s) => Buffer.from(s, 'utf8');
const S = (b) => b.toString('utf8');
const VER = 'out/.geneseed-version';

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
test('the destamp is not on the live snapshot path', () => {
  const sb = makeSandbox('destamp-');
  try {
    fs.mkdirSync(path.join(sb.path, 'out'), { recursive: true });
    const line = 'c81317fdc842 (built 2026-08-11)\n';
    fs.writeFileSync(path.join(sb.path, VER), line);
    const live = snapshot(sb.path, []);
    assert.equal(S(live.get(VER)), line,
      'a LIVE snapshot must compare the version marker byte for byte');
    assert.equal(S(destamp(VER, live.get(VER))), '<FP> (built <DATE>)\n');
  } finally { sb.cleanup(); }
});
