/**
 * The explain-changes renderer — what `git diff` becomes on the page.
 *
 * Every repository here is built in the OS temp root with `core.autocrlf false`, so the bytes a
 * test writes are the bytes git diffs, on Windows too. Expected values are written out: a row
 * that goes wrong is changed together with the sentence that says why.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { diffHash, parseDiff, selectDiff, MAX_FILE_LINES }
  from '../../src/skills/explain-changes/scripts/render_changes.mjs';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-changes-'));
  dirs.push(d);
  return d;
}

function write(dir, files) {
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  }
}

/** A repository whose first commit holds `files` (none → a repository with no commit). */
function repo(files = {}) {
  const dir = tmp();
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 'T');
  g('config', 'core.autocrlf', 'false');
  g('config', 'commit.gpgsign', 'false');
  write(dir, files);
  if (Object.keys(files).length) { g('add', '-A'); g('commit', '-q', '-m', 'base'); }
  return { dir, g };
}

test('a modified line is one deletion and one addition, each numbered on its own side', () => {
  const { dir } = repo({ 'a.js': 'keep\nold\n' });
  write(dir, { 'a.js': 'keep\nnew\n' });
  const [f] = parseDiff(selectDiff(dir).text);
  assert.equal(f.path, 'a.js');
  assert.equal(f.status, 'modified');
  assert.deepEqual([f.add, f.del], [1, 1]);
  assert.deepEqual(f.hunks[0].lines, [
    { t: 'ctx', o: 1, n: 1, text: 'keep' },
    { t: 'del', o: 2, text: 'old' },
    { t: 'add', n: 2, text: 'new' },
  ]);
});

test('staged changes are what the commit holds, so they win over unstaged ones', () => {
  const { dir, g } = repo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  write(dir, { 'a.txt': 'A\n', 'b.txt': 'B\n' });
  g('add', 'a.txt');
  const before = g('status', '--porcelain');
  const d = selectDiff(dir);
  assert.equal(d.mode, 'staged');
  assert.deepEqual(parseDiff(d.text).map((f) => f.path), ['a.txt']);
  assert.equal(g('status', '--porcelain'), before, 'reading the diff must not touch the index');
});

test('with nothing staged, the working tree is shown, untracked files included as added', () => {
  const { dir } = repo({ 'a.txt': 'a\n' });
  write(dir, { 'a.txt': 'A\n', 'new.js': 'one\ntwo\n' });
  const d = selectDiff(dir);
  assert.equal(d.mode, 'working tree');
  const files = parseDiff(d.text);
  assert.deepEqual(files.map((f) => [f.path, f.status]), [['a.txt', 'modified'], ['new.js', 'added']]);
  assert.deepEqual(files[1].hunks[0].lines.map((l) => [l.t, l.n, l.text]),
    [['add', 1, 'one'], ['add', 2, 'two']]);
});

test('a repository with no commit diffs against the empty tree, staged or not', () => {
  const { dir, g } = repo();
  write(dir, { 'x.txt': 'x\n' });
  assert.deepEqual(parseDiff(selectDiff(dir).text).map((f) => f.status), ['added']);
  g('add', 'x.txt');
  const d = selectDiff(dir);
  assert.equal(d.mode, 'staged');
  assert.deepEqual(parseDiff(d.text).map((f) => [f.path, f.status]), [['x.txt', 'added']]);
});

test('a deletion, a rename and a binary file are each recognised from the git headers', () => {
  const { dir, g } = repo({ 'gone.txt': 'g\n', 'old.txt': 'same\n', 'img.bin': Buffer.from([0, 1, 2]) });
  g('rm', '-q', 'gone.txt');
  g('mv', 'old.txt', 'new.txt');
  write(dir, { 'img.bin': Buffer.from([0, 9, 9, 9]) });
  g('add', 'img.bin');
  const byPath = Object.fromEntries(parseDiff(selectDiff(dir).text).map((f) => [f.path, f]));
  assert.equal(byPath['gone.txt'].status, 'deleted');
  assert.deepEqual([byPath['new.txt'].status, byPath['new.txt'].oldPath, byPath['new.txt'].hunks.length],
    ['renamed', 'old.txt', 0]);
  assert.equal(byPath['img.bin'].binary, true);
});

test('an untracked binary file is flagged binary, not decoded', () => {
  const { dir } = repo({ 'k.txt': 'k\n' });
  write(dir, { 'blob.dat': Buffer.from([0x50, 0, 0x4b]) });
  const f = parseDiff(selectDiff(dir).text).find((x) => x.path === 'blob.dat');
  assert.deepEqual([f.status, f.binary, f.hunks.length], ['added', true, 0]);
});

test('CR and the no-newline marker survive the parse unchanged', () => {
  const { dir } = repo({ 'w.txt': 'x\r\n', 'n.txt': 'x' });
  write(dir, { 'w.txt': 'y\r\n', 'n.txt': 'y' });
  const byPath = Object.fromEntries(parseDiff(selectDiff(dir).text).map((f) => [f.path, f]));
  assert.equal(byPath['w.txt'].hunks[0].lines.find((l) => l.t === 'add').text, 'y\r');
  assert.ok(byPath['n.txt'].hunks[0].lines.some((l) => l.t === 'note'
    && l.text === '\\ No newline at end of file'));
});

test('--base shows the branch against its merge base, even with a clean tree', () => {
  const { dir, g } = repo({ 'a.txt': 'a\n' });
  g('switch', '-q', '-c', 'feat');
  write(dir, { 'b.txt': 'b\n' });
  g('add', 'b.txt');
  g('commit', '-q', '-m', 'feat');
  const d = selectDiff(dir, 'main');
  assert.equal(d.mode, 'main...HEAD');
  assert.deepEqual(parseDiff(d.text).map((f) => f.path), ['b.txt']);
});

test('the hash is a pure function of the diff text', () => {
  assert.equal(diffHash('abc'), diffHash('abc'));
  assert.notEqual(diffHash('abc'), diffHash('abd'));
  assert.match(diffHash('abc'), /^[0-9a-f]{12}$/);
});

test('a file past the display cap keeps its true counts but stops adding lines', () => {
  const n = MAX_FILE_LINES + 10;
  const text = `diff --git a/big b/big\nnew file mode 100644\n--- /dev/null\n+++ b/big\n@@ -0,0 +1,${n} @@\n`
    + Array.from({ length: n }, (_, i) => `+${i}`).join('\n') + '\n';
  const [f] = parseDiff(text);
  assert.equal(f.add, n);
  assert.equal(f.hunks[0].lines.length, MAX_FILE_LINES);
  assert.equal(f.truncated, true);
});
