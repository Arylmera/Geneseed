// tests/unit/factory_cli.test.mjs
// `geneseed factory` end to end through bin/geneseed-cli.mjs: the JSON it prints is the whole
// interface the factory Rite has. Every action prints exactly ONE JSON line (the `run` helper
// asserts it on every call) and exits 1 on a refusal. Each sandbox is a fake git root (a `.git/`
// holding only a detached HEAD, which `setHead` moves as a loop's commit would) holding the fixture
// factories at its project level, `.geneseed/factories/`, with XDG_CONFIG_HOME pointed inside it so
// nothing reads or writes the machine tier. The tests at the end build real git repositories: the
// porcelain git prints, and the HEAD `headCommit` reads, are what they are only when git says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { headCommit } from '../../js/hosts/gitref.mjs';

const CLI = path.resolve(import.meta.dirname, '../../bin/geneseed-cli.mjs');
const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/factories');
const run = (cwd, argv, input = '') => {
  const r = spawnSync(process.execPath, [CLI, 'factory', ...argv], {
    cwd, input, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(cwd, 'xdg') },
  });
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `one JSON line per action, got: ${r.stdout}${r.stderr}`);
  return { code: r.status, out: JSON.parse(lines[0]) };
};
const sha = (d) => String(d).repeat(40);
const setHead = (sb, d) => writeFileSync(path.join(sb.path, '.git', 'HEAD'), `${sha(d)}\n`);
const repo = (factories = ['fixture-fix', 'fixture-spec', 'fixture-broken']) => {
  const sb = makeSandbox('factorycli-');
  mkdirSync(path.join(sb.path, '.git'));
  setHead(sb, 0);
  const dir = path.join(sb.path, '.geneseed', 'factories');
  mkdirSync(dir, { recursive: true });
  for (const f of factories) copyFileSync(path.join(FIXTURES, `${f}.json`), path.join(dir, `${f}.json`));
  return sb;
};
// R2: a loop stage passes with no LOOP.md left only when the loop registry saw a `loop init` here
// after `factory next`. `loopRan` is that loop, end to end: the real `geneseed loop init` (its
// registry row lands in the sandbox's XDG_CONFIG_HOME), then its close removing LOOP.md.
const loopRan = (sb, graph) => {
  const r = spawnSync(process.execPath, [CLI, 'loop', 'init', '--title', 't', '--requirement', 'r', '--graph', graph], {
    cwd: sb.path, encoding: 'utf8', windowsHide: true, env: { ...process.env, XDG_CONFIG_HOME: path.join(sb.path, 'xdg') },
  });
  assert.equal(r.status, 0, `fixture: loop init ${graph} -> ${r.stdout}${r.stderr}`);
  rmSync(path.join(sb.path, 'LOOP.md'));
};
const INIT = ['init', '--title', 'Rounding', '--requirement', 'Totals round wrong', '--input', 'issue #12'];

test('check: the catalogue, one factory, and a broken one', () => {
  const sb = repo();
  try {
    assert.deepEqual(run(sb.path, ['check']), {
      code: 1,
      out: {
        ok: false,
        problems: [
          'factories/fixture-broken: cycle loop:nope, review has no declared cycle around it',
          'factories/fixture-broken: stage loop:nope: no loop template named nope',
        ],
        factories: ['fixture-broken', 'fixture-fix', 'fixture-spec'],
      },
    });
    assert.deepEqual(run(sb.path, ['check', '--factory', 'fixture-fix']), { code: 0, out: { ok: true, problems: [] } });
    assert.equal(run(sb.path, ['check', '--factory', 'fixture-broken']).code, 1);
    assert.deepEqual(run(sb.path, ['check', '--factory', 'nope']), { code: 1, out: { error: 'no factory named "nope"' } });
  } finally { sb.cleanup(); }
});

test('list: name, description, category and origin of every factory', () => {
  const sb = repo(['fixture-fix']);
  try {
    assert.deepEqual(run(sb.path, ['list']), {
      code: 0,
      out: {
        factories: [{
          name: 'fixture-fix', category: null, origin: 'project',
          description: 'Test fixture: plan, run the bugfix loop, review; a failed review sends the item back to the loop.',
        }],
      },
    });
  } finally { sb.cleanup(); }
});

// R7: an unknown factory, or one that fails check, is refused before any stage runs.
test('R7: init refuses an unknown or broken factory and writes nothing', () => {
  const sb = repo();
  try {
    assert.deepEqual(run(sb.path, ['init', '--title', 'x']), { code: 1, out: { error: 'init needs --title, --requirement and --factory' } });
    assert.deepEqual(run(sb.path, [...INIT, '--factory', 'nope']), { code: 1, out: { error: 'no factory named "nope"' } });
    assert.deepEqual(run(sb.path, [...INIT, '--factory', 'fixture-broken']), {
      code: 1,
      out: {
        error: 'the factory does not pass factory check',
        problems: ['stage loop:nope: no loop template named nope', 'cycle loop:nope, review has no declared cycle around it'],
      },
    });
    assert.ok(!existsSync(path.join(sb.path, 'FACTORY.md')));
  } finally { sb.cleanup(); }
});

