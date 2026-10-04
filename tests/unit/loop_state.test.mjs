// tests/unit/loop_state.test.mjs
// Scenarios, each a script of engine calls with the expected result written after every call.
// The trailer block is written out byte for byte: it is what lands in a user's git history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  initState, nextStep, scoreDeclared, scoreDiff, recordOutcome, decideAwaiting,
  renderLoopFile, parseLoopFile, writeLoopFile, trailers, renameWithRetry,
} from '../../js/loop/state.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

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

// Fix round 1, item 3: `writeLoopFile`'s atomic writer leaves a `LOOP.md.tmp` sibling for the
// instant between the write and the rename — ordinarily invisible, but a lingering one (a crash
// in that window) must not pollute the scored diff or the read-brick porcelain check, exactly
// like LOOP.md itself.
test('a lingering LOOP.md.tmp is dropped from the scored diff, same as LOOP.md', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  const result = scoreDiff(s, [file('LOOP.md'), file('LOOP.md.tmp'), file('src/a.js')]);
  assert.equal(result.commit, true);
  assert.match(result.trailers, /Loop-Risk-Declared: 0\.4\nLoop-Risk-Actual: 0\.4/);
});

test('a diff of only LOOP.md and LOOP.md.tmp counts as empty', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
  recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  assert.deepEqual(scoreDiff(s, [file('LOOP.md'), file('LOOP.md.tmp')]), { empty: true, commit: false });
});

test('a read-brick porcelain that only touches LOOP.md.tmp does not stop the loop', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1; s.snapshot = '';
  assert.deepEqual(recordOutcome(s, BRICKS, 'more', { card, porcelain: '?? LOOP.md.tmp' }), { node: 'apply' });
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
  assert.throws(() => scoreDiff(s, [file('src/a.js')]), /LOOP\.md: contracts must be a list of file paths or globs/);
});

// F6 (Task 5 controller amendment): the read-only-unit-reaches-head path in `recordOutcome`
// calls `finishUnit(state, false)`, which can itself hit the iteration ceiling and stop the
// loop — the return value must report that stop, not the head node `finishUnit` was about to
// set. A one-node self-looping read brick with a ceiling of 1 hits the stop on its first entry.
test('F6: a read-only unit that re-enters the head and hits the iteration ceiling reports the stop', () => {
  const bricks = new Map([brick('identify', 'read', ['loop', 'done'])]);
  const graph = {
    name: 'g', description: 'd', nodes: ['identify'], start: 'identify',
    edges: [
      { from: 'identify', on: 'loop', to: 'identify' }, { from: 'identify', on: 'done', to: '$close' },
    ],
    loops: [{ name: 'iterations', nodes: ['identify'], max: 1, iteration: true }],
  };
  const s = initState({ title: 't', requirement: 'r', graph, preset: 'balanced' });
  assert.equal(s.iteration, 1);
  assert.deepEqual(recordOutcome(s, bricks, 'loop'), { stopped: 'iteration ceiling of 1 reached' });
  assert.equal(s.status, 'stopped');
});

// --- Final review ----------------------------------------------------------------------------

