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
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
        factories: ['analysis-to-build', 'bug-report-to-fix', 'fixture-broken', 'fixture-fix', 'fixture-spec', 'issue-to-pr'],
      },
    });
    assert.deepEqual(run(sb.path, ['check', '--factory', 'fixture-fix']), { code: 0, out: { ok: true, problems: [] } });
    assert.equal(run(sb.path, ['check', '--factory', 'fixture-broken']).code, 1);
    assert.deepEqual(run(sb.path, ['check', '--factory', 'nope']), { code: 1, out: { error: 'no factory named "nope"' } });
  } finally { sb.cleanup(); }
});

// M8: a project factory that shadows a shipped one is named in `check`'s `overridden`, as loop
// check names an overridden brick; and a project file of that name that does not load makes
// `init` refuse with its problem (and its origin), where the shipped graph used to run instead.
test('M8: check names an overridden factory; init refuses a broken override instead of the shipped one', () => {
  const sb = repo([]);
  const file = path.join(sb.path, '.geneseed', 'factories', 'bug-report-to-fix.json');
  try {
    const shipped = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../src/factories/bug-report-to-fix.json'), 'utf8'));
    writeFileSync(file, JSON.stringify(shipped));
    assert.deepEqual(run(sb.path, ['check']).out.overridden, ['bug-report-to-fix (project, overrides shipped)']);
    writeFileSync(file, '{ not json');
    const check = run(sb.path, ['check']);
    assert.deepEqual([check.code, check.out.problems, check.out.factories.includes('bug-report-to-fix')],
      [1, ['factories/bug-report-to-fix.json (project): not JSON'], false]);
    assert.deepEqual(run(sb.path, [...INIT, '--factory', 'bug-report-to-fix']),
      { code: 1, out: { error: 'no factory named "bug-report-to-fix": factories/bug-report-to-fix.json (project): not JSON' } });
    assert.equal(existsSync(path.join(sb.path, 'FACTORY.md')), false);
  } finally { sb.cleanup(); }
});

// The catalogue is every origin: the shipped `analysis-to-build`, `bug-report-to-fix` and
// `issue-to-pr` (src/factories/) list beside the project's fixture, sorted by name.
test('list: name, description, category and origin of every factory', () => {
  const sb = repo(['fixture-fix']);
  try {
    assert.deepEqual(run(sb.path, ['list']), {
      code: 0,
      out: {
        factories: [{
          name: 'analysis-to-build', category: 'development', origin: 'shipped',
          description: 'Turn an analysis (a document, pasted text or a request) into a spec whose task list you approve, '
            + 'build each task in turn with the feature loop in one worktree, run the base branch\'s checks and a review panel, '
            + 'play the holdout scenarios it never saw, then open one pull request and wait for green CI; a failed check, '
            + 'review or scenario, or red CI, sends the work back to the loop as one more task, twice at most each. At the '
            + 'end it asks you once whether to merge.',
        }, {
          name: 'bug-report-to-fix', category: 'development', origin: 'shipped',
          description: 'Take one bug report, fix it with the bugfix loop, run the base branch\'s checks and a review panel, '
            + 'play the holdout scenarios it never saw, open the pull request and wait for green CI; a failed check, review '
            + 'or scenario, or red CI, sends the fix back to the loop, twice at most each. At the end it asks you once '
            + 'whether to merge.',
        }, {
          name: 'fixture-fix', category: null, origin: 'project',
          description: 'Test fixture: plan, run the bugfix loop, review; a failed review sends the item back to the loop.',
        }, {
          name: 'issue-to-pr', category: 'development', origin: 'shipped',
          description: 'Take one issue, let triage pick the lane that fits (the bugfix, feature, deps-upgrade or refactor '
            + 'loop, or a docs-only update), run the base branch\'s checks and a review panel, play the holdout scenarios it '
            + 'never saw, open the pull request and wait for green CI; a failed check, review or scenario, or red CI, sends '
            + 'the work back to that lane, twice at most each. At the end it asks you once whether to merge.',
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
      code: 1, out: { error: 'review left the worktree dirty, and a stage outside a loop records only on a clean tree, so a brick that changes files commits them first:  M src/a.js' },
    });
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail', '--carry', 'totals still off by one cent'], ' M FACTORY.md\n'),
      { code: 0, out: { stage: 'loop:bugfix' } });
    assert.deepEqual(run(sb.path, ['next']).out.notes, ['totals still off by one cent']);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'nope']),
      { code: 1, out: { error: 'loop:bugfix cannot report "nope" — one of pass, fail' } });
  } finally { sb.cleanup(); }
});

