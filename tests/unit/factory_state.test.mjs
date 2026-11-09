// tests/unit/factory_state.test.mjs
// Scenarios: a script of engine calls with the expected result written after every call. The
// catalogue is in memory; factory_cli.test.mjs drives the shipped bricks through the real CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initFactory, nextStage, recordStage, decideFactory, renderFactoryFile, parseFactoryFile,
  validateFactoryState, countSpecTasks, FACTORY_MAX_TRANSITIONS,
} from '../../js/factory/state.mjs';
import * as engine from '../../js/factory/state.mjs';
import { loadCatalog } from '../../js/loop/catalog.mjs';
import { checkFactory } from '../../js/factory/graph.mjs';

const brick = (name, outcomes, extra = {}) => [name, {
  name, outcomes, effect: 'read', agent: 'explorer', skill: null, body: `do ${name}`, available: true, ...extra,
}];
const CATALOG = {
  bricks: new Map([
    brick('plan', ['pass']), brick('review', ['pass', 'fail']), brick('triage', ['bug', 'feature', 'docs', 'fail']),
    brick('notes', ['pass']), brick('judge', ['pass', 'fail'], { gate: 'human' }),
    brick('probe', ['pass', 'error']),
    brick('spec', ['pass', 'fail'], { effect: 'mutate', agent: 'architect', gate: 'human' }),
    brick('lint', ['pass', 'fail']),
    brick('intake', ['pass', 'fail', 'needs-info'], { gate: 'human', gateOn: ['needs-info'] }),
    brick('checks', ['pass', 'fail', 'error', 'none'], { agent: 'tester', gate: 'human', gateOn: ['error', 'none'] }),
    brick('review-panel', ['pass', 'fail'], { agent: null, skill: 'factory' }),
  ]),
  templates: new Map([['bugfix', {}], ['feature', {}]]),
};
// The porcelain of a clean tree: a stage outside a loop must be handed one (J5).
const CLEAN = { porcelain: '' };
// R2: a loop stage records against its launch. `next` stores HEAD (none given here: null) and the
// time (T0), the loop inits after it (the registry's `initAt`, T1) and commits, and `record` sees
// a HEAD that moved. `loopRec` is that whole round.
const H0 = '0'.repeat(40); const H1 = '1'.repeat(40);
const T0 = '2026-11-08T10:00:00.000Z'; const T1 = '2026-11-08T10:00:01.000Z';
const LAUNCH = { now: T0 };
const MOVED = { head: H1, loopInitAt: T1 };
const loopRec = (s, outcome, opts = {}) => { nextStage(s, CATALOG, LAUNCH); return recordStage(s, CATALOG, outcome, { ...MOVED, ...opts }); };
const step = (s, outcome) => (s.stage.startsWith('loop:') ? loopRec(s, outcome) : recordStage(s, CATALOG, outcome, CLEAN));
// plan -> loop:bugfix -> review -> $close; review fail goes back to the loop (cycle rework, max 2).
const fixFactory = () => ({
  name: 'fix', description: 'd', rules: ['Never merge.'], start: 'plan', stages: ['plan', 'loop:bugfix', 'review'],
  edges: [
    { from: 'plan', on: 'pass', to: 'loop:bugfix' },
    { from: 'loop:bugfix', on: 'pass', to: 'review' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: 'loop:bugfix' },
  ],
  cycles: [{ name: 'rework', nodes: ['loop:bugfix', 'review'], max: 2 }],
});
const start = (factory = fixFactory()) => initFactory({ title: 'Rounding', requirement: 'Totals round wrong', factory, input: 'issue #12' });

test('happy path: a brick stage, a loop stage, a brick stage, then $close', () => {
  const s = start();
  assert.deepEqual(nextStage(s, CATALOG), {
    stage: 'plan', effect: 'read', agent: 'explorer', skill: null, outcomes: ['pass'], prompt: 'do plan',
    requirement: 'Totals round wrong', input: 'issue #12', carry: null, rules: ['Never merge.'],
  });
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { porcelain: '' }), { stage: 'loop:bugfix' });
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH), { stage: 'loop:bugfix', loop: 'bugfix', notes: [], rules: ['Never merge.'] });
  assert.deepEqual(recordStage(s, CATALOG, 'pass', MOVED), { stage: 'review' });
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { porcelain: '' }), { done: true });
  assert.deepEqual(nextStage(s, CATALOG), {
    terminal: '$close',
    summary: {
      transitions: 2,
      history: [
        { stage: 'plan', outcome: 'pass', task: 0 }, { stage: 'loop:bugfix', outcome: 'pass', task: 0 },
        { stage: 'review', outcome: 'pass', task: 0 },
      ],
    },
  });
  assert.throws(() => recordStage(s, CATALOG, 'pass'), /the factory is done, not running/);
});

// A fail on the cycle's back edge spends the cycle (its first stage is the edge's target), hands
// the reason to the re-entered loop as its first note, and the third lap stops (R1).
test('back-route: the cycle counter, carry into the loop\'s notes, and max -> $stop', () => {
  const s = start();
  recordStage(s, CATALOG, 'pass', CLEAN);                               // plan -> loop
  loopRec(s, 'pass');                                                   // loop -> review
  assert.deepEqual(recordStage(s, CATALOG, 'fail', { ...CLEAN, carry: 'review: totals still off by one cent' }), { stage: 'loop:bugfix' });
  assert.deepEqual(s.counters, { rework: 1 });
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH).notes, ['review: totals still off by one cent']);
  // the loop's own record replaces the carry: nothing stale reaches the next stage
  loopRec(s, 'pass');
  assert.equal(s.carry, null);
  assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { stage: 'loop:bugfix' });
  assert.deepEqual(s.counters, { rework: 2 });
  loopRec(s, 'pass');
  assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { stopped: 'cycle rework exhausted its max of 2' });
  assert.equal(s.status, 'stopped');
  assert.equal(nextStage(s, CATALOG).reason, 'cycle rework exhausted its max of 2');
});

test('R2: a child loop that stopped records fail and follows its edge', () => {
  const s = start();
  recordStage(s, CATALOG, 'pass', CLEAN);
  assert.deepEqual(loopRec(s, 'fail'), { stopped: 'loop:bugfix reported fail' });
});

test('an undeclared outcome is refused; error with no edge stops', () => {
  const s = start();
  assert.throws(() => recordStage(s, CATALOG, 'more'), /^Error: plan cannot report "more" — one of pass$/);
  const f = fixFactory();
  f.stages[0] = 'probe'; f.start = 'probe'; f.edges[0] = { from: 'probe', on: 'pass', to: 'loop:bugfix' };
  assert.deepEqual(recordStage(start(f), CATALOG, 'error', CLEAN), { stopped: 'probe reported error' });
});