// I1: amending a blocked SETUP diff re-runs the setup brick (graph.start), not the iteration's
// first mutate node — the setup unit's work is a reproduction test, not the fix.
test('I1: an amended setup diff resumes at graph.start, not at the iteration\'s first mutate node', () => {
  const s = start(); // node: 'reproduce', iteration: 0
  scoreDeclared(s, { actions: ['new-file'], writeSet: ['test/a.test.js'], intent: 'reproduce' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { verify: true });
  assert.deepEqual(scoreDiff(s, [file('test/a.test.js'), file('src/b.js')]),
    { score: 0.8, decision: 'blocking', reasons: ['outside the write set: src/b.js'], commit: false });
  assert.deepEqual(decideAwaiting(s, BRICKS, 'amend', 'test only'), { resumed: true });
  assert.equal(s.node, 'reproduce');
  assert.equal(s.iteration, 0);
});

// I1: an inner loop exhausted during setup has no head to re-split into (the head belongs to
// the iterations that come after setup), so it stops the loop by name instead.
test('I1: exhausting an inner loop during setup stops the loop instead of jumping to the head', () => {
  const g = bugfix();
  g.edges.find((e) => e.from === 'reproduce' && e.on === 'fail').to = 'reproduce';
  g.loops.push({ name: 'repro', nodes: ['reproduce'], max: 2 });
  const s = initState({ title: 't', requirement: 'r', graph: g, preset: 'balanced' });
  scoreDeclared(s, { actions: ['new-file'], writeSet: ['test/a.test.js'], intent: 'reproduce' });
  for (let i = 0; i < 3; i += 1) assert.deepEqual(recordOutcome(s, BRICKS, 'fail'), { node: 'reproduce' });
  assert.deepEqual(recordOutcome(s, BRICKS, 'fail'), { stopped: 'setup repro exhausted its max of 2' });
  assert.equal(s.status, 'stopped');
});

// M2: once the unit has closed (pendingVerify), a declared score would rewrite the card of a unit
// whose diff has not been scored yet; it is refused with the same message `record` gives.
test('M2: scoreDeclared is refused while the iteration waits for its diff score', () => {
  const s = start();
  scoreDeclared(s, { actions: ['new-file'], writeSet: ['test/a.test.js'], intent: 'reproduce' });
  recordOutcome(s, BRICKS, 'pass');
  assert.throws(() => scoreDeclared(s, { actions: ['logic'] }),
    { message: 'the iteration is closed: run `geneseed loop score --diff` first' });
});

// Fix round 1, item 3: `writeLoopFile` writes `<file>.tmp` then renames — no `.tmp` sibling
// survives a successful write, and the result round-trips through `parseLoopFile` byte for
// byte with what `renderLoopFile` would have written directly. Also covers overwriting an
// existing LOOP.md (the `init`/`withState` call sites both rewrite one that already exists
// on every action after the first).
test('writeLoopFile writes atomically: no .tmp sibling survives, and the state round-trips', () => {
  const sb = makeSandbox('loopstate-');
  try {
    const s = start();
    const file = path.join(sb.path, 'LOOP.md');
    writeLoopFile(file, s);
    assert.ok(existsSync(file));
    assert.ok(!existsSync(`${file}.tmp`), 'the atomic writer must not leave its tmp file behind');
    // `writeText` (the writer `writeLoopFile` goes through) translates `\n` to the platform's
    // line separator, so the bytes on disk are CRLF on Windows while `renderLoopFile` returns
    // bare `\n` — compared through `parseLoopFile`, which tolerates both, not byte for byte.
    assert.deepEqual(parseLoopFile(readFileSync(file, 'utf8')), s);

    // Overwrite: a second write (a later action, a changed preset) replaces the file cleanly.
    const s2 = { ...s, preset: 'aggressive' };
    writeLoopFile(file, s2);
    assert.ok(!existsSync(`${file}.tmp`));
    assert.deepEqual(parseLoopFile(readFileSync(file, 'utf8')), s2);
  } finally { sb.cleanup(); }
});

test('initState refuses an inherited Object key as a preset — PRESETS[preset] is truthy for these', () => {
  for (const bad of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => initState({ title: 't', requirement: 'r', graph: bugfix(), preset: bad }),
      new RegExp(`unknown preset ${JSON.stringify(bad)}`), bad);
  }
});

// Fix round 2, item 2: a rename that fails with a transient Windows lock (EPERM/EACCES/EBUSY —
// an AV scanner or editor briefly holding the handle) is retried up to 3 times with a short
// synchronous back-off, not surfaced on the first failure.
test('renameWithRetry retries a transient lock and succeeds once the lock clears', () => {
  let calls = 0;
  const renameFn = () => {
    calls += 1;
    if (calls < 3) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
  };
  renameWithRetry('a.tmp', 'a', renameFn);
  assert.equal(calls, 3);
});

