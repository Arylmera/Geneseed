// tests/unit/loop_state.test.mjs
// Scenarios, each a script of engine calls with the expected result written after every call.
// The trailer block is written out byte for byte: it is what lands in a user's git history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initState, nextStep, scoreDeclared, scoreDiff, recordOutcome, decideAwaiting,
  renderLoopFile, parseLoopFile, trailers,
} from '../../js/loop/state.mjs';

const brick = (name, effect, outcomes) => [name, { name, effect, outcomes, agent: 'tester', skill: null, body: `do ${name}`, available: true }];
const BRICKS = new Map([
  brick('reproduce', 'mutate', ['pass', 'fail']), brick('identify', 'read', ['more', 'done']),
  brick('apply', 'mutate', ['pass']), brick('test', 'read', ['pass', 'fail']), brick('review', 'read', ['pass', 'fail']),
]);
const bugfix = () => ({
  name: 'bugfix', description: 'd', nodes: ['reproduce', 'identify', 'apply', 'test', 'review'], start: 'reproduce',
  edges: [
    { from: 'reproduce', on: 'pass', to: 'identify' }, { from: 'reproduce', on: 'fail', to: '$stop' },
    { from: 'identify', on: 'more', to: 'apply' }, { from: 'identify', on: 'done', to: '$close' },
    { from: 'apply', on: 'pass', to: 'test' }, { from: 'test', on: 'fail', to: 'apply' },
    { from: 'test', on: 'pass', to: 'review' }, { from: 'review', on: 'pass', to: 'identify' },
    { from: 'review', on: 'fail', to: 'apply' },
  ],
  loops: [
    { name: 'iterations', nodes: ['identify', 'apply', 'test', 'review'], max: 20, iteration: true },
    { name: 'apply-test', nodes: ['apply', 'test'], max: 5 },
    { name: 'review-fix', nodes: ['apply', 'test', 'review'], max: 3 },
  ],
});
const start = (preset = 'balanced') => initState({ title: 't', requirement: 'r', graph: bugfix(), preset });
const card = { intent: 'fix rounding', writeSet: ['src/a.js'], actions: ['logic'] };
const file = (f, deleted = 0) => ({ file: f, added: 3, deleted });

test('happy path: setup unit 0, then iteration 1, then done', () => {
  const s = start();
  assert.equal(s.iteration, 0);
  let n = nextStep(s, BRICKS);
  assert.equal(n.node, 'reproduce'); assert.equal(n.validate, true); assert.equal(n.prompt, 'do reproduce');
  assert.deepEqual(scoreDeclared(s, { actions: ['new-file'], writeSet: ['test/a.test.js'], intent: 'reproduce' }),
    { score: 0.4, preset: 'balanced', threshold: [0.2, 0.6], decision: 'soft' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: '?? test/a.test.js' }), { verify: true });
  n = nextStep(s, BRICKS);
  assert.deepEqual(n, { verify: true, iteration: 0, run: 'git add -A && git diff --cached --numstat | geneseed loop score --diff' });
  const c = scoreDiff(s, [file('test/a.test.js')]);
  assert.equal(c.commit, true);
  assert.equal(c.trailers, [
    'Loop-Iteration: 0', 'Loop-Bricks: reproduce', 'Loop-Risk-Declared: 0.4', 'Loop-Risk-Actual: 0.4',
    'Loop-Threshold: balanced 0.2/0.6', 'Loop-Decision: soft', 'Loop-Tests: n/a',
  ].join('\n'));
  assert.equal(s.iteration, 1); assert.equal(s.node, 'identify');

  assert.deepEqual(recordOutcome(s, BRICKS, 'more', { card, porcelain: '' }), { node: 'apply' });
  assert.equal(nextStep(s, BRICKS).validate, true);
  assert.equal(scoreDeclared(s).decision, 'soft');
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: ' M src/a.js' }), { node: 'test' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: ' M src/a.js' }), { node: 'review' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass', { porcelain: ' M src/a.js' }), { verify: true });
  const c2 = scoreDiff(s, [file('src/a.js')]);
  assert.match(c2.trailers, /^Loop-Iteration: 1\nLoop-Bricks: identify,apply,test,review\n/);
  assert.match(c2.trailers, /Loop-Tests: pass$/);
  assert.deepEqual(recordOutcome(s, BRICKS, 'done', { porcelain: '' }), { done: true });
  const t = nextStep(s, BRICKS);
  assert.equal(t.terminal, '$close');
  assert.deepEqual(t.summary.review, [{ iteration: 0, intent: 'reproduce' }, { iteration: 1, intent: 'fix rounding' }]);
});

