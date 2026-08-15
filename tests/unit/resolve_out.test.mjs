// `resolveOut` CANONICALISES — the gate the FALSIFIER demanded.
//
// HOW THIS FILE CAME TO EXIST, because that is the whole argument for it. P3's falsifier reverts
// a real historical bug fix and requires the new Node gate set to redden. The fix chosen was
// `bin/geneseed.mjs`'s `resolveOut`, documented in its own docblock as a user-visible defect
// found by GitHub's Windows runner: the reference ends in `Path.resolve()`, which CANONICALISES
// — 8.3 short names expanded, symlinks followed, the filesystem's own casing — where
// `path.resolve` only normalises `.` and `..`. Nine `pyResolve` call sites had the rule and this
// one did not, so the two entry points printed the same directory under two different names.
//
// Reverted, the ENTIRE Node suite stayed green: 68 unit tests and 12 emit cells, all passing.
// That is exactly what the design doc says blocks P4 — "a fix only the Python suite catches
// names a hole by name". This file is the hole, named.
//
// AND THE REASON NOTHING CAUGHT IT IS WORTH MORE THAN THE FIX. The fixture that could have seen
// it already existed — `tests/unit/sandbox.test.mjs` manufactures a second path spelling — but
// it was written inline, inside a test about `makeSandbox`. A fixture locked inside one test is
// a fixture the next defect cannot reach; it now lives in `tests/helpers/alias.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveOut } from '../../bin/geneseed.mjs';
import { ALIAS_SKIP, aliasedTemp } from '../helpers/alias.mjs';

test('resolveOut expands a non-canonical path, it does not merely normalise it', (t) => {
  const a = aliasedTemp();
  if (!a) return t.skip(ALIAS_SKIP);
  try {
    // THE CONTROL. Without it this test cannot tell a `resolveOut` that canonicalises from a
    // platform that never had two spellings to begin with — and on a machine whose paths are
    // already canonical, which is every machine this project ran on until a CI runner handed it
    // `C:\Users\RUNNER~1\…`, the assertion below would pass against `path.resolve` too.
    assert.notEqual(a.alias, a.real, 'the fixture produced one spelling, not two');
    assert.equal(fs.realpathSync.native(a.alias), a.real,
      'the alias must name the same directory as the original');

    assert.equal(resolveOut(a.alias), a.real,
      'resolveOut returned the alias rather than the canonical path — this is the defect the '
      + 'falsifier reverted, and it is invisible on a machine whose paths are already canonical');
  } finally { a.done(); }
});

// The rest of the contract, which the canonicalising half must not have eaten.
test('resolveOut makes a relative path absolute against the cwd', () => {
  const got = resolveOut('some-relative-dir');
  assert.ok(path.isAbsolute(got));
  assert.equal(path.basename(got), 'some-relative-dir');
});

// A BARE `~` IS A LEGAL DIRECTORY NAME, and the reference does not expand it here. The argument
// is made absolute BEFORE `pyResolve` sees it precisely so `expanduser` cannot fire — a rule
// that is one `path.resolve` away from being lost and that nothing else states.
test('resolveOut does not expand a leading tilde', () => {
  const got = resolveOut('~');
  assert.equal(path.basename(got), '~',
    'resolveOut expanded `~` to the home directory — the reference treats it as a directory '
    + 'name here, and a user with a literal `~` folder would have their build redirected home');
});

// A path that does not exist yet must still come back absolute and normalised rather than
// throwing: `--out` names a directory the emit is about to CREATE.
test('resolveOut answers for a path that does not exist yet', () => {
  const a = aliasedTemp();
  if (!a) {
    const got = resolveOut(path.join('nowhere-at-all', 'nested', '..', 'child'));
    assert.ok(path.isAbsolute(got));
    assert.ok(!got.includes('..'));
    return;
  }
  try {
    const target = path.join(a.alias, 'not', 'created', 'yet');
    const got = resolveOut(target);
    assert.ok(got.startsWith(a.real),
      'a not-yet-created path under an aliased parent must still canonicalise the part that '
      + 'exists — the emit creates the tail, and the head is what every destamp matches');
  } finally { a.done(); }
});