test('renameWithRetry gives up after 3 attempts, removes the temp file, and rethrows', () => {
  const sb = makeSandbox('loopstate-');
  try {
    const tmp = path.join(sb.path, 'a.tmp');
    writeFileSync(tmp, 'x');
    let calls = 0;
    const renameFn = () => { calls += 1; const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
    assert.throws(() => renameWithRetry(tmp, path.join(sb.path, 'a'), renameFn), { code: 'EBUSY' });
    assert.equal(calls, 3);
    assert.ok(!existsSync(tmp), 'the temp file must be removed on final failure');
  } finally { sb.cleanup(); }
});

test('renameWithRetry does not retry a non-transient error, and still removes the temp file', () => {
  const sb = makeSandbox('loopstate-');
  try {
    const tmp = path.join(sb.path, 'a.tmp');
    writeFileSync(tmp, 'x');
    let calls = 0;
    const renameFn = () => { calls += 1; const e = new Error('nope'); e.code = 'ENOENT'; throw e; };
    assert.throws(() => renameWithRetry(tmp, path.join(sb.path, 'a'), renameFn), { code: 'ENOENT' });
    assert.equal(calls, 1, 'a non-retryable error must not be retried');
    assert.ok(!existsSync(tmp));
  } finally { sb.cleanup(); }
});

// --- record --note: findings that survive the unit --------------------------------------------

// A setup read brick's output is otherwise dropped (`finishUnit` → `resetUnit` clears `card`,
// and only `decideAwaiting`/`exhaust` push to `notes`). `recordOutcome`'s `note` option is the
// fix: pushed before the transition, so a read-only setup unit's note is still in `notes` after
// it closes into iteration 1, and the next brick's `next` result hands it back.
test('N1: a note on a read setup brick survives the unit close, and next returns it', () => {
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
  assert.deepEqual(recordOutcome(s, bricks, 'pass', { note: 'iteration 1\niteration 2' }), { node: 'identify' });
  assert.equal(s.iteration, 1); // the setup unit closed (read-only: no diff to score)
  assert.deepEqual(s.notes, ['iteration 0 (plan): iteration 1\niteration 2']);
  assert.deepEqual(nextStep(s, bricks).notes, ['iteration 0 (plan): iteration 1\niteration 2']);
});

// A `review` `fail`'s findings are otherwise lost — `apply` only gets `card` and `notes`, and
// nothing stores what `review` found. `--note` on the `record` that reports `fail` is how those
// findings reach `apply`'s `next` result.
test('N2: a note on review fail reaches apply\'s next result', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card }); scoreDeclared(s);
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'test' });   // apply -> test
  assert.deepEqual(recordOutcome(s, BRICKS, 'pass'), { node: 'review' }); // test -> review
  assert.deepEqual(recordOutcome(s, BRICKS, 'fail', { note: 'src/a.js:10 off by one' }), { node: 'apply' });
  assert.deepEqual(s.notes, ['iteration 1 (review): src/a.js:10 off by one']);
  assert.deepEqual(nextStep(s, BRICKS).notes, ['iteration 1 (review): src/a.js:10 off by one']);
});

// No note passed (the default `''`) pushes nothing — every prior scenario's exact `notes` arrays
// stay exact, not silently prefixed with an empty entry.
test('N3: recordOutcome with no note pushes nothing to notes', () => {
  const s = start(); s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card });
  assert.deepEqual(s.notes, []);
});

// ---------------------------------------------------------------------------------------------
// G2 — the human gate. A `gate: human` brick's outcome (and note) is recorded, then the
// transition is HELD: `awaiting: {kind: 'gate', node, outcome, note?}` whatever the preset and
// the score. `ok` follows the held edge; `no` stops; `amend` re-runs the same node (its
// validation kept), at most 3 times per node per iteration (a new card gets its own 3). Every answer leaves a note; a passed gate
// also lands in the unit's trailers (`Loop-Gates`) and history. ORDER on one mutate brick: the
// declared score's blocking stop comes first, at its usual point before the brick runs; the
// gate after its outcome; the diff's blocking stop after the gate releases the transition — so
// nothing is scored, committed, re-split or stopped by the transition before the user answers.
const GB = new Map([
  ...BRICKS,
  ['draft', { name: 'draft', effect: 'read', outcomes: ['pass', 'fail'], agent: 'architect', skill: null, gate: 'human', body: 'do draft', available: true }],
  ['write', { name: 'write', effect: 'mutate', outcomes: ['pass', 'fail'], agent: 'developer', skill: null, gate: 'human', body: 'do write', available: true }],
]);
// setup: draft (read, gated); iterations: identify -> write (mutate, gated) -> identify,
// with write's `fail` retrying itself inside the `rewrite` ring (max 1).
const gated = () => ({
  name: 'gated', description: 'd', nodes: ['draft', 'identify', 'write'], start: 'draft',
  edges: [
    { from: 'draft', on: 'pass', to: 'identify' }, { from: 'draft', on: 'fail', to: '$stop' },
    { from: 'identify', on: 'more', to: 'write' }, { from: 'identify', on: 'done', to: '$close' },
    { from: 'write', on: 'pass', to: 'identify' }, { from: 'write', on: 'fail', to: 'write' },
  ],
  loops: [
    { name: 'iterations', nodes: ['identify', 'write'], max: 20, iteration: true },
    { name: 'rewrite', nodes: ['write'], max: 1 },
  ],
});
const gstart = (preset = 'balanced') => initState({ title: 't', requirement: 'r', graph: gated(), preset });
const atWrite = (s, actions = ['logic']) => {
  s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, GB, 'more', { card: { intent: 'w', writeSet: ['src/a.js'], actions } });
  return scoreDeclared(s);
};