test('a mutate node cannot be recorded before its declared score', () => {
  const s = start();
  assert.throws(() => recordOutcome(s, BRICKS, 'pass'), /reproduce modifies code: run `geneseed loop score --declared`/);
});

test('blocking before apply waits, and ok resumes', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card: { ...card, actions: ['api'] } });
  assert.equal(scoreDeclared(s).decision, 'blocking');
  assert.equal(s.status, 'awaiting');
  assert.deepEqual(nextStep(s, BRICKS).awaiting.kind, 'declared');
  assert.deepEqual(decideAwaiting(s, BRICKS, 'ok'), { resumed: true });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'test' });
});

test('declared "no" drops the iteration back to identify with a note', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card: { ...card, actions: ['architecture'] } });
  scoreDeclared(s);
  assert.deepEqual(decideAwaiting(s, BRICKS, 'no', 'too broad'), { dropped: true });
  assert.equal(s.node, 'identify'); assert.equal(s.card, null);
  assert.deepEqual(s.notes, ['iteration 1 (declared, no): too broad']);
});

test('the diff escalates to blocking; ok commits with the actual score', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card });
  scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  assert.deepEqual(scoreDiff(s, [file('src/a.js'), file('src/b.js')]),
    { score: 0.8, decision: 'blocking', reasons: ['outside the write set: src/b.js'], commit: false });
  const c = decideAwaiting(s, BRICKS, 'ok');
  assert.equal(c.commit, true);
  assert.match(c.trailers, /Loop-Risk-Declared: 0\.4\nLoop-Risk-Actual: 0\.8\n.*\nLoop-Decision: blocking/s);
});

test('inner ring: 5 retries allowed, the 6th re-splits once, the next exhaustion stops', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  const drive = () => {
    recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
    recordOutcome(s, BRICKS, 'pass');                        // apply → test
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(recordOutcome(s, BRICKS, 'fail'), { node: 'apply' });   // retry i+1
      recordOutcome(s, BRICKS, 'pass');                      // apply → test
    }
    return recordOutcome(s, BRICKS, 'fail');                 // 6th return to apply
  };
  assert.deepEqual(drive(), { discard: true, resplit: true });
  assert.equal(s.node, 'identify'); assert.equal(s.resplit, true);
  assert.deepEqual(drive(), { stopped: 'apply-test exhausted its max of 5 twice in iteration 1' });
  assert.equal(s.status, 'stopped');
});

test('a read brick that changes the tree stops the loop', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1; s.snapshot = '';
  assert.deepEqual(recordOutcome(s, BRICKS, 'more', { card, porcelain: ' M x.js' }),
    { stopped: 'read-brick-wrote: identify changed the working tree' });
});

test('two empty iterations in a row stop the loop', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  const emptyUnit = () => {
    recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
    recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
    return scoreDiff(s, []);
  };
  assert.deepEqual(emptyUnit(), { empty: true, commit: false });
  assert.deepEqual(emptyUnit(), { stopped: 'two consecutive iterations produced no diff' });
});

test('prudent waits for the graph before anything runs', () => {
  const s = start('prudent');
  assert.deepEqual(nextStep(s, BRICKS), { awaiting: { kind: 'launch' }, preset: 'prudent' });
  assert.deepEqual(decideAwaiting(s, BRICKS, 'ok'), { resumed: true });
  assert.equal(nextStep(s, BRICKS).node, 'reproduce');
});

test('LOOP.md round-trips, with CRLF tolerated', () => {
  const s = start();
  const text = renderLoopFile(s);
  assert.match(text, /^# Loop — t\n\nr\n/);
  assert.deepEqual(parseLoopFile(text), s);
  assert.deepEqual(parseLoopFile(text.replace(/\n/g, '\r\n')), s);
  assert.throws(() => parseLoopFile('# nothing'), /no loop-state block/);
});

test('the preset is re-read from the state on every score (editing LOOP.md takes effect)', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card });
  s.preset = 'prudent';
  assert.equal(scoreDeclared(s).decision, 'blocking');
});

