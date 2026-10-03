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
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { registryPath } from '../../js/loop/registry.mjs';

const CLI = path.resolve(import.meta.dirname, '../../bin/geneseed-cli.mjs');
const run = (cwd, argv, input = '') => {
  const r = spawnSync(process.execPath, [CLI, 'loop', ...argv], {
    cwd, input, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(cwd, 'xdg') },
  });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
};

// A bare `check` is also the catalogue LISTING the loop skill composes a free graph from: every
// template name, and every brick's frontmatter (never its body — `next` hands that over, and
// only for the node the engine chose), sorted by name, with `overridden` naming any brick a
// later origin replaced. The two rows below are written out from `src/bricks/apply.md` and
// `src/bricks/bruno-test.md`: one agent brick, one skill brick, both shipped and available.
test('check over the shipped catalogue is clean, and lists templates and bricks', () => {
  const sb = makeSandbox('loopcli-');
  try {
    const r = run(sb.path, ['check']);
    assert.equal(r.code, 0);
    assert.equal(r.out.ok, true);
    assert.deepEqual(r.out.problems, []);
    assert.deepEqual(r.out.templates, ['bugfix', 'feature', 'refactor']);
    assert.deepEqual(r.out.overridden, []);
    assert.deepEqual(r.out.bricks.map((b) => b.name), [
      'apply', 'baseline-green', 'bruno-test', 'ci-fix', 'deps-audit', 'docs-update', 'identify',
      'lint', 'plan', 'reproduce', 'review', 'security-scan', 'test',
    ]);
    assert.deepEqual(r.out.bricks[0], {
      name: 'apply', description: "Implement the current card's intent, touching only its declared write set.",
      effect: 'mutate', agent: 'developer', skill: null, outcomes: ['pass'], origin: 'shipped', available: true,
    });
    assert.deepEqual(r.out.bricks[2], {
      name: 'bruno-test', description: 'Write or update Bruno requests for the endpoints this iteration touched.',
      effect: 'mutate', agent: null, skill: 'bruno-test-writer', outcomes: ['pass', 'fail'], origin: 'shipped', available: true,
    });
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
    const scored = run(sb.path, ['score', '--diff'], '12\t0\ttest/r.test.js\n').out;
    assert.equal(scored.commit, true);
    assert.match(readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8'), /"iteration": 1/);
    // The commit message never has to be quoted on a command line (`js/hosts/hooks.mjs`'s
    // `loopExempt` only whitelists `git commit -F <path>`): the CLI writes it to a file beside
    // LOOP.md's own gitdir and names that file in the result.
    const msgFile = path.join(sb.path, '.git', 'LOOP_COMMIT_MSG');
    // X3: forward slashes even on Windows — Git Bash and git both accept that form, and a
    // raw backslash path breaks when an unquoted shell command later tries to use it.
    assert.equal(scored.message_file, msgFile.replaceAll('\\', '/'));
    assert.equal(readFileSync(msgFile, 'utf8').replace(/\r\n/g, '\n'),
      `loop(loop): iteration ${scored.iteration} — reproduce\n\n${scored.trailers}\n`);
    assert.equal(run(sb.path, ['record', '--outcome', 'nope']).out.error,
      'identify cannot report "nope" — one of more, done');
  } finally { sb.cleanup(); }
});

test('X8: the root\'s .git is a gitdir file — LOOP_COMMIT_MSG lands in that gitdir, forward-slashed', () => {
  const sb = makeSandbox('loopcli-');
  try {
    const realgit = path.join(sb.path, 'realgit');
    mkdirSync(realgit);
    writeFileSync(path.join(sb.path, '.git'), `gitdir: ${realgit}\n`);
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    run(sb.path, ['next']);
    run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
    run(sb.path, ['record', '--outcome', 'pass'], '?? test/r.test.js\n');
    const scored = run(sb.path, ['score', '--diff'], '12\t0\ttest/r.test.js\n').out;
    assert.equal(scored.commit, true);
    const msgFile = path.join(realgit, 'LOOP_COMMIT_MSG');
    assert.equal(scored.message_file, msgFile.replaceAll('\\', '/'));
    assert.ok(existsSync(msgFile), 'the message file must land in the gitdir the .git FILE names');
    assert.ok(!existsSync(path.join(sb.path, '.git', 'LOOP_COMMIT_MSG')),
      '.git is a file here — nothing should ever try to write inside it as a directory');
  } finally { sb.cleanup(); }
});

test('X6: a malformed .git gitdir file errors on score --diff without advancing the loop', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    run(sb.path, ['next']);
    run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
    run(sb.path, ['record', '--outcome', 'pass'], '?? test/r.test.js\n');
    const before = readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8');
    // Replace the `.git` DIRECTORY with a FILE that does not name a gitdir — `gitDirOf`
    // must throw on this, and that throw must happen before `withState` ever runs.
    rmSync(path.join(sb.path, '.git'), { recursive: true, force: true });
    writeFileSync(path.join(sb.path, '.git'), 'not a gitdir line\n');
    const r = run(sb.path, ['score', '--diff'], '12\t0\ttest/r.test.js\n');
    assert.equal(r.code, 1);
    assert.match(r.out.error, /does not name a gitdir/);
    assert.equal(readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8'), before,
      'the loop state must not advance when the gitdir resolution itself fails');
  } finally { sb.cleanup(); }
});