// R3: a LOOP.md in the worktree means the child loop still owns it.
test('R3: next and record refuse while a LOOP.md exists', () => {
  const s = start();
  recordStage(s, CATALOG, 'pass', CLEAN);
  const before = JSON.stringify(s);
  assert.throws(() => nextStage(s, CATALOG, { loopStatus: 'running' }), /a loop is still running in this worktree \(LOOP\.md exists\)/);
  assert.throws(() => recordStage(s, CATALOG, 'pass', { loopStatus: 'running' }), /a loop is still running in this worktree/);
  assert.equal(JSON.stringify(s), before);
});

// J5: a stage outside a loop never changes the worktree. Engine files do not count.
test('J5: a dirty tree after a brick stage is refused, engine files aside', () => {
  const s = start();
  const before = JSON.stringify(s);
  assert.throws(() => recordStage(s, CATALOG, 'pass', { porcelain: ' M src/a.js\n?? notes.txt' }),
    /^Error: plan left the worktree dirty, and a stage outside a loop records only on a clean tree, so a brick that changes files commits them first: {2}M src\/a\.js; \?\? notes\.txt$/);
  assert.equal(JSON.stringify(s), before, 'a refusal changes nothing');
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { porcelain: ' M FACTORY.md\n?? FACTORY.md.tmp\n?? LOOP.md.tmp' }), { stage: 'loop:bugfix' });
  // a loop stage's porcelain is the child loop's business, never checked here
  assert.deepEqual(loopRec(s, 'pass', { porcelain: ' M src/a.js' }), { stage: 'review' });
  // no porcelain at all (a TTY stdin) proves nothing about the tree, so it is refused too
  const t = start();
  const unchanged = JSON.stringify(t);
  assert.throws(() => recordStage(t, CATALOG, 'pass'),
    /^Error: plan is a stage outside a loop: pipe `git status --porcelain --untracked-files=all` into record, so the engine can see the tree is clean$/);
  assert.equal(JSON.stringify(t), unchanged);
});

// R8: 60 transitions per run (per task), whatever the cycles still allow. 60, not 30 (D15): the
// `checks` and `review-panel` stages take a bug-report-to-fix worst case from about 18 to about
// 38 transitions, so 30 would stop a run its own cycles still allow; the 61st stops, not the 31st.
test('R8: the transition ceiling stops the run', () => {
  assert.equal(FACTORY_MAX_TRANSITIONS, 60);
  const s = start();
  s.transitions = 59;
  assert.deepEqual(recordStage(s, CATALOG, 'pass', CLEAN), { stage: 'loop:bugfix' });
  assert.equal(s.transitions, 60);
  assert.deepEqual(loopRec(s, 'pass'), { stopped: 'transition ceiling of 60 reached' });
});

// spec -> loop:feature (two tasks) -> lint; a lint failure sends the item back to the spec
// (cycle redo, max 1). Re-recording the spec restarts at task 1, but the tasks already reached
// get no fresh budget, so the second lint failure spends redo a second time and stops.
const redoFactory = () => ({
  name: 'redo', description: 'd', start: 'spec', stages: ['spec', 'loop:feature', 'lint'],
  edges: [
    { from: 'spec', on: 'pass', to: 'loop:feature' }, { from: 'spec', on: 'fail', to: '$stop' },
    { from: 'loop:feature', on: 'pass', to: 'lint' }, { from: 'loop:feature', on: 'fail', to: '$stop' },
    { from: 'lint', on: 'pass', to: '$close' }, { from: 'lint', on: 'fail', to: 'spec' },
  ],
  cycles: [{ name: 'redo', nodes: ['spec', 'loop:feature', 'lint'], max: 1 }],
});
const SPEC = { porcelain: '?? specs/r/spec.md', specPath: 'specs/r/spec.md', taskCount: 2 };

test('tasks: re-recording the spec gives no fresh budget to a task already reached', () => {
  const s = start(redoFactory());
  let last;
  for (let i = 0; i < 200 && s.status === 'running'; i += 1) {
    if (s.stage === 'spec') { recordStage(s, CATALOG, 'pass', SPEC); last = decideFactory(s, CATALOG, 'ok'); }
    else last = step(s, s.stage === 'lint' ? 'fail' : 'pass');
  }
  assert.deepEqual(last, { stopped: 'cycle redo exhausted its max of 1' });
  assert.deepEqual(s.history.filter((h) => h.stage === 'lint').length, 2);
});

// The run-wide ceiling: FACTORY_MAX_TRANSITIONS per task reached, never reset.
test('R8: the run-wide ceiling holds across tasks, whatever the per-task count says', () => {
  const s = start(redoFactory());
  recordStage(s, CATALOG, 'pass', SPEC); decideFactory(s, CATALOG, 'ok');
  assert.deepEqual(loopRec(s, 'pass'), { stage: 'loop:feature', task: { path: 'specs/r/spec.md', count: 2, index: 2 } });
  assert.equal(s.transitions, 0, 'the per-task count restarts for a task never reached');
  s.runTransitions = 2 * FACTORY_MAX_TRANSITIONS - 1;
  assert.deepEqual(loopRec(s, 'pass'), { stage: 'lint' });
  assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { stopped: 'run-wide transition ceiling of 120 reached (60 per task)' });
});

test('R4: FACTORY.md round-trips with CRLF, and anything else is refused', () => {
  const s = start();
  const text = renderFactoryFile(s);
  assert.match(text, /^# Factory — Rounding\n\nTotals round wrong\n/);
  assert.deepEqual(parseFactoryFile(text), s);
  assert.deepEqual(parseFactoryFile(text.replace(/\n/g, '\r\n')), s);
  assert.throws(() => parseFactoryFile('# nothing'), /^Error: FACTORY\.md has no factory-state block$/);
  assert.throws(() => parseFactoryFile(text.replace('"v": 1', '"v": 1,,')), /^Error: FACTORY\.md is unreadable: /);
  assert.throws(() => parseFactoryFile(text.replace('"v": 1', '"v": 2')), /^Error: FACTORY\.md is unreadable: no state of version 1$/);
});

// spec (gated) -> loop:feature once per spec task -> review.
const specFactory = () => ({
  name: 'build', description: 'd', start: 'spec', stages: ['spec', 'loop:feature', 'review'],
  edges: [
    { from: 'spec', on: 'pass', to: 'loop:feature' }, { from: 'spec', on: 'fail', to: '$stop' },
    { from: 'loop:feature', on: 'pass', to: 'review' }, { from: 'loop:feature', on: 'fail', to: '$stop' },
    { from: 'review', on: 'pass', to: '$close' }, { from: 'review', on: 'fail', to: 'loop:feature' },
  ],
  cycles: [{ name: 'ci', nodes: ['loop:feature', 'review'], max: 1 }],
});

test('tasks: the loop stage replays once per spec task, with fresh budgets per task', () => {
  const s = start(specFactory());
  // the spec file itself is the one dirty path a stage may leave: it is what it records
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { porcelain: '?? specs/r/spec.md', specPath: 'specs/r/spec.md', taskCount: 2 }),
    { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } });
  assert.deepEqual(decideFactory(s, CATALOG, 'ok'), { stage: 'loop:feature' });
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH), { stage: 'loop:feature', loop: 'feature', notes: [], task: { path: 'specs/r/spec.md', count: 2, index: 1 } });
  s.counters = { ci: 1 }; s.transitions = 7;
  assert.deepEqual(recordStage(s, CATALOG, 'pass', MOVED), { stage: 'loop:feature', task: { path: 'specs/r/spec.md', count: 2, index: 2 } });
  assert.deepEqual(s.counters, {}); assert.equal(s.transitions, 0);
  assert.deepEqual(loopRec(s, 'pass'), { stage: 'review' });
  assert.deepEqual(s.history.map((h) => [h.stage, h.outcome ?? h.verdict, h.task]),
    [['spec', 'pass', 1], ['spec', 'ok', 1], ['loop:feature', 'pass', 1], ['loop:feature', 'pass', 2]]);
});