// J9 through the CLI: `factory init` registers the run in factories.json, and `loop init --factory`
// stamps the run's slug on the child loop's row in loops.json. Both rows share the worktree root,
// which is how a reader groups them. The sandbox HEAD is detached, so the branch reads null.
test('init registers the run; loop init --factory stamps the child loop row', () => {
  const sb = repo(['fixture-fix']);
  try {
    const xdg = path.join(sb.path, 'xdg', 'geneseed');
    assert.equal(run(sb.path, [...INIT, '--factory', 'fixture-fix']).code, 0);
    const [row] = JSON.parse(readFileSync(path.join(xdg, 'factories.json'), 'utf8')).factories;
    assert.deepEqual({ ...row, root: typeof row.root, started: typeof row.started },
      { root: 'string', branch: null, factory: 'fixture-fix', title: 'Rounding', started: 'string' });
    const r = spawnSync(process.execPath, [CLI, 'loop', 'init', '--title', 't', '--requirement', 'r', '--graph', 'bugfix', '--factory', 'rounding'], {
      cwd: sb.path, encoding: 'utf8', windowsHide: true, env: { ...process.env, XDG_CONFIG_HOME: path.join(sb.path, 'xdg') },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [loop] = JSON.parse(readFileSync(path.join(xdg, 'loops.json'), 'utf8')).loops;
    assert.equal(loop.factory, 'rounding');
    assert.equal(loop.root, row.root);
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

// D11 on the shipped `issue-to-pr` (no project factory loaded): triage is a fork. `next` hands it
// the lanes (each outcome with the stage it leads to), an outcome it does not declare is refused
// and FACTORY.md stays as it was, and `bug` routes straight to the bugfix loop.
test('issue-to-pr: triage gets its lanes, and the outcome it reports names the lane', () => {
  const sb = repo([]);
  const file = path.join(sb.path, 'FACTORY.md');
  try {
    assert.equal(run(sb.path, [...INIT, '--factory', 'issue-to-pr']).code, 0);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'item.md']), { code: 0, out: { stage: 'holdout-write' } });
    // The holdout writer runs as tester and hands the work item on unchanged (J11, D18).
    const hw = run(sb.path, ['next']).out;
    assert.deepEqual({ stage: hw.stage, agent: hw.agent, outcomes: hw.outcomes, carry: hw.carry },
      { stage: 'holdout-write', agent: 'tester', outcomes: ['pass', 'fail'], carry: 'item.md' });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'item.md']), { code: 0, out: { stage: 'triage' } });
    const next = run(sb.path, ['next']).out;
    assert.deepEqual({ stage: next.stage, agent: next.agent, outcomes: next.outcomes, carry: next.carry, lanes: next.lanes }, {
      stage: 'triage', agent: 'explorer', outcomes: ['bug', 'feature', 'deps', 'refactor', 'docs', 'fail'], carry: 'item.md',
      lanes: { bug: 'loop:bugfix', feature: 'loop:feature', deps: 'loop:deps-upgrade', refactor: 'loop:refactor', docs: 'docs-update' },
    });
    const before = readFileSync(file, 'utf8');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), {
      code: 1, out: { error: 'triage cannot report "pass" — one of bug, feature, deps, refactor, docs, fail' },
    });
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'bug', '--carry', 'triage.md']), { code: 0, out: { stage: 'loop:bugfix' } });
    assert.deepEqual(run(sb.path, ['next']).out, {
      stage: 'loop:bugfix', loop: 'bugfix', notes: ['triage.md'],
      rules: ["Never merge or enable auto-merge without the user's yes, asked once at the end of the run.", "Push only this worktree's own branch."],
    });
  } finally { sb.cleanup(); }
});