test('init -> next -> record through a brick stage, a loop stage and a back-route', () => {
  const sb = repo();
  const file = path.join(sb.path, 'FACTORY.md');
  try {
    assert.deepEqual(run(sb.path, [...INIT, '--factory', 'fixture-fix']),
      { code: 0, out: { file, factory: 'fixture-fix', stage: 'plan', status: 'running' } });
    assert.deepEqual(run(sb.path, [...INIT, '--factory', 'fixture-fix']),
      { code: 1, out: { error: `${file} already exists — a factory is already running here` } });
    const next = run(sb.path, ['next']).out;
    assert.deepEqual({ ...next, prompt: typeof next.prompt }, {
      stage: 'plan', effect: 'read', agent: 'architect', skill: null, outcomes: ['pass'], prompt: 'string',
      requirement: 'Totals round wrong', input: 'issue #12', carry: null, rules: ['Never merge.'],
    });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], ''), { code: 0, out: { stage: 'loop:bugfix' } });
    assert.deepEqual(run(sb.path, ['next']), { code: 0, out: { stage: 'loop:bugfix', loop: 'bugfix', notes: [], rules: ['Never merge.'] } });

    // R3: while the child loop's LOOP.md exists, the factory does not move.
    writeFileSync(path.join(sb.path, 'LOOP.md'), 'a running loop');
    const r3 = run(sb.path, ['next']);
    assert.equal(r3.code, 1);
    assert.match(r3.out.error, /^a loop is still running in this worktree \(LOOP\.md exists\)/);
    assert.equal(run(sb.path, ['record', '--outcome', 'pass']).code, 1);
    rmSync(path.join(sb.path, 'LOOP.md'));

    // R2: no LOOP.md left, so only the loop's close commit (HEAD moved since `next`) lets it record,
    // and pass also needs the registry's `loop init` after `next`: a HEAD move alone is fail only.
    assert.match(run(sb.path, ['record', '--outcome', 'pass']).out.error, /^loop:bugfix cannot report pass: no LOOP\.md is left and HEAD has not moved/);
    setHead(sb, 1);
    assert.match(run(sb.path, ['record', '--outcome', 'pass']).out.error, /^loop:bugfix cannot report pass on a HEAD move alone: no LOOP\.md is left, and the loop registry records no/);
    loopRan(sb, 'bugfix');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'review' } });
    // J5: a brick stage outside a loop that left the tree dirty is refused, FACTORY.md untouched.
    const before = readFileSync(file, 'utf8');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], ' M src/a.js\n'), {
      code: 1, out: { error: 'review left the worktree dirty, and a stage outside a loop never changes it:  M src/a.js' },
    });
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail', '--carry', 'totals still off by one cent'], ' M FACTORY.md\n'),
      { code: 0, out: { stage: 'loop:bugfix' } });
    assert.deepEqual(run(sb.path, ['next']).out.notes, ['totals still off by one cent']);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'nope']),
      { code: 1, out: { error: 'loop:bugfix cannot report "nope" — one of pass, fail' } });
  } finally { sb.cleanup(); }
});

// R2 through the CLI: a child loop that ended on $stop leaves its LOOP.md in place, so R3 reads
// its status. A running or awaiting loop (or an unreadable LOOP.md) still owns the worktree; a
// stopped one does not, and `record --outcome fail` follows the loop stage's fail edge.
const loopMd = (status, name = 'bugfix') => `# Loop\n\n<!-- loop-state:begin -->\n\`\`\`json\n${JSON.stringify({ status, graph: { name } })}\n\`\`\`\n<!-- loop-state:end -->\n`;
test('R2: a stopped LOOP.md lets record fail through; a running or awaiting one does not', () => {
  const sb = repo(['fixture-fix']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-fix']);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'loop:bugfix' } });
    assert.equal(run(sb.path, ['next']).code, 0);
    for (const status of ['running', 'awaiting']) {
      writeFileSync(path.join(sb.path, 'LOOP.md'), loopMd(status));
      const r = run(sb.path, ['record', '--outcome', 'fail']);
      assert.equal(r.code, 1, status);
      assert.match(r.out.error, /^a loop is still running in this worktree/, status);
    }
    // the outcome must match the status: stopped is fail, done is pass
    writeFileSync(path.join(sb.path, 'LOOP.md'), loopMd('stopped'));
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']),
      { code: 1, out: { error: 'loop:bugfix cannot report pass: its LOOP.md says the loop stopped — report fail' } });
    writeFileSync(path.join(sb.path, 'LOOP.md'), loopMd('done'));
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail']),
      { code: 1, out: { error: 'loop:bugfix cannot report fail: its LOOP.md says the loop is done — report pass' } });
    // a stale LOOP.md from another template is not this stage's loop
    writeFileSync(path.join(sb.path, 'LOOP.md'), loopMd('done', 'feature'));
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']),
      { code: 1, out: { error: "the LOOP.md at the worktree root ran feature, not bugfix: it is not loop:bugfix's loop" } });
    writeFileSync(path.join(sb.path, 'LOOP.md'), loopMd('stopped'));
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail']), { code: 0, out: { stopped: 'loop:bugfix reported fail' } });
  } finally { sb.cleanup(); }
});