test('tasks: a spec with no task list, or one recorded at a loop stage, is refused', () => {
  const s = start(specFactory());
  assert.throws(() => recordStage(s, CATALOG, 'pass', { ...CLEAN, specPath: 'specs/r/spec.md', taskCount: 0 }),
    /^Error: specs\/r\/spec\.md has no ordered task list under a Tasks heading$/);
  s.stage = 'loop:feature';
  assert.throws(() => recordStage(s, CATALOG, 'pass', { specPath: 'specs/r/spec.md', taskCount: 2 }),
    /^Error: --spec is recorded by a stage outside a loop$/);
});

// G2 + J5: `--spec` names the `spec` brick's own path or nothing. Any other path is refused before
// the porcelain is read and before the state changes: R4 holds `tasks.path` to that shape, so a
// stored `src/a.js` would make every later action refuse FACTORY.md. The exemption then covers
// that one file, never a sibling in its folder.
test('G2 + J5: --spec takes specs/<slug>/spec.md and nothing else, and exempts only that file', () => {
  for (const specPath of ['src/a.js', 'specs/spec.md', 'specs/r/notes.md', 'specs/r/deep/spec.md', 'specs/../spec.md']) {
    const s = start(specFactory());
    const before = JSON.stringify(s);
    assert.throws(() => recordStage(s, CATALOG, 'pass', { porcelain: ` M ${specPath}`, specPath, taskCount: 2 }),
      new RegExp(`^Error: --spec ${specPath.replaceAll('.', '\\.')} is not a spec the engine can keep: record specs/<slug>/spec\\.md, one folder named for the run's slug$`),
      specPath);
    assert.equal(JSON.stringify(s), before, specPath);
  }
  const s = start(specFactory());
  assert.throws(() => recordStage(s, CATALOG, 'pass', { porcelain: '?? specs/r-2/spec.md\n?? specs/r-2/notes.md', specPath: 'specs/r-2/spec.md', taskCount: 2 }),
    /^Error: spec left the worktree dirty, and a stage outside a loop records only on a clean tree, so a brick that changes files commits them first: \?\? specs\/r-2\/notes\.md$/);
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { porcelain: '?? specs/r-2/spec.md', specPath: 'specs/r-2/spec.md', taskCount: 2 }),
    { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } });
  // the state it stores passes R4: the next action can read FACTORY.md back
  validateFactoryState(s, CATALOG);
});

test('countSpecTasks counts the top-level numbered items under the first Tasks heading', () => {
  const spec = [
    '# Spec', '', '1. not a task: no Tasks heading yet', '', '## Ordered tasks', '',
    '1. Parse the input', '   - a detail', '2) Round half-even', '    10. too deep to be a task', '3. Verify end to end', '',
    '### Notes under the tasks', '4. a deeper heading keeps the section open', '', '## Out of scope', '5. not a task',
  ].join('\r\n');
  assert.equal(countSpecTasks(spec), 4);
  assert.equal(countSpecTasks('# Spec\n\n1. no heading names tasks\n'), 0);
});

// A task is a numbered item at the indent of the list's FIRST task; a numbered item indented
// deeper is a sub-item (CommonMark nests `   1.` under `1. `), never a task. A list may start
// indented 1 to 3 spaces. A fenced block (``` or ~~~) is skipped whole: a `# comment` in it is
// no heading, and a numbered line in it is no task.
test('countSpecTasks counts the first task\'s indent only, and skips fenced blocks', () => {
  const rows = [
    ['numbered sub-items under 3 spaces', '## Tasks\n\n1. Parse\n   1. detail\n   2. more\n2. Verify\n', 2],
    ['a list indented 1 space', '## Tasks\n\n 1. Parse\n    1. detail\n 2. Verify\n', 2],
    ['a list indented 3 spaces', '## Tasks\n\n   1) Parse\n      2) detail\n   2) Verify\n   3) Ship\n', 3],
    ['a ``` fence with a # line', '## Tasks\n\n1. a\n```\n# comment\n1. not a task\n```\n2. b\n', 2],
    ['a ~~~ fence, then the list ends', '## Tasks\n\n1. a\n~~~sh\n## not a heading\n~~~\n2. b\n\n## Out of scope\n1. no\n', 2],
    ['a ``` inside a ~~~ fence does not close it', '## Tasks\n\n1. a\n~~~\n```\n# x\n~~~\n2. b\n', 2],
  ];
  for (const [what, spec, n] of rows) assert.equal(countSpecTasks(spec), n, what);
});

test('gates: no stops, amend re-runs the stage with the note as its carry, three times at most', () => {
  const s = start(specFactory());
  recordStage(s, CATALOG, 'pass', CLEAN);
  assert.deepEqual(nextStage(s, CATALOG), { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } });
  assert.throws(() => recordStage(s, CATALOG, 'pass'), /the factory is awaiting, not running/);
  assert.throws(() => decideFactory(s, CATALOG, 'maybe'), /^Error: verdict must be ok, no or amend, not "maybe"$/);
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(decideFactory(s, CATALOG, 'amend', 'name the rounding mode'), { resumed: true });
    assert.equal(s.stage, 'spec');
    assert.equal(nextStage(s, CATALOG).carry, 'name the rounding mode');
    recordStage(s, CATALOG, 'pass', CLEAN);
  }
  assert.deepEqual(decideFactory(s, CATALOG, 'amend', 'again'), { stopped: 'gate amended 3 times at spec' });
  const t = start(specFactory());
  recordStage(t, CATALOG, 'pass', CLEAN);
  assert.deepEqual(decideFactory(t, CATALOG, 'no', 'out of scope'), { stopped: 'gate rejected at spec: out of scope' });
  assert.throws(() => decideFactory(t, CATALOG, 'ok'), /^Error: nothing is awaiting a decision$/);
});