// R5 on the shipped `bug-report-to-fix`: the holdout writer sits between intake and the loop, the
// judge after it, and a judge that reports `error` (the diff touches the holdout folder, or a
// scenario cannot be played) stops the run; it never routes back to the developer. Between the loop
// and the judge run `checks` (as tester, gated on error and none) and `review-panel` (the factory
// skill's own stage, which seats the panel). Intake may ask: `needs-info` holds for the user.
test('bug-report-to-fix: holdout-write before the loop, holdout after it, holdout error stops', () => {
  const sb = repo([]);
  try {
    assert.equal(run(sb.path, [...INIT, '--factory', 'bug-report-to-fix']).code, 0);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'needs-info', '--carry', 'questions.md']),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'intake', outcome: 'needs-info', note: 'questions.md' } } });
    assert.deepEqual(run(sb.path, ['decide', '--verdict', 'amend', '--note', '1. refunds only']), { code: 0, out: { resumed: true } });
    assert.equal(run(sb.path, ['next']).out.carry, '1. refunds only');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'item.md']), { code: 0, out: { stage: 'holdout-write' } });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'item.md']), { code: 0, out: { stage: 'loop:bugfix' } });
    assert.deepEqual(run(sb.path, ['next']).out.notes, ['item.md']);
    loopRan(sb, 'bugfix'); setHead(sb, 1);
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'checks' } });
    const checks = run(sb.path, ['next']).out;
    assert.deepEqual({ stage: checks.stage, agent: checks.agent, outcomes: checks.outcomes },
      { stage: 'checks', agent: 'tester', outcomes: ['pass', 'fail', 'error', 'none'] });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'review-panel' } });
    const panel = run(sb.path, ['next']).out;
    assert.deepEqual({ stage: panel.stage, agent: panel.agent, skill: panel.skill, outcomes: panel.outcomes },
      { stage: 'review-panel', agent: null, skill: 'factory', outcomes: ['pass', 'fail'] });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'holdout' } });
    const judge = run(sb.path, ['next']).out;
    assert.deepEqual({ stage: judge.stage, agent: judge.agent, outcomes: judge.outcomes },
      { stage: 'holdout', agent: 'tester', outcomes: ['pass', 'fail', 'error'] });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'error']), { code: 0, out: { stopped: 'holdout reported error' } });
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
// under it, is outside. The slug folder is such a directory here, so the path is also the spec
// brick's own shape (G2).
test('record --spec accepts a path inside the worktree with a segment that starts with ..', () => {
  const sb = repo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, 'specs', '..r'), { recursive: true });
    writeFileSync(path.join(sb.path, 'specs', '..r', 'spec.md'), '# R\n\n## Tasks\n\n1. one\n');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/..r/spec.md'], ''),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
  } finally { sb.cleanup(); }
});

// M6: every path argument resolves against the current directory, `--spec` included, as
// `--factory <file>` and loop's `--note-file` do; FACTORY.md alone is found at the git root. From
// `sub/`, `../specs/r/spec.md` is the spec, and `specs/r/spec.md` names `sub/specs/r/spec.md`.
test('M6: record --spec resolves against the current directory, as every path argument does', () => {
  const sb = repo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, 'specs', 'r'), { recursive: true });
    mkdirSync(path.join(sb.path, 'sub'));
    writeFileSync(path.join(sb.path, 'specs', 'r', 'spec.md'), '# R\n\n## Tasks\n\n1. one\n');
    const sub = path.join(sb.path, 'sub');
    const r = run(sub, ['record', '--outcome', 'pass', '--spec', 'specs/r/spec.md'], '');
    assert.equal(r.code, 1);
    assert.match(r.out.error, /^cannot read --spec specs\/r\/spec\.md: /);
    assert.deepEqual(run(sub, ['record', '--outcome', 'pass', '--spec', '../specs/r/spec.md'], ''),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
  } finally { sb.cleanup(); }
});

// M7: `--carry-file` on record and `--note-file` on decide take free text from a file, so a line
// that starts with `git … commit` never sits on the command line the git gate matches whole. The
// text reaches the engine CRLF-folded and trimmed; a flag and its -file twin together are refused.
test('M7: record --carry-file and decide --note-file carry free text without the command line', () => {
  const sb = repo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, 'specs', 'r'), { recursive: true });
    writeFileSync(path.join(sb.path, 'specs', 'r', 'spec.md'), '# R\n\n## Tasks\n\n1. one\n');
    const tmp = path.join(path.dirname(sb.path), `${path.basename(sb.path)}-texts`);
    mkdirSync(tmp);
    writeFileSync(path.join(tmp, 'carry.txt'), 'the spec, then:\r\ngit commit -m "spec"\r\n\r\n');
    writeFileSync(path.join(tmp, 'note.txt'), 'split task 1\ngit push origin HEAD\n');
    try {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/r/spec.md', '--carry', 'x', '--carry-file', path.join(tmp, 'carry.txt')], ''),
        { code: 1, out: { error: 'record takes --carry or --carry-file, not both' } });
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/r/spec.md', '--carry-file', path.join(tmp, 'carry.txt')], ''),
        { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass', note: 'the spec, then:\ngit commit -m "spec"' } } });
      assert.deepEqual(run(sb.path, ['decide', '--verdict', 'amend', '--note-file', path.join(tmp, 'missing.txt')]).out.error.startsWith('cannot read --note-file '), true);
      assert.deepEqual(run(sb.path, ['decide', '--verdict', 'amend', '--note-file', path.join(tmp, 'note.txt')]), { code: 0, out: { resumed: true } });
      assert.equal(run(sb.path, ['next']).out.carry, 'split task 1\ngit push origin HEAD');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  } finally { sb.cleanup(); }
});

