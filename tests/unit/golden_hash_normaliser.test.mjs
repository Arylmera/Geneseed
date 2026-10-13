// THE NORMALISERS MUST ASSERT BEFORE THEY PASS ANYTHING THROUGH — this is `destamp.test.mjs`'s
// discipline applied to `blankVerifiedManifestHashes` (`tests/helpers/golden.mjs`), the
// normaliser Task 3's `hashes` field needed in the two self-comparison gates (`--idempotent`,
// `--deletion`): those compare TWO DIFFERENT sandboxes, and a few owned files legitimately embed
// their own sandbox's absolute path (command bricks, Bob's skill files), so their sha256 digest
// is sandbox-location-bound even though the content is semantically identical. A hex digest is
// OPAQUE to a text substitution, unlike the path itself, so this normaliser recomputes each
// hash against its OWN sandbox's file and only blanks the ones that check out — never the kind
// of blind substitution the file-level comment above warns against.
//
// So, as there: tested in BOTH directions. A correct hash is blanked (the false positive this
// exists to remove); a WRONG hash — corrupted, or naming a file that is gone — is left exactly
// as recorded, so it can never coincidentally agree with a placeholder or with anything else,
// and the comparison gates still catch it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { snapshot } from '../helpers/golden.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { fileHash } from '../../js/hosts/owned.mjs';

function withDir(fn) {
  const sb = makeSandbox('golden-hash-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const writeManifest = (dir, hashes) => fs.writeFileSync(
  path.join(dir, GLOBAL_MANIFEST),
  JSON.stringify({ owned: Object.keys(hashes), hashes }),
  'utf8',
);

test('a manifest hash that matches its own sandbox file is blanked to a fixed placeholder', () => {
  withDir((dir) => {
    fs.writeFileSync(path.join(dir, 'a.md'), 'HELLO\n');
    const hash = fileHash(path.join(dir, 'a.md'));
    writeManifest(dir, { 'a.md': hash });

    const body = snapshot(dir, []).get(GLOBAL_MANIFEST).toString('utf8');
    assert.ok(!body.includes(hash),
      'the real hash must not survive into the snapshot the gates compare');
    assert.match(body, /<VERIFIED-HASH>/,
      'a verified-correct hash is replaced by the fixed placeholder');
  });
});

test('a corrupted hash (one flipped hex digit) is left verbatim, never blanked', () => {
  // The mutation this normaliser must not swallow: a hash that is simply WRONG for the file it
  // claims to describe — exactly what a real regression in `ownedHashes`/`fileHash` would
  // produce — must still read as a difference, not be excused into agreement with anything.
  withDir((dir) => {
    fs.writeFileSync(path.join(dir, 'a.md'), 'HELLO\n');
    const hash = fileHash(path.join(dir, 'a.md'));
    const corrupted = `${hash.slice(0, -1)}${hash.at(-1) === '0' ? '1' : '0'}`;
    writeManifest(dir, { 'a.md': corrupted });

    const body = snapshot(dir, []).get(GLOBAL_MANIFEST).toString('utf8');
    assert.ok(body.includes(corrupted),
      'a hash that does not match its own sandbox file must be left exactly as recorded');
    assert.ok(!body.includes('<VERIFIED-HASH>'),
      'a wrong hash must never be folded into the same placeholder a correct one gets');
  });
});

test('two sandboxes, one correct hash and one corrupted, still compare as CHANGED', () => {
  withDir((good) => {
    withDir((bad) => {
      fs.writeFileSync(path.join(good, 'a.md'), 'HELLO\n');
      fs.writeFileSync(path.join(bad, 'a.md'), 'HELLO\n');
      const hash = fileHash(path.join(good, 'a.md'));
      const corrupted = `${hash.slice(0, -1)}${hash.at(-1) === '0' ? '1' : '0'}`;
      writeManifest(good, { 'a.md': hash });
      writeManifest(bad, { 'a.md': corrupted });

      const goodSnap = snapshot(good, []).get(GLOBAL_MANIFEST);
      const badSnap = snapshot(bad, []).get(GLOBAL_MANIFEST);
      assert.ok(!goodSnap.equals(badSnap),
        'a corrupted hash must still make the two sandboxes compare CHANGED');
    });
  });
});

test('a hash recorded for a file the sandbox no longer has is left verbatim', () => {
  withDir((dir) => {
    const hash = 'a'.repeat(64);
    writeManifest(dir, { 'missing.md': hash }); // never written to disk

    const body = snapshot(dir, []).get(GLOBAL_MANIFEST).toString('utf8');
    assert.ok(body.includes(hash),
      'a hash naming a file this sandbox does not have must not be blanked');
  });
});

test('two identical-content sandboxes at different paths still compare as unchanged', () => {
  // The positive case this whole normaliser exists for: content is the SAME, only the absolute
  // sandbox path differs (as it legitimately does for `command/ci-fix.md`'s self-reference), and
  // the manifest comparison must not report that as a difference.
  withDir((a) => {
    withDir((b) => {
      fs.writeFileSync(path.join(a, 'a.md'), 'HELLO\n');
      fs.writeFileSync(path.join(b, 'a.md'), 'HELLO\n');
      writeManifest(a, { 'a.md': fileHash(path.join(a, 'a.md')) });
      writeManifest(b, { 'a.md': fileHash(path.join(b, 'a.md')) });

      const snapA = snapshot(a, []).get(GLOBAL_MANIFEST);
      const snapB = snapshot(b, []).get(GLOBAL_MANIFEST);
      assert.ok(snapA.equals(snapB),
        'two sandboxes with identical file content must compare equal despite their differing '
        + 'absolute paths, which is the whole point of blanking a VERIFIED hash');
    });
  });
});