test('G2: a gate holds the transition; ok follows the held edge', () => {
  const s = gstart();
  assert.deepEqual(recordOutcome(s, GB, 'pass', { note: 'ADR at /tmp/adr.md' }),
    { awaiting: { kind: 'gate', node: 'draft', outcome: 'pass', note: 'ADR at /tmp/adr.md' } });
  assert.equal(s.status, 'awaiting'); assert.equal(s.node, 'draft'); assert.equal(s.iteration, 0);
  assert.deepEqual(nextStep(s, GB), { awaiting: { kind: 'gate', node: 'draft', outcome: 'pass', note: 'ADR at /tmp/adr.md' }, preset: 'balanced' });
  assert.throws(() => recordOutcome(s, GB, 'pass'), /the loop is awaiting, not running/);
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { node: 'identify' });
  assert.equal(s.iteration, 1); assert.equal(s.status, 'running');
  assert.deepEqual(s.notes, ['iteration 0 (draft): ADR at /tmp/adr.md', 'iteration 0 (gate at draft, ok)']);
});

test('G2: no stops with the gate named; ok on a held $stop edge stops as the brick reported', () => {
  const s = gstart();
  recordOutcome(s, GB, 'pass');
  assert.deepEqual(s.awaiting, { kind: 'gate', node: 'draft', outcome: 'pass' });
  assert.deepEqual(decideAwaiting(s, GB, 'no', 'wrong option'), { stopped: 'gate rejected at draft: wrong option' });
  assert.deepEqual(s.notes, ['iteration 0 (gate at draft, no): wrong option']);
  const t = gstart();
  recordOutcome(t, GB, 'fail');
  assert.equal(t.status, 'awaiting');
  assert.deepEqual(decideAwaiting(t, GB, 'ok'), { stopped: 'draft reported fail' });
  const u = gstart(); recordOutcome(u, GB, 'pass');
  assert.deepEqual(decideAwaiting(u, GB, 'no'), { stopped: 'gate rejected at draft' });
});

test('G2: amend re-runs the same node, three times at most; the 4th amend stops', () => {
  const s = gstart();
  for (let i = 1; i <= 3; i += 1) {
    recordOutcome(s, GB, 'pass');
    assert.deepEqual(decideAwaiting(s, GB, 'amend', `tighten ${i}`), { resumed: true });
    assert.equal(s.node, 'draft'); assert.equal(s.status, 'running');
  }
  recordOutcome(s, GB, 'pass');
  assert.deepEqual(decideAwaiting(s, GB, 'amend', 'again'), { stopped: 'gate amended 3 times at draft' });
  assert.deepEqual(s.notes, [
    'iteration 0 (gate at draft, amend): tighten 1', 'iteration 0 (gate at draft, amend): tighten 2',
    'iteration 0 (gate at draft, amend): tighten 3', 'iteration 0 (gate at draft, amend): again',
  ]);
});

test('G2: an amended mutate gate keeps its validation, and the passed gate reaches the trailers', () => {
  const s = gstart();
  assert.equal(atWrite(s).decision, 'soft');
  assert.deepEqual(recordOutcome(s, GB, 'pass').awaiting, { kind: 'gate', node: 'write', outcome: 'pass' });
  decideAwaiting(s, GB, 'amend', 'rename it');
  assert.equal(s.validated, true);
  assert.equal(nextStep(s, GB).validate, false);
  recordOutcome(s, GB, 'pass');                      // no second score --declared needed
  // The held edge closes the unit: the diff is scored only now, after the answer.
  assert.equal(s.pendingVerify, false);
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { verify: true });
  const c = scoreDiff(s, [file('src/a.js')]);
  assert.equal(c.trailers, [
    'Loop-Iteration: 1', 'Loop-Bricks: identify,write', 'Loop-Risk-Declared: 0.4', 'Loop-Risk-Actual: 0.4',
    'Loop-Threshold: balanced 0.2/0.6', 'Loop-Decision: soft', 'Loop-Tests: n/a', 'Loop-Gates: write',
  ].join('\n'));
  assert.deepEqual(s.history.at(-1).gates, ['write']);
});

test('G2: the gate fires under aggressive with a silent score', () => {
  const s = gstart('aggressive');
  assert.equal(atWrite(s, ['format']).decision, 'silent');
  assert.equal(recordOutcome(s, GB, 'pass').awaiting.kind, 'gate');
});