// The registry is how the Active tab discovers a loop without scanning every worktree on the
// machine; `init` records into it right after LOOP.md is written, with the branch read straight
// off `.git/HEAD` (`currentBranch`, never spawned git).
test('init records the loop into the registry, branch from currentBranch', () => {
  const sb = makeSandbox('loopcli-');
  const savedXdg = process.env.XDG_CONFIG_HOME;
  try {
    mkdirSync(path.join(sb.path, '.git'));
    writeFileSync(path.join(sb.path, '.git', 'HEAD'), 'ref: refs/heads/loop/rounding\n');
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    // The child process was handed its own XDG_CONFIG_HOME; read the same file from here.
    process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
    const raw = JSON.parse(readFileSync(registryPath(), 'utf8'));
    assert.equal(raw.loops.length, 1);
    assert.equal(raw.loops[0].root, sb.path);
    assert.equal(raw.loops[0].branch, 'loop/rounding');
    assert.equal(raw.loops[0].title, 'Rounding');
    assert.ok(raw.loops[0].started);
  } finally {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    sb.cleanup();
  }
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

// M1: `decide` closes a unit through the CLI too — a diff with a file outside the write set
// escalates to blocking (0.8 > balanced's 0.6), `decide --verdict ok` commits it at that actual
// score, and the message file it names carries the setup unit's trailers byte for byte.
test('M1: a blocking actual diff, answered with decide --verdict ok, commits through the message file', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    run(sb.path, ['next']);
    run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
    run(sb.path, ['record', '--outcome', 'pass'], '?? test/r.test.js\n?? src/b.js\n');
    assert.deepEqual(run(sb.path, ['score', '--diff'], '12\t0\ttest/r.test.js\n3\t0\tsrc/b.js\n').out,
      { score: 0.8, decision: 'blocking', reasons: ['outside the write set: src/b.js'], commit: false });
    assert.equal(run(sb.path, ['next']).out.awaiting.kind, 'actual');
    const decided = run(sb.path, ['decide', '--verdict', 'ok']).out;
    const msgFile = path.join(sb.path, '.git', 'LOOP_COMMIT_MSG');
    const trailers = 'Loop-Iteration: 0\nLoop-Bricks: reproduce\nLoop-Risk-Declared: 0.4\nLoop-Risk-Actual: 0.8\n'
      + 'Loop-Threshold: balanced 0.2/0.6\nLoop-Decision: blocking\nLoop-Tests: n/a';
    assert.deepEqual(decided, {
      commit: true, trailers, iteration: 0, intent: 'reproduce', message_file: msgFile.replaceAll('\\', '/'),
    });
    assert.equal(readFileSync(msgFile, 'utf8').replace(/\r\n/g, '\n'), `loop(loop): iteration 0 — reproduce\n\n${trailers}\n`);
  } finally { sb.cleanup(); }
});
