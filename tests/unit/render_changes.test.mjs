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
import path from 'node:path';
import test, { after } from 'node:test';

import { diffHash, parseDiff, selectDiff, MAX_FILE_LINES, checkBrief, safeSvg, markGenerated, run }
  from '../../src/skills/explain-changes/scripts/render_changes.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); });

function tmp() {
  const sb = makeSandbox('explain-changes-');
  sandboxes.push(sb);
  return sb.path;
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

test('a diagram is accepted only when it cannot run code or reach outside the page', () => {
  for (const [svg, ok] of [
    ['<svg viewBox="0 0 1 1"><rect/></svg>', true],
    ['<svg><a href="#u1"><text>x</text></a></svg>', true],
    ['<svg><rect style="fill:url(#g)"/></svg>', true],
    ['<svg><script>x()</script></svg>', false],
    ['<svg onload="x()"></svg>', false],
    ['<svg><rect onclick = "x()"/></svg>', false],
    ['<svg><foreignObject><div/></foreignObject></svg>', false],
    ['<svg><a href="https://evil.example">x</a></svg>', false],
    ['<svg><image xlink:href="data:image/png;base64,AA"/></svg>', false],
    ['<svg><rect style="fill:url(https://evil.example/x)"/></svg>', false],
    ['<div>not an svg</div>', false],
    ['<svg><a href=#u1>x</a></svg>', true],
    ["<svg><a href='#u1'>x</a></svg>", true],
    ['<svg><rect style="fill:url(\'#g\')"/></svg>', true],
    ['<svg><rect style=\'fill:url("#g")\'/></svg>', true],
    ['<svg><a href=https://evil.example>x</a></svg>', false],
    ['<svg><image xlink:href=https://evil.example/x.png /></svg>', false],
  ]) assert.equal(safeSvg(svg), ok, svg);
});

const FILES = parseDiff([
  'diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-a', '+A',
  'diff --git a/b.txt b/b.txt', '--- a/b.txt', '+++ b/b.txt', '@@ -1 +1 @@', '-b', '+B',
  'diff --git a/package-lock.json b/package-lock.json', '--- a/package-lock.json',
  '+++ b/package-lock.json', '@@ -1 +1 @@', '-{}', '+{ }', '',
].join('\n'));

test('the brief is checked against the diff: phantom files, phantom hunks, unexplained changes', () => {
  const lock = FILES.find((f) => f.path === 'package-lock.json');
  lock.generated = true;
  const problems = checkBrief({
    risks: [{ level: 'low', text: 'x' }],
    units: [{ title: 'U', files: ['phantom.js'], hunks: { 'a.txt': [0, 5] }, svg: '<svg onload="x()"/>' }],
  }, FILES);
  assert.deepEqual(problems, [
    'unit "U" cites phantom.js, which is not in the diff',
    'unit "U" cites hunk 5 of a.txt, which has 1',
    'unit "U": diagram dropped (unsafe SVG)',
    'b.txt is changed but no unit explains it',
  ]);
});

test('an empty risk list needs a stated reason', () => {
  const units = [{ title: 'U', files: ['a.txt', 'b.txt', 'package-lock.json'] }];
  assert.deepEqual(checkBrief({ units }, FILES), ['no risks listed and no risks_none_reason given']);
  assert.deepEqual(checkBrief({ units, risks: [], risks_none_reason: 'docs only' }, FILES), []);
});

test('lockfiles, dist/ and linguist-generated paths are marked generated', () => {
  const { dir } = repo({ '.gitattributes': 'gen/** linguist-generated\n' });
  const files = ['package-lock.json', 'dist/app.js', 'gen/x.ts', 'src/x.ts']
    .map((p) => ({ path: p, generated: false }));
  markGenerated(dir, files);
  assert.deepEqual(files.map((f) => f.generated), [true, true, true, false]);
});

const outDir = () => tmp();

/** A brief that explains `paths` in one unit and lists one risk. */
const brief = (paths, extra = {}) => ({
  title: 'T', request: 'the request', summary: 'the summary',
  risks: [{ level: 'high', text: 'check this', unit: 'u1' }],
  units: [{ id: 'u1', title: 'U', why: 'because', files: paths }], ...extra,
});

function render(dir, b, extra = ['--out', outDir()]) {
  const bf = path.join(tmp(), 'brief.json');
  fs.writeFileSync(bf, JSON.stringify(b));
  const r = run(['--brief', bf, ...extra], dir);
  assert.equal(r.code, 0, r.err.join('\n'));
  return { ...r, html: fs.readFileSync(r.out[0], 'utf8') };
}

test('a modified file renders side by side: old line left, new line right, escaped', () => {
  const { dir } = repo({ 'a.js': 'if (a < b) go();\nx = 1;\n' });
  write(dir, { 'a.js': 'if (a < b) go();\nx = 2;\n' });
  const { html } = render(dir, brief(['a.js']));
  assert.match(html, /<table class="diff split">/);
  assert.match(html, /<td class="n del">2<\/td><td class="c del">x = 1;<\/td><td class="n add">2<\/td><td class="c add">x = 2;<\/td>/);
  assert.match(html, /if \(a &lt; b\) go\(\);/);
});

test('an added file is one full-width column', () => {
  const { dir } = repo({ 'k.txt': 'k\n' });
  write(dir, { 'new.js': 'one\ntwo\n' });
  const { html } = render(dir, brief(['new.js']));
  assert.match(html, /<table class="diff single">/);
  assert.match(html, /<td class="n add">2<\/td><td class="s add">\+<\/td><td class="c add">two<\/td>/);
});

test('a carriage return is made visible rather than silently dropped', () => {
  const { dir } = repo({ 'w.txt': 'x\r\n' });
  write(dir, { 'w.txt': 'y\r\n' });
  assert.match(render(dir, brief(['w.txt'])).html, /y<span class="cr" title="CR">␍<\/span>/);
});

test('brief text is escaped: a title cannot inject markup', () => {
  const { dir } = repo({ 'a.txt': 'a\n' });
  write(dir, { 'a.txt': 'A\n' });
  const { html } = render(dir, brief(['a.txt'], { title: '<img src=x onerror=alert(1)>' }));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('the page opens dark, carries no external reference, and footers the diff hash', () => {
  const { dir } = repo({ 'a.txt': 'a\n' });
  write(dir, { 'a.txt': 'A\n' });
  const { html, out } = render(dir, brief(['a.txt']));
  assert.match(html, /^<!doctype html>\n<html lang="en" data-theme="dark">/);
  assert.doesNotMatch(html, /(src|href)=["']https?:/);
  const hash = out[1].replace('diff ', '');
  assert.equal(run(['--hash'], dir).out[0], hash);
  assert.ok(html.includes(`diff ${hash}`));
});

test('a mismatched brief still renders, bannered, with every problem on stderr', () => {
  const { dir } = repo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  write(dir, { 'a.txt': 'A\n', 'b.txt': 'B\n' });
  const { html, err } = render(dir, brief(['a.txt', 'phantom.js']));
  assert.match(html, /<div class="mismatch">/);
  assert.ok(html.includes('phantom.js, which is not in the diff'));
  assert.ok(err.some((l) => l.includes('2 narrative mismatch(es)')));
});

test('risks come ranked high to low whatever order the brief gives', () => {
  const { dir } = repo({ 'a.txt': 'a\n' });
  write(dir, { 'a.txt': 'A\n' });
  const { html } = render(dir, brief(['a.txt'], { risks: [
    { level: 'low', text: 'third' }, { level: 'high', text: 'first' }, { level: 'medium', text: 'second' },
  ] }));
  assert.ok(html.indexOf('first') < html.indexOf('second') && html.indexOf('second') < html.indexOf('third'));
});

test('lang fr switches the fixed labels', () => {
  const { dir } = repo({ 'a.txt': 'a\n' });
  write(dir, { 'a.txt': 'A\n' });
  const { html } = render(dir, brief(['a.txt'], { lang: 'fr' }));
  assert.ok(html.includes('À vérifier en priorité'));
  assert.match(html, /<html lang="fr"/);
});

test('without --out the report lands inside .git, so the next diff never contains it', () => {
  const { dir } = repo({ 'a.txt': 'a\n' });
  write(dir, { 'a.txt': 'A\n' });
  const first = render(dir, brief(['a.txt']), []);
  assert.ok(first.out[0].includes(`${path.sep}.git${path.sep}explain-changes${path.sep}`), first.out[0]);
  assert.equal(render(dir, brief(['a.txt']), []).out[1], first.out[1]);
});

test('an empty diff is exit 3 and writes nothing; bad arguments are exit 2', () => {
  const { dir } = repo({ 'a.txt': 'a\n' });
  const out = outDir();
  assert.equal(run(['--brief', 'x.json', '--out', out], dir).code, 3);
  assert.deepEqual(fs.readdirSync(out), []);
  write(dir, { 'a.txt': 'A\n' });
  assert.equal(run(['--nope'], dir).code, 2);
  assert.equal(run(['--base', '--output=x'], dir).code, 2);
  assert.equal(run([], dir).code, 2);
});
