/**
 * The atomic-write guarantee for USER-OWNED config files (`opencode.json`, `settings.json`):
 * a failed write must never leave one half-written, and must leave no litter beside it.
 *
 * SUCCESSOR TO `tests/test_atomic_config.py`. A DATA-LOSS property, which is the tier that is
 * never simplified away — these two files belong to the user, Geneseed only merges into them,
 * and a truncated `settings.json` is the user's whole Claude configuration gone.
 *
 * THE MONKEYPATCH BECAME A REAL DENIAL. The reference replaced `os.replace` with a function that
 * raises `OSError("disk full")`. ESM cannot rebind an imported binding, and the substitute is
 * better than the original rather than a workaround: a mock proves the handler catches the
 * exception someone decided to throw; an ACL proves it catches the one the OS raises. That
 * difference has already paid once in this port — a denied ACL on Windows raises EPERM,
 * "operation not permitted", where the reference asserted the phrase "Permission denied".
 *
 * ⚠ ONE MOCK BECAME TWO FIXTURES, BECAUSE `os.replace = boom` FAILED AT A POINT NO DENIAL
 * REACHES. Denying write on the PARENT DIRECTORY stops `atomicWriteJson` at the temp write,
 * before the rename — which gates "the original survives" but never reaches the `rmSync(tmp)`
 * litter cleanup, since no temp was created. Reaching that needs the temp write to SUCCEED and
 * the rename to fail, and the denial fixture cannot produce it: measured, a delete-denied target
 * does not stop a rename on Windows, and no POSIX mode bit on a FILE stops one either, because
 * that right belongs to the directory. A non-empty DIRECTORY at the target does, on both
 * platforms, so the two arms are two fixtures rather than one skipped test.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { atomicWriteJson, wireClaudeExcludes } from '../../js/settings.mjs';
import { DENY_SKIP, deny } from '../helpers/deny.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

/** A sandbox directory for one test. */
function withDir(fn) {
  const sb = makeSandbox('atomic-');
  try {
    return fn(sb.path);
  } finally {
    sb.cleanup();
  }
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('an existing file is replaced, and no temp litter is left beside it', () => {
  withDir((d) => {
    const p = path.join(d, 'settings.json');
    writeFileSync(p, '{"old": true}\n', 'utf8');
    atomicWriteJson(p, { new: 1 });
    assert.deepEqual(readJson(p), { new: 1 });
    assert.deepEqual(readdirSync(d), ['settings.json'],
      'a temp file was left beside the target — the next emit would read or replace it');
  });
});

test('the file is created when it is missing', () => {
  withDir((d) => {
    const p = path.join(d, 'opencode.json');
    atomicWriteJson(p, { instructions: ['AGENT.md'] });
    assert.deepEqual(readJson(p), { instructions: ['AGENT.md'] });
  });
});

test('a failed write leaves the original byte-identical', (t) => {
  withDir((d) => {
    const dir = path.join(d, 'cfg');
    const p = path.join(dir, 'settings.json');
    mkdirSync(dir, { recursive: true });
    const original = '{"old": true}\n';
    writeFileSync(p, original, 'utf8');
    const release = deny(dir, 'W', () => writeFileSync(path.join(dir, '.probe'), 'x'));
    if (!release) { t.skip(DENY_SKIP); return; }
    try {
      // THROWS, as the reference's does. `wireClaudeExcludes` is the caller that decides a
      // failed exclude-wiring is survivable; the primitive itself must not swallow.
      assert.throws(() => atomicWriteJson(p, { new: 1 }), /E[A-Z]+/);
    } finally {
      release();
    }
    // BYTE-IDENTICAL, not merely "still valid JSON": a write that got as far as truncating the
    // target and then failed leaves a parseable empty object on some paths.
    assert.equal(readFileSync(p, 'utf8'), original,
      'the original did not survive a failed write');
  });
});

test('a rename that fails after the temp is written leaves no litter', () => {
  // THE ARM THE REFERENCE'S MOCK REACHED, and the ONLY one that exercises the `rmSync(tmp)`
  // cleanup: the temp write must SUCCEED and the rename over the target must fail. The denial
  // fixture cannot produce it — MEASURED, not assumed. Denying write on the parent stops the
  // temp write first, and denying DELETE on the target does not stop a rename on Windows at all
  // (the first draft of this test skipped for that reason), while no POSIX mode bit on a file
  // blocks a rename over it either, since that right belongs to the directory.
  //
  // What does produce it, on both platforms, is a target that is a non-empty DIRECTORY: the temp
  // file is written normally beside it and `renameSync` then refuses. The user-facing shape is
  // real — a `settings.json` directory is what a mis-set `--out` or a container mount leaves
  // behind — and what is under test here is the cleanup, not the cause.
  withDir((d) => {
    const p = path.join(d, 'settings.json');
    mkdirSync(p, { recursive: true });
    writeFileSync(path.join(p, 'keep-me'), 'x', 'utf8');
    assert.throws(() => atomicWriteJson(p, { new: 1 }), /E[A-Z]+/,
      'a rename onto a non-empty directory did not fail, so this cell never reached the cleanup');
    assert.deepEqual(readdirSync(d), ['settings.json'],
      'the temp file survived a failed rename — atomicWriteJson leaked its own scratch file into '
      + 'the user\'s config directory, where the next read may find it');
    assert.deepEqual(readdirSync(p), ['keep-me'], 'the target was disturbed');
  });
});

test('a failed exclude write reports nothing wired and leaves the settings intact', (t) => {
  // THE CALLER'S HALF. `wireClaudeExcludes` must NOT propagate: a Claude emit that could not
  // write the excludes is still a successful emit, and the user gets a warning naming the file,
  // the reason, and the entries to add by hand. What it must never do is claim it wired them —
  // `added` is what the caller records as OWNED, and a false claim there means the next
  // uninstall unwires an entry it never wrote.
  withDir((d) => {
    const dir = path.join(d, 'cfg');
    const p = path.join(dir, 'settings.json');
    mkdirSync(dir, { recursive: true });
    const original = '{"old": true}\n';
    writeFileSync(p, original, 'utf8');
    const release = deny(dir, 'W', () => writeFileSync(path.join(dir, '.probe'), 'x'));
    if (!release) { t.skip(DENY_SKIP); return; }
    const errs = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { errs.push(String(chunk)); return true; };
    let added;
    try {
      added = wireClaudeExcludes(p, ['/abs/CLAUDE.md']);
    } finally {
      process.stderr.write = realWrite;
      release();
    }
    assert.deepEqual(added, [],
      'a failed write reported the excludes as wired — the uninstall would unwire an entry that '
      + 'was never written');
    assert.equal(readFileSync(p, 'utf8'), original);
    // THE WARNING, WHICH THE REFERENCE NAMED IN ITS TITLE AND NEVER ASSERTED. Silence here is
    // the worst outcome: the emit reports success, the excludes are missing, and the preamble
    // loads twice in every session with no way for the user to know why.
    const said = errs.join('');
    assert.match(said, /WARN/, `no warning was printed: ${said}`);
    assert.ok(said.includes(p), 'the warning does not name the file');
    assert.match(said, /\(E[A-Z]+/, 'the warning names the file but not the reason');
    assert.ok(said.includes('/abs/CLAUDE.md'),
      'the warning does not name the entry the user must add by hand');
  });
});