// D11/D13: triage is a fork; each named outcome leads to its own lane (two loops and the `notes`
// brick), all joining at review, whose fail routes back to `$lane` (cycle rework, max 2).
const forkFactory = (judge = 'review') => ({
  name: 'forked', description: 'd', start: 'triage', stages: ['triage', 'loop:bugfix', 'loop:feature', 'notes', judge],
  edges: [
    { from: 'triage', on: 'bug', to: 'loop:bugfix' }, { from: 'triage', on: 'feature', to: 'loop:feature' },
    { from: 'triage', on: 'docs', to: 'notes' }, { from: 'triage', on: 'fail', to: '$stop' },
    { from: 'loop:bugfix', on: 'pass', to: judge }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'loop:feature', on: 'pass', to: judge }, { from: 'loop:feature', on: 'fail', to: '$stop' },
    { from: 'notes', on: 'pass', to: judge },
    { from: judge, on: 'pass', to: '$close' }, { from: judge, on: 'fail', to: '$lane' },
  ],
  cycles: [{ name: 'rework', nodes: ['$lane', judge], max: 2 }],
});

// The fork route: `next` hands the fork its lanes (outcome -> stage), the outcome names the lane,
// and the record stores it as `lane`. A `pass` the fork does not declare is refused, unchanged.
test('fork: next hands out the lanes, and the outcome recorded names the lane taken', () => {
  const s = start(forkFactory());
  assert.deepEqual(nextStage(s, CATALOG).lanes, { bug: 'loop:bugfix', feature: 'loop:feature', docs: 'notes' });
  assert.equal(s.lane, null);
  const before = JSON.stringify(s);
  assert.throws(() => recordStage(s, CATALOG, 'pass', CLEAN), /^Error: triage cannot report "pass" — one of bug, feature, docs, fail$/);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(recordStage(s, CATALOG, 'feature', { ...CLEAN, carry: 'triage.md' }), { stage: 'loop:feature' });
  assert.equal(s.lane, 'loop:feature');
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH), { stage: 'loop:feature', loop: 'feature', notes: ['triage.md'] });
  assert.equal('lanes' in nextStage(start(), CATALOG), false, 'a stage that is no fork gets no lanes');
  // a fork outcome to $stop chooses no lane
  const t = start(forkFactory());
  assert.deepEqual(recordStage(t, CATALOG, 'fail', CLEAN), { stopped: 'triage reported fail' });
  assert.equal(t.lane, null);
});

// The `$lane` route back: a failed review returns to the loop the fork chose, the reason as its
// note, and spends the rework cycle.
test('fork: a route back to $lane re-enters the lane taken and spends its cycle', () => {
  const s = start(forkFactory());
  recordStage(s, CATALOG, 'bug', CLEAN);
  assert.deepEqual(loopRec(s, 'pass'), { stage: 'review' });
  assert.deepEqual(recordStage(s, CATALOG, 'fail', { ...CLEAN, carry: 'still off by one' }), { stage: 'loop:bugfix' });
  assert.deepEqual(s.counters, { rework: 1 });
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH), { stage: 'loop:bugfix', loop: 'bugfix', notes: ['still off by one'] });
});

// Cycle laps through `$lane` on a brick lane: each failed review re-runs `notes` and spends one
// lap; the third failure exhausts rework (max 2), and the run stops.
test('fork: laps through $lane on a brick lane are bounded by the cycle max', () => {
  const s = start(forkFactory());
  assert.deepEqual(recordStage(s, CATALOG, 'docs', CLEAN), { stage: 'notes' });
  const seen = [];
  for (let i = 0; i < 20 && s.status === 'running'; i += 1) {
    seen.push(recordStage(s, CATALOG, s.stage === 'review' ? 'fail' : 'pass', CLEAN));
  }
  assert.deepEqual(seen, [
    { stage: 'review' }, { stage: 'notes' }, { stage: 'review' }, { stage: 'notes' }, { stage: 'review' },
    { stopped: 'cycle rework exhausted its max of 2' },
  ]);
  assert.equal(s.lane, 'notes');
});

// `$lane` with no prior fork (a state `check` cannot produce, reached by hand): refused before the
// state changes, never guessed — both on record and on a gate's ok.
test('fork: a route to $lane with no lane on record is refused, never guessed', () => {
  const s = start(forkFactory()); s.stage = 'review';
  const before = JSON.stringify(s);
  assert.throws(() => recordStage(s, CATALOG, 'fail', CLEAN), /^Error: review routes to \$lane, but no fork has chosen a lane in this run$/);
  assert.equal(JSON.stringify(s), before);
  const g = start(forkFactory('judge')); g.stage = 'judge';
  assert.throws(() => recordStage(g, CATALOG, 'fail', CLEAN), /^Error: judge routes to \$lane, but no fork has chosen a lane in this run$/);
  g.status = 'awaiting'; g.awaiting = { kind: 'gate', stage: 'judge', outcome: 'fail' };
  const held = JSON.stringify(g);
  assert.throws(() => decideFactory(g, CATALOG, 'ok'), /^Error: judge routes to \$lane, but no fork has chosen a lane in this run$/);
  assert.equal(JSON.stringify(g), held);
});

// A gate's ok on an edge to `$lane` follows the lane taken, and spends the cycle like a record.
test('fork: a gate\'s ok on a $lane edge re-enters the lane taken', () => {
  const s = start(forkFactory('judge'));
  recordStage(s, CATALOG, 'docs', CLEAN); recordStage(s, CATALOG, 'pass', CLEAN);
  assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { awaiting: { kind: 'gate', stage: 'judge', outcome: 'fail' } });
  assert.deepEqual(decideFactory(s, CATALOG, 'ok'), { stage: 'notes' });
  assert.deepEqual(s.counters, { rework: 1 });
});

// Termination by construction: the task count is frozen once the first loop launches, capped at
// FACTORY_MAX_TASKS, and the run-wide ceiling is computed from it then.
test('tasks: a re-recorded spec may not grow, so laps that grow the spec still stop', () => {
  const s = start(redoFactory());
  let count = 2; let refused = 0;
  for (let i = 0; i < 200 && s.status === 'running'; i += 1) {
    if (s.stage === 'spec') {
      try { recordStage(s, CATALOG, 'pass', { ...SPEC, taskCount: count }); } catch (e) {
        assert.equal(e.message, `specs/r/spec.md lists ${count} tasks, more than the 2 frozen when the first loop launched`);
        refused += 1;
        recordStage(s, CATALOG, 'pass', { ...SPEC, taskCount: 2 });
      }
      decideFactory(s, CATALOG, 'ok'); count += 1;
    } else step(s, s.stage === 'lint' ? 'fail' : 'pass');
  }
  assert.equal(s.status, 'stopped');
  assert.equal(refused, 1);
});

test('tasks: more than FACTORY_MAX_TASKS tasks are refused', () => {
  assert.equal(engine.FACTORY_MAX_TASKS, 20);
  const s = start(redoFactory());
  const before = JSON.stringify(s);
  assert.throws(() => recordStage(s, CATALOG, 'pass', { ...SPEC, taskCount: 21 }),
    /^Error: specs\/r\/spec\.md lists 21 tasks; a factory runs 20 at most — split the requirement$/);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { ...SPEC, taskCount: 20 }), { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } });
});