// F1: the skill records with the porcelain in a file on stdin (`< file`), not a pipe. A redirect
// hands the process a file descriptor, not a pipe: `record` reads it the same way. A dirty line
// in the file is refused; the clean spec porcelain records.
test('F1: record reads the porcelain from a file redirected to stdin', () => {
  const sb = repo(['fixture-spec']);
  const status = path.join(path.dirname(sb.path), `${path.basename(sb.path)}-status.txt`);
  const redirected = (argv, porcelain) => {
    writeFileSync(status, porcelain);
    const fd = openSync(status, 'r');
    try {
      const r = spawnSync(process.execPath, [CLI, 'factory', ...argv], {
        cwd: sb.path, stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true,
        env: { ...process.env, XDG_CONFIG_HOME: path.join(sb.path, 'xdg') },
      });
      return { code: r.status, out: JSON.parse(r.stdout.trim()) };
    } finally { closeSync(fd); }
  };
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, 'specs', 'r'), { recursive: true });
    writeFileSync(path.join(sb.path, 'specs', 'r', 'spec.md'), '# R\n\n## Tasks\n\n1. one\n');
    const argv = ['record', '--outcome', 'pass', '--spec', 'specs/r/spec.md'];
    const dirty = redirected(argv, '?? FACTORY.md\r\n?? specs/r/spec.md\r\n?? notes.txt\r\n');
    assert.deepEqual([dirty.code, /dirty.*\?\? notes\.txt$/.test(dirty.out.error)], [1, true]);
    assert.deepEqual(redirected(argv, '?? FACTORY.md\r\n?? specs/r/spec.md\r\n'),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
  } finally { rmSync(status, { force: true }); sb.cleanup(); }
});

// G2: a spec inside the worktree but not at specs/<slug>/spec.md is refused, and FACTORY.md stays
// as it was. Stored, it would pass this record and fail R4 on every later action: `decide` here.
test('G2: record --spec refuses a path that is not specs/<slug>/spec.md, and the run goes on', () => {
  const sb = repo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    writeFileSync(path.join(sb.path, 'plan.md'), '# R\n\n## Tasks\n\n1. one\n');
    const before = readFileSync(path.join(sb.path, 'FACTORY.md'), 'utf8');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'plan.md'], ''),
      { code: 1, out: { error: '--spec plan.md is not a spec the engine can keep: record a file named spec.md one folder under specs/ (specs/<slug>/spec.md; the folder may have any name but . or ..)' } });
    assert.equal(readFileSync(path.join(sb.path, 'FACTORY.md'), 'utf8'), before);
    assert.equal(run(sb.path, ['next']).out.stage, 'spec');
  } finally { sb.cleanup(); }
});