test('trailers format', () => {
  const s = start(); s.iteration = 3; s.visited = ['identify', 'apply', 'apply', 'test'];
  s.current = { declared: 0.4, decision: 'soft' }; s.tests = 'pass';
  assert.equal(trailers(s), 'Loop-Iteration: 3\nLoop-Bricks: identify,apply,test\nLoop-Risk-Declared: 0.4\n'
    + 'Loop-Risk-Actual: 0.4\nLoop-Threshold: balanced 0.2/0.6\nLoop-Decision: soft\nLoop-Tests: pass');
});

// --- Fix round 1 -----------------------------------------------------------------------------

// F1 (fix round 2 — G2): the fixture now declares `review-fix` ([apply, test, review], max 3),
// an explicit inner loop around the review -> apply cycle (a graph rule, not a runtime one: G1
// in js/loop/graph.mjs now refuses this cycle at `checkGraph` time when no such loop exists).
// `apply`/`test`'s budget is 1 + max(apply-test.max=5, review-fix.max=3) = 6, unchanged from
// before `review-fix` existed; `review`'s budget is 1 + review-fix.max = 4, new.
test('F1: review -> apply is bounded by its own declared inner loop (review-fix, max 3)', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'test' }); // apply -> test, entry 1
  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'review' }); // test -> review, entries 1..4
    assert.deepEqual(recordOutcome(s, BRICKS, 'fail'), { node: 'apply' });  // review -> apply, entries 2..5
    if (i < 3) assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'test' }); // apply -> test, entries 2..4
  }
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'test' }); // apply -> test, entry 5 (allowed: 6, ok)
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'),                   // test -> review, entry 5 > allowed 4: exhaust
    { discard: true, resplit: true });
  assert.equal(s.node, 'identify'); assert.equal(s.resplit, true);
  assert.deepEqual(s.notes, ['iteration 1: review-fix exhausted its max of 3; re-split once']);
});

// F1: dropping the `from !== h` condition bounds an edge from the head back into itself.
test('F1: an edge from the iteration head back into itself closes the unit, not an infinite loop', () => {
  const bricks = new Map([
    brick('identify', 'read', ['loop', 'done']), brick('apply', 'mutate', ['pass']),
  ]);
  const graph = {
    name: 'g', description: 'd', nodes: ['identify', 'apply'], start: 'identify',
    edges: [
      { from: 'identify', on: 'loop', to: 'identify' }, { from: 'identify', on: 'done', to: '$close' },
      { from: 'apply', on: 'pass', to: '$close' },
    ],
    loops: [{ name: 'iterations', nodes: ['identify', 'apply'], max: 20, iteration: true }],
  };
  const s = initState({ title: 't', requirement: 'r', graph, preset: 'balanced' });
  assert.equal(s.iteration, 1); // start is inside the iteration loop
  assert.deepEqual(recordOutcome(s, bricks, 'loop'), { node: 'identify' });
  assert.equal(s.iteration, 2); // the self-edge closed the unit instead of looping forever
});

// F2: LOOP.md is dropped from the scored diff before the write-set check and the empty check.
test('F2: scoreDiff drops LOOP.md rows before the write-set check and scoring', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  const result = scoreDiff(s, [file('LOOP.md'), file('src/a.js')]);
  assert.equal(result.commit, true);
  assert.match(result.trailers, /Loop-Risk-Declared: 0\.4\nLoop-Risk-Actual: 0\.4/);
});

test('F2: a diff of only LOOP.md counts as empty', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  assert.deepEqual(scoreDiff(s, [file('LOOP.md')]), { empty: true, commit: false });
});

test('F2: a read-brick porcelain that only touches LOOP.md does not stop the loop', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1; s.snapshot = '';
  assert.deepEqual(recordOutcome(s, BRICKS, 'more', { card, porcelain: ' M LOOP.md' }), { node: 'apply' });
});

// F3: rejecting the setup unit (iteration 0, start outside the iteration loop) stops the loop —
// there is no "back to the head" to reset into.
test('F3: rejecting the setup unit stops the loop instead of resetting it', () => {
  const s = start(); // node: 'reproduce', iteration: 0
  assert.deepEqual(scoreDeclared(s, { actions: ['architecture'], writeSet: ['t.js'] }).decision, 'blocking');
  assert.deepEqual(decideAwaiting(s, BRICKS, 'no', 'wrong bug'), { stopped: 'setup rejected: wrong bug' });
  assert.equal(s.status, 'stopped');
});

