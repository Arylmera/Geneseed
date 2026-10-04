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
    assert.deepEqual(r.out.templates, ['api-endpoint', 'architecture-decision', 'bugfix', 'ci-repair', 'deps-upgrade', 'enforce-architecture-rule', 'feature', 'fix-flaky-tests', 'legacy-refactor', 'legacy-tests', 'refactor', 'remove-dead-code', 'spec-first-feature', 'tdd', 'update-contract']);
    assert.deepEqual(r.out.overridden, []);
    assert.deepEqual(r.out.bricks.map((b) => b.name), [
      'adr-challenge', 'adr-draft', 'apply', 'baseline-green', 'bruno-test', 'characterize', 'ci-fix',
      'ci-triage', 'compat-check', 'deps-audit', 'docs-update', 'done-check', 'fitness-define',
      'flake-check', 'flake-repro', 'identify', 'lint', 'migration-plan', 'mutation-check', 'plan',
      'red-test', 'reproduce', 'review', 'security-scan', 'spec', 'test', 'upgrade-scout',
    ]);
    assert.deepEqual(r.out.bricks[2], {
      name: 'apply', description: "Implement the current card's intent, touching only its declared write set.",
      effect: 'mutate', agent: 'developer', skill: null, outcomes: ['pass'], origin: 'shipped', available: true,
    });
    assert.deepEqual(r.out.bricks[4], {
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

// G5: `init --contracts` (comma-separated, trimmed) appends to the graph's own `contracts`.
test('init --contracts appends globs after the template\'s own contracts', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    const graphFile = path.join(sb.path, 'g.json');
    writeFileSync(graphFile, JSON.stringify({ ...JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../src/loops/bugfix.json'), 'utf8')), contracts: ['api/**'] }));
    const r = run(sb.path, ['init', '--title', 't', '--requirement', 'r', '--graph', graphFile, '--contracts', 'proto/*.proto, schema.sql']);
    assert.equal(r.code, 0);
    const text = readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8');
    assert.deepEqual(JSON.parse(text.slice(text.indexOf('```json') + 7, text.lastIndexOf('```'))).contracts,
      ['api/**', 'proto/*.proto', 'schema.sql']);
  } finally { sb.cleanup(); }
});

test('every state action refuses outside a git repository', () => {
  const sb = makeSandbox('loopcli-');
  try {
    const r = run(sb.path, ['next']);
    assert.equal(r.code, 1); assert.deepEqual(r.out, { error: 'not inside a git repository' });
  } finally { sb.cleanup(); }
});

// record --note: a finding a brick must not lose (a read setup brick's plan, a review's fail
// findings) appended to LOOP.md's notes, exactly `iteration N (node): <note>`.
test('record --note appends "iteration N (node): note" to LOOP.md notes', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    run(sb.path, ['next']);
    run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
    const r = run(sb.path, ['record', '--outcome', 'pass', '--note', 'x'], '?? test/r.test.js\n');
    assert.deepEqual(r.out, { verify: true });
    const loopmd = readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8');
    assert.match(loopmd, /"notes": \[\s*"iteration 0 \(reproduce\): x"\s*\]/);
  } finally { sb.cleanup(); }
});

// record --note-file: a multi-line note (plan's ordered list) or one that mentions
// git commit/push can't go on the command line — `--note-file` reads it from a file instead,
// CRLF-folded and trailing-whitespace trimmed, same as the porcelain read from stdin.
test('record --note-file round-trips a multi-line, CRLF note exactly into LOOP.md notes', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    run(sb.path, ['next']);
    run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
    const noteFile = path.join(sb.path, 'note.txt');
    writeFileSync(noteFile, 'iteration 1: do the thing\r\niteration 2: do the other thing\r\n\r\n');
    const r = run(sb.path, ['record', '--outcome', 'pass', '--note-file', noteFile], '?? test/r.test.js\n');
    assert.deepEqual(r.out, { verify: true });
    const loopmd = readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8');
    assert.match(loopmd, /"notes": \[\s*"iteration 0 \(reproduce\): iteration 1: do the thing\\niteration 2: do the other thing"\s*\]/);
  } finally { sb.cleanup(); }
});

test('record --note and --note-file together is an error', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    run(sb.path, ['next']);
    run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
    const noteFile = path.join(sb.path, 'note.txt');
    writeFileSync(noteFile, 'x');
    const r = run(sb.path, ['record', '--outcome', 'pass', '--note', 'y', '--note-file', noteFile], '?? test/r.test.js\n');
    assert.equal(r.code, 1);
    assert.equal(r.out.error, 'record takes --note or --note-file, not both');
  } finally { sb.cleanup(); }
});

test('record --note-file naming an unreadable file is an error', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    run(sb.path, ['next']);
    run(sb.path, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
    const r = run(sb.path, ['record', '--outcome', 'pass', '--note-file', path.join(sb.path, 'missing.txt')], '?? test/r.test.js\n');
    assert.equal(r.code, 1);
    assert.match(r.out.error, /cannot read --note-file/);
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

const SRC = path.resolve(import.meta.dirname, '../../src');
// Runs the shipped bugfix template through its setup unit (reproduce, committed as iteration 0),
// leaving the loop at `identify`, iteration 1, on a clean tree.
const pastSetup = (root) => {
  run(root, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
  run(root, ['score', '--declared', '--actions', 'new-file', '--write-set', 'test/r.test.js', '--intent', 'reproduce']);
  run(root, ['record', '--outcome', 'pass'], '?? test/r.test.js\n');
  assert.equal(run(root, ['score', '--diff'], '12\t0\ttest/r.test.js\n').out.commit, true);
};

// `record --card` refuses before LOOP.md moves: malformed JSON says so (the skill retries on an
// error that mentions JSON), and a card of the wrong shape names the field. Before this, a
// string writeSet was stored and only threw `writeSet.map is not a function` at `score --diff`,
// after pendingVerify was set — a loop nothing could move again.
test('record --card refuses malformed JSON and a wrong-shaped card without touching LOOP.md', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    pastSetup(sb.path);
    const before = readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8');
    const bad = run(sb.path, ['record', '--outcome', 'more', '--card', '{intent: x}'], '');
    assert.equal(bad.code, 1);
    assert.match(bad.out.error, /^--card is not valid JSON: /);
    const shape = run(sb.path, ['record', '--outcome', 'more', '--card', '{"intent":"x","writeSet":"src/a.js","actions":["logic"]}'], '');
    assert.deepEqual(shape, { code: 1, out: { error: "the card's writeSet must be a list of strings" }, err: '' });
    assert.equal(readFileSync(path.join(sb.path, 'LOOP.md'), 'utf8'), before);
  } finally { sb.cleanup(); }
});

// `next` only reads: it must not rewrite LOOP.md (a rewrite would undo a preset the Active tab
// saved in between). A line appended after the state block survives a `next` untouched.
test('next leaves LOOP.md byte-identical', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    run(sb.path, ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--graph', 'bugfix']);
    const file = path.join(sb.path, 'LOOP.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nhand-written line\n`);
    const before = readFileSync(file, 'utf8');
    assert.equal(run(sb.path, ['next']).out.node, 'reproduce');
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally { sb.cleanup(); }
});

// An empty pipe is a CLEAN tree, not "no porcelain given": a read brick (`test`) that leaves
// the tree clean after `apply` dirtied it reverted the work, and the read-brick check must see
// that. Before, '' read as null and the check was skipped — the loop moved on to `review`.
test('an empty porcelain pipe is a clean tree: a read brick that reverted the work stops the loop', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    pastSetup(sb.path);
    run(sb.path, ['record', '--outcome', 'more', '--card', '{"intent":"fix","writeSet":["src/a.js"],"actions":["logic"]}'], '');
    run(sb.path, ['score', '--declared']);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], ' M src/a.js\n').out, { node: 'test' });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], '').out,
      { stopped: 'read-brick-wrote: test changed the working tree' });
  } finally { sb.cleanup(); }
});

// The commit message's two fallbacks: a branch outside `loop/*` names the loop `loop`, and a
// card with no intent names the unit `setup`. A one-ring graph reaches a commit in four calls.
test('LOOP_COMMIT_MSG falls back to loop(loop) off a loop/* branch, and to "setup" with no intent', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    writeFileSync(path.join(sb.path, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const graph = path.join(sb.path, 'ring.json');
    writeFileSync(graph, JSON.stringify({
      name: 'ring', description: 'd', nodes: ['identify', 'apply'], start: 'identify',
      edges: [
        { from: 'identify', on: 'more', to: 'apply' }, { from: 'identify', on: 'done', to: '$close' },
        { from: 'apply', on: 'pass', to: 'identify' },
      ],
      loops: [{ name: 'iterations', nodes: ['identify', 'apply'], max: 5, iteration: true }],
    }));
    assert.equal(run(sb.path, ['init', '--title', 't', '--requirement', 'r', '--graph', graph]).code, 0);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'more', '--card', '{"writeSet":["src/a.js"],"actions":["logic"]}'], '').out,
      { node: 'apply' });
    run(sb.path, ['score', '--declared']);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], ' M src/a.js\n').out, { verify: true });
    const scored = run(sb.path, ['score', '--diff'], '3\t1\tsrc/a.js\n').out;
    assert.equal(scored.commit, true);
    assert.equal(scored.intent, null);
    assert.equal(readFileSync(path.join(sb.path, '.git', 'LOOP_COMMIT_MSG'), 'utf8').replace(/\r\n/g, '\n'),
      `loop(loop): iteration 1 — setup\n\n${scored.trailers}\n`);
  } finally { sb.cleanup(); }
});

test('check --graph names an unknown template', () => {
  const sb = makeSandbox('loopcli-');
  try {
    assert.deepEqual(run(sb.path, ['check', '--graph', 'nope']), { code: 1, out: { error: 'no loop template named "nope"' }, err: '' });
  } finally { sb.cleanup(); }
});

// `check` reads the project catalogue at the GIT ROOT's `.geneseed/`, as `init` and `next` do,
// so run from a subdirectory it still sees a project brick and a project template. The graph
// `mine` is bugfix with `apply` swapped for the project brick `myapply`: before, from `sub/`,
// the template was unknown and the .json path failed on `myapply`.
test('check from a subdirectory sees the git root\'s project bricks and templates', () => {
  const sb = makeSandbox('loopcli-');
  try {
    mkdirSync(path.join(sb.path, '.git'));
    const sub = path.join(sb.path, 'sub');
    for (const d of ['sub', '.geneseed/bricks', '.geneseed/loops']) mkdirSync(path.join(sb.path, d), { recursive: true });
    writeFileSync(path.join(sb.path, '.geneseed/bricks/myapply.md'),
      readFileSync(path.join(SRC, 'bricks/apply.md'), 'utf8').replace('name: apply', 'name: myapply'));
    const bugfix = readFileSync(path.join(SRC, 'loops/bugfix.json'), 'utf8');
    writeFileSync(path.join(sb.path, '.geneseed/loops/mine.json'),
      bugfix.replace('"name": "bugfix"', '"name": "mine"').replaceAll('"apply"', '"myapply"'));
    const ok = { code: 0, out: { ok: true, problems: [] }, err: '' };
    assert.deepEqual(run(sub, ['check', '--brick', '../.geneseed/bricks/myapply.md']), ok);
    assert.deepEqual(run(sub, ['check', '--graph', 'mine']), ok);
    assert.deepEqual(run(sub, ['check', '--graph', '../.geneseed/loops/mine.json']), ok);
    assert.ok(run(sub, ['check']).out.templates.includes('mine'));
  } finally { sb.cleanup(); }
});