// R3 before a new loop: a stopped loop's LOOP.md still at the root blocks `next` on the loop stage
// a back-route re-enters, and the error names the removal the Rite makes.
test('R3: next on a loop stage refuses a leftover LOOP.md and names its removal', () => {
  const sb = repo(['fixture-fix']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-fix']);
    run(sb.path, ['record', '--outcome', 'pass']);
    run(sb.path, ['next']); loopRan(sb, 'bugfix'); setHead(sb, 1);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'review' } });
    writeFileSync(path.join(sb.path, 'LOOP.md'), loopMd('done'));
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail']), { code: 0, out: { stage: 'loop:bugfix' } });
    assert.deepEqual(run(sb.path, ['next']), {
      code: 1,
      out: { error: 'the previous loop left its LOOP.md at the worktree root: run `git rm -f LOOP.md` and commit that removal before `geneseed loop init` starts loop:bugfix' },
    });
  } finally { sb.cleanup(); }
});

// R4: an unreadable FACTORY.md is refused by every state action, and nothing repairs it.
test('R4: every action refuses an unreadable FACTORY.md and leaves it as it was', () => {
  const sb = repo();
  const file = path.join(sb.path, 'FACTORY.md');
  try {
    assert.deepEqual(run(sb.path, ['next']), { code: 1, out: { error: `${file} does not exist — run \`geneseed factory init\` first` } });
    writeFileSync(file, '# Factory\n\n<!-- factory-state:begin -->\n```json\n{ torn\n```\n<!-- factory-state:end -->\n');
    const before = readFileSync(file, 'utf8');
    for (const argv of [['next'], ['record', '--outcome', 'pass'], ['decide', '--verdict', 'ok']]) {
      const r = run(sb.path, argv);
      assert.equal(r.code, 1, argv.join(' '));
      assert.match(r.out.error, /^FACTORY\.md is unreadable: /);
    }
    assert.equal(run(sb.path, [...INIT, '--factory', 'fixture-fix']).code, 1, 'init does not overwrite it either');
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally { sb.cleanup(); }
});

// The gated shipped `spec` brick writes the spec; `--spec` hands its tasks to the loop stage.
test('record --spec counts the tasks; the gate holds until decide; next names the task', () => {
  const sb = repo();
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, 'specs', 'r'), { recursive: true });
    writeFileSync(path.join(sb.path, 'specs', 'r', 'spec.md'), '# Rounding\n\n## Tasks\n\n1. Round half-even\n2. Verify end to end\n');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/r/spec.md'], '?? specs/r/spec.md\n'),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
    assert.deepEqual(run(sb.path, ['decide', '--verdict', 'ok']), { code: 0, out: { stage: 'loop:feature' } });
    assert.deepEqual(run(sb.path, ['next']).out,
      { stage: 'loop:feature', loop: 'feature', notes: [], task: { path: 'specs/r/spec.md', count: 2, index: 1 } });
    loopRan(sb, 'feature'); setHead(sb, 1);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']),
      { code: 0, out: { stage: 'loop:feature', task: { path: 'specs/r/spec.md', count: 2, index: 2 } } });
    run(sb.path, ['next']); loopRan(sb, 'feature'); setHead(sb, 2);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'lint' } });
  } finally { sb.cleanup(); }
});

test('record --spec refuses a path outside the worktree, before reading it', () => {
  const sb = repo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    const before = readFileSync(path.join(sb.path, 'FACTORY.md'), 'utf8');
    for (const spec of ['../outside/spec.md', path.join(path.dirname(sb.path), 'abs', 'spec.md')]) {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', spec]),
        { code: 1, out: { error: `--spec ${spec} is outside the worktree` } }, spec);
    }
    assert.equal(readFileSync(path.join(sb.path, 'FACTORY.md'), 'utf8'), before);
  } finally { sb.cleanup(); }
});