// F4: an amended actual verdict keeps the decision at blocking and says so in the trailers; the
// retry budget (counters) restarts since the user changed what the unit does.
test('F4: an amended actual verdict renders "blocking (amended)" in the trailers', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card });
  scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  assert.deepEqual(scoreDiff(s, [file('src/a.js'), file('src/b.js')]),
    { score: 0.8, decision: 'blocking', reasons: ['outside the write set: src/b.js'], commit: false });
  assert.deepEqual(decideAwaiting(s, BRICKS, 'amend', 'keep b.js out'), { resumed: true });
  assert.deepEqual(s.counters, {});
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'test' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'review' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { verify: true });
  const c = scoreDiff(s, [file('src/a.js')]);
  assert.equal(c.commit, true);
  assert.match(c.trailers, /Loop-Risk-Actual: 0\.4/);
  assert.match(c.trailers, /Loop-Decision: blocking \(amended\)/);
});

// F5: a unit that reaches the head with no mutate node visited (a read-only setup brick) closes
// without a verify step — it never touched the tree, so there is nothing to diff.
test('F5: a read-only setup unit closes without asking for a diff score', () => {
  const bricks = new Map([
    brick('plan', 'read', ['pass']), brick('identify', 'read', ['more', 'done']),
    brick('apply', 'mutate', ['pass']), brick('test', 'read', ['pass']),
  ]);
  const graph = {
    name: 'g', description: 'd', nodes: ['plan', 'identify', 'apply', 'test'], start: 'plan',
    edges: [
      { from: 'plan', on: 'pass', to: 'identify' },
      { from: 'identify', on: 'more', to: 'apply' }, { from: 'identify', on: 'done', to: '$close' },
      { from: 'apply', on: 'pass', to: 'test' }, { from: 'test', on: 'pass', to: 'identify' },
    ],
    loops: [{ name: 'iterations', nodes: ['identify', 'apply', 'test'], max: 20, iteration: true }],
  };
  const s = initState({ title: 't', requirement: 'r', graph, preset: 'balanced' });
  assert.equal(s.iteration, 0);
  assert.deepEqual(recordOutcome(s, bricks, 'pass'), { node: 'identify' });
  assert.equal(s.iteration, 1);
});

// F5: an empty diff on a closing unit finishes it as done, even mid-way through a would-be
// two-empty-iterations stop.
test('F5: an empty diff on a closing unit finishes it as done, not as a stop', () => {
  const bricks = new Map([
    brick('identify', 'read', ['more', 'done']), brick('apply', 'mutate', ['pass']),
  ]);
  const graph = {
    name: 'g', description: 'd', nodes: ['identify', 'apply'], start: 'identify',
    edges: [
      { from: 'identify', on: 'more', to: 'apply' }, { from: 'identify', on: 'done', to: '$close' },
      { from: 'apply', on: 'pass', to: '$close' },
    ],
    loops: [{ name: 'iterations', nodes: ['identify', 'apply'], max: 20, iteration: true }],
  };
  const s = initState({ title: 't', requirement: 'r', graph, preset: 'balanced' });
  s.node = 'identify'; s.iteration = 1; s.emptyStreak = 1; // would stop on a plain 2nd empty diff
  recordOutcome(s, bricks, 'more', { card: { actions: ['logic'], writeSet: ['a.js'], intent: 'x' } });
  scoreDeclared(s);
  assert.deepEqual(recordOutcome(s, bricks, 'pass'), { verify: true });
  assert.equal(s.closing, true);
  assert.deepEqual(scoreDiff(s, []), { empty: true, commit: false });
  assert.equal(s.status, 'done');
});

// F5: parseLoopFile must find the LAST end marker, so a title/requirement that happens to
// contain the literal marker text still parses.
test('F5: parseLoopFile uses the last end marker, tolerating one earlier in the title', () => {
  const s = start();
  s.title = 'fix <!-- loop-state:end --> rendering';
  const text = renderLoopFile(s);
  assert.deepEqual(parseLoopFile(text), s);
});

// F5: a malformed `contracts` field fails loudly instead of silently miscomputing risk.
test('F5: scoreDiff rejects a non-array contracts field', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  s.contracts = 'not-an-array';
  assert.throws(() => scoreDiff(s, [file('src/a.js')]), /LOOP\.md: contracts must be a list of file paths/);
});
