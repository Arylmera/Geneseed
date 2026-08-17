import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cmdLink, cmdUnlink } from '../../js/link.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const unix = process.platform !== 'win32';

// A sandbox dir that is NOT on PATH, so cmdUnlink's PATH sweep cannot reach it; the
// candidate list also carries ~/.local/bin and /usr/local/bin, which we must not touch.
function sandbox() {
  return makeSandbox('geneseed-link-').path;
}

test('link writes a regular Node shim, not a symlink to the bash launcher',
  { skip: !unix }, () => {
    const dir = sandbox();
    try {
      assert.equal(cmdLink({ dir }), 0);
      const dest = path.join(dir, 'geneseed');
      assert.ok(existsSync(dest));
      assert.equal(lstatSync(dest).isSymbolicLink(), false, 'must not be a symlink');
      const body = readFileSync(dest, 'utf-8');
      assert.match(body, /bin\/geneseed-cli\.mjs/);
      assert.match(body, /GENESEED_LINK_SHIM/);
      assert.doesNotMatch(body, /python/i);
      assert.ok(lstatSync(dest).mode & 0o111, 'must be executable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test('unlink removes the shim link wrote', { skip: !unix }, () => {
  const dir = sandbox();
  const saved = process.env.PATH;
  try {
    assert.equal(cmdLink({ dir }), 0);
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.equal(cmdUnlink(), 0);
    assert.equal(existsSync(path.join(dir, 'geneseed')), false,
      'unlink must remove what link wrote');
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unlink still removes a LEGACY symlink install', { skip: !unix }, () => {
  const dir = sandbox();
  const saved = process.env.PATH;
  try {
    // The shape every existing `geneseed link` install has on disk today.
    symlinkSync(path.join(process.cwd(), 'geneseed'), path.join(dir, 'geneseed'));
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.equal(cmdUnlink(), 0);
    assert.equal(existsSync(path.join(dir, 'geneseed')), false);
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unlink leaves a FOREIGN geneseed alone', { skip: !unix }, () => {
  const dir = sandbox();
  const saved = process.env.PATH;
  const foreign = path.join(dir, 'geneseed');
  try {
    writeFileSync(foreign, '#!/bin/sh\necho not ours\n');
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.equal(cmdUnlink(), 0);
    assert.ok(existsSync(foreign), 'a file we did not write must survive');
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