// R8: once a loop has run, the ceiling is fixed; a smaller re-record (lint sends the work back
// to the spec) lowers the task list but keeps the ceiling.
test('R8: the run-wide ceiling is fixed once a loop launched, and a smaller re-record keeps it', () => {
  const s = start(redoFactory());
  assert.equal(s.runCeiling, FACTORY_MAX_TRANSITIONS);
  recordStage(s, CATALOG, 'pass', SPEC); decideFactory(s, CATALOG, 'ok');
  assert.equal(s.runCeiling, 2 * FACTORY_MAX_TRANSITIONS);
  loopRec(s, 'pass'); loopRec(s, 'pass');
  assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { stage: 'spec' });
  recordStage(s, CATALOG, 'pass', { ...SPEC, taskCount: 1 }); decideFactory(s, CATALOG, 'ok');
  assert.equal(s.runCeiling, 2 * FACTORY_MAX_TRANSITIONS);
  assert.equal(s.taskCount, 2);
  assert.deepEqual(s.tasks, { path: 'specs/r/spec.md', count: 1, index: 1, stage: null });
});

// G3: the spec's gate comes after its record, so an amend there may make the re-run spec list
// more tasks. Until the first loop launches, a --spec record sets the count and the ceiling again
// (up or down); the amend cap of 3 bounds that window. Once a loop has launched, a larger count
// is refused — `launched` alone already freezes it, before the loop records anything.
test('G3: an amended spec may grow until the first loop launches, then the count is frozen', () => {
  const s = start(redoFactory());
  assert.deepEqual(recordStage(s, CATALOG, 'pass', SPEC), { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } });
  assert.deepEqual(decideFactory(s, CATALOG, 'amend', 'split task 2'), { resumed: true });
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { ...SPEC, taskCount: 3 }), { awaiting: { kind: 'gate', stage: 'spec', outcome: 'pass' } });
  assert.deepEqual([s.taskCount, s.runCeiling, s.tasks.count], [3, 3 * FACTORY_MAX_TRANSITIONS, 3]);
  decideFactory(s, CATALOG, 'amend', 'drop task 3');
  recordStage(s, CATALOG, 'pass', { ...SPEC, taskCount: 1 });
  assert.deepEqual([s.taskCount, s.runCeiling, s.tasks.count], [1, FACTORY_MAX_TRANSITIONS, 1]);
  decideFactory(s, CATALOG, 'amend', 'put task 2 back');
  recordStage(s, CATALOG, 'pass', SPEC);
  assert.deepEqual([s.taskCount, s.runCeiling], [2, 2 * FACTORY_MAX_TRANSITIONS]);
  assert.deepEqual(decideFactory(s, CATALOG, 'amend', 'a fourth amend'), { stopped: 'gate amended 3 times at spec' });
  // frozen by the launch alone: the stage is the loop's, so a spec record is a hand-edit away
  const t = start(redoFactory());
  recordStage(t, CATALOG, 'pass', SPEC); decideFactory(t, CATALOG, 'ok');
  nextStage(t, CATALOG, LAUNCH);
  t.stage = 'spec';
  const before = JSON.stringify(t);
  assert.throws(() => recordStage(t, CATALOG, 'pass', { ...SPEC, taskCount: 3 }),
    /^Error: specs\/r\/spec\.md lists 3 tasks, more than the 2 frozen when the first loop launched$/);
  assert.equal(JSON.stringify(t), before);
});

// R2: when the child loop's LOOP.md is still there, its status decides what the stage may report.
test('R2: a loop stage reports what its LOOP.md says — stopped is fail, done is pass', () => {
  const s = start();
  recordStage(s, CATALOG, 'pass', CLEAN);
  nextStage(s, CATALOG, { head: H0 });
  const before = JSON.stringify(s);
  const bugfix = { loopTemplate: 'bugfix', head: H0 };
  assert.throws(() => recordStage(s, CATALOG, 'pass', { ...bugfix, loopStatus: 'stopped' }),
    /^Error: loop:bugfix cannot report pass: its LOOP\.md says the loop stopped — report fail$/);
  assert.throws(() => recordStage(s, CATALOG, 'fail', { ...bugfix, loopStatus: 'done' }),
    /^Error: loop:bugfix cannot report fail: its LOOP\.md says the loop is done — report pass$/);
  // a stale LOOP.md from another template is not this stage's loop, whatever it says
  assert.throws(() => recordStage(s, CATALOG, 'pass', { loopStatus: 'done', loopTemplate: 'feature', head: H1 }),
    /^Error: the LOOP\.md at the worktree root ran feature, not bugfix: it is not loop:bugfix's loop$/);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { ...bugfix, loopStatus: 'done' }), { stage: 'review' });
  assert.equal(s.launched, null, 'a record spends the launch');
});

// R2 with no LOOP.md left (F3): only a HEAD that moved since `next` — the loop's close commit, or
// the commit removing a stopped loop's LOOP.md — lets a loop stage record, pass or fail.
test('R2: with no LOOP.md, a loop stage records only after HEAD moved past its launch', () => {
  const s = start();
  recordStage(s, CATALOG, 'pass', CLEAN);
  const unlaunched = JSON.stringify(s);
  assert.throws(() => recordStage(s, CATALOG, 'pass', MOVED),
    /^Error: loop:bugfix was never launched: run `geneseed factory next` before its loop, then record$/);
  assert.equal(JSON.stringify(s), unlaunched);
  nextStage(s, CATALOG, { head: H0 });
  assert.deepEqual(s.launched, { stage: 'loop:bugfix', template: 'bugfix', head: H0, at: null });
  nextStage(s, CATALOG, { head: H1 });
  assert.equal(s.launched.head, H0, 'a second next keeps the baseline');
  const launched = JSON.stringify(s);
  for (const [outcome, head] of [['pass', H0], ['fail', H0], ['pass', null]]) {
    assert.throws(() => recordStage(s, CATALOG, outcome, { head }), {
      message: `loop:bugfix cannot report ${outcome}: no LOOP.md is left and HEAD has not moved since \`factory next\` — `
        + 'record after the loop\'s close commit, or after the commit that removes a stopped loop\'s LOOP.md',
    }, `${outcome} at ${head}`);
  }
  assert.equal(JSON.stringify(s), launched);
  assert.deepEqual(recordStage(s, CATALOG, 'fail', { head: H1 }), { stopped: 'loop:bugfix reported fail' });
});

// R2, pass with no LOOP.md left: a HEAD move is enough for fail only. Pass also needs the loop
// registry's `initAt` for this worktree strictly after the launch time — a loop init ran here
// since `next`. No registry row, one from before the launch, the same instant, or a launch with no
// time (an old FACTORY.md) cannot tell, so pass is refused and fail still goes through.
test('R2: with no LOOP.md, pass needs a loop init after the launch; fail needs only the HEAD move', () => {
  const refusal = 'loop:bugfix cannot report pass on a HEAD move alone: no LOOP.md is left, and the loop registry '
    + 'records no `geneseed loop init` in this worktree since `factory next` — report fail, or record pass '
    + 'while the done LOOP.md is still at the root';
  for (const [launch, loopInitAt] of [[LAUNCH, null], [LAUNCH, '2026-11-08T09:59:59.000Z'], [LAUNCH, T0], [{}, T1], [LAUNCH, 'soon']]) {
    const s = start();
    recordStage(s, CATALOG, 'pass', CLEAN);
    nextStage(s, CATALOG, { head: H0, ...launch });
    const before = JSON.stringify(s);
    assert.throws(() => recordStage(s, CATALOG, 'pass', { head: H1, loopInitAt }), { message: refusal }, String(loopInitAt));
    assert.equal(JSON.stringify(s), before);
    assert.deepEqual(recordStage(s, CATALOG, 'fail', { head: H1, loopInitAt }), { stopped: 'loop:bugfix reported fail' });
  }
  const s = start();
  recordStage(s, CATALOG, 'pass', CLEAN);
  nextStage(s, CATALOG, { head: H0, now: T0 });
  assert.equal(s.launched.at, T0);
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { head: H1, loopInitAt: T1 }), { stage: 'review' });
});