// R4 past the JSON (F4): a hand-edited FACTORY.md whose counters the engine could not have written
// is refused by every state action, and left as it was.
test('R4: a FACTORY.md edited past the engine\'s bounds is refused and left as it was', () => {
  const sb = repo(['fixture-fix']);
  const file = path.join(sb.path, 'FACTORY.md');
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-fix']);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"runCeiling": 60', '"runCeiling": 100000'));
    const before = readFileSync(file, 'utf8');
    for (const argv of [['next'], ['record', '--outcome', 'pass'], ['decide', '--verdict', 'ok']]) {
      assert.deepEqual(run(sb.path, argv), { code: 1, out: { error: 'FACTORY.md is unreadable: runCeiling must be 1200 at most' } }, argv.join(' '));
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

// M11: the porcelain real git prints for a non-ASCII slug is C-quoted with octal escapes (the
// default core.quotePath); the engine unquotes it, so the spec records.
test('M11: record --spec with a non-ASCII slug, on the porcelain real git prints', () => {
  const sb = gitRepo(['fixture-spec']);
  try {
    run(sb.path, [...INIT, '--factory', 'fixture-spec']);
    mkdirSync(path.join(sb.path, 'specs', 'café'), { recursive: true });
    writeFileSync(path.join(sb.path, 'specs', 'café', 'spec.md'), '# R\n\n## Tasks\n\n1. one\n');
    const all = git(sb.path, '-c', 'core.quotePath=true', 'status', '--porcelain', '--untracked-files=all');
    assert.equal(all, '?? FACTORY.md\n?? "specs/caf\\303\\251/spec.md"\n');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/café/spec.md'], all),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
  } finally { sb.cleanup(); }
});

// D9 + J7 on the shipped `analysis-to-build`, in a real git repository, every porcelain the one
// git prints: intake -> spec (3 tasks, gated) -> holdout-write -> loop:feature once per task ->
// checks red -> loop:feature once more (task 3/3 marked `extra`, the failing check as its note; D12:
// checks runs only after the last task) -> checks -> review-panel -> holdout red -> the extra task
// again (the failed scenario's sentence as its note) -> checks -> review-panel -> holdout green ->
// pr-open -> merge-gate red -> the extra task "make CI green" (the red CI's carry as its note) ->
// checks -> review-panel -> holdout -> pr-open -> merge-gate green -> retro -> $close.
// The spec is committed after the gate's ok, before the first loop: an untracked spec would stop
// that loop's first read brick (`plan`). Each loop is a real `loop init` (the registry's evidence)
// and a real commit (HEAD moves); the extra pass goes to pr-open, never to a task 4.
test('analysis-to-build: spec, three tasks, red CI as one extra task, then $close', () => {
  const sb = gitRepo([]);
  const porcelain = () => git(sb.path, 'status', '--porcelain', '--untracked-files=all');
  const commit = (msg) => git(sb.path, 'commit', '-q', '--allow-empty', '-m', msg);
  const RULES = ["Never merge or enable auto-merge without the user's yes, asked once at the end of the run.", "Push only this worktree's own branch."];
  const TASK = { path: 'specs/build/spec.md', count: 3 };
  // checks then review-panel, both green: what every pass of the loop goes through on its way to holdout
  const gated = () => {
    for (const out of [{ stage: 'review-panel' }, { stage: 'holdout' }]) {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], porcelain()), { code: 0, out });
    }
  };
  try {
    commit('base');
    assert.equal(run(sb.path, [...INIT, '--factory', 'analysis-to-build']).out.stage, 'intake');
    assert.equal(porcelain(), '?? FACTORY.md\n', 'FACTORY.md is the only change, and the engine ignores it');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'item.md'], porcelain()), { code: 0, out: { stage: 'spec' } });
    const spec = run(sb.path, ['next']).out;
    assert.deepEqual({ stage: spec.stage, agent: spec.agent, carry: spec.carry }, { stage: 'spec', agent: 'architect', carry: 'item.md' });
    mkdirSync(path.join(sb.path, 'specs', 'build'), { recursive: true });
    writeFileSync(path.join(sb.path, 'specs', 'build', 'spec.md'),
      '# Build\n\n## Tasks\n\n1. Parse the input\n2. Round half-even\n3. Verify end to end\n');
    assert.equal(porcelain(), '?? FACTORY.md\n?? specs/build/spec.md\n');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--spec', 'specs/build/spec.md'], porcelain()),
      { code: 0, out: { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } } });
    assert.deepEqual(run(sb.path, ['decide', '--verdict', 'ok']), { code: 0, out: { stage: 'holdout-write' } });
    git(sb.path, 'add', 'specs/build/spec.md'); commit('spec');
    // The holdout writer reads the spec's finding and hands it on unchanged: the scenarios live
    // outside the worktree, so the tree stays clean.
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'spec-finding.md'], porcelain()),
      { code: 0, out: { stage: 'loop:feature' } });

    for (const index of [1, 2, 3]) {
      assert.deepEqual(run(sb.path, ['next']).out,
        { stage: 'loop:feature', loop: 'feature', notes: index === 1 ? ['spec-finding.md'] : [], task: { ...TASK, index }, rules: RULES }, `task ${index}`);
      loopRan(sb, 'feature'); commit(`task ${index}`);
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']).out,
        index < 3 ? { stage: 'loop:feature', task: { ...TASK, index: index + 1 } } : { stage: 'checks' });
    }
    // A red check after the last task sends the work back as one extra task, spending `checks`.
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail', '--carry', 'checks-red.md'], porcelain()), { code: 0, out: { stage: 'loop:feature' } });
    assert.deepEqual(run(sb.path, ['next']).out, {
      stage: 'loop:feature', loop: 'feature', notes: ['checks-red.md'],
      task: { ...TASK, index: 3, extra: 'checks reported fail' }, rules: RULES,
    });
    loopRan(sb, 'feature'); commit('make the checks pass');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'checks' } });
    gated();
    // A failed scenario sends the work back as one extra task, its one-sentence carry as the note,
    // and spends the `holdout` cycle (the smallest that holds the source), not `ci`.
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail', '--carry', 'holdout-red.md'], porcelain()), { code: 0, out: { stage: 'loop:feature' } });
    assert.deepEqual(run(sb.path, ['next']).out, {
      stage: 'loop:feature', loop: 'feature', notes: ['holdout-red.md'],
      task: { ...TASK, index: 3, extra: 'holdout reported fail' }, rules: RULES,
    });
    loopRan(sb, 'feature'); commit('make the holdout pass');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'checks' } });
    gated();
    for (const out of [{ stage: 'pr-open' }, { stage: 'merge-gate' }]) {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], porcelain()), { code: 0, out });
    }
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail', '--carry', 'ci-red.md'], porcelain()), { code: 0, out: { stage: 'loop:feature' } });
    assert.deepEqual(run(sb.path, ['next']).out, {
      stage: 'loop:feature', loop: 'feature', notes: ['ci-red.md'],
      task: { ...TASK, index: 3, extra: 'merge-gate reported fail' }, rules: RULES,
    });
    loopRan(sb, 'feature'); commit('make CI green');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass']), { code: 0, out: { stage: 'checks' } });
    gated();
    for (const out of [{ stage: 'pr-open' }, { stage: 'merge-gate' }, { stage: 'retro' }, { done: true }]) {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], porcelain()), { code: 0, out });
    }
    const end = run(sb.path, ['next']).out;
    assert.equal(end.terminal, '$close');
    assert.deepEqual(end.summary.history.map((h) => [h.stage, h.outcome ?? h.verdict, h.task]), [
      ['intake', 'pass', 0], ['spec', 'pass', 1], ['spec', 'ok', 1], ['holdout-write', 'pass', 1],
      ['loop:feature', 'pass', 1], ['loop:feature', 'pass', 2], ['loop:feature', 'pass', 3],
      ['checks', 'fail', 3], ['loop:feature', 'pass', 3], ['checks', 'pass', 3], ['review-panel', 'pass', 3],
      ['holdout', 'fail', 3], ['loop:feature', 'pass', 3], ['checks', 'pass', 3], ['review-panel', 'pass', 3], ['holdout', 'pass', 3],
      ['pr-open', 'pass', 3], ['merge-gate', 'fail', 3], ['loop:feature', 'pass', 3], ['checks', 'pass', 3], ['review-panel', 'pass', 3],
      ['holdout', 'pass', 3], ['pr-open', 'pass', 3], ['merge-gate', 'pass', 3], ['retro', 'pass', 3],
    ]);
    const lf = readFileSync(path.join(sb.path, 'FACTORY.md'), 'utf8').replace(/\r\n/g, '\n');
    const state = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(lf)[1]);
    assert.deepEqual({ counters: state.counters, taskCount: state.taskCount, runCeiling: state.runCeiling, taskHigh: state.taskHigh },
      { counters: { checks: 1, holdout: 1, ci: 1 }, taskCount: 3, runCeiling: 180, taskHigh: 3 },
      'each extra lap spent its own cycle once and bought no task');
  } finally { sb.cleanup(); }
});