test('G2: declared blocking first, then the gate, on the same brick', () => {
  const s = gstart();
  assert.equal(atWrite(s, ['api']).decision, 'blocking');
  assert.equal(nextStep(s, GB).awaiting.kind, 'declared');
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { resumed: true });
  assert.equal(recordOutcome(s, GB, 'pass').awaiting.kind, 'gate');
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { verify: true });
});

test('G2: a ring exhausted by the held edge re-splits only after ok', () => {
  const s = gstart(); atWrite(s);                                           // identify -> write: entry 1 of 2
  recordOutcome(s, GB, 'fail');
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { node: 'write' });       // entry 2 of 2 (rewrite max 1)
  assert.deepEqual(recordOutcome(s, GB, 'fail').awaiting, { kind: 'gate', node: 'write', outcome: 'fail' });
  assert.equal(s.resplit, false);
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { discard: true, resplit: true });
});

// The amend cap is per node PER ITERATION: the next iteration's card is a new draft with its
// own three amends, so a long run is not stopped by amends spent on earlier, accepted units.
test('G2: the amend cap resets for the same node in the next iteration', () => {
  const s = gstart(); atWrite(s);
  for (let i = 1; i <= 3; i += 1) { recordOutcome(s, GB, 'pass'); decideAwaiting(s, GB, 'amend', `a${i}`); }
  recordOutcome(s, GB, 'pass');
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { verify: true });
  scoreDiff(s, [file('src/a.js')]);
  assert.equal(s.iteration, 2);
  recordOutcome(s, GB, 'more', { card: { intent: 'w2', writeSet: ['src/a.js'], actions: ['logic'] } });
  scoreDeclared(s);
  recordOutcome(s, GB, 'pass');
  assert.deepEqual(decideAwaiting(s, GB, 'amend', 'b1'), { resumed: true });
  assert.deepEqual(s.gateAmends, { 'write@1': 3, 'write@2': 1 });
});

// `gateOn` holds only the listed outcomes: the rest follow their edge at once, ungated.
test('G2: gateOn holds only its listed outcomes', () => {
  const B = new Map([...GB, ['draft', { ...GB.get('draft'), gateOn: ['pass'] }]]);
  const s = gstart();
  assert.deepEqual(recordOutcome(s, B, 'fail'), { stopped: 'draft reported fail' });
  const t = gstart();
  assert.deepEqual(recordOutcome(t, B, 'pass').awaiting, { kind: 'gate', node: 'draft', outcome: 'pass' });
});

// A gate passed twice in one unit is listed once, as Loop-Bricks lists a node once.
test('G2: a gate passed twice in one unit appears once in Loop-Gates', () => {
  const s = gstart(); atWrite(s);
  recordOutcome(s, GB, 'fail'); decideAwaiting(s, GB, 'ok');             // write -> write
  recordOutcome(s, GB, 'pass');
  assert.deepEqual(decideAwaiting(s, GB, 'ok'), { verify: true });
  assert.match(scoreDiff(s, [file('src/a.js')]).trailers, /\nLoop-Gates: write$/);
  assert.deepEqual(s.history.at(-1).gates, ['write']);
});

// G5: a template's `contracts` globs are copied into the state at init, followed by any extra
// ones `loop init --contracts` passes; the diff score matches them as globs.
test('G5: graph contracts are copied at init, extra ones appended, and match as globs', () => {
  const s = initState({ title: 't', requirement: 'r', graph: { ...bugfix(), contracts: ['api/**'] }, contracts: ['proto/*.proto'] });
  assert.deepEqual(s.contracts, ['api/**', 'proto/*.proto']);
  assert.deepEqual(start().contracts, []);
  s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card: { ...card, writeSet: ['proto/u.proto'] } });
  scoreDeclared(s); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  assert.deepEqual(scoreDiff(s, [file('proto/u.proto')]),
    { score: 0.8, decision: 'blocking', reasons: ['contract files: proto/u.proto'], commit: false });
});

// G6: the graph's `ignoreDeletions` reaches the diff score.
test('G6: a graph\'s ignoreDeletions keeps a lockfile\'s deletions out of the count', () => {
  const s = initState({ title: 't', requirement: 'r', graph: { ...bugfix(), ignoreDeletions: ['**/package-lock.json'] } });
  s.node = 'identify'; s.iteration = 1;
  recordOutcome(s, BRICKS, 'more', { card: { ...card, writeSet: ['package-lock.json'] } });
  scoreDeclared(s); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass'); recordOutcome(s, BRICKS, 'pass');
  assert.equal(scoreDiff(s, [file('package-lock.json', 900)]).commit, true);
});