// R3 before a new loop: any LOOP.md left at the root (a stopped loop leaves one) blocks `next` on
// a loop stage, and the error names the removal; a brick stage may still run beside it.
test('R3: next on a loop stage refuses any LOOP.md and names its removal', () => {
  const s = start();
  assert.equal(nextStage(s, CATALOG, { loopStatus: 'stopped' }).stage, 'plan');
  recordStage(s, CATALOG, 'pass', CLEAN);
  for (const loopStatus of ['stopped', 'done']) {
    assert.throws(() => nextStage(s, CATALOG, { loopStatus }), { message: 'the previous loop left its LOOP.md at the worktree root: '
      + 'run `git rm -f LOOP.md` and commit that removal before `geneseed loop init` starts loop:bugfix' }, loopStatus);
  }
});

// D9: only the loop stage that owns the tasks (the first loop stage recorded after the spec)
// replays per task; a fix loop that runs in between follows its own edge.
test('tasks: only the owning loop stage replays per task', () => {
  const f = {
    name: 'own', description: 'd', start: 'spec', stages: ['spec', 'loop:feature', 'loop:bugfix'],
    edges: [
      { from: 'spec', on: 'pass', to: 'loop:feature' }, { from: 'spec', on: 'fail', to: '$stop' },
      { from: 'loop:feature', on: 'pass', to: '$close' }, { from: 'loop:feature', on: 'fail', to: 'loop:bugfix' },
      { from: 'loop:bugfix', on: 'pass', to: 'loop:feature' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    ],
    cycles: [{ name: 'fix', nodes: ['loop:feature', 'loop:bugfix'], max: 1 }],
  };
  const s = start(f);
  recordStage(s, CATALOG, 'pass', SPEC); decideFactory(s, CATALOG, 'ok');
  assert.deepEqual(loopRec(s, 'fail'), { stage: 'loop:bugfix' });
  assert.equal(s.tasks.stage, 'loop:feature');
  assert.equal(nextStage(s, CATALOG, LAUNCH).task, undefined, 'the fix loop is handed no task');
  assert.deepEqual(recordStage(s, CATALOG, 'pass', MOVED), { stage: 'loop:feature' });
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH).task, { path: 'specs/r/spec.md', count: 2, index: 1 });
  assert.deepEqual(recordStage(s, CATALOG, 'pass', MOVED), { stage: 'loop:feature', task: { path: 'specs/r/spec.md', count: 2, index: 2 } });
});

// J7: a route back into the owner after its last task is ONE EXTRA TASK. `next` hands the last
// task's index with `extra` naming the stage that sent it back, and the carry as its note; it is
// no task never reached, so the lap spends cycle ci and the transition counts and resets neither,
// and the next red review exhausts ci (max 1). A replay (task 1 -> 2) is never marked extra.
test('J7: a route back after the last task is one extra task, bounded by its cycle', () => {
  const s = start(specFactory());
  recordStage(s, CATALOG, 'pass', SPEC); decideFactory(s, CATALOG, 'ok');
  loopRec(s, 'pass');
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH).task, { path: 'specs/r/spec.md', count: 2, index: 2 }, 'a replay is a task');
  assert.deepEqual(recordStage(s, CATALOG, 'pass', MOVED), { stage: 'review' });
  assert.deepEqual(recordStage(s, CATALOG, 'fail', { ...CLEAN, carry: 'ci.md' }), { stage: 'loop:feature' });
  const transitions = s.transitions;
  assert.deepEqual(nextStage(s, CATALOG, LAUNCH), {
    stage: 'loop:feature', loop: 'feature', notes: ['ci.md'],
    task: { path: 'specs/r/spec.md', count: 2, index: 2, extra: 'review reported fail' },
  });
  assert.deepEqual(recordStage(s, CATALOG, 'pass', MOVED), { stage: 'review' });
  assert.deepEqual(s.counters, { ci: 1 }); assert.equal(s.transitions, transitions + 1);
  assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { stopped: 'cycle ci exhausted its max of 1' });
});

// J5 after the spec record (F2): the spec on record stays exempt for every later stage outside a
// loop (the Rite commits it before the first loop, but the engine never relies on that) — that
// path only, never another one.
test('J5: the spec on record stays exempt for every later stage outside a loop', () => {
  const s = start(specFactory());
  recordStage(s, CATALOG, 'pass', SPEC); decideFactory(s, CATALOG, 'ok');
  loopRec(s, 'pass'); loopRec(s, 'pass');
  assert.equal(s.stage, 'review');
  assert.throws(() => recordStage(s, CATALOG, 'pass', { porcelain: '?? specs/r/spec.md\n?? specs/q/spec.md' }),
    /^Error: review left the worktree dirty, and a stage outside a loop records only on a clean tree, so a brick that changes files commits them first: \?\? specs\/q\/spec\.md$/);
  assert.deepEqual(recordStage(s, CATALOG, 'pass', { porcelain: '?? specs/r/spec.md' }), { done: true });
});

// F1: plain `git status --porcelain` folds a new directory into one line, which no exemption can
// match; the refusal names the form that lists each file.
test('J5: a folded untracked directory is refused with the porcelain form that unfolds it', () => {
  const s = start(specFactory());
  assert.throws(() => recordStage(s, CATALOG, 'pass', { ...SPEC, porcelain: '?? specs/' }), {
    message: 'spec left the worktree dirty, and a stage outside a loop records only on a clean tree, so a brick that changes files commits them first: ?? specs/ — a path ending '
      + 'in / is a whole untracked directory: pipe `git status --porcelain --untracked-files=all`, which lists each file',
  });
});