// D12 + D13 on the shipped `issue-to-pr`, in a real git repository: triage reports `docs`, so the
// run takes the brick lane `docs-update` (a mutate brick, so it commits its change before record:
// a dirty tree is refused). The docs lane goes through `checks` and `review-panel` like any lane; a
// failed review routes back to `$lane`, which is `docs-update` again, spending the `review` cycle,
// and so does a failed holdout, spending `holdout`; then holdout -> pr-open -> merge-gate -> retro
// -> $close. The lane taken is on record in FACTORY.md.
test('issue-to-pr: triage reports docs, the run takes the docs-update lane and reaches pr-open', () => {
  const sb = gitRepo([]);
  const porcelain = () => git(sb.path, 'status', '--porcelain', '--untracked-files=all');
  const commit = (msg) => git(sb.path, 'commit', '-q', '--allow-empty', '-m', msg);
  const doc = (text) => { mkdirSync(path.join(sb.path, 'docs'), { recursive: true }); writeFileSync(path.join(sb.path, 'docs', 'guide.md'), text); };
  try {
    commit('base');
    assert.equal(run(sb.path, [...INIT, '--factory', 'issue-to-pr']).out.stage, 'intake');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'item.md'], porcelain()), { code: 0, out: { stage: 'holdout-write' } });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass', '--carry', 'item.md'], porcelain()), { code: 0, out: { stage: 'triage' } });
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'docs', '--carry', 'triage.md'], porcelain()), { code: 0, out: { stage: 'docs-update' } });
    const lane = run(sb.path, ['next']).out;
    assert.deepEqual({ stage: lane.stage, agent: lane.agent, effect: lane.effect, outcomes: lane.outcomes, carry: lane.carry },
      { stage: 'docs-update', agent: 'docs', effect: 'mutate', outcomes: ['pass'], carry: 'triage.md' });
    doc('# Guide\n\nThe flag is --strict.\n');
    assert.equal(porcelain(), '?? FACTORY.md\n?? docs/guide.md\n');
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], porcelain()), {
      code: 1,
      out: { error: 'docs-update left the worktree dirty, and a stage outside a loop records only on a clean tree, so a brick that changes files commits them first: ?? docs/guide.md' },
    });
    git(sb.path, 'add', 'docs/guide.md'); commit('docs: the strict flag');
    for (const out of [{ stage: 'checks' }, { stage: 'review-panel' }]) {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], porcelain()), { code: 0, out });
    }
    // the failed review routes back to $lane: the docs lane, not a loop
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail', '--carry', 'review-red.md'], porcelain()), { code: 0, out: { stage: 'docs-update' } });
    assert.equal(run(sb.path, ['next']).out.carry, 'review-red.md');
    doc('# Guide\n\nThe flag is --strict.\n\nIt takes no value.\n');
    git(sb.path, 'add', 'docs/guide.md'); commit('docs: no value');
    for (const out of [{ stage: 'checks' }, { stage: 'review-panel' }, { stage: 'holdout' }]) {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], porcelain()), { code: 0, out });
    }
    // the failed scenario routes back to $lane too
    assert.deepEqual(run(sb.path, ['record', '--outcome', 'fail', '--carry', 'holdout-red.md'], porcelain()), { code: 0, out: { stage: 'docs-update' } });
    assert.equal(run(sb.path, ['next']).out.carry, 'holdout-red.md');
    doc('# Guide\n\nThe flag is --strict, off by default.\n');
    git(sb.path, 'add', 'docs/guide.md'); commit('docs: the default');
    for (const out of [{ stage: 'checks' }, { stage: 'review-panel' }, { stage: 'holdout' }, { stage: 'pr-open' }, { stage: 'merge-gate' }, { stage: 'retro' }, { done: true }]) {
      assert.deepEqual(run(sb.path, ['record', '--outcome', 'pass'], porcelain()), { code: 0, out });
    }
    const end = run(sb.path, ['next']).out;
    assert.equal(end.terminal, '$close');
    assert.deepEqual(end.summary.history.map((h) => [h.stage, h.outcome]), [
      ['intake', 'pass'], ['holdout-write', 'pass'], ['triage', 'docs'], ['docs-update', 'pass'], ['checks', 'pass'],
      ['review-panel', 'fail'], ['docs-update', 'pass'], ['checks', 'pass'], ['review-panel', 'pass'], ['holdout', 'fail'],
      ['docs-update', 'pass'], ['checks', 'pass'], ['review-panel', 'pass'], ['holdout', 'pass'], ['pr-open', 'pass'],
      ['merge-gate', 'pass'], ['retro', 'pass'],
    ]);
    const lf = readFileSync(path.join(sb.path, 'FACTORY.md'), 'utf8').replace(/\r\n/g, '\n');
    const state = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(lf)[1]);
    assert.deepEqual({ lane: state.lane, counters: state.counters }, { lane: 'docs-update', counters: { review: 1, holdout: 1 } });
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
