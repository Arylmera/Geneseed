// tests/unit/loop_cli.test.mjs
// The verb end to end through bin/geneseed-cli.mjs: the JSON it prints is the whole interface
// the loop skill has, so each expectation is a full object, written out.
//
// NO `--file`: `js/loop/cli.mjs` finds LOOP.md itself by walking up from the cwd to the first
// `.git`, so every sandbox that runs a state action needs one — an empty `.git/` dir is enough,
// nothing reads its contents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';

const CLI = path.resolve(import.meta.dirname, '../../bin/geneseed-cli.mjs');
const run = (cwd, argv, input = '') => {
  const r = spawnSync(process.execPath, [CLI, 'loop', ...argv], {
    cwd, input, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(cwd, 'xdg') },
  });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
};

test('check over the shipped catalogue is clean', () => {
  const sb = makeSandbox('loopcli-');
  try {
    assert.deepEqual(run(sb.path, ['check']), { code: 0, out: { ok: true, problems: [] }, err: '' });
  } finally { sb.cleanup(); }
});

test('init -> next -> score -> record on the shipped bugfix template', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    const init = run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    assert.deepEqual(init.out, { file: path.join(sb.path, 'LOOP.md'), graph: 'bugfix', preset: 'balanced', status: 'running' });
    assert.ok(existsSync(path.join(sb.path, 'LOOP.md')));
    assert.equal(run(sb.path, ['init', '--title', 'x', '--requirement', 'y', '--graph', 'bugfix']).out.error,
      `${path.join(sb.path, 'LOOP.md')} already exists — a loop is already running here`);
    const next = run(sb.path, ['next']).out;
    assert.equal(next.node, 'reproduce'); assert.equal(next.validate, true);
    assert.deepEqual(run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']).out,
      { score: 0.4, preset: 'balanced', threshold: [0.2, 0.6], decision: 'soft' });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], '?? test/r.test.js\n').out, { verify: true });
    assert.deepEqual(run(sb.path, ['score', '--diff'], '12\t0\ttest/r.test.js\n').out.commit, true);
    assert.match(readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8'), /"iteration": 1/);
    assert.equal(run(sb.path, ['record', '--outcome', 'nope']).out.error,
      'identify cannot report "nope" — one of more, done');
  } finally { sb.cleanup(); }
});

test('an unknown preset is refused by init', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    const r = run(sb.path, ['init', '--title', 't', '--requirement', 'r', '--graph', 'bugfix', '--preset', 'yolo']);
    assert.equal(r.code, 1); assert.equal(r.out.error, 'unknown preset "yolo"');
  } finally { sb.cleanup(); }
});

test('every state action refuses outside a git repository', () => {
  const sb = makeSandbox('loopcli-');
  try {
    const r = run(sb.path, ['next']);
    assert.equal(r.code, 1); assert.deepEqual(r.out, { error: 'not inside a git repository' });
  } finally { sb.cleanup(); }
});