// R4 past the JSON (F4): a FACTORY.md edited by hand into a state the engine could never write —
// a counter that is not a non-negative integer, a ceiling past 30 x 20, a gate amend count past 3,
// a chosen loop outside `loops`, an unknown status, a `history` or `cycles` that is not a list, a
// broken factory — is unreadable, like a torn one, and never throws anything else.
test('R4: validateFactoryState refuses a state the engine could not have written', () => {
  const valid = () => { const s = start(); recordStage(s, CATALOG, 'pass', CLEAN); nextStage(s, CATALOG, { head: H0 }); return s; };
  validateFactoryState(valid(), CATALOG);
  const rows = [
    [(s) => { s.runTransitions = -1; }, 'runTransitions must be a non-negative integer'],
    [(s) => { s.transitions = 1.5; }, 'transitions must be a non-negative integer'],
    [(s) => { s.runCeiling = '30'; }, 'runCeiling must be a non-negative integer'],
    [(s) => { s.runCeiling = 1201; }, 'runCeiling must be 1200 at most'],
    [(s) => { s.taskHigh = null; }, 'taskHigh must be a non-negative integer'],
    [(s) => { s.counters = { rework: -1 }; }, 'counters must map each cycle to a non-negative integer'],
    [(s) => { s.counters = [1]; }, 'counters must map each cycle to a non-negative integer'],
    [(s) => { s.taskCount = 21; }, 'taskCount must be null or an integer from 1 to 20'],
    [(s) => { s.taskCount = 2; s.tasks = { path: 'specs/r/spec.md', count: 9, index: 1, stage: null }; },
      'tasks must be null or a spec path with 1 <= index <= count <= taskCount'],
    [(s) => { s.launched = { stage: 'loop:bugfix', template: 'bugfix', head: 7 }; }, 'launched must be null or a stage, a template, a head and a time'],
    [(s) => { s.launched.at = 5; }, 'launched must be null or a stage, a template, a head and a time'],
    [(s) => { s.gateAmends = { 'spec@0': 4 }; }, 'gateAmends must map each gate to an integer from 0 to 3'],
    [(s) => { s.gateAmends = { 'spec@0': -1 }; }, 'gateAmends must map each gate to an integer from 0 to 3'],
    [(s) => { s.gateAmends = []; }, 'gateAmends must map each gate to an integer from 0 to 3'],
    [(s) => { s.lane = 'loop:bugfix'; }, 'lane must be null or a stage a fork of the factory leads to'],
    [(s) => { s.status = 'paused'; }, 'status must be one of running, awaiting, done, stopped'],
    [(s) => { s.history = {}; }, 'history must be a list'],
    [(s) => { s.factory.cycles = {}; }, 'factory.cycles must be a list'],
    [(s) => { s.factory.edges.push(null); }, 'its factory no longer passes factory check: edges: entry 6 must have a string from, on and to'],
    [(s) => { s.factory = null; }, 'its factory no longer passes factory check: factory: must be an object'],
  ];
  for (const [edit, why] of rows) {
    const s = valid(); edit(s);
    assert.throws(() => validateFactoryState(s, CATALOG), { message: `FACTORY.md is unreadable: ${why}` }, why);
  }
  // what the engine does write stays readable: no `cycles` key at all, a lane on record, and a
  // state written before lanes existed (no `lane` key)
  const s = valid(); delete s.factory.cycles; s.factory.edges = s.factory.edges.filter((e) => !(e.from === 'review' && e.on === 'fail'));
  s.factory.edges.push({ from: 'review', on: 'fail', to: '$stop' });
  validateFactoryState(s, CATALOG);
  const t = start(forkFactory());
  recordStage(t, CATALOG, 'feature', CLEAN);
  validateFactoryState(t, CATALOG);
  t.lane = 'review';
  assert.throws(() => validateFactoryState(t, CATALOG), { message: 'FACTORY.md is unreadable: lane must be null or a stage a fork of the factory leads to' });
  const old = valid(); delete old.lane;
  validateFactoryState(old, CATALOG);
});

// R4 against the gate cap: the fourth amend stops the run without storing a count of 4, so the
// stopped FACTORY.md stays readable and `next` reports the stop instead of refusing the file.
test('R4: a run stopped by the amend cap stays readable', () => {
  const s = start(specFactory());
  recordStage(s, CATALOG, 'pass', CLEAN);
  for (let i = 0; i < 3; i += 1) { decideFactory(s, CATALOG, 'amend', 'again'); recordStage(s, CATALOG, 'pass', CLEAN); }
  assert.deepEqual(decideFactory(s, CATALOG, 'amend', 'again'), { stopped: 'gate amended 3 times at spec' });
  assert.deepEqual(s.gateAmends, { 'spec@0': 3 });
  validateFactoryState(s, CATALOG);
  assert.equal(nextStage(s, CATALOG).terminal, '$stop');
});

// The shipped factories' new tail, in small: intake (gated on needs-info) -> loop:bugfix -> checks
// -> review-panel -> $close. `checks` holds on error (a locked path changed) and none (no done
// list on the base, whose `ok` re-runs it through the `done-list` cycle); a failed check or
// review sends the work back to the loop, each through its own cycle, twice at most.
const reviewFactory = () => ({
  name: 'reviewed', description: 'd', start: 'intake', stages: ['intake', 'loop:bugfix', 'checks', 'review-panel'],
  protected: ['infra/'],
  edges: [
    { from: 'intake', on: 'pass', to: 'loop:bugfix' }, { from: 'intake', on: 'fail', to: '$stop' },
    { from: 'intake', on: 'needs-info', to: 'loop:bugfix' },
    { from: 'loop:bugfix', on: 'pass', to: 'checks' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'checks', on: 'pass', to: 'review-panel' }, { from: 'checks', on: 'fail', to: 'loop:bugfix' },
    { from: 'checks', on: 'error', to: 'review-panel' }, { from: 'checks', on: 'none', to: 'checks' },
    { from: 'review-panel', on: 'pass', to: '$close' }, { from: 'review-panel', on: 'fail', to: 'loop:bugfix' },
  ],
  cycles: [
    { name: 'done-list', nodes: ['checks'], max: 1 },
    { name: 'checks', nodes: ['loop:bugfix', 'checks'], max: 2 },
    { name: 'review', nodes: ['loop:bugfix', 'checks', 'review-panel'], max: 2 },
  ],
});

// D3 + J5: needs-info holds the gate. amend re-runs intake with the user's answers as its carry,
// three times at most (the engine's cap), the 4th stops; ok follows needs-info's own edge, which
// goes where pass goes. needs-info is no lane: nothing records one, and intake gets no `lanes`.
test('D3: intake needs-info holds, amend re-runs it with the answers, ok goes on, the 4th amend stops', () => {
  const s = start(reviewFactory());
  assert.equal('lanes' in nextStage(s, CATALOG), false);
  assert.deepEqual(recordStage(s, CATALOG, 'needs-info', { ...CLEAN, carry: 'questions.md' }),
    { awaiting: { kind: 'gate', stage: 'intake', outcome: 'needs-info', note: 'questions.md' } });
  assert.equal(s.lane, null);
  assert.deepEqual(decideFactory(s, CATALOG, 'amend', '1. half-even'), { resumed: true });
  assert.equal(nextStage(s, CATALOG).carry, '1. half-even');
  recordStage(s, CATALOG, 'needs-info', CLEAN);
  assert.deepEqual(decideFactory(s, CATALOG, 'ok'), { stage: 'loop:bugfix' });
  assert.equal(s.lane, null);
  const t = start(reviewFactory());
  for (let i = 0; i < 3; i += 1) {
    recordStage(t, CATALOG, 'needs-info', CLEAN);
    assert.deepEqual(decideFactory(t, CATALOG, 'amend', 'more answers'), { resumed: true });
  }
  recordStage(t, CATALOG, 'needs-info', CLEAN);
  assert.deepEqual(decideFactory(t, CATALOG, 'amend', 'more answers'), { stopped: 'gate amended 3 times at intake' });
});

