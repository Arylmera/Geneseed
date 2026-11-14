// `offerShellPath`'s unattended arm (`setup --profile`, install profiles D26): the PATH block goes
// into the shell startup file without a question and without a terminal. Every rc file here is a
// sandbox file passed through the `rc` seam; the real ~/.zshrc is never named.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { offerShellPath, withPathBlock } from '../../js/hosts/link.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

/** Run `fn` with stdout and stderr captured; `{ value, out }`. */
function quiet(fn) {
  const lines = [];
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { return { value: fn(), out: lines.join('') }; } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

const DIR = '/home/u/.local/bin';
const BLOCK = withPathBlock('', DIR);

test('unattended: the block is appended once, the file kept, and the rc file reported', () => {
  const sb = makeSandbox('gs-rc-');
  try {
    const rc = path.join(sb.path, '.zshrc');
    fs.writeFileSync(rc, 'alias ll="ls -l"');            // no trailing newline
    const report = {};
    const first = quiet(() => offerShellPath(DIR, { unattended: true, report, rc }));
    assert.equal(first.value, true);
    assert.equal(report.rcFile, rc);
    assert.equal(fs.readFileSync(rc, 'utf8'), `alias ll="ls -l"\n${BLOCK}`);
    const second = quiet(() => offerShellPath(DIR, { unattended: true, report: {}, rc }));
    assert.equal(second.value, true);
    assert.match(second.out, /already adds it/);
    assert.equal(fs.readFileSync(rc, 'utf8'), `alias ll="ls -l"\n${BLOCK}`, 'a second run changed the file');
  } finally { sb.cleanup(); }
});

test('unattended: a missing rc file is created holding the block alone', () => {
  const sb = makeSandbox('gs-rc-');
  try {
    const rc = path.join(sb.path, '.bashrc');
    assert.equal(quiet(() => offerShellPath(DIR, { unattended: true, rc })).value, true);
    assert.equal(fs.readFileSync(rc, 'utf8'), BLOCK);
  } finally { sb.cleanup(); }
});

test('unattended: a CRLF rc file gets a CRLF block', () => {
  const sb = makeSandbox('gs-rc-');
  try {
    const rc = path.join(sb.path, '.zshrc');
    fs.writeFileSync(rc, 'export A=1\r\n');
    quiet(() => offerShellPath(DIR, { unattended: true, rc }));
    assert.equal(fs.readFileSync(rc, 'utf8'), `export A=1\r\n${BLOCK.replaceAll('\n', '\r\n')}`);
  } finally { sb.cleanup(); }
});

test('an rc path that cannot be read (not a missing file) is left alone', () => {
  const sb = makeSandbox('gs-rc-');
  try {
    const rc = path.join(sb.path, '.zshrc');
    fs.mkdirSync(rc);                                     // a directory: EISDIR, not ENOENT
    const report = {};
    const r = quiet(() => offerShellPath(DIR, { unattended: true, report, rc }));
    assert.equal(r.value, false);
    assert.match(r.out, /could not read .* leaving it unchanged/);
    assert.equal(report.rcFile, undefined);
    assert.ok(fs.statSync(rc).isDirectory());
  } finally { sb.cleanup(); }
});

test('no shell rc file this can edit: nothing written, false', () => {
  assert.equal(quiet(() => offerShellPath(DIR, { unattended: true, rc: null })).value, false);
});

test('attended off a terminal still writes nothing (only setup --profile skips the ask)', () => {
  const sb = makeSandbox('gs-rc-');
  try {
    const rc = path.join(sb.path, '.zshrc');
    // The test runner's stdin is not a TTY, so the attended arm must stop before reading.
    assert.equal(quiet(() => offerShellPath(DIR, { rc })).value, false);
    assert.equal(fs.existsSync(rc), false);
  } finally { sb.cleanup(); }
});