// F6: a directory whose name starts with `..` is inside the root; only `..` itself, or a path
// under it, is outside.
test('record --spec accepts a path inside the worktree whose first segment starts with ..', () => {
  const sb = repo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, '..r'));
    writeFileSync(path.join(sb.path, '..r', 'spec.md'), '# R\n\n## Tasks\n\n1. one\n');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', '..r/spec.md'], ''),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
  } finally { sb.cleanup(); }
});

// R4 past the JSON (F4): a hand-edited FACTORY.md whose counters the engine could not have written
// is refused by every state action, and left as it was.
test('R4: a FACTORY.md edited past the engine\'s bounds is refused and left as it was', () => {
  const sb = repo(['fixture-fix']);
  const file = path.join(sb.path, 'FACTORY.md');
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-fix']);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"runCeiling": 30', '"runCeiling": 100000'));
    const before = readFileSync(file, 'utf8');
    for (const argv of [['next'], ['record', '--outcome', 'pass'], ['decide', '--verdict', 'ok']]) {
      assert.deepEqual(run(sb.path, argv), { code: 1, out: { error: 'FACTORY.md is unreadable: runCeiling must be 600 at most' } }, argv.join(' '));
    }
    assert.equal(readFileSync(file, 'utf8'), before);
    // a `cycles` edited into an object: refused as unreadable, never a TypeError out of `transition`
    const lf = before.replace(/\r\n/g, '\n');
    const state = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(lf)[1]);
    state.runCeiling = 30; state.stage = 'review'; state.factory.cycles = {};
    writeFileSync(file, lf.replace(/```json\n[\s\S]*?\n```/, `\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\``));
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail'], ''),
      { code: 1, out: { error: 'FACTORY.md is unreadable: factory.cycles must be a list' } });
  } finally { sb.cleanup(); }
});

// Real git from here on: the tests may spawn it, the product CLI may not.
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `fixture: git ${args.join(' ')} -> ${r.status}\n${r.stderr}`);
  return r.stdout;
};
const gitRepo = (factories) => {
  const sb = repo(factories);
  rmSync(path.join(sb.path, '.git'), { recursive: true });
  git(sb.path, 'init', '-q');
  writeFileSync(path.join(sb.path, '.git', 'info', 'exclude'), '.geneseed/\nxdg/\n');
  return sb;
};

// F1: the porcelain git really prints. Plain `--porcelain` folds the new spec directory into
// `?? specs/`, which the exemption cannot match, and the refusal names the form that unfolds it;
// `--untracked-files=all` lists the spec itself, and the stage records.
test('record --spec with the porcelain real git prints: --untracked-files=all is the form that records', () => {
  const sb = gitRepo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, 'specs', 'r'), { recursive: true });
    writeFileSync(path.join(sb.path, 'specs', 'r', 'spec.md'), '# Rounding\n\n## Tasks\n\n1. Round half-even\n');
    const folded = git(sb.path, 'status', '--porcelain');
    assert.equal(folded, '?? FACTORY.md\n?? specs/\n', 'plain porcelain folds the directory');
    const r = run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/r/spec.md'], folded);
    assert.equal(r.code, 1);
    assert.match(r.out.error, /\?\? specs\/ — a path ending in \/ is a whole untracked directory: pipe `git status --porcelain --untracked-files=all`/);
    const all = git(sb.path, 'status', '--porcelain', '--untracked-files=all');
    assert.equal(all, '?? FACTORY.md\n?? specs/r/spec.md\n');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/r/spec.md'], all),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
  } finally { sb.cleanup(); }
});

// The fs-only HEAD reader against `git rev-parse HEAD`: unborn, a loose ref, a packed one, a
// detached HEAD, and a linked worktree (whose branch ref lives in the shared gitdir).
test('headCommit reads the HEAD commit git names, without spawning it', () => {
  const sb = gitRepo([]);
  const revParse = (cwd) => git(cwd, 'rev-parse', 'HEAD').trim();
  try {
    assert.equal(headCommit(sb.path), null, 'an unborn branch has no commit');
    writeFileSync(path.join(sb.path, 'a.txt'), 'a');
    git(sb.path, 'add', 'a.txt'); git(sb.path, 'commit', '-qm', 'a');
    assert.equal(headCommit(sb.path), revParse(sb.path), 'loose ref');
    git(sb.path, 'pack-refs', '--all');
    assert.equal(headCommit(sb.path), revParse(sb.path), 'packed ref');
    const wt = path.join(sb.path, 'wt');
    git(sb.path, 'worktree', 'add', '-q', '-b', 'side', wt);
    git(wt, 'commit', '-q', '--allow-empty', '-m', 'b');
    assert.equal(headCommit(wt), revParse(wt), 'linked worktree');
    assert.notEqual(headCommit(wt), headCommit(sb.path));
    git(sb.path, 'checkout', '-q', '--detach');
    assert.equal(headCommit(sb.path), revParse(sb.path), 'detached');
  } finally { sb.cleanup(); }
});