// D2 + D6: a failed check spends `checks`, a failed review spends `review` (the smallest cycle
// that holds the source), and the third lap of either stops the run.
test('D2: a checks fail spends checks, a review-panel fail spends review, the 3rd lap stops', () => {
  const s = start(reviewFactory());
  recordStage(s, CATALOG, 'pass', CLEAN);
  for (const n of [1, 2]) {
    loopRec(s, 'pass');
    assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { stage: 'loop:bugfix' });
    assert.deepEqual(s.counters, { checks: n });
  }
  loopRec(s, 'pass');
  assert.deepEqual(recordStage(s, CATALOG, 'fail', CLEAN), { stopped: 'cycle checks exhausted its max of 2' });
  const r = start(reviewFactory());
  recordStage(r, CATALOG, 'pass', CLEAN);
  for (const n of [1, 2]) {
    loopRec(r, 'pass');
    assert.deepEqual(recordStage(r, CATALOG, 'pass', CLEAN), { stage: 'review-panel' });
    assert.deepEqual(recordStage(r, CATALOG, 'fail', CLEAN), { stage: 'loop:bugfix' });
    assert.deepEqual(r.counters, { review: n });
  }
  loopRec(r, 'pass'); recordStage(r, CATALOG, 'pass', CLEAN);
  assert.deepEqual(recordStage(r, CATALOG, 'fail', CLEAN), { stopped: 'cycle review exhausted its max of 2' });
});

// D16: a locked-path change holds rather than stops; ok goes on to the review, no stops. D13: no
// done list on the base holds too, ok re-runs checks once (`done-list`, max 1), a second ok stops.
// Every brick stage gets the factory's `protected` paths, as it gets its `rules`.
test('D16 + D13: checks error and none hold the gate; ok continues or re-runs checks once', () => {
  const s = start(reviewFactory());
  recordStage(s, CATALOG, 'pass', CLEAN); loopRec(s, 'pass');
  assert.deepEqual(nextStage(s, CATALOG).protected, ['infra/']);
  assert.deepEqual(recordStage(s, CATALOG, 'error', { ...CLEAN, carry: 'locked.md' }),
    { awaiting: { kind: 'gate', stage: 'checks', outcome: 'error', note: 'locked.md' } });
  assert.deepEqual(decideFactory(s, CATALOG, 'ok'), { stage: 'review-panel' });
  const n = start(reviewFactory());
  recordStage(n, CATALOG, 'pass', CLEAN); loopRec(n, 'pass');
  assert.deepEqual(recordStage(n, CATALOG, 'none', CLEAN), { awaiting: { kind: 'gate', stage: 'checks', outcome: 'none' } });
  assert.deepEqual(decideFactory(n, CATALOG, 'ok'), { stage: 'checks' });
  assert.deepEqual(n.counters, { 'done-list': 1 });
  recordStage(n, CATALOG, 'none', CLEAN);
  assert.deepEqual(decideFactory(n, CATALOG, 'ok'), { stopped: 'cycle done-list exhausted its max of 1' });
  const x = start(reviewFactory());
  recordStage(x, CATALOG, 'pass', CLEAN); loopRec(x, 'pass'); recordStage(x, CATALOG, 'error', CLEAN);
  assert.deepEqual(decideFactory(x, CATALOG, 'no'), { stopped: 'gate rejected at checks' });
});

// F1, backward compatibility: `bug-report-to-fix` as it shipped before intake could ask (5.0.4),
// written out here. It has no needs-info edge. Against today's shipped catalogue, where intake
// declares needs-info, it must (1) still pass check, (2) still validate when a FACTORY.md embeds
// it, and (3) on needs-info, hold, and on ok go where intake's pass goes: holdout-write.
const OLD_BUG_REPORT_TO_FIX = {
  name: 'bug-report-to-fix', description: 'd', category: 'development',
  rules: ['Never merge, and never enable auto-merge: the run ends at an open PR with green CI.', "Push only this worktree's own branch."],
  stages: ['intake', 'holdout-write', 'loop:bugfix', 'holdout', 'pr-open', 'merge-gate', 'retro'],
  start: 'intake',
  edges: [
    { from: 'intake', on: 'pass', to: 'holdout-write' }, { from: 'intake', on: 'fail', to: '$stop' },
    { from: 'holdout-write', on: 'pass', to: 'loop:bugfix' }, { from: 'holdout-write', on: 'fail', to: '$stop' },
    { from: 'loop:bugfix', on: 'pass', to: 'holdout' }, { from: 'loop:bugfix', on: 'fail', to: '$stop' },
    { from: 'holdout', on: 'pass', to: 'pr-open' }, { from: 'holdout', on: 'fail', to: 'loop:bugfix' },
    { from: 'holdout', on: 'error', to: '$stop' },
    { from: 'pr-open', on: 'pass', to: 'merge-gate' }, { from: 'pr-open', on: 'fail', to: '$stop' },
    { from: 'merge-gate', on: 'pass', to: 'retro' }, { from: 'merge-gate', on: 'fail', to: 'loop:bugfix' },
    { from: 'merge-gate', on: 'none', to: 'retro' }, { from: 'retro', on: 'pass', to: '$close' },
  ],
  cycles: [
    { name: 'holdout', nodes: ['loop:bugfix', 'holdout'], max: 2 },
    { name: 'ci', nodes: ['loop:bugfix', 'holdout', 'pr-open', 'merge-gate'], max: 2 },
  ],
};

test('F1: a factory with no needs-info edge still checks, validates, and goes on along pass', () => {
  const shipped = loadCatalog({ projectRoot: null, globalLevel: false });
  assert.deepEqual(shipped.bricks.get('intake').outcomes, ['pass', 'fail', 'needs-info']);
  assert.deepEqual(checkFactory(OLD_BUG_REPORT_TO_FIX, shipped), []);
  const s = initFactory({ title: 'T', requirement: 'R', factory: structuredClone(OLD_BUG_REPORT_TO_FIX), input: null });
  validateFactoryState(parseFactoryFile(renderFactoryFile(s)), shipped);
  assert.deepEqual(recordStage(s, shipped, 'needs-info', { ...CLEAN, carry: 'questions.md' }),
    { awaiting: { kind: 'gate', stage: 'intake', outcome: 'needs-info', note: 'questions.md' } });
  validateFactoryState(parseFactoryFile(renderFactoryFile(s)), shipped);
  assert.deepEqual(decideFactory(s, shipped, 'ok'), { stage: 'holdout-write' });
  assert.deepEqual(s.counters, {});
});
